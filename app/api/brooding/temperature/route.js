// app/api/brooding/temperature/route.js
// GET  — temp log history for a flock (flockId param)
// POST — log a reading; alert managers if outside 26–38°C
// v2: primary scope is flockId; chickArrivalId optional
// Prisma accessor: prisma.temperature_logs
// Relation names (from db pull): users (loggedBy), pen_sections, chick_arrivals
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const ALLOWED_POST_ROLES = [
  'PEN_WORKER', 'PEN_MANAGER', 'PRODUCTION_STAFF',
  'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];

const createSchema = z.object({
  flockId:        z.string().min(1),
  penSectionId:   z.string().min(1),
  chickArrivalId: z.string().min(1).optional().nullable(),
  zone:           z.string().min(1).default('Zone A'),
  tempCelsius:    z.number().min(-10).max(60),
  humidity:       z.number().min(0).max(100).optional().nullable(),
  taskId:         z.string().min(1).optional().nullable(),
  loggedAt:       z.string().optional().nullable(),
  notes:          z.string().max(500).optional().nullable(),
});

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const flockId          = searchParams.get('flockId');
  const chickArrivalId   = searchParams.get('chickArrivalId');

  if (!flockId && !chickArrivalId)
    return NextResponse.json({ error: 'flockId or chickArrivalId required' }, { status: 400 });

  try {
    const logs = await prisma.temperature_logs.findMany({
      where: {
        tenantId: user.tenantId,
        ...(flockId        ? { flockId }        : {}),
        ...(chickArrivalId ? { chickArrivalId } : {}),
      },
      orderBy: { loggedAt: 'asc' },
      include: {
        // Prisma db-pull names the relation 'users' (from loggedById FK)
        users: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Normalise: expose as loggedBy for the UI
    const normalisedLogs = logs.map(log => ({
      ...log,
      loggedBy: log.users,
      users: undefined,
    }));

    // Daily aggregates per zone for Recharts
    const byDayZone = {};
    for (const log of logs) {
      const day = log.loggedAt.toISOString().slice(0, 10);
      const key = `${day}__${log.zone}`;
      if (!byDayZone[key]) byDayZone[key] = { day, zone: log.zone, readings: [] };
      byDayZone[key].readings.push(Number(log.tempCelsius));
    }
    const dailyAggregates = Object.values(byDayZone).map(d => ({
      day:     d.day,
      zone:    d.zone,
      avgTemp: +(d.readings.reduce((s, v) => s + v, 0) / d.readings.length).toFixed(1),
      minTemp: +Math.min(...d.readings).toFixed(1),
      maxTemp: +Math.max(...d.readings).toFixed(1),
    })).sort((a, b) => a.day.localeCompare(b.day));

    return NextResponse.json({ logs: normalisedLogs, dailyAggregates });
  } catch (err) {
    console.error('GET /api/brooding/temperature error:', err);
    return NextResponse.json({ error: 'Failed', detail: err?.message }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_POST_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body   = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.errors }, { status: 422 });

    const data = parsed.data;

    const flock = await prisma.flock.findFirst({
      where:  { id: data.flockId, tenantId: user.tenantId },
      select: { id: true, batchCode: true },
    });
    if (!flock)
      return NextResponse.json({ error: 'Flock not found' }, { status: 404 });

    const section = await prisma.penSection.findFirst({
      where: { id: data.penSectionId, pen: { farm: { tenantId: user.tenantId } } },
    });
    if (!section)
      return NextResponse.json({ error: 'Pen section not found' }, { status: 404 });

    const log = await prisma.temperature_logs.create({
      data: {
        tenantId:       user.tenantId,
        flockId:        data.flockId,
        chickArrivalId: data.chickArrivalId || null,
        penSectionId:   data.penSectionId,
        zone:           data.zone,
        tempCelsius:    data.tempCelsius,
        humidity:       data.humidity    ?? null,
        taskId:         data.taskId      || null,
        loggedAt:       data.loggedAt ? new Date(data.loggedAt) : new Date(),
        loggedById:     user.sub,
        notes:          data.notes       || null,
      },
    });

    const isOutOfRange = data.tempCelsius < 26 || data.tempCelsius > 38;
    let alertCount = 0;

    if (isOutOfRange) {
      const direction = data.tempCelsius < 26 ? 'LOW' : 'HIGH';
      const managers  = await prisma.user.findMany({
        where:  { tenantId: user.tenantId, role: { in: ['PEN_MANAGER','FARM_MANAGER','FARM_ADMIN'] }, isActive: true },
        select: { id: true },
      });
      for (const mgr of managers) {
        await prisma.notification.create({
          data: {
            tenantId: user.tenantId, recipientId: mgr.id, senderId: user.sub,
            type: 'ALERT',
            title: `Brooder Temp Alert — ${flock.batchCode}`,
            message: `Temperature ${direction}: ${data.tempCelsius}°C in ${data.zone}. Safe range 26–38°C. Batch: ${flock.batchCode}.`,
            channel: 'IN_APP',
            data: { flockId: data.flockId, batchCode: flock.batchCode, tempCelsius: data.tempCelsius, zone: data.zone, direction },
          },
        }).catch(() => {});
        alertCount++;
      }
    }

    return NextResponse.json({
      log,
      alert: isOutOfRange ? { triggered: true, notified: alertCount } : { triggered: false },
    }, { status: 201 });

  } catch (err) {
    console.error('POST /api/brooding/temperature error:', err);
    return NextResponse.json({ error: 'Failed to log temperature', detail: err?.message }, { status: 500 });
  }
}
