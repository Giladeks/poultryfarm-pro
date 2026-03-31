// app/api/rearing/route.js
// GET — all REARING-stage layer flocks with computed KPIs:
//   - age in weeks, weeks to target Point-of-Lay (wk 18)
//   - latest weight record + uniformity %
//   - rearing FCR (feed consumed since rearingStartDate ÷ weight gain)
//   - mortality since rearing start
//   - vaccination compliance (scheduled vs administered)
//   - current pen section (may differ from originalPenSectionId after transfer)
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
    // Pen-scoped filter for workers/PMs
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
        tenantId:      user.tenantId,
        stage:         'REARING',
        status:        'ACTIVE',
        operationType: 'LAYER',  // only layers have a rearing stage
        // Only match current penSectionId — originalPenSectionId was needed pre-transfer
      // but after COMPLETED transfer the flock's penSectionId is updated to destination.
      // Including originalPenSectionId causes the sending PM to keep seeing the flock.
      ...(sectionIdFilter ? { penSectionId: { in: sectionIdFilter } } : {}),
      },
      include: {
        penSection: {
          select: {
            id: true, name: true,
            pen: { select: { id: true, name: true, operationType: true, penPurpose: true } },
            workerAssignments: {
              where:  { isActive: true },
              select: { user: { select: { id: true, firstName: true, lastName: true, role: true } } },
            },
          },
        },
      },
      orderBy: { dateOfPlacement: 'asc' },
    });

    const today = new Date();

    const enriched = await Promise.all(flocks.map(async (flock) => {
      const placementDate    = new Date(flock.dateOfPlacement);
      const rearingStart     = flock.rearingStartDate ? new Date(flock.rearingStartDate) : null;
      const ageInDays        = Math.floor((today - placementDate) / 86400000);
      const ageInWeeks       = Math.floor(ageInDays / 7);
      const weeksToPointOfLay = Math.max(0, 18 - ageInWeeks);

      // Latest weight — check weight_samples first (rearing), fall back to weightRecord (broiler)
      const [latestSample, latestRecord] = await Promise.all([
        prisma.weight_samples.findFirst({
          where:   { flockId: flock.id, penSectionId: flock.penSectionId },
          orderBy: { sampleDate: 'desc' },
          select:  { meanWeightG: true, uniformityPct: true, sampleDate: true },
        }),
        prisma.weightRecord.findFirst({
          where:   { flockId: flock.id, penSectionId: flock.penSectionId },
          orderBy: { recordDate: 'desc' },
          select:  { avgWeightG: true, uniformityPct: true, recordDate: true, ageInDays: true },
        }),
      ]);
      // Normalise to a single shape — weight_samples takes priority for rearing flocks
      const latestWeight = latestSample
        ? {
            avgWeightG:    Number(latestSample.meanWeightG),
            uniformityPct: latestSample.uniformityPct ? Number(latestSample.uniformityPct) : null,
            recordDate:    latestSample.sampleDate,
            ageInDays:     flock.dateOfPlacement
              ? Math.floor((new Date(latestSample.sampleDate) - new Date(flock.dateOfPlacement)) / 86400000)
              : null,
          }
        : latestRecord
        ? {
            avgWeightG:    Number(latestRecord.avgWeightG),
            uniformityPct: latestRecord.uniformityPct ? Number(latestRecord.uniformityPct) : null,
            recordDate:    latestRecord.recordDate,
            ageInDays:     latestRecord.ageInDays,
          }
        : null;

      // Mortality since rearing started
      let mortalitySinceRearing = 0;
      if (rearingStart) {
        const mortalityResult = await prisma.mortalityRecord.aggregate({
          where: {
            flockId:      flock.id,
            penSectionId: flock.penSectionId,
            recordDate:   { gte: rearingStart },
          },
          _sum: { count: true },
        });
        mortalitySinceRearing = mortalityResult._sum.count || 0;
      }

      // Feed consumed since rearing start (for FCR)
      let totalFeedKgRearing = 0;
      if (rearingStart) {
        const feedResult = await prisma.feedConsumption.aggregate({
          where: {
            flockId:      flock.id,
            penSectionId: flock.penSectionId,
            recordedDate: { gte: rearingStart },   // correct field name
          },
          _sum: { quantityKg: true },
        });
        totalFeedKgRearing = Number(feedResult._sum.quantityKg || 0);
      }

      // Rearing FCR: feed kg ÷ (current count × weight gain in kg)
      // Weight gain = current avg weight - ~40g (day-old chick weight)
      let rearingFCR = null;
      if (latestWeight && totalFeedKgRearing > 0 && flock.currentCount > 0) {
        const avgWeightKg  = Number(latestWeight.avgWeightG) / 1000;
        const weightGainKg = Math.max(0, avgWeightKg - 0.04); // subtract ~40g DOC weight
        const totalGainKg  = weightGainKg * flock.currentCount;
        if (totalGainKg > 0)
          rearingFCR = +(totalFeedKgRearing / totalGainKg).toFixed(3);
      }

      // Vaccination compliance: scheduled vs administered for this flock
      const [vaccinationsScheduled, vaccinationsAdministered] = await Promise.all([
        prisma.vaccination.count({ where: { flockId: flock.id } }),
        prisma.vaccination.count({ where: { flockId: flock.id, status: 'COMPLETED' } }),
      ]);

      // Transfer history (did this flock move pens?)
      const transfers = await prisma.flock_transfers.findMany({
        where:   { flockId: flock.id, tenantId: user.tenantId },
        orderBy: { transferDate: 'desc' },
        select: {
          id: true, transferDate: true, fromPenSectionId: true, toPenSectionId: true,
          survivingCount: true, avgWeightAtTransferG: true,
        },
      });

      return {
        ...flock,
        purchaseCost: flock.purchaseCost ? Number(flock.purchaseCost) : null,
        ageInDays,
        ageInWeeks,
        weeksToPointOfLay,
        latestWeight: latestWeight ? {
          ...latestWeight,
          avgWeightG:    Number(latestWeight.avgWeightG),
          uniformityPct: latestWeight.uniformityPct ? Number(latestWeight.uniformityPct) : null,
        } : null,
        mortalitySinceRearing,
        totalFeedKgRearing: +totalFeedKgRearing.toFixed(2),
        rearingFCR,
        vaccinationsScheduled,
        vaccinationsAdministered,
        vaccinationCompliancePct: vaccinationsScheduled > 0
          ? +((vaccinationsAdministered / vaccinationsScheduled) * 100).toFixed(1)
          : null,
        transfers,
        hasBeenTransferred: transfers.length > 0,
      };
    }));

    return NextResponse.json({ flocks: enriched });
  } catch (err) {
    console.error('GET /api/rearing error:', err);
    return NextResponse.json({ error: 'Failed to fetch rearing flocks', detail: err?.message }, { status: 500 });
  }
}
