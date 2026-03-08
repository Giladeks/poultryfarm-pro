// app/api/eggs/[id]/route.js — Edit a rejected egg production record
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const editSchema = z.object({
  totalEggs:     z.number().int().min(0),
  gradeACount:   z.number().int().min(0).optional(),
  gradeBCount:   z.number().int().min(0).optional(),
  crackedCount:  z.number().int().min(0).optional(),
  dirtyCount:    z.number().int().min(0).optional(),
  collectionDate: z.string().optional(),
  notes:         z.string().optional().nullable(),
});

export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Find the record and verify it belongs to this tenant and was submitted by this user
    const record = await prisma.eggProduction.findFirst({
      where: {
        id: params.id,
        flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
      },
      include: { flock: { select: { currentCount: true, operationType: true } } },
    });

    if (!record) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    // Only the original submitter can edit, and only if it's PENDING (returned from rejection)
    if (record.recordedById !== user.sub)
      return NextResponse.json({ error: 'You can only edit your own records' }, { status: 403 });
    if (record.submissionStatus !== 'PENDING')
      return NextResponse.json({ error: 'Only pending records can be edited' }, { status: 422 });

    const body = await request.json();
    const data = editSchema.parse(body);

    const layingRatePct = record.flock.currentCount > 0
      ? parseFloat(((data.totalEggs / record.flock.currentCount) * 100).toFixed(2))
      : 0;
    const cratesCount = Math.floor(data.totalEggs / 30);

    const updated = await prisma.eggProduction.update({
      where: { id: params.id },
      data: {
        totalEggs:      data.totalEggs,
        gradeACount:    data.gradeACount  ?? record.gradeACount,
        gradeBCount:    data.gradeBCount  ?? record.gradeBCount,
        crackedCount:   data.crackedCount ?? record.crackedCount,
        dirtyCount:     data.dirtyCount   ?? record.dirtyCount,
        ...(data.collectionDate && { collectionDate: new Date(data.collectionDate) }),
        ...(data.notes !== undefined && { notes: data.notes }),
        layingRatePct,
        cratesCount,
        submissionStatus: 'PENDING',   // stays PENDING — enters verification queue fresh
        rejectionReason:  null,        // clear the rejection reason
      },
    });

    // Reset linked verification back to PENDING so it reappears in the queue
    await prisma.verification.updateMany({
      where: {
        referenceId: params.id,
        tenantId:    user.tenantId,
        status:      'DISCREPANCY_FOUND',
      },
      data: { status: 'PENDING', discrepancyNotes: null },
    }).catch(() => {});

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'UPDATE',
        entityType: 'EggProduction',
        entityId:   params.id,
        changes:    { reason: 'Resubmitted after rejection', totalEggs: data.totalEggs },
      },
    }).catch(() => {});

    return NextResponse.json({ record: updated });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Egg edit error:', error);
    return NextResponse.json({ error: 'Failed to update record' }, { status: 500 });
  }
}
