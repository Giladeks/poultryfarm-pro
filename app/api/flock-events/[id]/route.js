// app/api/flock-events/[id]/route.js
// GET /api/flock-events/[id]
// Returns full detail for a single FlockLifecycleEvent.
// PM can only view events they submitted.
// FM+ can view all events in their tenant.

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const VIEW_ROLES = [
  'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
  'STORE_MANAGER', 'INTERNAL_CONTROL',
];
const MANAGER_ROLES = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

export async function GET(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user)                           return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!VIEW_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' },   { status: 403 });

  try {
    const event = await prisma.flockLifecycleEvent.findFirst({
      where: {
        id:       params.id,
        tenantId: user.tenantId,
        // Non-managers only see their own or store-related events
        ...(!MANAGER_ROLES.includes(user.role) && user.role !== 'STORE_MANAGER' && user.role !== 'INTERNAL_CONTROL'
          ? { submittedById: user.sub }
          : {}),
      },
      include: {
        flock:       { select: { id: true, batchCode: true, operationType: true, currentCount: true, status: true, dateOfPlacement: true } },
        penSection:  { select: { id: true, name: true, pen: { select: { id: true, name: true } } } },
        submittedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
        reviewedBy:  { select: { id: true, firstName: true, lastName: true, role: true } },
        store:       { select: { id: true, name: true, storeType: true } },
        storeAcknowledgedBy: { select: { id: true, firstName: true, lastName: true } },
        disposalVerifiedBy:  { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!event)
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    return NextResponse.json({ event });
  } catch (err) {
    console.error('[GET /api/flock-events/[id]]', err);
    return NextResponse.json({ error: 'Failed to load event', detail: err?.message }, { status: 500 });
  }
}

// ── PATCH /api/flock-events/[id] — cancel a pending event ────────────────────
// Only the submitter (or FM+) can cancel while status is PENDING_APPROVAL.
export async function PATCH(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const CANCEL_ROLES = ['PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
  if (!CANCEL_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const event = await prisma.flockLifecycleEvent.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      select: { id: true, status: true, submittedById: true, flockId: true, eventType: true },
    });
    if (!event)
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (event.status !== 'PENDING_APPROVAL')
      return NextResponse.json({ error: `Cannot cancel an event with status ${event.status}` }, { status: 422 });

    const isManager = MANAGER_ROLES.includes(user.role);
    if (!isManager && event.submittedById !== user.sub)
      return NextResponse.json({ error: 'You can only cancel your own submissions' }, { status: 403 });

    const updated = await prisma.flockLifecycleEvent.update({
      where: { id: params.id },
      data:  { status: 'CANCELLED' },
      select: { id: true, status: true, eventType: true, flockId: true },
    });

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'UPDATE',
        entityType: 'FlockLifecycleEvent',
        entityId:   params.id,
        changes:    { status: 'CANCELLED', cancelledBy: user.sub },
      },
    }).catch(() => {});

    return NextResponse.json({ message: 'Event cancelled', event: updated });
  } catch (err) {
    console.error('[PATCH /api/flock-events/[id]]', err);
    return NextResponse.json({ error: 'Failed to cancel event', detail: err?.message }, { status: 500 });
  }
}
