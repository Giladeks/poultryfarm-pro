// app/api/feed/receipts/route.js — Feed store receipts: list + create
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const ALLOWED_ROLES = [
  'STORE_CLERK', 'STORE_MANAGER', 'FARM_MANAGER',
  'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];
const MANAGER_ROLES = ['STORE_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];

const createReceiptSchema = z.object({
  storeId:         z.string().uuid(),
  feedInventoryId: z.string().uuid(),
  supplierId:      z.string().uuid().optional().nullable(),
  receiptDate:     z.string(),
  quantityReceived: z.number().positive(),
  unitCost:        z.number().min(0),
  currency:        z.enum(['NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES', 'ZAR']).default('NGN'),
  referenceNumber: z.string().optional().nullable(),  // delivery note / PO ref
  batchNumber:     z.string().optional().nullable(),
  expiryDate:      z.string().optional().nullable(),
  qualityNotes:    z.string().optional().nullable(),
  notes:           z.string().optional().nullable(),
});

// ─── GET /api/feed/receipts ───────────────────────────────────────────────────
// Returns feed store receipts for this tenant.
// Query params: storeId, feedInventoryId, supplierId, from, to, limit
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const storeId         = searchParams.get('storeId');
  const feedInventoryId = searchParams.get('feedInventoryId');
  const supplierId      = searchParams.get('supplierId');
  const from            = searchParams.get('from');
  const to              = searchParams.get('to');
  const limit           = parseInt(searchParams.get('limit') || '50', 10);

  try {
    // Resolve stores belonging to this tenant
    const tenantStores = await prisma.store.findMany({
      where: { farm: { tenantId: user.tenantId } },
      select: { id: true },
    });
    const storeIds = tenantStores.map(s => s.id);

    const where = {
      storeId: { in: storeIds },
      // Only feed receipts (has feedInventoryId)
      feedInventoryId: { not: null },
      ...(storeId         && { storeId }),
      ...(feedInventoryId && { feedInventoryId }),
      ...(supplierId      && { supplierId }),
      ...((from || to)    && {
        receiptDate: {
          ...(from && { gte: new Date(from) }),
          ...(to   && { lte: new Date(to) }),
        },
      }),
    };

    const receipts = await prisma.storeReceipt.findMany({
      where,
      include: {
        store:         { select: { id: true, name: true } },
        feedInventory: { select: { id: true, feedType: true } },
        supplier:      { select: { id: true, name: true, phone: true } },
        receivedBy:    { select: { id: true, firstName: true, lastName: true, role: true } },
      },
      orderBy: { receiptDate: 'desc' },
      take: Math.min(limit, 200),
    });

    // Aggregate totals
    const totals = await prisma.storeReceipt.aggregate({
      where,
      _sum:   { quantityReceived: true, totalCost: true },
      _count: true,
    });

    return NextResponse.json({
      receipts,
      summary: {
        totalReceipts:   totals._count,
        totalKgReceived: parseFloat(Number(totals._sum.quantityReceived || 0).toFixed(2)),
        totalCost:       parseFloat(Number(totals._sum.totalCost || 0).toFixed(2)),
      },
    });
  } catch (error) {
    console.error('Feed receipts fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch feed receipts' }, { status: 500 });
  }
}

