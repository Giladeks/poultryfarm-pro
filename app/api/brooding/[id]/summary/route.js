// app/api/brooding/[id]/summary/route.js
// GET — full brooding period summary for a chick arrival batch
// Returns:
//   - arrival info, flock, section
//   - daily temp chart data (avg per zone per day)
//   - mortality breakdown: week 1, week 2, total
//   - total feed consumed during brooding period
//   - survival rate
//   - cost per surviving chick
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

export async function GET(request, { params: rawParams }) {
  const params = await rawParams;
  const user   = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // Fetch the arrival (tenant-scoped)
    const arrival = await prisma.chick_arrivals.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
      include: {
        penSection: {
          select: {
            id: true, name: true,
            pen: { select: { id: true, name: true, operationType: true } },
          },
        },
        flock:     { select: { id: true, batchCode: true, breed: true, currentCount: true, status: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!arrival)
      return NextResponse.json({ error: 'Arrival not found' }, { status: 404 });

    const arrivalDateUTC = new Date(arrival.arrivalDate);
    // End of brooding = transfer date if transferred, else today
    const endDate = arrival.transferDate ? new Date(arrival.transferDate) : new Date();

    // ── 1. Daily temperature aggregates for chart ─────────────────────────────
    const tempLogs = await prisma.temperature_logs.findMany({
      where:   { chickArrivalId: arrival.id, tenantId: user.tenantId },
      orderBy: { loggedAt: 'asc' },
    });

    const byDayZone = {};
    for (const log of tempLogs) {
      const day = log.loggedAt.toISOString().slice(0, 10);
      const key = `${day}__${log.zone}`;
      if (!byDayZone[key]) byDayZone[key] = { day, zone: log.zone, readings: [] };
      byDayZone[key].readings.push(Number(log.tempCelsius));
    }
    const dailyTempData = Object.values(byDayZone).map(d => ({
      day:     d.day,
      zone:    d.zone,
      avgTemp: +(d.readings.reduce((s, v) => s + v, 0) / d.readings.length).toFixed(1),
      minTemp: Math.min(...d.readings),
      maxTemp: Math.max(...d.readings),
    })).sort((a, b) => a.day.localeCompare(b.day));

    // ── 2. Mortality during brooding period (from MortalityRecord for this flock/section) ──
    let mortalityWk1 = 0;
    let mortalityWk2 = 0;
    let mortalityTotal = 0;

    if (arrival.flockId) {
      // Week 1 = days 0–6 from arrival; Week 2 = days 7–13
      const wk1Start = new Date(Date.UTC(
        arrivalDateUTC.getUTCFullYear(), arrivalDateUTC.getUTCMonth(), arrivalDateUTC.getUTCDate()
      ));
      const wk1End = new Date(wk1Start); wk1End.setUTCDate(wk1End.getUTCDate() + 7);
      const wk2End = new Date(wk1Start); wk2End.setUTCDate(wk2End.getUTCDate() + 14);
      const periodEnd = endDate;

      const [wk1Records, wk2Records, totalRecords] = await Promise.all([
        prisma.mortalityRecord.aggregate({
          where: {
            flockId:      arrival.flockId,
            penSectionId: arrival.penSectionId,
            recordDate:   { gte: wk1Start, lt: wk1End },
          },
          _sum: { count: true },
        }),
        prisma.mortalityRecord.aggregate({
          where: {
            flockId:      arrival.flockId,
            penSectionId: arrival.penSectionId,
            recordDate:   { gte: wk1End, lt: wk2End },
          },
          _sum: { count: true },
        }),
        prisma.mortalityRecord.aggregate({
          where: {
            flockId:      arrival.flockId,
            penSectionId: arrival.penSectionId,
            recordDate:   { gte: wk1Start, lte: periodEnd },
          },
          _sum: { count: true },
        }),
      ]);

      mortalityWk1  = wk1Records._sum.count  || 0;
      mortalityWk2  = wk2Records._sum.count  || 0;
      mortalityTotal = totalRecords._sum.count || 0;
    }

    // ── 3. Total feed consumed during brooding ────────────────────────────────
    let totalFeedKg = 0;
    if (arrival.flockId) {
      const feedStart = new Date(Date.UTC(
        arrivalDateUTC.getUTCFullYear(), arrivalDateUTC.getUTCMonth(), arrivalDateUTC.getUTCDate()
      ));
      const feedEnd = new Date(endDate);
      feedEnd.setUTCHours(23, 59, 59, 999);

      const feedResult = await prisma.feedConsumption.aggregate({
        where: {
          flockId:         arrival.flockId,
          penSectionId:    arrival.penSectionId,
          consumptionDate: { gte: feedStart, lte: feedEnd },
        },
        _sum: { quantityKg: true },
      });
      totalFeedKg = Number(feedResult._sum.quantityKg || 0);
    }

    // ── 4. KPI calculations ───────────────────────────────────────────────────
    const chicksIn     = arrival.chicksReceived;
    const surviving    = arrival.survivingCount
      ?? (chicksIn - mortalityTotal);                  // best estimate if not yet transferred

    const survivalRatePct =
      chicksIn > 0 ? +((surviving / chicksIn) * 100).toFixed(2) : null;
    const mortalityWk1Pct =
      chicksIn > 0 ? +((mortalityWk1 / chicksIn) * 100).toFixed(2) : null;
    const mortalityWk2Pct =
      chicksIn > 0 ? +((mortalityWk2 / chicksIn) * 100).toFixed(2) : null;
    const mortalityTotalPct =
      chicksIn > 0 ? +((mortalityTotal / chicksIn) * 100).toFixed(2) : null;

    // Cost per surviving chick
    const totalChickCost = arrival.chickCostPerBird
      ? Number(arrival.chickCostPerBird) * chicksIn
      : null;
    const costPerSurviving =
      totalChickCost && surviving > 0
        ? +(totalChickCost / surviving).toFixed(2)
        : null;

    // Days in brooder
    const daysInBrooder = Math.floor((endDate - arrivalDateUTC) / 86400000);

    return NextResponse.json({
      arrival: {
        ...arrival,
        chickCostPerBird: arrival.chickCostPerBird ? Number(arrival.chickCostPerBird) : null,
        transferWeight:   arrival.transferWeight   ? Number(arrival.transferWeight)   : null,
      },
      summary: {
        daysInBrooder,
        chicksReceived:    chicksIn,
        surviving,
        survivalRatePct,
        mortalityWk1,
        mortalityWk1Pct,
        mortalityWk2,
        mortalityWk2Pct,
        mortalityTotal,
        mortalityTotalPct,
        totalFeedKg:       +totalFeedKg.toFixed(2),
        totalChickCost,
        costPerSurviving,
        currency:          arrival.currency || 'NGN',
      },
      dailyTempData,
    });

  } catch (err) {
    console.error('GET /api/brooding/[id]/summary error:', err);
    return NextResponse.json({ error: 'Failed to fetch summary', detail: err?.message }, { status: 500 });
  }
}
