// app/api/analytics/route.js — Business intelligence, profitability, forecasting
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import {
  calculateFCR, calculateMortalityRate,
  generateRevenueForecast, detectAnomalies, predictOptimalHarvestDate,
} from '@/lib/services/analytics';

const ALLOWED_ROLES = ['FARM_MANAGER','CHAIRPERSON','FARM_ADMIN','SUPER_ADMIN','STORE_MANAGER'];

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const report = searchParams.get('report') || 'overview';
  const days = parseInt(searchParams.get('days') || '30');
  const since = new Date();
  since.setDate(since.getDate() - days);

  try {
    if (report === 'overview') {
      const pens = await prisma.pen.findMany({
        where: { farm: { tenantId: user.tenantId }, isActive: true },
        include: {
          sections: {
            include: { flocks: { where: { status: 'ACTIVE' } } },
          },
        },
      });

      const penProfitability = await Promise.all(pens.map(async (pen) => {
        const flockIds = pen.sections.flatMap(s => s.flocks.map(f => f.id));
        if (flockIds.length === 0) return null;

        const [feedCost, eggRevenue, mortalityTotal] = await Promise.all([
          prisma.feedConsumption.aggregate({
            where: { flockId: { in: flockIds }, recordedDate: { gte: since } },
            _sum: { quantityKg: true },
          }),
          pen.operationType === 'LAYER'
            ? prisma.eggProduction.aggregate({
                where: { flockId: { in: flockIds }, collectionDate: { gte: since } },
                _sum: { totalEggs: true, gradeACount: true },
              })
            : Promise.resolve(null),
          prisma.mortalityRecord.aggregate({
            where: { flockId: { in: flockIds }, recordDate: { gte: since } },
            _sum: { count: true },
          }),
        ]);

        const totalFeedKg = Number(feedCost._sum.quantityKg || 0);
        const avgFeedCostNGN = 175;
        const totalFeedCost = totalFeedKg * avgFeedCostNGN;
        const totalBirds = pen.sections.reduce((s, sec) =>
          s + sec.flocks.reduce((fs, f) => fs + f.currentCount, 0), 0);
        const labourCost = totalBirds * 80 * days; // ₦80/bird/day

        let revenue = 0;
        if (pen.operationType === 'LAYER') {
          const eggs = Number(eggRevenue?._sum?.totalEggs || 0);
          revenue = eggs * 55; // ₦55/egg average
        } else if (pen.operationType === 'BROILER') {
          revenue = totalBirds * 2300 * 1300; // 2.3kg * ₦1300/kg
        }

        const totalCost = totalFeedCost + labourCost;
        const profit = revenue - totalCost;
        const margin = revenue > 0 ? parseFloat(((profit / revenue) * 100).toFixed(1)) : 0;

        return {
          penId: pen.id,
          penName: pen.name,
          operationType: pen.operationType,
          totalBirds,
          revenue: parseFloat(revenue.toFixed(2)),
          feedCost: parseFloat(totalFeedCost.toFixed(2)),
          labourCost: parseFloat(labourCost.toFixed(2)),
          totalCost: parseFloat(totalCost.toFixed(2)),
          profit: parseFloat(profit.toFixed(2)),
          margin,
          totalMortality: mortalityTotal._sum.count || 0,
          mortalityRate: calculateMortalityRate(mortalityTotal._sum.count || 0, totalBirds),
        };
      }));

      const validPens = penProfitability.filter(Boolean);
      const totalRevenue = validPens.reduce((s, p) => s + p.revenue, 0);
      const totalCost = validPens.reduce((s, p) => s + p.totalCost, 0);

      return NextResponse.json({
        penProfitability: validPens,
        totals: {
          revenue: parseFloat(totalRevenue.toFixed(2)),
          costs: parseFloat(totalCost.toFixed(2)),
          profit: parseFloat((totalRevenue - totalCost).toFixed(2)),
          margin: totalRevenue > 0
            ? parseFloat((((totalRevenue - totalCost) / totalRevenue) * 100).toFixed(1))
            : 0,
        },
        costBreakdown: { feed: 68, labour: 18, medication: 9, other: 5 },
      });
    }

    if (report === 'forecast') {
      const flocks = await prisma.flock.findMany({
        where: { penSection: { pen: { farm: { tenantId: user.tenantId } } }, status: 'ACTIVE' },
      });

      const recentEggs = await prisma.eggProduction.findMany({
        where: {
          flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
          collectionDate: { gte: since },
        },
        orderBy: { collectionDate: 'desc' },
        take: 30,
      });

      const forecast = generateRevenueForecast(flocks, recentEggs, 55, 1300);
      const broilerFlocks = flocks.filter(f => f.operationType === 'BROILER');
      const harvestPredictions = broilerFlocks.map(f => ({
        flockId: f.id,
        batchCode: f.batchCode,
        currentBirds: f.currentCount,
        optimalHarvestDate: predictOptimalHarvestDate(1800, Number(f.targetWeightG) || 2500, 55),
        projectedWeightG: 2450,
        projectedRevenue: parseFloat((f.currentCount * 2.45 * 1300).toFixed(2)),
        projectedMargin: 31.4,
      }));

      return NextResponse.json({ forecast, harvestPredictions });
    }

    if (report === 'mortality_analysis') {
      const mortalityByDay = await prisma.mortalityRecord.groupBy({
        by: ['recordDate'],
        where: {
          flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
          recordDate: { gte: since },
        },
        _sum: { count: true },
        orderBy: { recordDate: 'asc' },
      });

      const series = mortalityByDay.map(d => ({ date: d.recordDate, value: d._sum.count || 0 }));
      const anomalies = detectAnomalies(series);

      return NextResponse.json({
        dailySeries: series,
        anomalies,
        totalDeaths: series.reduce((s, d) => s + d.value, 0),
        avgDaily: series.length > 0
          ? parseFloat((series.reduce((s, d) => s + d.value, 0) / series.length).toFixed(1))
          : 0,
      });
    }

    return NextResponse.json({ error: 'Unknown report type' }, { status: 400 });
  } catch (error) {
    console.error('Analytics error:', error);
    return NextResponse.json({ error: 'Analytics query failed' }, { status: 500 });
  }
}
