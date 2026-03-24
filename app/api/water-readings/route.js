// app/api/water-readings/route.js
// POST — worker logs daily water meter odometer reading for a pen section
// GET  — returns recent readings for the worker's assigned sections
//
// WaterMeterReading fields:
//   tenantId, penSectionId, flockId (optional), readingDate, meterReading (raw odometer L)
//   consumptionL    = today − yesterday's meterReading (system-computed)
//   consumptionLPB  = consumptionL / flock.currentCount   (system-computed)
//
// Unique constraint: (penSectionId, readingDate) — one reading per section per day

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';
import { z }            from 'zod';

const ALLOWED_ROLES = [
  'PEN_WORKER', 'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN',
  'CHAIRPERSON', 'SUPER_ADMIN',
];

const createSchema = z.object({
  penSectionId: z.string().min(1),
  flockId:      z.string().min(1).optional().nullable(),
  readingDate:  z.string(),                         // YYYY-MM-DD
  meterReading: z.number().positive(),              // raw odometer value in litres
  notes:        z.string().max(500).optional().nullable(),
});

// ── GET /api/water-readings ───────────────────────────────────────────────────
// Returns last 7 days of readings for the caller's assigned sections
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const penSectionId = searchParams.get('penSectionId');
  const days         = Math.min(parseInt(searchParams.get('days') || '7'), 30);
  const since        = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  try {
    // Scope to worker's assigned sections unless manager+
    const FARM_WIDE = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
    let sectionIds = null;

    if (!FARM_WIDE.includes(user.role)) {
      const assignments = await prisma.penWorkerAssignment.findMany({
        where:  { userId: user.sub },
        select: { penSectionId: true },
      });
      sectionIds = assignments.map(a => a.penSectionId);
      if (sectionIds.length === 0) return NextResponse.json({ readings: [] });
    }

    const readings = await prisma.waterMeterReading.findMany({
      where: {
        tenantId:    user.tenantId,
        readingDate: { gte: since },
        ...(penSectionId && { penSectionId }),
        ...(sectionIds   && { penSectionId: { in: sectionIds } }),
      },
      include: {
        penSection: { select: { id: true, name: true, pen: { select: { name: true } } } },
        flock:      { select: { id: true, batchCode: true, currentCount: true } },
        recordedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ penSectionId: 'asc' }, { readingDate: 'desc' }],
    });

    return NextResponse.json({ readings });
  } catch (err) {
    console.error('[water-readings GET]', err);
    return NextResponse.json({ error: 'Failed to load water readings' }, { status: 500 });
  }
}

// ── POST /api/water-readings ──────────────────────────────────────────────────
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await request.json();
    const data = createSchema.parse(body);

    // ── Verify the section belongs to this tenant ─────────────────────────────
    const section = await prisma.penSection.findFirst({
      where: {
        id:  data.penSectionId,
        pen: { farm: { tenantId: user.tenantId } },
      },
      include: {
        flocks: {
          where:  { status: 'ACTIVE' },
          select: { id: true, currentCount: true },
          take:   1,
        },
      },
    });
    if (!section)
      return NextResponse.json({ error: 'Pen section not found' }, { status: 404 });

    // ── Workers must be assigned to this section ──────────────────────────────
    const FARM_WIDE = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN', 'PEN_MANAGER'];
    if (!FARM_WIDE.includes(user.role)) {
      const assigned = await prisma.penWorkerAssignment.findFirst({
        where: { userId: user.sub, penSectionId: data.penSectionId },
      });
      if (!assigned)
        return NextResponse.json({ error: 'You are not assigned to this section' }, { status: 403 });
    }

    // ── Resolve flockId — use active flock in section if not supplied ─────────
    const flockId = data.flockId || section.flocks[0]?.id || null;
    const currentBirdCount = section.flocks[0]?.currentCount || 0;

    const readingDate = new Date(data.readingDate);

    // ── Check duplicate: one reading per section per day ─────────────────────
    const existing = await prisma.waterMeterReading.findUnique({
      where: { penSectionId_readingDate: { penSectionId: data.penSectionId, readingDate } },
    });
    if (existing)
      return NextResponse.json(
        { error: 'A water meter reading for this section has already been recorded today' },
        { status: 409 }
      );

    // ── Fetch yesterday's reading to compute daily consumption ────────────────
    const yesterday = new Date(readingDate);
    yesterday.setDate(yesterday.getDate() - 1);

    const prevReading = await prisma.waterMeterReading.findFirst({
      where: {
        penSectionId: data.penSectionId,
        readingDate:  { gte: new Date(yesterday.getTime() - 2 * 86400000), lte: yesterday },
      },
      orderBy: { readingDate: 'desc' },
      select:  { meterReading: true, readingDate: true },
    });

    // consumptionL = today − yesterday (null if no previous reading)
    let consumptionL   = null;
    let consumptionLPB = null;

    if (prevReading) {
      const diff = data.meterReading - Number(prevReading.meterReading);
      if (diff >= 0) {
        consumptionL = parseFloat(diff.toFixed(2));
        consumptionLPB = currentBirdCount > 0
          ? parseFloat((consumptionL / currentBirdCount).toFixed(4))
          : null;
      }
      // Negative diff = meter reset or entry error — store null, let staff correct
    }

    const reading = await prisma.waterMeterReading.create({
      data: {
        tenantId:      user.tenantId,
        penSectionId:  data.penSectionId,
        flockId:       flockId || undefined,
        readingDate,
        meterReading:  data.meterReading,
        consumptionL,
        consumptionLPB,
        recordedById:  user.sub,
      },
      include: {
        penSection: { select: { id: true, name: true, pen: { select: { name: true } } } },
        flock:      { select: { id: true, batchCode: true, currentCount: true } },
        recordedBy: { select: { firstName: true, lastName: true } },
      },
    });

    return NextResponse.json({
      reading,
      computed: {
        consumptionL,
        consumptionLPB,
        prevMeterReading: prevReading ? Number(prevReading.meterReading) : null,
        prevReadingDate:  prevReading?.readingDate || null,
        isFirstReading:   !prevReading,
      },
    }, { status: 201 });

  } catch (err) {
    if (err.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: err.errors }, { status: 422 });
    if (err.code === 'P2002')
      return NextResponse.json(
        { error: 'A water meter reading for this section has already been recorded today' },
        { status: 409 }
      );
    console.error('[water-readings POST]', err);
    return NextResponse.json({ error: 'Failed to save water meter reading' }, { status: 500 });
  }
}
