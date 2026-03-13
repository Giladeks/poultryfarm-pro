// app/api/eggs/[id]/route.js — Worker edits a rejected egg record (Phase 8B)
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

// Worker can only re-enter the crate-based fields they originally submitted
const editSchema = z.object({
  cratesCollected:   z.number().int().min(0),
  looseEggs:         z.number().int().min(0).max(29),
  crackedCount:      z.number().int().min(0),
  collectionDate:    z.string().optional(),
  collectionSession: z.number().int().min(1).max(2).optional(),
});

export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const record = await prisma.eggProduction.findFirst({
      where: {
        id: params.id,
        flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
      },
      include: { flock: { select: { currentCount: true, operationType: true } } },
    });

    if (!record) return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    if (record.recordedById !== user.sub)
      return NextResponse.json({ error: 'You can only edit your own records' }, { status: 403 });
    if (record.submissionStatus !== 'PENDING')
      return NextResponse.json({ error: 'Only pending records can be edited' }, { status: 422 });

    const body = await request.json();
    const data = editSchema.parse(body);

    // Recalculate total from new crate inputs
    const cratesCollected = data.cratesCollected ?? record.cratesCollected;
    const looseEggs       = data.looseEggs       ?? record.looseEggs;
    const crackedCount    = data.crackedCount     ?? record.crackedCount;
    const totalEggs       = (cratesCollected * 30) + looseEggs + crackedCount;

    const layingRatePct = record.flock.currentCount > 0
      ? parseFloat(((totalEggs / record.flock.currentCount) * 100).toFixed(2))
      : 0;

    const updated = await prisma.eggProduction.update({
      where: { id: params.id },
      data: {
        cratesCollected,
        looseEggs,
        crackedCount,
        totalEggs,
        layingRatePct,
        ...(data.collectionDate    && { collectionDate:    new Date(data.collectionDate) }),
        ...(data.collectionSession && { collectionSession: data.collectionSession }),
        // Clear any PM grading since the worker input changed
        gradeBCrates:     null,
        gradeBLoose:      null,
        crackedConfirmed: null,
        gradeBCount:      null,
        gradeACount:      null,
        gradeAPct:        null,
        approvedById:     null,
        approvedAt:       null,
        submissionStatus: 'PENDING',
        rejectionReason:  null,
      },
    });

    // Reset linked verification back to PENDING
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
        changes: {
          reason: 'Resubmitted after rejection',
          cratesCollected, looseEggs, crackedCount, totalEggs,
        },
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
