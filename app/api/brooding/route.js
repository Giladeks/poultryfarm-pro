// app/api/brooding/route.js
// GET — all BROODING-stage flocks for the tenant, enriched with:
//   - section + pen info
//   - chick delivery records (chick_arrivals linked to flockId)
//   - latest temperature reading
//   - days in brooding, age in weeks
//   - operationType (LAYER vs BROILER) for UI branching
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const ALLOWED_ROLES = [
  'PEN_WORKER', 'PEN_MANAGER', 'FARM_MANAGER',
  'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    // For pen-scoped roles, filter to their assigned sections
    let sectionIdFilter = null;
    if (['PEN_WORKER', 'PEN_MANAGER'].includes(user.role)) {
      const assignments = await prisma.penWorkerAssignment.findMany({
        where:  { userId: user.sub, isActive: true },
        select: { penSectionId: true },
      });
      sectionIdFilter = assignments.map(a => a.penSectionId);
      if (sectionIdFilter.length === 0)
        return NextResponse.json({ flocks: [] });
    }

    const flocks = await prisma.flock.findMany({
      where: {
        tenantId: user.tenantId,
        stage:    'BROODING',
        status:   'ACTIVE',
        ...(sectionIdFilter ? { penSectionId: { in: sectionIdFilter } } : {}),
      },
      include: {
        penSection: {
          select: {
            id: true, name: true,
            pen: {
              select: { id: true, name: true, operationType: true, penPurpose: true },
            },
            workerAssignments: {
              where:  { isActive: true },
              select: {
                user: { select: { id: true, firstName: true, lastName: true, role: true } },
              },
            },
          },
        },
      },
      orderBy: { dateOfPlacement: 'asc' },
    });

    // Enrich each flock with delivery records + latest temp
    const enriched = await Promise.all(flocks.map(async (flock) => {
      const [deliveries, latestTemp] = await Promise.all([
        prisma.chick_arrivals.findMany({
          where:   { flockId: flock.id, tenantId: user.tenantId },
          orderBy: { arrivalDate: 'desc' },
          select: {
            id: true, batchCode: true, arrivalDate: true,
            chicksReceived: true, doaCount: true,
            supplier: true, chickCostPerBird: true, currency: true, status: true,
          },
        }),
        prisma.temperature_logs.findFirst({
          where:   { flockId: flock.id, tenantId: user.tenantId },
          orderBy: { loggedAt: 'desc' },
          select:  { tempCelsius: true, humidity: true, zone: true, loggedAt: true },
        }),
      ]);

      const placementDate = new Date(flock.dateOfPlacement);
      const today         = new Date();
      const daysOld       = Math.floor((today - placementDate) / 86400000);
      const weeksOld      = Math.floor(daysOld / 7);

      return {
        ...flock,
        purchaseCost: flock.purchaseCost ? Number(flock.purchaseCost) : null,
        daysOld,
        weeksOld,
        deliveries,
        latestTemp,
        operationType: flock.penSection?.pen?.operationType,
      };
    }));

    return NextResponse.json({ flocks: enriched });
  } catch (err) {
    console.error('GET /api/brooding error:', err);
    return NextResponse.json({ error: 'Failed to fetch brooding flocks', detail: err?.message }, { status: 500 });
  }
}
