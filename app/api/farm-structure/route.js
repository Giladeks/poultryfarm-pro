// app/api/farm-structure/route.js — Role-aware farm structure + metrics
// Phase 8C update:
//   POST  ?type=pen → now accepts and persists `penPurpose` (required)
//   PATCH ?type=pen → now accepts and persists `penPurpose`
//   GET   → now returns `penPurpose` on each pen (already comes from DB after migration)
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';

const MANAGER_ROLES = ['FARM_ADMIN', 'FARM_MANAGER', 'CHAIRPERSON', 'SUPER_ADMIN'];

// ── GET /api/farm-structure ───────────────────────────────────────────────────
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isManager = MANAGER_ROLES.includes(user.role);

  try {
    const _t = new Date();
    const today = new Date(Date.UTC(_t.getFullYear(), _t.getMonth(), _t.getDate()));
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // ── Determine which sections this user can see ──────────────────────────
    let allowedSectionIds = null;
    let allowedOpTypes    = null;

    if (!isManager) {
      const assignments = await prisma.penWorkerAssignment.findMany({
        where: { userId: user.sub },
        include: {
          penSection: {
            select: { id: true, pen: { select: { operationType: true } } },
          },
        },
      });
      allowedSectionIds = assignments.map(a => a.penSection.id);
      const opTypes = [...new Set(assignments.map(a => a.penSection.pen.operationType))];
      allowedOpTypes = opTypes.length > 0 ? opTypes : ['NONE'];
    }

    // ── Fetch farm structure ────────────────────────────────────────────────
    const farms = await prisma.farm.findMany({
      where: { tenantId: user.tenantId, isActive: true },
      include: {
        pens: {
          where: {
            isActive: true,   // exclude archived pens
            ...(allowedOpTypes && { operationType: { in: allowedOpTypes } }),
          },
          include: {
            sections: {
              where: {
                ...(allowedSectionIds && { id: { in: allowedSectionIds } }),
              },
              include: {
                flocks: {
                  where: { status: 'ACTIVE' },
                  select: {
                    id: true, batchCode: true, operationType: true,
                    currentCount: true, initialCount: true,
                    dateOfPlacement: true, breed: true,
                    expectedHarvestDate: true, expectedLayingStartDate: true,
                    stage: true,   // Phase 8C: include stage
                  },
                },
                workerAssignments: {
                  where: { isActive: true },
                  include: {
                    user: { select: { id: true, firstName: true, lastName: true, role: true } },
                  },
                },
              },
              orderBy: { name: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Managers see ALL pens (including newly created ones with no sections yet).
    // Non-managers are filtered to only pens that have sections they are assigned to.
    const filteredFarms = isManager
      ? farms
      : farms.map(farm => ({
      ...farm,
      pens: farm.pens.filter(pen => pen.sections.length > 0),
      })).filter(farm => farm.pens.length > 0);

    // ── Fetch metrics ───────────────────────────────────────────────────────
    const sectionFilter = allowedSectionIds
      ? { penSectionId: { in: allowedSectionIds } }
      : { penSection: { pen: { farm: { tenantId: user.tenantId } } } };

    const [todayMortality, weekMortality, weekFeed, todayEggs, weekEggs, weekWeights] =
      await Promise.all([
        prisma.mortalityRecord.groupBy({
          by: ['penSectionId'],
          where: { ...sectionFilter, recordDate: { gte: today } },
          _sum: { count: true },
        }),
        prisma.mortalityRecord.groupBy({
          by: ['penSectionId'],
          where: { ...sectionFilter, recordDate: { gte: sevenDaysAgo } },
          _sum: { count: true },
        }),
        prisma.feedConsumption.groupBy({
          by: ['penSectionId'],
          where: { ...sectionFilter, recordedDate: { gte: sevenDaysAgo } },
          _sum: { quantityKg: true },
          // gramsPerBird computed from totalKg/currentBirds in enrichment
        }),
        prisma.eggProduction.groupBy({
          by: ['penSectionId'],
          where: {
            ...(allowedSectionIds
              ? { penSectionId: { in: allowedSectionIds } }
              : { penSection: { pen: { farm: { tenantId: user.tenantId } } } }),
            collectionDate: { gte: today },
          },
          _sum: { totalEggs: true, gradeACount: true, crackedCount: true },
          
        }),
        prisma.eggProduction.groupBy({
          by: ['penSectionId'],
          where: {
            ...(allowedSectionIds
              ? { penSectionId: { in: allowedSectionIds } }
              : { penSection: { pen: { farm: { tenantId: user.tenantId } } } }),
            collectionDate: { gte: sevenDaysAgo },
          },
          _sum: { totalEggs: true, gradeACount: true },
          
        }),
        prisma.weightRecord.findMany({
          where: {
            ...(allowedSectionIds
              ? { penSectionId: { in: allowedSectionIds } }
              : { penSection: { pen: { farm: { tenantId: user.tenantId } } } }),
            recordDate: { gte: sevenDaysAgo },
          },
          orderBy: { recordDate: 'desc' },
          select: {
            penSectionId: true, avgWeightG: true, ageInDays: true,
            uniformityPct: true, recordDate: true,
          },
        }),
      ]);

    // Index metrics by penSectionId
    const idx = {
      todayDead:  Object.fromEntries(todayMortality.map(r => [r.penSectionId, r._sum.count || 0])),
      weekDead:   Object.fromEntries(weekMortality.map(r  => [r.penSectionId, r._sum.count || 0])),
      weekFeed:   Object.fromEntries(weekFeed.map(r => [r.penSectionId, {
        kg:  parseFloat((r._sum.quantityKg || 0).toFixed(1)),
        gpb: null, // computed per-section from totalKg/currentBirds in enrichment
      }])),
      todayEggs:  Object.fromEntries(todayEggs.map(r => [r.penSectionId, {
        total:        r._sum.totalEggs   || 0,
        gradeA:       r._sum.gradeACount || 0,
        cracked:      r._sum.crackedCount || 0,
        rate:         null, // computed per-section using totalEggs/currentBirds below
        gradePending: (r._sum.totalEggs || 0) > 0 && !r._sum.gradeACount,
      }])),
      weekEggs:   Object.fromEntries(weekEggs.map(r => [r.penSectionId, {
        total:  r._sum.totalEggs   || 0,
        gradeA: r._sum.gradeACount || 0,
        rate:   null, // computed per-section using totalEggs/currentBirds below
      }])),
      latestWeight: weekWeights.reduce((acc, w) => {
        if (!acc[w.penSectionId]) acc[w.penSectionId] = w;
        return acc;
      }, {}),
    };

    // ── Enrich with metrics ─────────────────────────────────────────────────
    const enriched = filteredFarms.map(farm => {
      const pens = farm.pens.map(pen => {
        const isLayer   = pen.operationType === 'LAYER';
        const isBroiler = pen.operationType === 'BROILER';

        const penManagers = [...new Map(
          pen.sections
            .flatMap(s => s.workerAssignments)
            .filter(a => a.user.role === 'PEN_MANAGER')
            .map(a => [a.user.id, a.user])
        ).values()];

        const sections = pen.sections.map(sec => {
          const activeFlock  = sec.flocks[0] || null;
          const currentBirds = sec.flocks.reduce((s, f) => s + f.currentCount, 0);
          const occupancyPct = sec.capacity > 0
            ? parseFloat(((currentBirds / sec.capacity) * 100).toFixed(1)) : 0;

          const workers  = sec.workerAssignments.filter(a => a.user.role === 'PEN_WORKER').map(a => a.user);
          const managers = sec.workerAssignments.filter(a => a.user.role === 'PEN_MANAGER').map(a => a.user);
          const ageInDays = activeFlock
            ? Math.floor((new Date() - new Date(activeFlock.dateOfPlacement)) / 86400000)
            : null;

          // Build the metrics object using field names the page expects:
          // page uses sec.metrics.todayMortality, sec.metrics.todayEggs,
          // sec.metrics.todayLayingRate, sec.metrics.todayGradeAPct,
          // sec.metrics.latestWeightG, sec.metrics.estimatedFCR, sec.metrics.daysToHarvest,
          // sec.metrics.avgDailyFeedKg, sec.metrics.mortalityRate
          const avgDailyFeedKg = activeFlock
            ? parseFloat(((idx.weekFeed[sec.id]?.kg || 0) / 7).toFixed(1))
            : 0;
          const mortalityRate = activeFlock && activeFlock.currentCount > 0
            ? parseFloat(((( idx.weekDead[sec.id] || 0) / activeFlock.currentCount) * 100).toFixed(2))
            : 0;
          const daysToHarvest = activeFlock?.expectedHarvestDate
            ? Math.max(0, Math.floor((new Date(activeFlock.expectedHarvestDate) - new Date()) / 86400000))
            : null;

          const metrics = activeFlock ? {
            type:             activeFlock.operationType,
            stage:            activeFlock.stage,
            todayMortality:   idx.todayDead[sec.id]  || 0,
            weekMortality:    idx.weekDead[sec.id]   || 0,
            mortalityRate,
            avgDailyFeedKg,
            weekFeedKg:       idx.weekFeed[sec.id]?.kg  || 0,
            gramsPerBird: currentBirds > 0 && (idx.weekFeed[sec.id]?.kg || 0) > 0
              ? parseFloat(((idx.weekFeed[sec.id].kg * 1000) / 7 / currentBirds).toFixed(1))
              : 0,
            todayEggs:        isLayer ? (idx.todayEggs[sec.id]?.total    || 0) : null,
            todayLayingRate:  isLayer && currentBirds > 0
              ? parseFloat(((idx.todayEggs[sec.id]?.total || 0) / currentBirds * 100).toFixed(1))
              : 0,
            todayGradeAPct:   isLayer ? (idx.todayEggs[sec.id]?.gradeA && idx.todayEggs[sec.id]?.total
              ? parseFloat(((idx.todayEggs[sec.id].gradeA / idx.todayEggs[sec.id].total)*100).toFixed(1))
              : null) : null,
            gradePending:     isLayer ? (idx.todayEggs[sec.id]?.gradePending || false) : null,
            weekEggs:         isLayer ? (idx.weekEggs[sec.id]?.total || 0) : null,
            weekLayRate:      isLayer && currentBirds > 0
              ? parseFloat(((idx.weekEggs[sec.id]?.total || 0) / 7 / currentBirds * 100).toFixed(1))
              : 0,
            latestWeightG:    isBroiler ? (idx.latestWeight[sec.id]?.avgWeightG
              ? parseFloat(Number(idx.latestWeight[sec.id].avgWeightG).toFixed(0)) : null) : null,
            uniformityPct:    isBroiler ? (idx.latestWeight[sec.id]?.uniformityPct
              ? parseFloat(Number(idx.latestWeight[sec.id].uniformityPct).toFixed(1)) : null) : null,
            estimatedFCR:     null, // computed separately if needed
            daysToHarvest,
          } : null;

          // Keep mx as alias for backward compat with any components using it
          return {
            ...sec,
            activeFlock,
            currentBirds,
            occupancyPct,
            ageInDays,
            workers,
            managers,
            metrics,
            mx: metrics, // alias
          };
        });

        const penTotalBirds    = sections.reduce((s, sec) => s + sec.currentBirds, 0);
        const penTotalCapacity = sections.reduce((s, sec) => s + sec.capacity, 0);

        return {
          ...pen,
          sections,
          sectionCount: sections.length,    // page uses pen.sectionCount
          penManagers,
          totalBirds:    penTotalBirds,
          totalCapacity: penTotalCapacity,
          totalCapacityPct: penTotalCapacity > 0
            ? parseFloat(((penTotalBirds / penTotalCapacity) * 100).toFixed(1)) : 0,
          metrics: {
            todayMortality: sections.reduce((s, sec) => s + (sec.metrics?.todayMortality || 0), 0),
            weekMortality:  sections.reduce((s, sec) => s + (sec.metrics?.weekMortality  || 0), 0),
            weekFeedKg:     parseFloat(sections.reduce((s, sec) => s + (sec.metrics?.weekFeedKg || 0), 0).toFixed(1)),
            todayEggs:      isLayer   ? sections.reduce((s, sec) => s + (sec.metrics?.todayEggs || 0), 0) : null,
            avgLayingRate:  isLayer && penTotalBirds > 0
              ? parseFloat((sections.reduce((s, sec) => s + (sec.metrics?.todayEggs || 0), 0) / penTotalBirds * 100).toFixed(1))
              : null,
            latestWeightG:  isBroiler ? (sections.map(s => s.metrics?.latestWeightG).find(Boolean) || null) : null,
          },
        };
      });

      // Farm-level aggregates — all fields the page uses
      const farmTotalBirds    = pens.reduce((s, p) => s + p.totalBirds, 0);
      const farmTotalCapacity = pens.reduce((s, p) => s + p.totalCapacity, 0);
      const farmLayerBirds    = pens.filter(p => p.operationType === 'LAYER')
                                    .reduce((s, p) => s + p.totalBirds, 0);
      const farmBroilerBirds  = pens.filter(p => p.operationType === 'BROILER')
                                    .reduce((s, p) => s + p.totalBirds, 0);
      const farmOccupancyPct  = farmTotalCapacity > 0
        ? parseFloat(((farmTotalBirds / farmTotalCapacity) * 100).toFixed(1)) : 0;

      return {
        ...farm,
        pens,
        penCount:      pens.length,           // page uses farm.penCount
        totalBirds:    farmTotalBirds,         // page uses farm.totalBirds
        totalCapacity: farmTotalCapacity,      // page uses farm.totalCapacity
        layerBirds:    farmLayerBirds,         // page uses farm.layerBirds
        broilerBirds:  farmBroilerBirds,       // page uses farm.broilerBirds
        occupancyPct:  farmOccupancyPct,       // page uses farm.occupancyPct
        metrics: {
          totalBirds:     farmTotalBirds,
          todayMortality: pens.reduce((s, p) => s + p.metrics.todayMortality, 0),
          weekFeedKg:     parseFloat(pens.reduce((s, p) => s + p.metrics.weekFeedKg, 0).toFixed(1)),
          todayEggs:      pens.reduce((s, p) => s + (p.metrics.todayEggs || 0), 0),
        },
      };
    });

    return NextResponse.json({ farms: enriched });
  } catch (error) {
    console.error('Farm structure fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch farm structure', detail: error?.message }, { status: 500 });
  }
}

// ── POST /api/farm-structure ──────────────────────────────────────────────────
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!MANAGER_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type'); // 'farm' | 'pen' | 'section'

  try {
    const body = await request.json();

    // ── Create Farm ─────────────────────────────────────────────────────────
    if (type === 'farm') {
      const { name, location, address, phone, email, managerId } = body;
      if (!name?.trim()) return NextResponse.json({ error: 'Farm name required' }, { status: 400 });

      const farm = await prisma.farm.create({
        data: {
          tenantId:  user.tenantId,
          name:      name.trim(),
          location:  location  || null,
          address:   address   || null,
          phone:     phone     || null,
          email:     email     || null,
          managerId: managerId || null,
        },
      });
      return NextResponse.json({ farm }, { status: 201 });
    }

    // ── Create Pen ──────────────────────────────────────────────────────────
    // Phase 8C: penPurpose is now required. API validates it is present.
    if (type === 'pen') {
      const { farmId, name, operationType, penPurpose, capacity, location, buildYear } = body;
      if (!farmId || !name?.trim() || !operationType || !penPurpose || !capacity)
        return NextResponse.json({ error: 'farmId, name, operationType, penPurpose, and capacity are required' }, { status: 400 });

      if (!['PRODUCTION','BROODING','GENERAL'].includes(penPurpose))
        return NextResponse.json({ error: 'penPurpose must be PRODUCTION, BROODING, or GENERAL' }, { status: 400 });

      // Verify farm belongs to tenant
      const farm = await prisma.farm.findFirst({
        where: { id: farmId, tenantId: user.tenantId },
      });
      if (!farm) return NextResponse.json({ error: 'Farm not found' }, { status: 404 });

      const pen = await prisma.pen.create({
        data: {
          farmId,
          name:          name.trim(),
          operationType,
          penPurpose,
          capacity:      parseInt(capacity),
          location:      location  || null,
          buildYear:     buildYear ? parseInt(buildYear) : null,
        },
      });
      return NextResponse.json({ pen }, { status: 201 });
    }

    // ── Create Section ──────────────────────────────────────────────────────
    if (type === 'section') {
      const { penId, name, capacity } = body;
      if (!penId || !name?.trim() || !capacity)
        return NextResponse.json({ error: 'penId, name, and capacity are required' }, { status: 400 });

      // Verify pen belongs to tenant
      const pen = await prisma.pen.findFirst({
        where: { id: penId, farm: { tenantId: user.tenantId } },
      });
      if (!pen) return NextResponse.json({ error: 'Pen not found' }, { status: 404 });

      const section = await prisma.penSection.create({
        data: {
          penId,
          name:     name.trim(),
          capacity: parseInt(capacity),
        },
      });
      return NextResponse.json({ section }, { status: 201 });
    }

    return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
  } catch (error) {
    console.error('Farm structure POST error:', error);
    return NextResponse.json({ error: 'Failed to create', detail: error?.message }, { status: 500 });
  }
}

// ── PATCH /api/farm-structure ─────────────────────────────────────────────────
export async function PATCH(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!MANAGER_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');

  try {
    const body = await request.json();

    // ── Update Farm ─────────────────────────────────────────────────────────
    if (type === 'farm') {
      const { id, name, location, address, phone, email, managerId } = body;
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

      const farm = await prisma.farm.findFirst({ where: { id, tenantId: user.tenantId } });
      if (!farm) return NextResponse.json({ error: 'Farm not found' }, { status: 404 });

      const updated = await prisma.farm.update({
        where: { id },
        data: {
          ...(name      && { name: name.trim() }),
          ...(location !== undefined && { location: location || null }),
          ...(address  !== undefined && { address:  address  || null }),
          ...(phone    !== undefined && { phone:    phone    || null }),
          ...(email    !== undefined && { email:    email    || null }),
          ...(managerId !== undefined && { managerId: managerId || null }),
        },
      });
      return NextResponse.json({ farm: updated });
    }

    // ── Update Pen ──────────────────────────────────────────────────────────
    // Phase 8C: penPurpose can now be updated
    if (type === 'pen') {
      const { id, name, capacity, location, buildYear, penPurpose } = body;
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

      const pen = await prisma.pen.findFirst({ where: { id, farm: { tenantId: user.tenantId } } });
      if (!pen) return NextResponse.json({ error: 'Pen not found' }, { status: 404 });

      if (penPurpose && !['PRODUCTION','BROODING','GENERAL'].includes(penPurpose))
        return NextResponse.json({ error: 'penPurpose must be PRODUCTION, BROODING, or GENERAL' }, { status: 400 });

      const updated = await prisma.pen.update({
        where: { id },
        data: {
          ...(name       && { name:      name.trim() }),
          ...(capacity   && { capacity:  parseInt(capacity) }),
          ...(location  !== undefined && { location:  location  || null }),
          ...(buildYear !== undefined && { buildYear: buildYear ? parseInt(buildYear) : null }),
          ...(penPurpose && { penPurpose }),
        },
      });
      return NextResponse.json({ pen: updated });
    }

    // ── Update Section ──────────────────────────────────────────────────────
    if (type === 'section') {
      const { id, name, capacity } = body;
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

      const section = await prisma.penSection.findFirst({
        where: { id, pen: { farm: { tenantId: user.tenantId } } },
      });
      if (!section) return NextResponse.json({ error: 'Section not found' }, { status: 404 });

      const updated = await prisma.penSection.update({
        where: { id },
        data: {
          ...(name     && { name:     name.trim() }),
          ...(capacity && { capacity: parseInt(capacity) }),
        },
      });
      return NextResponse.json({ section: updated });
    }

    return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
  } catch (error) {
    console.error('Farm structure PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update', detail: error?.message }, { status: 500 });
  }
}
