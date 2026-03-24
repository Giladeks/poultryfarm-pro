// app/api/daily-summary/[id]/route.js
// PATCH — worker updates checklist items and/or closing observation
//         PM can add reviewNotes and mark as REVIEWED
//
// Allowed fields (worker):
//   waterNipplesChecked, manureBeltsRun, aislesSwept, cageDoorsInspected
//   closingObservation
//
// Allowed fields (PM+):
//   reviewNotes, status (REVIEWED | FLAGGED)

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const WORKER_ROLES = ['PEN_WORKER', 'PEN_MANAGER', 'PRODUCTION_STAFF'];
const PM_ROLES     = ['PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

const patchSchema = z.object({
  // Checklist (worker can set)
  waterNipplesChecked: z.boolean().optional(),
  manureBeltsRun:      z.boolean().optional(),
  aislesSwept:         z.boolean().optional(),
  cageDoorsInspected:  z.boolean().optional(),
  // Observation (worker)
  closingObservation:  z.string().max(1000).nullable().optional(),
  // PM review fields
  reviewNotes: z.string().max(1000).nullable().optional(),
  status:      z.enum(['REVIEWED', 'FLAGGED']).optional(),
}).strict();

export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const allowedRoles = [...WORKER_ROLES, ...PM_ROLES];
  if (!allowedRoles.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await request.json();
    const data = patchSchema.parse(body);

    // Verify the summary belongs to this tenant
    const existing = await prisma.dailySummary.findFirst({
      where: {
        id:      params.id,
        tenantId: user.tenantId,
      },
    });
    if (!existing)
      return NextResponse.json({ error: 'Daily summary not found' }, { status: 404 });

    // Workers cannot update PM-only fields
    const isPM = PM_ROLES.includes(user.role);
    if (!isPM && (data.reviewNotes !== undefined || data.status !== undefined))
      return NextResponse.json({ error: 'Only Pen Managers can set review notes or status' }, { status: 403 });

    // Locked summaries (REVIEWED) can only be updated by PM+
    if (existing.status === 'REVIEWED' && !isPM)
      return NextResponse.json({ error: 'This summary has been reviewed and is locked' }, { status: 422 });

    const updateData = {
      ...(data.waterNipplesChecked !== undefined && { waterNipplesChecked: data.waterNipplesChecked }),
      ...(data.manureBeltsRun      !== undefined && { manureBeltsRun:      data.manureBeltsRun }),
      ...(data.aislesSwept         !== undefined && { aislesSwept:         data.aislesSwept }),
      ...(data.cageDoorsInspected  !== undefined && { cageDoorsInspected:  data.cageDoorsInspected }),
      ...(data.closingObservation  !== undefined && { closingObservation:  data.closingObservation }),
      ...(isPM && data.reviewNotes !== undefined && { reviewNotes: data.reviewNotes }),
      ...(isPM && data.status      !== undefined && {
        status:       data.status,
        reviewedById: user.sub,
        reviewedAt:   new Date(),
      }),
    };

    const summary = await prisma.dailySummary.update({
      where:   { id: params.id },
      data:    updateData,
      include: { reviewedBy: { select: { firstName: true, lastName: true } } },
    });

    return NextResponse.json({ summary });
  } catch (err) {
    if (err.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 422 });
    console.error('[daily-summary PATCH]', err);
    return NextResponse.json({ error: 'Failed to update daily summary' }, { status: 500 });
  }
}
