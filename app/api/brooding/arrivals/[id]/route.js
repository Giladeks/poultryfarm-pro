// app/api/brooding/arrivals/[id]/route.js
// PATCH — update status, record transfer to production pen
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const ALLOWED_ROLES = [
  'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN',
  'CHAIRPERSON', 'SUPER_ADMIN',
];

const patchSchema = z.object({
  status:          z.enum(['ACTIVE', 'TRANSFERRED', 'CLOSED']).optional(),
  transferDate:    z.string().min(1).optional().nullable(),  // YYYY-MM-DD
  transferWeight:  z.number().min(0).optional().nullable(),  // kg average weight at transfer
  survivingCount:  z.number().int().min(0).optional().nullable(),
  notes:           z.string().max(1000).optional().nullable(),
});

export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body   = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.errors }, { status: 422 });

    const data = parsed.data;

    // Verify arrival belongs to this tenant
    const existing = await prisma.chick_arrivals.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
    });
    if (!existing)
      return NextResponse.json({ error: 'Arrival not found' }, { status: 404 });

    // Build update payload
    const updateData = {};
    if (data.status !== undefined)         updateData.status         = data.status;
    if (data.survivingCount !== undefined) updateData.survivingCount = data.survivingCount;
    if (data.notes !== undefined)          updateData.notes          = data.notes || null;

    // Handle transfer date
    if (data.transferDate) {
      const [yr, mo, dy] = data.transferDate.split('-').map(Number);
      updateData.transferDate   = new Date(Date.UTC(yr, mo - 1, dy));
      updateData.status         = 'TRANSFERRED';
    }
    if (data.transferWeight !== undefined) {
      updateData.transferWeight = data.transferWeight ?? null;
    }

    const updated = await prisma.chick_arrivals.update({
      where: { id: params.id },
      data:  updateData,
      include: {
        penSection: { select: { id: true, name: true } },
        flock:      { select: { id: true, batchCode: true } },
      },
    });

    return NextResponse.json({ arrival: updated });
  } catch (err) {
    console.error('PATCH /api/brooding/arrivals/[id] error:', err);
    return NextResponse.json({ error: 'Failed to update arrival', detail: err?.message }, { status: 500 });
  }
}
