// app/api/flock-events/[id]/verify-disposal/route.js
// Phase 8-Supplement · FlockLifecycleEvent — Disposal Verification
//
// POST /api/flock-events/[id]/verify-disposal
//
// Called by IC or FM after physically verifying that disposed birds
// were properly buried/cremated/incinerated.
// Body: { notes?: string }
//
// Only valid for events with disposition === 'DISPOSED' and status === 'APPROVED'.
// Sets status → DISPOSAL_VERIFIED.
//
// Roles: INTERNAL_CONTROL, FARM_MANAGER, FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const VERIFY_ROLES = [
  'INTERNAL_CONTROL', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];

const verifySchema = z.object({
  notes: z.string().max(1000).optional().nullable(),
});

export async function POST(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user)                              return NextResponse.json({ error: 'Unauthorized' },  { status: 401 });
  if (!VERIFY_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden — Internal Control or Farm Manager role required' }, { status: 403 });

  try {
    const body = await request.json();
    const data = verifySchema.parse(body);

    // ── Load event ────────────────────────────────────────────────────────────
    const event = await prisma.flockLifecycleEvent.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: {
        flock:       { select: { id: true, batchCode: true } },
        submittedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!event)
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (event.disposition !== 'DISPOSED')
      return NextResponse.json({
        error: `Disposal verification only applies to DISPOSED events — this event has disposition ${event.disposition}`,
      }, { status: 422 });
    if (event.status !== 'APPROVED')
      return NextResponse.json({
        error: `Event must be APPROVED before disposal can be verified (current: ${event.status})`,
      }, { status: 422 });

    // COI: verifier cannot be the original submitter
    if (event.submittedById === user.sub)
      return NextResponse.json({
        error: 'Conflict of interest — you cannot verify disposal of an event you submitted',
        coiBlocked: true,
      }, { status: 403 });

    const now = new Date();

    const updated = await prisma.flockLifecycleEvent.update({
      where: { id: params.id },
      data: {
        status:                    'DISPOSAL_VERIFIED',
        disposalVerifiedById:      user.sub,
        disposalVerifiedAt:        now,
        disposalVerificationNotes: data.notes || null,
      },
      select: {
        id: true, status: true, disposition: true,
        disposalMethod: true, disposalLocation: true,
        disposalVerifiedAt: true, disposalVerificationNotes: true,
      },
    });

    // ── Notify the submitter ──────────────────────────────────────────────────
    await prisma.notification.create({
      data: {
        tenantId:    event.tenantId,
        recipientId: event.submittedById,
        type:        'REPORT_APPROVED',
        title:       `✅ Disposal Verified — ${event.flock.batchCode}`,
        message:     `${user.firstName} ${user.lastName} has verified the physical disposal of ${event.birdCount.toLocaleString()} birds from ${event.flock.batchCode} (${event.disposalMethod ?? 'method not recorded'}).${data.notes ? ` Notes: ${data.notes}` : ''}`,
        data:        { eventId: event.id, flockId: event.flockId },
        channel:     'IN_APP',
      },
    }).catch(() => {});

    // ── Audit log ─────────────────────────────────────────────────────────────
    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'UPDATE',
        entityType: 'FlockLifecycleEvent',
        entityId:   params.id,
        changes: {
          action:          'DISPOSAL_VERIFIED',
          verifiedBy:      user.sub,
          disposalMethod:  event.disposalMethod,
          disposalLocation:event.disposalLocation,
          birdCount:       event.birdCount,
          notes:           data.notes,
        },
      },
    }).catch(() => {});

    return NextResponse.json({
      message: `Disposal of ${event.birdCount.toLocaleString()} birds from ${event.flock.batchCode} verified`,
      event:   updated,
    });

  } catch (err) {
    if (err.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 422 });
    console.error('[POST /api/flock-events/[id]/verify-disposal]', err);
    return NextResponse.json({ error: 'Disposal verification failed', detail: err?.message }, { status: 500 });
  }
}
