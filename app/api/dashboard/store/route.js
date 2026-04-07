// app/api/dashboard/store/route.js
// Role-scoped dashboard data for Store Manager, Store Clerk, Feed Mill Manager, QC Technician
import { NextResponse } from 'next/server';
import { prisma }        from '@/lib/db/prisma';
import { verifyToken }   from '@/lib/middleware/auth';

const ALLOWED_ROLES = [
  'STORE_MANAGER', 'STORE_CLERK',
  'FEED_MILL_MANAGER', 'QC_TECHNICIAN',
  'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const today     = new Date(); today.setHours(0, 0, 0, 0);
  const sevenAgo  = new Date(today); sevenAgo.setDate(sevenAgo.getDate() - 7);
  const thirtyAgo = new Date(today); thirtyAgo.setDate(thirtyAgo.getDate() - 30);

  try {
    // ── Stores scoped to tenant ───────────────────────────────────────────────
    const stores = await prisma.store.findMany({
      where: { farm: { tenantId: user.tenantId } },
      select: { id: true, name: true, storeType: true },
    });
    const storeIds = stores.map(s => s.id);

    // ── Feed inventory with low-stock flag ────────────────────────────────────
    const inventory = await prisma.feedInventory.findMany({
      where: { storeId: { in: storeIds } },
      select: {
        id: true, feedType: true, currentStockKg: true,
        reorderLevelKg: true, maxStockKg: true, costPerKg: true,
        store: { select: { id: true, name: true } },
      },
      orderBy: { currentStockKg: 'asc' },
    });

    const lowStock     = inventory.filter(i => parseFloat(i.currentStockKg) <= parseFloat(i.reorderLevelKg));
    const totalStockKg = inventory.reduce((s, i) => s + parseFloat(i.currentStockKg), 0);
    const stockValue   = inventory.reduce((s, i) => s + parseFloat(i.currentStockKg) * parseFloat(i.costPerKg), 0);

    // ── Recent receipts (GRNs) ────────────────────────────────────────────────
    const recentReceipts = await prisma.storeReceipt.findMany({
      where: {
        storeId: { in: storeIds },
        receiptDate: { gte: thirtyAgo },
      },
      select: {
        id: true, receiptDate: true, quantityReceived: true,
        qualityStatus: true, batchNumber: true,
        feedInventory: { select: { feedType: true } },
        supplier:      { select: { name: true } },
        receivedBy:    { select: { firstName: true, lastName: true } },
      },
      orderBy: { receiptDate: 'desc' },
      take: 10,
    });

    // ── Recent issuances ──────────────────────────────────────────────────────
    const recentIssuances = await prisma.storeIssuance.findMany({
      where: {
        storeId: { in: storeIds },
        issuanceDate: { gte: sevenAgo },
      },
      select: {
        id: true, issuanceDate: true, quantityIssued: true, purpose: true,
        feedInventory: { select: { feedType: true } },
        issuedBy:      { select: { firstName: true, lastName: true } },
      },
      orderBy: { issuanceDate: 'desc' },
      take: 10,
    }).catch(() => []);

    // ── Feed consumption last 7 days ──────────────────────────────────────────
    const weekConsumption = await prisma.feedConsumption.aggregate({
      where: {
        penSection: { pen: { farm: { tenantId: user.tenantId } } },
        recordedDate: { gte: sevenAgo },
      },
      _sum: { quantityKg: true },
    });

    // ── Pending verifications for store records ───────────────────────────────
    const pendingVerifications = await prisma.verification.count({
      where: {
        tenantId: user.tenantId,
        status: 'PENDING',
        referenceType: { in: ['StoreReceipt', 'FeedConsumption'] },
      },
    });

    // ── 7-day daily consumption trend ─────────────────────────────────────────
    const consumptionTrend = await prisma.feedConsumption.groupBy({
      by: ['recordedDate'],
      where: {
        penSection: { pen: { farm: { tenantId: user.tenantId } } },
        recordedDate: { gte: sevenAgo },
      },
      _sum: { quantityKg: true },
      orderBy: { recordedDate: 'asc' },
    });

    // ── QC tests ──────────────────────────────────────────────────────────────
    const qcPending = await prisma.qCTest.findMany({
      where: {
        feedMillBatch: { tenantId: user.tenantId },
        passedSpec: false,
      },
      select: {
        id: true, testType: true, createdAt: true,
        feedMillBatch: { select: { batchCode: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 10,
    }).catch(() => []);

    const qcRecent = await prisma.qCTest.findMany({
      where: {
        feedMillBatch: { tenantId: user.tenantId },
        createdAt: { gte: sevenAgo },
        result: { not: '' },
      },
      select: {
        id: true, testType: true, result: true, createdAt: true,
        feedMillBatch: { select: { batchCode: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }).catch(() => []);

    // ── Feed mill batches ─────────────────────────────────────────────────────
    const millBatches = await prisma.feedMillBatch.findMany({
      where: {
        tenantId: user.tenantId,
        status: { in: ['PLANNED', 'IN_PRODUCTION', 'PRODUCED', 'QC_PASSED', 'QC_FAILED', 'RELEASED'] },
      },
      select: {
        id: true, batchCode: true,
        targetQuantityKg: true, actualQuantityKg: true,
        status: true, productionDate: true,
        producedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { productionDate: 'desc' },
      take: 10,
    }).catch(() => []);

    const millStats = {
      planned:     millBatches.filter(b => b.status === 'PLANNED').length,
      inProgress:  millBatches.filter(b => b.status === 'IN_PRODUCTION').length,
      completed7d: millBatches.filter(b =>
        ['PRODUCED', 'QC_PASSED', 'RELEASED'].includes(b.status) &&
        new Date(b.productionDate) >= sevenAgo
      ).length,
    };

    return NextResponse.json({
      role: user.role,
      stores,
      inventory: {
        items:         inventory,
        lowStock,
        totalStockKg:  parseFloat(totalStockKg.toFixed(1)),
        stockValue:    parseFloat(stockValue.toFixed(2)),
        lowStockCount: lowStock.length,
      },
      receipts:  recentReceipts,
      issuances: recentIssuances,
      consumption: {
        weekTotalKg: parseFloat((weekConsumption._sum.quantityKg || 0).toFixed(1)),
        trend: consumptionTrend.map(r => ({
          date:    r.recordedDate,
          totalKg: parseFloat((r._sum.quantityKg || 0).toFixed(1)),
        })),
      },
      pendingVerifications,
      qc: {
        pending:    qcPending,
        recent:     qcRecent,
        passRate7d: qcRecent.length > 0
          ? Math.round(qcRecent.filter(t => t.result === 'PASS').length / qcRecent.length * 100)
          : null,
      },
      mill: {
        batches: millBatches,
        stats:   millStats,
      },
    });
  } catch (error) {
    console.error('Store dashboard error:', error);
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 });
  }
}
