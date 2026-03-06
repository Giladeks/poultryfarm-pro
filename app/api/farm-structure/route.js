// app/api/farm-structure/route.js — Role-aware farm structure + metrics
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';

const MANAGER_ROLES = ['FARM_ADMIN', 'FARM_MANAGER', 'CHAIRPERSON', 'SUPER_ADMIN'];
const ADMIN_ROLES   = ['FARM_ADMIN', 'FARM_MANAGER', 'CHAIRPERSON', 'SUPER_ADMIN'];

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isManager = MANAGER_ROLES.includes(user.role);

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // ── Determine which sections this user can see ──────────────────────────
    // Managers see all. Workers/PenManagers see only their assigned sections.
    let allowedSectionIds = null; // null = all
    let allowedOpTypes    = null; // null = all

    if (!isManager) {
      const assignments = await prisma.penWorkerAssignment.findMany({
        where: { userId: user.sub, isActive: true },
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

    // ── Fetch structure ─────────────────────────────────────────────────────
    const farms = await prisma.farm.findMany({
      where: { tenantId: user.tenantId, isActive: true },
      include: {
        pens: {
          where: {
            isActive: true,
            ...(allowedOpTypes && { operationType: { in: allowedOpTypes } }),
          },
          include: {
            sections: {
              where: {
                isActive: true,
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

    // Filter out pens with no visible sections (for field workers)
    const filteredFarms = farms.map(farm => ({
      ...farm,
      pens: farm.pens.filter(pen => pen.sections.length > 0),
    })).filter(farm => farm.pens.length > 0);

    // ── Fetch metrics ───────────────────────────────────────────────────────
    const sectionFilter = allowedSectionIds
      ? { penSectionId: { in: allowedSectionIds } }
      : { flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } } };

    const [todayMortality, weekMortality, weekFeed, todayEggs, weekEggs, weekWeights] = await Promise.all([
      // Today mortality
      prisma.mortalityRecord.groupBy({
        by: ['penSectionId'],
        where: { ...sectionFilter, recordDate: { gte: today } },
        _sum: { count: true },
      }),
      // 7-day mortality
      prisma.mortalityRecord.groupBy({
        by: ['penSectionId'],
        where: { ...sectionFilter, recordDate: { gte: sevenDaysAgo } },
        _sum: { count: true },
      }),
      // 7-day feed
      prisma.feedConsumption.groupBy({
        by: ['penSectionId'],
        where: {
          ...(allowedSectionIds
            ? { penSectionId: { in: allowedSectionIds } }
            : { flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } } }),
          recordedDate: { gte: sevenDaysAgo },
        },
        _sum: { quantityKg: true },
        _avg: { gramsPerBird: true },
      }),
      // Today eggs (LAYER only)
      prisma.eggProduction.groupBy({
        by: ['penSectionId'],
        where: {
          ...(allowedSectionIds
            ? { penSectionId: { in: allowedSectionIds } }
            : { flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } } }),
          collectionDate: { gte: today },
        },
        _sum: { totalEggs: true, gradeACount: true, dirtyCount: true },
        _avg: { layingRatePct: true },
      }),
      // 7-day eggs
      prisma.eggProduction.groupBy({
        by: ['penSectionId'],
        where: {
          ...(allowedSectionIds
            ? { penSectionId: { in: allowedSectionIds } }
            : { flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } } }),
          collectionDate: { gte: sevenDaysAgo },
        },
        _sum: { totalEggs: true, gradeACount: true },
        _avg: { layingRatePct: true },
      }),
      // Latest weight per section (BROILER only)
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

    // Index metrics
    const idx = {
      todayDead:  Object.fromEntries(todayMortality.map(r => [r.penSectionId, r._sum.count || 0])),
      weekDead:   Object.fromEntries(weekMortality.map(r  => [r.penSectionId, r._sum.count || 0])),
      weekFeed:   Object.fromEntries(weekFeed.map(r       => [r.penSectionId, {
        kg:  parseFloat((r._sum.quantityKg || 0).toFixed(1)),
        gpb: parseFloat((r._avg.gramsPerBird || 0).toFixed(0)),
      }])),
      todayEggs:  Object.fromEntries(todayEggs.map(r => [r.penSectionId, {
        total: r._sum.totalEggs || 0,
        gradeA: r._sum.gradeACount || 0,
        dirty:  r._sum.dirtyCount  || 0,
        rate:   parseFloat((r._avg.layingRatePct || 0).toFixed(1)),
      }])),
      weekEggs:   Object.fromEntries(weekEggs.map(r => [r.penSectionId, {
        total:  r._sum.totalEggs  || 0,
        gradeA: r._sum.gradeACount || 0,
        rate:   parseFloat((r._avg.layingRatePct || 0).toFixed(1)),
      }])),
      // Latest weight record per section
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
            ? Math.floor((Date.now() - new Date(activeFlock.dateOfPlacement)) / 86400000) : 0;

          const todayDead  = idx.todayDead[sec.id]  || 0;
          const weekDead   = idx.weekDead[sec.id]   || 0;
          const feedData   = idx.weekFeed[sec.id]   || { kg: 0, gpb: 0 };
          const tEgg       = idx.todayEggs[sec.id]  || { total: 0, gradeA: 0, dirty: 0, rate: 0 };
          const wEgg       = idx.weekEggs[sec.id]   || { total: 0, gradeA: 0, rate: 0 };
          const wt         = idx.latestWeight[sec.id];

          const mortalityRate = activeFlock?.initialCount > 0
            ? parseFloat(((weekDead / activeFlock.initialCount) * 100).toFixed(2)) : 0;

          // Estimated FCR: feed consumed / estimated weight gain
          // avgWeight (g) * currentBirds / 1000 = total kg now
          // assume chick placement weight = 42g
          const currentWeightKg = wt
            ? parseFloat(wt.avgWeightG) * currentBirds / 1000 : null;
          const placementWeightKg = currentBirds * 0.042;
          const estimatedGainKg  = currentWeightKg
            ? parseFloat((currentWeightKg - placementWeightKg).toFixed(1)) : null;
          const estimatedFCR = estimatedGainKg && feedData.kg > 0 && estimatedGainKg > 0
            ? parseFloat((feedData.kg / estimatedGainKg).toFixed(2)) : null;

          // Egg grade A %
          const gradeAPct = tEgg.total > 0
            ? parseFloat(((tEgg.gradeA / tEgg.total) * 100).toFixed(1)) : 0;
          const weekGradeAPct = wEgg.total > 0
            ? parseFloat(((wEgg.gradeA / wEgg.total) * 100).toFixed(1)) : 0;

          // Days to expected harvest (broilers)
          const daysToHarvest = activeFlock?.expectedHarvestDate
            ? Math.max(0, Math.floor((new Date(activeFlock.expectedHarvestDate) - Date.now()) / 86400000)) : null;

          return {
            id: sec.id, name: sec.name, capacity: sec.capacity,
            currentBirds, occupancyPct, activeFlock, ageInDays,
            workers, managers,
            metrics: isLayer ? {
              // LAYER metrics
              type: 'LAYER',
              todayMortality:   todayDead,
              weekMortality:    weekDead,
              mortalityRate,
              todayEggs:        tEgg.total,
              todayGradeA:      tEgg.gradeA,
              todayDirty:       tEgg.dirty,
              todayGradeAPct:   gradeAPct,
              todayLayingRate:  tEgg.rate,
              weekEggs:         wEgg.total,
              weekGradeA:       wEgg.gradeA,
              weekGradeAPct,
              avgLayingRate:    wEgg.rate,
              avgDailyFeedKg:   feedData.kg > 0
                ? parseFloat((feedData.kg / 7).toFixed(1)) : 0,
              feedGramsPerBird: feedData.gpb,
            } : {
              // BROILER metrics
              type: 'BROILER',
              todayMortality:  todayDead,
              weekMortality:   weekDead,
              mortalityRate,
              ageInDays,
              daysToHarvest,
              latestWeightG:   wt ? parseFloat(parseFloat(wt.avgWeightG).toFixed(0)) : null,
              uniformityPct:   wt?.uniformityPct ? parseFloat(parseFloat(wt.uniformityPct).toFixed(1)) : null,
              weekFeedKg:      feedData.kg,
              avgDailyFeedKg:  feedData.kg > 0 ? parseFloat((feedData.kg / 7).toFixed(1)) : 0,
              feedGramsPerBird: feedData.gpb,
              estimatedFCR,
            },
          };
        });

        // Aggregate pen metrics
        const totalCapacity = sections.reduce((s, sec) => s + sec.capacity, 0);
        const currentBirds  = sections.reduce((s, sec) => s + sec.currentBirds, 0);

        const penMetrics = isLayer ? {
          type: 'LAYER',
          todayMortality: sections.reduce((s, sec) => s + sec.metrics.todayMortality, 0),
          weekMortality:  sections.reduce((s, sec) => s + sec.metrics.weekMortality, 0),
          mortalityRate:  currentBirds > 0
            ? parseFloat(((sections.reduce((s, sec) => s + sec.metrics.weekMortality, 0) / currentBirds) * 100).toFixed(2)) : 0,
          todayEggs:      sections.reduce((s, sec) => s + (sec.metrics.todayEggs || 0), 0),
          weekEggs:       sections.reduce((s, sec) => s + (sec.metrics.weekEggs  || 0), 0),
          avgLayingRate:  (() => {
            const ls = sections.filter(s => s.metrics.avgLayingRate > 0);
            return ls.length > 0 ? parseFloat((ls.reduce((s, sec) => s + sec.metrics.avgLayingRate, 0) / ls.length).toFixed(1)) : 0;
          })(),
          weekFeedKg: parseFloat(sections.reduce((s, sec) => s + (sec.metrics.avgDailyFeedKg || 0) * 7, 0).toFixed(1)),
        } : {
          type: 'BROILER',
          todayMortality: sections.reduce((s, sec) => s + sec.metrics.todayMortality, 0),
          weekMortality:  sections.reduce((s, sec) => s + sec.metrics.weekMortality,  0),
          mortalityRate:  currentBirds > 0
            ? parseFloat(((sections.reduce((s, sec) => s + sec.metrics.weekMortality, 0) / currentBirds) * 100).toFixed(2)) : 0,
          avgWeightG: (() => {
            const ws = sections.filter(s => s.metrics.latestWeightG);
            return ws.length > 0 ? parseFloat((ws.reduce((s, sec) => s + sec.metrics.latestWeightG, 0) / ws.length).toFixed(0)) : null;
          })(),
          avgFCR: (() => {
            const fs = sections.filter(s => s.metrics.estimatedFCR);
            return fs.length > 0 ? parseFloat((fs.reduce((s, sec) => s + sec.metrics.estimatedFCR, 0) / fs.length).toFixed(2)) : null;
          })(),
          weekFeedKg: parseFloat(sections.reduce((s, sec) => s + (sec.metrics.weekFeedKg || 0), 0).toFixed(1)),
        };

        return {
          id: pen.id, name: pen.name, operationType: pen.operationType,
          capacity: pen.capacity, location: pen.location, buildYear: pen.buildYear,
          sections, penManagers, totalCapacity, currentBirds,
          occupancyPct: totalCapacity > 0
            ? parseFloat(((currentBirds / totalCapacity) * 100).toFixed(1)) : 0,
          sectionCount: sections.length,
          activeSections: sections.filter(s => s.activeFlock).length,
          metrics: penMetrics,
        };
      });

      // Farm-level aggregation (managers only see full picture)
      const totalCapacity  = pens.reduce((s, p) => s + p.totalCapacity, 0);
      const totalBirds     = pens.reduce((s, p) => s + p.currentBirds, 0);
      const layerPens      = pens.filter(p => p.operationType === 'LAYER');
      const broilerPens    = pens.filter(p => p.operationType === 'BROILER');

      const farmMetrics = {
        todayMortality:  pens.reduce((s, p) => s + p.metrics.todayMortality, 0),
        weekMortality:   pens.reduce((s, p) => s + p.metrics.weekMortality,  0),
        mortalityRate:   totalBirds > 0
          ? parseFloat(((pens.reduce((s, p) => s + p.metrics.weekMortality, 0) / totalBirds) * 100).toFixed(2)) : 0,
        weekFeedKg:      parseFloat(pens.reduce((s, p) => s + (p.metrics.weekFeedKg || 0), 0).toFixed(1)),
        // Layer
        todayEggs:       layerPens.reduce((s, p) => s + (p.metrics.todayEggs || 0), 0),
        weekEggs:        layerPens.reduce((s, p) => s + (p.metrics.weekEggs  || 0), 0),
        avgLayingRate:   (() => {
          const lp = layerPens.filter(p => p.metrics.avgLayingRate > 0);
          return lp.length > 0 ? parseFloat((lp.reduce((s, p) => s + p.metrics.avgLayingRate, 0) / lp.length).toFixed(1)) : 0;
        })(),
        // Broiler
        avgBroilerWeightG: (() => {
          const bp = broilerPens.filter(p => p.metrics.avgWeightG);
          return bp.length > 0 ? parseFloat((bp.reduce((s, p) => s + p.metrics.avgWeightG, 0) / bp.length).toFixed(0)) : null;
        })(),
        avgFCR: (() => {
          const bp = broilerPens.filter(p => p.metrics.avgFCR);
          return bp.length > 0 ? parseFloat((bp.reduce((s, p) => s + p.metrics.avgFCR, 0) / bp.length).toFixed(2)) : null;
        })(),
      };

      return {
        id: farm.id, name: farm.name, location: farm.location,
        address: farm.address, phone: farm.phone, email: farm.email,
        managerId: farm.managerId,
        pens, totalCapacity, totalBirds,
        occupancyPct: totalCapacity > 0
          ? parseFloat(((totalBirds / totalCapacity) * 100).toFixed(1)) : 0,
        penCount: pens.length,
        layerBirds:   layerPens.reduce((s, p) => s + p.currentBirds, 0),
        broilerBirds: broilerPens.reduce((s, p) => s + p.currentBirds, 0),
        metrics: farmMetrics,
      };
    });

    const managers = await prisma.user.findMany({
      where: {
        tenantId: user.tenantId,
        role: { in: ['FARM_MANAGER', 'PEN_MANAGER'] },
        isActive: true,
      },
      select: { id: true, firstName: true, lastName: true, role: true },
      orderBy: { firstName: 'asc' },
    });

    return NextResponse.json({
      farms: enriched,
      managers,
      viewerRole: user.role,
      isManager,
      allowedOpTypes,
    });
  } catch (error) {
    console.error('Farm structure error:', error);
    return NextResponse.json({ error: 'Failed to fetch farm structure' }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ADMIN_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');

  try {
    if (type === 'farm') {
      const { name, location, address, phone, email, managerId } = await request.json();
      if (!name) return NextResponse.json({ error: 'Farm name required' }, { status: 400 });
      const farm = await prisma.farm.create({ data: { tenantId: user.tenantId, name: name.trim(), location: location||null, address: address||null, phone: phone||null, email: email||null, managerId: managerId||null } });
      await prisma.auditLog.create({ data: { tenantId: user.tenantId, userId: user.sub, action: 'CREATE', entityType: 'Farm', entityId: farm.id, changes: { name: farm.name } } }).catch(()=>{});
      return NextResponse.json({ farm }, { status: 201 });
    }
    if (type === 'pen') {
      const { farmId, name, operationType, capacity, location, buildYear } = await request.json();
      if (!farmId||!name||!operationType||!capacity) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      const farm = await prisma.farm.findFirst({ where: { id: farmId, tenantId: user.tenantId } });
      if (!farm) return NextResponse.json({ error: 'Farm not found' }, { status: 404 });
      const pen = await prisma.pen.create({ data: { farmId, name: name.trim(), operationType, capacity: parseInt(capacity), location: location||null, buildYear: buildYear ? parseInt(buildYear) : null } });
      return NextResponse.json({ pen }, { status: 201 });
    }
    if (type === 'section') {
      const { penId, name, capacity } = await request.json();
      if (!penId||!name||!capacity) return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
      const pen = await prisma.pen.findFirst({ where: { id: penId, farm: { tenantId: user.tenantId } } });
      if (!pen) return NextResponse.json({ error: 'Pen not found' }, { status: 404 });
      const section = await prisma.penSection.create({ data: { penId, name: name.trim(), capacity: parseInt(capacity) } });
      return NextResponse.json({ section }, { status: 201 });
    }
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  } catch (error) {
    if (error.code === 'P2002') return NextResponse.json({ error: 'Name already exists' }, { status: 409 });
    console.error('Create error:', error);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}

export async function PATCH(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ADMIN_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const body = await request.json();

  try {
    if (type === 'farm') {
      const { id, name, location, address, phone, email, managerId, isActive } = body;
      const farm = await prisma.farm.findFirst({ where: { id, tenantId: user.tenantId } });
      if (!farm) return NextResponse.json({ error: 'Farm not found' }, { status: 404 });
      const updated = await prisma.farm.update({ where: { id }, data: { ...(name!==undefined&&{name}), ...(location!==undefined&&{location}), ...(address!==undefined&&{address}), ...(phone!==undefined&&{phone}), ...(email!==undefined&&{email}), ...(managerId!==undefined&&{managerId}), ...(isActive!==undefined&&{isActive}) } });
      return NextResponse.json({ farm: updated });
    }
    if (type === 'pen') {
      const { id, name, capacity, location, buildYear, isActive } = body;
      const pen = await prisma.pen.findFirst({ where: { id, farm: { tenantId: user.tenantId } } });
      if (!pen) return NextResponse.json({ error: 'Pen not found' }, { status: 404 });
      const updated = await prisma.pen.update({ where: { id }, data: { ...(name!==undefined&&{name}), ...(capacity!==undefined&&{capacity:parseInt(capacity)}), ...(location!==undefined&&{location}), ...(buildYear!==undefined&&{buildYear:buildYear?parseInt(buildYear):null}), ...(isActive!==undefined&&{isActive}) } });
      return NextResponse.json({ pen: updated });
    }
    if (type === 'section') {
      const { id, name, capacity, isActive } = body;
      const section = await prisma.penSection.findFirst({ where: { id, pen: { farm: { tenantId: user.tenantId } } } });
      if (!section) return NextResponse.json({ error: 'Section not found' }, { status: 404 });
      const updated = await prisma.penSection.update({ where: { id }, data: { ...(name!==undefined&&{name}), ...(capacity!==undefined&&{capacity:parseInt(capacity)}), ...(isActive!==undefined&&{isActive}) } });
      return NextResponse.json({ section: updated });
    }
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  } catch (error) {
    console.error('Update error:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
