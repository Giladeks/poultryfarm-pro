// app/api/investigations/route.js
import { NextResponse }  from 'next/server';
import { prisma }        from '@/lib/db/prisma';
import { verifyToken }   from '@/lib/middleware/auth';

const IC_ROLES       = ['INTERNAL_CONTROL', 'SUPER_ADMIN'];
const VIEW_ROLES     = ['INTERNAL_CONTROL', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const VALID_STATUSES = ['OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED'];

// GET /api/investigations?status=OPEN&page=1&limit=30
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!VIEW_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const status  = searchParams.get('status')  || null;
  const page    = Math.max(1, parseInt(searchParams.get('page')  || '1',  10));
  const limit   = Math.min(50, parseInt(searchParams.get('limit') || '30', 10));

  if (status && !VALID_STATUSES.includes(status))
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  try {
    const where = {
      tenantId: user.tenantId,
      ...(status && { status }),
    };

    const [investigations, total, summary] = await Promise.all([
      prisma.investigation.findMany({
        where,
        include: {
          flaggedBy:   { select: { id: true, firstName: true, lastName: true, role: true } },
          escalatedTo: { select: { id: true, firstName: true, lastName: true, role: true } },
          resolvedBy:  { select: { id: true, firstName: true, lastName: true, role: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip:  (page - 1) * limit,
        take:  limit,
      }),
      prisma.investigation.count({ where }),
      // Summary counts by status
      prisma.investigation.groupBy({
        by: ['status'],
        where: { tenantId: user.tenantId },
        _count: { status: true },
      }),
    ]);

    const counts = Object.fromEntries(
      VALID_STATUSES.map(s => [s, 0])
    );
    for (const row of summary) counts[row.status] = row._count.status;

    return NextResponse.json({
      investigations,
      pagination: {
        page, limit, total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1,
      },
      summary: counts,
    });
  } catch (err) {
    console.error('[investigations GET]', err);
    return NextResponse.json({ error: 'Failed to load investigations' }, { status: 500 });
  }
}

// POST /api/investigations — IC Officer flags a record
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!IC_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Only Internal Control Officers can flag records' }, { status: 403 });

  try {
    const body = await request.json();
    const { referenceType, referenceId, flagReason } = body;

    if (!referenceType || !referenceId || !flagReason?.trim())
      return NextResponse.json({ error: 'referenceType, referenceId, and flagReason are required' }, { status: 400 });

    // Prevent duplicate open/under-review flags on same record
    const existing = await prisma.investigation.findFirst({
      where: {
        tenantId: user.tenantId,
        referenceType,
        referenceId,
        status: { in: ['OPEN', 'UNDER_REVIEW', 'ESCALATED'] },
      },
    });
    if (existing)
      return NextResponse.json({ error: 'An open investigation already exists for this record', existingId: existing.id }, { status: 409 });

    const investigation = await prisma.investigation.create({
      data: {
        tenantId:      user.tenantId,
        referenceType,
        referenceId,
        flaggedById:   user.id,
        flagReason:    flagReason.trim(),
        status:        'OPEN',
      },
      include: {
        flaggedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
    });

    return NextResponse.json({ investigation }, { status: 201 });
  } catch (err) {
    console.error('[investigations POST]', err);
    return NextResponse.json({ error: 'Failed to create investigation' }, { status: 500 });
  }
}
