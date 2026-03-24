// app/api/audit/acknowledge/route.js
// POST — IC Officer acknowledges a PM override, creating a permanent audit record
// that the override has been independently reviewed and accepted (or flagged).
//
// Body:
//   { entityType, entityId, action, reviewNote }
//   action: 'IC_OVERRIDE_ACKNOWLEDGED' | 'IC_OVERRIDE_FLAGGED'
//
// 'IC_OVERRIDE_FLAGGED' also creates a linked Investigation record.
// 'IC_OVERRIDE_ACKNOWLEDGED' writes to AuditLog only.

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const IC_ROLES = ['INTERNAL_CONTROL', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

const schema = z.object({
  entityType: z.enum(['EggProduction', 'MortalityRecord']),
  entityId:   z.string().min(1),
  action:     z.enum(['IC_OVERRIDE_ACKNOWLEDGED', 'IC_OVERRIDE_FLAGGED']),
  reviewNote: z.string().min(3, 'Review note is required'),
});

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!IC_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Only Internal Control and above can acknowledge overrides' }, { status: 403 });

  try {
    const body = await request.json();
    const data = schema.parse(body);

    // Check the override actually exists in the audit log before acknowledging it
    const overrideLog = await prisma.auditLog.findFirst({
      where: {
        tenantId:   user.tenantId,
        entityType: data.entityType,
        entityId:   data.entityId,
        action:     'APPROVE',
        changes:    { path: ['action'], equals: 'PM_OVERRIDE' },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!overrideLog)
      return NextResponse.json({ error: 'No PM override found for this record' }, { status: 404 });

    // Prevent double-acknowledgement
    const existing = await prisma.auditLog.findFirst({
      where: {
        tenantId:   user.tenantId,
        entityType: data.entityType,
        entityId:   data.entityId,
        userId:     user.sub,
        changes:    { path: ['action'], equals: data.action },
      },
    });
    if (existing)
      return NextResponse.json({ error: 'You have already reviewed this override' }, { status: 409 });

    // Write acknowledgement to audit log
    const auditEntry = await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'UPDATE',
        entityType: data.entityType,
        entityId:   data.entityId,
        changes: {
          action:          data.action,
          reviewedBy:      user.sub,
          reviewNote:      data.reviewNote,
          originalOverrideLogId: overrideLog.id,
          reviewedAt:      new Date().toISOString(),
        },
      },
    });

    // For FLAG action — also open a formal investigation
    let investigation = null;
    if (data.action === 'IC_OVERRIDE_FLAGGED') {
      // Prevent duplicate open investigations on same record
      const existingInv = await prisma.investigation.findFirst({
        where: {
          tenantId:      user.tenantId,
          referenceType: data.entityType,
          referenceId:   data.entityId,
          status:        { in: ['OPEN', 'UNDER_REVIEW', 'ESCALATED'] },
        },
      });

      if (!existingInv) {
        investigation = await prisma.investigation.create({
          data: {
            tenantId:    user.tenantId,
            referenceType: data.entityType,
            referenceId:   data.entityId,
            flaggedById:   user.sub,
            flagReason:    `PM Override flagged by IC: ${data.reviewNote}`,
            status:        'OPEN',
          },
        });
      } else {
        // Already has an open investigation — return it
        investigation = existingInv;
      }
    }

    return NextResponse.json({
      auditEntry,
      investigation,
      message: data.action === 'IC_OVERRIDE_ACKNOWLEDGED'
        ? 'Override acknowledged and recorded'
        : 'Override flagged for investigation',
    }, { status: 201 });

  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('[audit/acknowledge POST]', error);
    return NextResponse.json({ error: 'Failed to record review' }, { status: 500 });
  }
}
