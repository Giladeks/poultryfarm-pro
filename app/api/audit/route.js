// app/api/audit/route.js — Audit log viewer API
// GET /api/audit?page=1&limit=50&entityType=User&userId=x&action=LOGIN&from=2026-01-01&to=2026-03-31
import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const ALLOWED_ROLES = ['FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

const ENTITY_TYPES = [
  'User', 'Farm', 'Flock', 'FeedConsumption', 'FeedInventory',
  'FeedMillBatch', 'StoreReceipt', 'PurchaseOrder', 'DailyReport',
  'Verification',
];

const ACTIONS = ['LOGIN', 'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'ROLE_CHANGE'];

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  const { searchParams } = new URL(request.url);

  const page       = Math.max(1, parseInt(searchParams.get('page')  || '1',  10));
  const limit      = Math.min(100, parseInt(searchParams.get('limit') || '50', 10));
  const entityType = searchParams.get('entityType') || null;
  const userId     = searchParams.get('userId')     || null;
  const action     = searchParams.get('action')     || null;
  const from       = searchParams.get('from')       || null;
  const to         = searchParams.get('to')         || null;
  const search     = searchParams.get('search')     || null;

  // Validate enums if provided
  if (entityType && !ENTITY_TYPES.includes(entityType))
    return NextResponse.json({ error: 'Invalid entityType' }, { status: 400 });
  if (action && !ACTIONS.includes(action))
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  try {
    const where = {
      tenantId: user.tenantId,
      ...(entityType && { entityType }),
      ...(userId     && { userId }),
      ...(action     && { action }),
      ...((from || to) && {
        createdAt: {
          ...(from && { gte: new Date(from) }),
          ...(to   && { lte: new Date(new Date(to).setHours(23, 59, 59, 999)) }),
        },
      }),
      // Free-text search across entityId and entityType
      ...(search && {
        OR: [
          { entityId:   { contains: search, mode: 'insensitive' } },
          { entityType: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id:        true,
              firstName: true,
              lastName:  true,
              role:      true,
              email:     true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip:  (page - 1) * limit,
        take:  limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    // ── Aggregate stats for the filter set ──────────────────────
    const [actionCounts, entityCounts] = await Promise.all([
      prisma.auditLog.groupBy({
        by: ['action'],
        where: { tenantId: user.tenantId },
        _count: { action: true },
        orderBy: { _count: { action: 'desc' } },
      }),
      prisma.auditLog.groupBy({
        by: ['entityType'],
        where: { tenantId: user.tenantId },
        _count: { entityType: true },
        orderBy: { _count: { entityType: 'desc' } },
      }),
    ]);

    return NextResponse.json({
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext:    page * limit < total,
        hasPrev:    page > 1,
      },
      meta: {
        actionCounts:  actionCounts.map(r  => ({ action: r.action,         count: r._count.action })),
        entityCounts:  entityCounts.map(r  => ({ entityType: r.entityType, count: r._count.entityType })),
      },
    });
  } catch (err) {
    console.error('[audit GET]', err);
    return NextResponse.json({ error: 'Failed to load audit logs' }, { status: 500 });
  }
}