// ─── POST /api/feed/receipts ──────────────────────────────────────────────────
// Records a feed delivery. Adds quantity to FeedInventory stock.
// Updates costPerKg using weighted average pricing.
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  try {
    const body = await request.json();
    const data = createReceiptSchema.parse(body);

    // Verify store belongs to this tenant
    const store = await prisma.store.findFirst({
      where: { id: data.storeId, farm: { tenantId: user.tenantId } },
    });
    if (!store)
      return NextResponse.json({ error: 'Store not found' }, { status: 404 });

    // Verify feed inventory item belongs to this tenant
    const feedItem = await prisma.feedInventory.findFirst({
      where: {
        id:    data.feedInventoryId,
        store: { farm: { tenantId: user.tenantId } },
      },
    });
    if (!feedItem)
      return NextResponse.json({ error: 'Feed inventory item not found' }, { status: 404 });

    const totalCost = parseFloat((data.quantityReceived * data.unitCost).toFixed(2));

    // Weighted average cost per kg
    const currentStock  = Number(feedItem.currentStockKg);
    const currentCost   = Number(feedItem.costPerKg);
    const incomingQty   = data.quantityReceived;
    const incomingCost  = data.unitCost;
    const newTotalStock = currentStock + incomingQty;

    const weightedAvgCost = newTotalStock > 0
      ? parseFloat(
          ((currentStock * currentCost + incomingQty * incomingCost) / newTotalStock).toFixed(4)
        )
      : incomingCost;

    // Transactional: create receipt + update inventory stock & cost
    const [receipt] = await prisma.$transaction([
      prisma.storeReceipt.create({
        data: {
          storeId:          data.storeId,
          receivedById:     user.sub,
          receiptDate:      new Date(data.receiptDate),
          referenceNumber:  data.referenceNumber,
          supplierId:       data.supplierId,
          feedInventoryId:  data.feedInventoryId,
          quantityReceived: data.quantityReceived,
          unitCost:         data.unitCost,
          currency:         data.currency,
          totalCost,
          batchNumber:      data.batchNumber,
          expiryDate:       data.expiryDate ? new Date(data.expiryDate) : null,
          qualityStatus:    'PENDING',
          qualityNotes:     data.qualityNotes,
          notes:            data.notes,
        },
        include: {
          store:         { select: { id: true, name: true } },
          feedInventory: { select: { id: true, feedType: true } },
          supplier:      { select: { id: true, name: true } },
          receivedBy:    { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.feedInventory.update({
        where: { id: data.feedInventoryId },
        data: {
          currentStockKg: { increment: data.quantityReceived },
          costPerKg:      weightedAvgCost,
          // Update batch & expiry if provided
          ...(data.batchNumber && { batchNumber: data.batchNumber }),
          ...(data.expiryDate  && { expiryDate: new Date(data.expiryDate) }),
          ...(data.supplierId  && { supplierId: data.supplierId }),
        },
      }),
    ]);

    // Notify store manager + farm manager of new delivery
    await notifyDelivery(receipt, feedItem.feedType, data.quantityReceived, user.tenantId).catch(() => {});

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.sub,
        action:     'CREATE',
        entityType: 'StoreReceipt',
        entityId:   receipt.id,
        changes: {
          feedType:        feedItem.feedType,
          quantityReceived: data.quantityReceived,
          unitCost:        data.unitCost,
          totalCost,
          newStock:        parseFloat(newTotalStock.toFixed(2)),
          newCostPerKg:    weightedAvgCost,
        },
      },
    }).catch(() => {});

    return NextResponse.json({ receipt, updatedCostPerKg: weightedAvgCost }, { status: 201 });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Feed receipt create error:', error);
    return NextResponse.json({ error: 'Failed to record feed receipt' }, { status: 500 });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function notifyDelivery(receipt, feedType, quantityKg, tenantId) {
  const recipients = await prisma.user.findMany({
    where: {
      tenantId,
      role:     { in: ['STORE_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN'] },
      isActive: true,
    },
    select: { id: true },
  });

  if (!recipients.length) return;

  await prisma.notification.createMany({
    data: recipients.map(r => ({
      tenantId,
      recipientId: r.id,
      type:        'SYSTEM',
      title:       `Feed Delivery Recorded: ${feedType}`,
      message:     `${quantityKg}kg of ${feedType} received and added to stock.`,
      data: {
        receiptId:   receipt.id,
        feedType,
        quantityKg,
      },
      channel: 'IN_APP',
    })),
  });
}
