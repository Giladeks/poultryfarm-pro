// app/api/feed/consumption/route.js — Log and list feed consumption
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';
import { sendLowFeedAlert } from '@/lib/services/sms';

// Roles that can LOG consumption (workers + managers)
const ALLOWED_ROLES = [
  'PEN_WORKER', 'PEN_MANAGER', 'FARM_MANAGER',
  'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN', 'STORE_MANAGER',
];

const MANAGER_ROLES = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN', 'STORE_MANAGER'];

const createConsumptionSchema = z.object({
  flockId:         z.string().min(1),
  penSectionId:    z.string().min(1),
  feedInventoryId: z.string().min(1),
  recordedDate:    z.string(), // ISO date string
  quantityKg:      z.number().positive(),
  notes:           z.string().optional().nullable(),
});

// ─── GET /api/feed/consumption ────────────────────────────────────────────────
// Returns consumption records for this tenant.
// Query params: flockId, penSectionId, feedInventoryId, from, to, limit
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const flockId         = searchParams.get('flockId');
  const penSectionId    = searchParams.get('penSectionId');
  const feedInventoryId = searchParams.get('feedInventoryId');
  const from            = searchParams.get('from');
  const to              = searchParams.get('to');
  const limit           = parseInt(searchParams.get('limit') || '50', 10);

  try {
    // Workers can only see their own assigned sections
    let sectionFilter = undefined;
    if (user.role === 'PEN_WORKER') {
      const assignments = await prisma.penWorkerAssignment.findMany({
        where: { userId: user.sub, isActive: true },
        select: { penSectionId: true },
      });
      sectionFilter = { in: assignments.map(a => a.penSectionId) };
    }

    const where = {
      flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
      ...(flockId && { flockId }),
      ...(penSectionId && { penSectionId }),
      ...(feedInventoryId && { feedInventoryId }),
      ...(sectionFilter && { penSectionId: sectionFilter }),
      ...((from || to) && {
        recordedDate: {
          ...(from && { gte: new Date(from) }),
          ...(to   && { lte: new Date(to) }),
        },
      }),
    };

    const records = await prisma.feedConsumption.findMany({
      where,
      include: {
        flock:         { select: { id: true, batchCode: true, operationType: true, currentCount: true } },
        penSection:    { select: { id: true, name: true, pen: { select: { id: true, name: true } } } },
        feedInventory: { select: { id: true, feedType: true, costPerKg: true, currency: true } },
        recordedBy:    { select: { id: true, firstName: true, lastName: true, role: true } },
      },
      orderBy: { recordedDate: 'desc' },
      take: Math.min(limit, 200),
    });

    // Aggregate totals for summary
    const totals = await prisma.feedConsumption.aggregate({
      where,
      _sum: { quantityKg: true },
      _count: true,
    });

    // Group by flock for FCR data (if from/to provided)
    let flockSummaries = [];
    if (flockId) {
      const flock = await prisma.flock.findFirst({
        where: { id: flockId },
        select: { currentCount: true, operationType: true },
      });

      if (flock) {
        const totalKg = Number(totals._sum.quantityKg || 0);
        const perBirdKg = flock.currentCount > 0 ? totalKg / flock.currentCount : 0;

        flockSummaries = [{
          flockId,
          totalFeedKg:  parseFloat(totalKg.toFixed(2)),
          perBirdKg:    parseFloat(perBirdKg.toFixed(3)),
          // FCR requires weight data — returned separately
        }];
      }
    }

    return NextResponse.json({
      consumption: records,
      summary: {
        totalRecords:  totals._count,
        totalKg:       parseFloat(Number(totals._sum.quantityKg || 0).toFixed(2)),
        flockSummaries,
      },
    });
  } catch (error) {
    console.error('Feed consumption fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch consumption records' }, { status: 500 });
  }
}

