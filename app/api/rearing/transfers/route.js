// app/api/rearing/transfers/route.js
// GET — Returns pending and recent transfers visible to this user.
// Relation names from prisma db pull (snake_case auto-generated):
//   fromPenSection → pen_sections_flock_transfers_fromPenSectionIdTopen_sections
//   toPenSection   → pen_sections_flock_transfers_toPenSectionIdTopen_sections
//   recordedBy     → users
//   receivedBy     → users_flock_transfers_received_by_idTousers
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const ALLOWED_ROLES = [
  'PEN_MANAGER','FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN','PEN_WORKER',
];
const FARM_WIDE = ['FARM_MANAGER','FARM_ADMIN','CHAIRPERSON','SUPER_ADMIN'];

// Shorthand aliases for the long Prisma relation names
const INCLUDE_RELATIONS = {
  flocks: {
    select: { id: true, batchCode: true, operationType: true, currentCount: true },
  },
  pen_sections_flock_transfers_fromPenSectionIdTopen_sections: {
    select: { id: true, name: true, pen: { select: { name: true } } },
  },
  pen_sections_flock_transfers_toPenSectionIdTopen_sections: {
    select: { id: true, name: true, pen: { select: { name: true } } },
  },
  users: {
    select: { id: true, firstName: true, lastName: true, role: true },
  },
  users_flock_transfers_received_by_idTousers: {
    select: { id: true, firstName: true, lastName: true },
  },
};

// Remap long Prisma relation names to friendly names for the API response
function remap(t) {
  return {
    ...t,
    fromPenSection: t.pen_sections_flock_transfers_fromPenSectionIdTopen_sections ?? null,
    toPenSection:   t.pen_sections_flock_transfers_toPenSectionIdTopen_sections   ?? null,
    recordedBy:     t.users ?? null,
    receivedBy:     t.users_flock_transfers_received_by_idTousers ?? null,
    // Remove the verbose keys
    pen_sections_flock_transfers_fromPenSectionIdTopen_sections: undefined,
    pen_sections_flock_transfers_toPenSectionIdTopen_sections:   undefined,
    users:                                       undefined,
    users_flock_transfers_received_by_idTousers: undefined,
  };
}

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status') || 'ALL';
  const days         = Math.min(parseInt(searchParams.get('days') || '30'), 180);
  const since        = new Date(Date.now() - days * 86400000);

  try {
    let where;

    if (FARM_WIDE.includes(user.role)) {
      // Farm-wide: all PENDING + recent history
      where = statusFilter === 'ALL'
        ? {
            tenantId: user.tenantId,
            OR: [
              { status: 'PENDING' },
              { status: { in: ['COMPLETED','DISPUTED','CANCELLED','DISCREPANCY_REVIEW'] }, transferDate: { gte: since } },
            ],
          }
        : {
            tenantId: user.tenantId,
            status:   statusFilter,
            ...(statusFilter !== 'PENDING' && { transferDate: { gte: since } }),
          };
    } else {
      // Section-scoped: only transfers touching their sections or ones they initiated
      const assignments = await prisma.penWorkerAssignment.findMany({
        where:  { userId: user.sub, isActive: true },
        select: { penSectionId: true },
      });
      const sectionIds = assignments.map(a => a.penSectionId);

      const scopeFilter = {
        OR: [
          { recordedById:     user.sub },
          { fromPenSectionId: { in: sectionIds } },
          { toPenSectionId:   { in: sectionIds } },
        ],
      };

      where = statusFilter === 'ALL'
        ? {
            tenantId: user.tenantId,
            ...scopeFilter,
            OR: [
              { status: 'PENDING' },
              { status: { in: ['COMPLETED','DISPUTED','CANCELLED','DISCREPANCY_REVIEW'] }, transferDate: { gte: since } },
            ],
          }
        : {
            tenantId: user.tenantId,
            ...scopeFilter,
            status: statusFilter,
            ...(statusFilter !== 'PENDING' && { transferDate: { gte: since } }),
          };
    }

    const raw = await prisma.flock_transfers.findMany({
      where,
      orderBy: [{ status: 'asc' }, { transferDate: 'desc' }],
      include: INCLUDE_RELATIONS,
    });

    // Get this user's section IDs to tag direction
    const myAssignments = FARM_WIDE.includes(user.role) ? [] : (
      await prisma.penWorkerAssignment.findMany({
        where:  { userId: user.sub, isActive: true },
        select: { penSectionId: true },
      })
    );
    const mySectionIds = new Set(myAssignments.map(a => a.penSectionId));

    const transfers = raw.map(t => {
      const mapped = remap(t);
      mapped.direction = mySectionIds.size > 0
        ? mySectionIds.has(t.toPenSectionId)   ? 'INCOMING'
        : mySectionIds.has(t.fromPenSectionId) ? 'OUTGOING'
        : t.recordedById === user.sub           ? 'OUTGOING' : 'OTHER'
        : t.recordedById === user.sub           ? 'OUTGOING' : 'ALL';
      return mapped;
    });

    return NextResponse.json({
      transfers,
      counts: {
        pending:   transfers.filter(t => t.status === 'PENDING').length,
        completed: transfers.filter(t => t.status === 'COMPLETED').length,
        disputed:  transfers.filter(t => t.status === 'DISPUTED').length,
        inReview:  transfers.filter(t => t.status === 'DISCREPANCY_REVIEW').length,
        total:     transfers.length,
      },
      incoming: transfers.filter(t => t.direction === 'INCOMING' && t.status === 'PENDING'),
      outgoing: transfers.filter(t => t.direction === 'OUTGOING' && t.status === 'PENDING'),
    });

  } catch (err) {
    console.error('GET /api/rearing/transfers error:', err);
    return NextResponse.json({ error: 'Failed to fetch transfers', detail: err?.message }, { status: 500 });
  }
}
