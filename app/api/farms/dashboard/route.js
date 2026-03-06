// app/api/farms/dashboard/route.js — Farm-wide KPI summary
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { generateSystemAlerts, detectAnomalies } from '@/lib/services/notifications';

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const tenantId = user.tenantId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Pens via farm → tenant chain
    const pens = await prisma.pen.findMany({
      where: { farm: { tenantId }, isActive: true },
      include: {
        sections: {
          include: { flocks: { where: { status: 'ACTIVE' } } },
        },
      },
      orderBy: { name: 'asc' },
    });

    const todayMortality = await prisma.mortalityRecord.findMany({
      where: { flock: { penSection: { pen: { farm: { tenantId } } } }, recordDate: { gte: today } },
    });

    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const weekMortality = await prisma.mortalityRecord.groupBy({
      by: ['recordDate'],
      where: { flock: { penSection: { pen: { farm: { tenantId } } } }, recordDate: { gte: sevenDaysAgo, lt: today } },
      _sum: { count: true },
    });

    const avgDailyMortality = weekMortality.length > 0
      ? weekMortality.reduce((s, d) => s + (d._sum.count || 0), 0) / weekMortality.length
      : 0;
    const todayMortalityCount = todayMortality.reduce((s, m) => s + m.count, 0);

    const todayEggs = await prisma.eggProduction.aggregate({
      where: { flock: { penSection: { pen: { farm: { tenantId } } } }, collectionDate: { gte: today } },
      _sum: { totalEggs: true, gradeACount: true },
    });

    const yesterdayStart = new Date(today);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayEggs = await prisma.eggProduction.aggregate({
      where: { flock: { penSection: { pen: { farm: { tenantId } } } }, collectionDate: { gte: yesterdayStart, lt: today } },
      _sum: { totalEggs: true },
    });

    const eggsTrend = (yesterdayEggs._sum.totalEggs || 0) > 0
      ? parseFloat((((todayEggs._sum.totalEggs - yesterdayEggs._sum.totalEggs) / yesterdayEggs._sum.totalEggs) * 100).toFixed(1))
      : 0;

    // Feed via store → farm → tenant
    const feedInventory = await prisma.feedInventory.findMany({
      where: { store: { farm: { tenantId } } },
    });

    const tasks = await prisma.task.findMany({
      where: { tenantId, dueDate: { gte: today } },
      include: {
        assignedTo: { select: { firstName: true, lastName: true } },
        penSection: { include: { pen: { select: { name: true } } } },
      },
      orderBy: { dueDate: 'asc' },
    });

    const vaccinations = await prisma.vaccination.findMany({
      where: {
        flock: { penSection: { pen: { farm: { tenantId } } } },
        status: { in: ['SCHEDULED', 'OVERDUE'] },
      },
      include: {
        flock: {
          select: {
            batchCode: true,
            penSection: { include: { pen: { select: { name: true } } } },
          },
        },
      },
      orderBy: { scheduledDate: 'asc' },
    });

    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const productionTrend = await prisma.$queryRaw`
      SELECT
        ep.collection_date::date as date,
        SUM(ep.total_eggs) as total_eggs,
        SUM(ep.grade_a_count) as grade_a,
        COALESCE(SUM(mr.count), 0) as total_mortality
      FROM egg_production ep
      LEFT JOIN mortality_records mr ON mr.record_date = ep.collection_date
      JOIN flocks f ON f.id = ep.flock_id
      JOIN pen_sections ps ON ps.id = f.pen_section_id
      JOIN pens p ON p.id = ps.pen_id
      JOIN farms fm ON fm.id = p.farm_id
      WHERE fm.tenant_id = ${tenantId}
        AND ep.collection_date >= ${thirtyDaysAgo}
      GROUP BY ep.collection_date
      ORDER BY ep.collection_date ASC
    `;

    const penSummary = pens.map(pen => {
      const totalBirds = pen.sections.reduce((s, sec) =>
        s + sec.flocks.reduce((fs, f) => fs + f.currentCount, 0), 0);
      const penMortality = todayMortality
        .filter(m => pen.sections.some(sec => sec.id === m.penSectionId))
        .reduce((s, m) => s + m.count, 0);

      let status = 'green';
      if (penMortality > avgDailyMortality * 2) status = 'red';
      else if (penMortality > avgDailyMortality * 1.3) status = 'yellow';

      return {
        id: pen.id,
        name: pen.name,
        operationType: pen.operationType,
        capacity: pen.capacity,
        currentCount: totalBirds,
        todayMortality: penMortality,
        status,
        sections: pen.sections.map(sec => ({
          id: sec.id,
          name: sec.name,
          capacity: sec.capacity,
          currentCount: sec.flocks.reduce((s, f) => s + f.currentCount, 0),
          flocks: sec.flocks,
        })),
      };
    });

    const alerts = generateSystemAlerts({
      flocks: penSummary.flatMap(p => p.sections.flatMap(s => s.flocks)),
      feedInventory,
      vaccinations,
      tasks,
      mortalityData: [],
    });

    const totalBirds = penSummary.reduce((s, p) => s + p.currentCount, 0);
    const totalCapacity = penSummary.reduce((s, p) => s + p.capacity, 0);
    const mortalityRate = totalBirds > 0
      ? parseFloat(((todayMortalityCount / totalBirds) * 100).toFixed(3))
      : 0;

    const feedDaysRemaining = feedInventory.length > 0
      ? Math.min(...feedInventory.map(f => Math.floor(Number(f.currentStockKg) / 100)))
      : 0;

    return NextResponse.json({
      kpis: {
        totalBirds, totalCapacity,
        occupancyPct: totalCapacity > 0 ? parseFloat(((totalBirds / totalCapacity) * 100).toFixed(1)) : 0,
        todayMortality: todayMortalityCount, mortalityRate,
        mortalityTrend: avgDailyMortality > 0
          ? parseFloat((((todayMortalityCount - avgDailyMortality) / avgDailyMortality) * 100).toFixed(1))
          : 0,
        todayEggs: todayEggs._sum.totalEggs || 0,
        todayGradeA: todayEggs._sum.gradeACount || 0,
        eggsTrend, feedDaysRemaining,
        activeAlerts: alerts.filter(a => a.severity === 'red').length,
      },
      pens: penSummary,
      tasks: tasks.map(t => ({
        id: t.id,
        type: t.taskType,
        title: t.title,
        workerName: `${t.assignedTo.firstName} ${t.assignedTo.lastName}`,
        section: `${t.penSection.pen.name} — ${t.penSection.name}`,
        dueDate: t.dueDate,
        status: t.status,
        completedAt: t.completedAt,
      })),
      alerts,
      vaccinations: vaccinations.slice(0, 5),
      productionTrend,
      feedInventory,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return NextResponse.json({ error: 'Failed to load dashboard data' }, { status: 500 });
  }
}