// ─── POST /api/feed/consumption ───────────────────────────────────────────────
// Logs a new feed consumption entry. Deducts from FeedInventory stock.
// Workers log for their assigned pen sections only.
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const body = await request.json();
    const data = createConsumptionSchema.parse(body);

    // Verify flock belongs to this tenant
    const flock = await prisma.flock.findFirst({
      where: {
        id:         data.flockId,
        penSection: { pen: { farm: { tenantId: user.tenantId } } },
      },
      include: { penSection: true },
    });
    if (!flock)
      return NextResponse.json({ error: 'Flock not found' }, { status: 404 });

    // Verify pen section matches flock
    if (flock.penSectionId !== data.penSectionId)
      return NextResponse.json({ error: 'Pen section does not match flock' }, { status: 422 });

    // Workers: verify they are assigned to this section
    if (user.role === 'PEN_WORKER') {
      const assignment = await prisma.penWorkerAssignment.findFirst({
        where: { userId: user.sub, penSectionId: data.penSectionId, isActive: true },
      });
      if (!assignment)
        return NextResponse.json({ error: 'You are not assigned to this pen section' }, { status: 403 });
    }

    // Verify feed inventory belongs to tenant and has sufficient stock
    const feedItem = await prisma.feedInventory.findFirst({
      where: {
        id:    data.feedInventoryId,
        store: { farm: { tenantId: user.tenantId } },
      },
    });
    if (!feedItem)
      return NextResponse.json({ error: 'Feed inventory item not found' }, { status: 404 });

    if (Number(feedItem.currentStockKg) < data.quantityKg) {
      return NextResponse.json({
        error: 'Insufficient feed stock',
        available: Number(feedItem.currentStockKg),
        requested: data.quantityKg,
      }, { status: 422 });
    }

    // Auto-calculate grams per bird
    const gramsPerBird = flock.currentCount > 0
      ? parseFloat(((data.quantityKg * 1000) / flock.currentCount).toFixed(2))
      : null;

    // Transactional: create consumption record + deduct from stock
    const [consumption] = await prisma.$transaction([
      prisma.feedConsumption.create({
        data: {
          flockId:         data.flockId,
          penSectionId:    data.penSectionId,
          feedInventoryId: data.feedInventoryId,
          recordedDate:    new Date(data.recordedDate),
          quantityKg:      data.quantityKg,
          gramsPerBird,
          costAtTime:      feedItem.costPerKg,
          currency:        feedItem.currency,
          recordedById:    user.sub,
          notes:           data.notes,
        },
        include: {
          flock:         { select: { id: true, batchCode: true, operationType: true } },
          penSection:    { select: { id: true, name: true } },
          feedInventory: { select: { id: true, feedType: true } },
        },
      }),
      prisma.feedInventory.update({
        where: { id: data.feedInventoryId },
        data: {
          currentStockKg: {
            decrement: data.quantityKg,
          },
        },
      }),
    ]);

    // Check if stock is now below reorder level — trigger notification + SMS
    const updatedStock = Number(feedItem.currentStockKg) - data.quantityKg;
    if (updatedStock <= Number(feedItem.reorderLevelKg)) {
      // Fire-and-forget: in-app notifications
      prisma.notification.createMany({
        data: await buildLowStockNotifications(feedItem, updatedStock, user.tenantId),
      }).catch(() => {});
      // Fire-and-forget: SMS alert
      sendLowFeedSms(feedItem, updatedStock, user.tenantId).catch(() => {});
    }

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'CREATE',
        entityType: 'FeedConsumption',
        entityId:   consumption.id,
        changes: {
          flockId:    data.flockId,
          quantityKg: data.quantityKg,
          gramsPerBird,
          stockAfter: parseFloat(updatedStock.toFixed(2)),
        },
      },
    }).catch(() => {});

    return NextResponse.json({ consumption }, { status: 201 });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Feed consumption create error:', error);
    return NextResponse.json({ error: 'Failed to log feed consumption' }, { status: 500 });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildLowStockNotifications(feedItem, currentStockKg, tenantId) {
  // Find all STORE_MANAGER and FARM_MANAGER users for this tenant
  const recipients = await prisma.user.findMany({
    where: {
      tenantId,
      role: { in: ['STORE_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN'] },
      isActive: true,
    },
    select: { id: true },
  });

  return recipients.map(r => ({
    tenantId,
    recipientId: r.id,
    type:        'LOW_STOCK',
    title:       `Low Feed Stock: ${feedItem.feedType}`,
    message:     `${feedItem.feedType} is below reorder level. Current stock: ${currentStockKg.toFixed(1)}kg (reorder at ${feedItem.reorderLevelKg}kg).`,
    data: {
      feedInventoryId: feedItem.id,
      feedType:        feedItem.feedType,
      currentStockKg:  currentStockKg.toFixed(2),
      reorderLevelKg:  feedItem.reorderLevelKg,
    },
    channel: 'IN_APP',
  }));
}

async function sendLowFeedSms(feedItem, currentStockKg, tenantId) {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: true },
    });
    const smsSettings = tenant?.settings?.sms;
    if (!smsSettings?.enabled || !smsSettings?.lowFeedAlert?.enabled) return;

    // Get store name for the message
    const store = await prisma.store.findUnique({
      where: { id: feedItem.storeId },
      select: { name: true },
    });

    const recipients = await prisma.user.findMany({
      where: {
        tenantId,
        role:     { in: ['STORE_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON'] },
        isActive: true,
        phone:    { not: null },
      },
      select: { phone: true },
    });

    const extraPhones = (smsSettings.alertPhones || []).map(p => ({ phone: p.phone }));
    const allRecipients = [...recipients, ...extraPhones].filter(r => r.phone);

    await sendLowFeedAlert({
      feedType:       feedItem.feedType,
      currentStockKg,
      reorderLevelKg: feedItem.reorderLevelKg,
      storeName:      store?.name || 'Store',
      recipients:     allRecipients,
    });
  } catch (err) {
    console.error('[SMS] Low feed alert error:', err.message);
  }
}



// app/api/feed/consumption/[id]/route.js — Single consumption: GET + PATCH + DELETE
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const MANAGER_ROLES = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN', 'STORE_MANAGER'];

