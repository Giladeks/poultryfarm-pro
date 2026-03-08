// app/api/mortality/[id]/route.js — Edit a rejected mortality record
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const CAUSE_CODES = ['DISEASE', 'INJURY', 'PREDATOR', 'HEAT_STRESS', 'UNKNOWN', 'OTHER'];

const editSchema = z.object({
  count:     z.number().int().min(1),
  causeCode: z.enum(CAUSE_CODES).optional(),
  recordDate: z.string().optional(),
  notes:     z.string().optional().nullable(),
});

export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const record = await prisma.mortalityRecord.findFirst({
      where: {
        id: params.id,
        flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
      },
      include: { flock: { select: { currentCount: true } } },
    });

    if (!record) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    if (record.recordedById !== user.sub)
      return NextResponse.json({ error: 'You can only edit your own records' }, { status: 403 });
    if (record.submissionStatus !== 'PENDING')
      return NextResponse.json({ error: 'Only pending records can be edited' }, { status: 422 });

    const body = await request.json();
    const data = editSchema.parse(body);

    if (data.count > record.flock.currentCount)
      return NextResponse.json({ error: `Count (${data.count}) exceeds live bird count (${record.flock.currentCount})` }, { status: 422 });

    const updated = await prisma.mortalityRecord.update({
      where: { id: params.id },
      data: {
        count:    data.count,
        causeCode: data.causeCode ?? record.causeCode,
        ...(data.recordDate && { recordDate: new Date(data.recordDate) }),
        ...(data.notes !== undefined && { notes: data.notes }),
        submissionStatus: 'PENDING',
        rejectionReason:  null,
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
        entityType: 'MortalityRecord',
        entityId:   params.id,
        changes:    { reason: 'Resubmitted after rejection', count: data.count },
      },
    }).catch(() => {});

    return NextResponse.json({ record: updated });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Mortality edit error:', error);
    return NextResponse.json({ error: 'Failed to update record' }, { status: 500 });
  }
}
