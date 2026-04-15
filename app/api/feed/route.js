// app/api/feed/route.js — Feed inventory and consumption management
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';
import { z } from 'zod';

const consumptionSchema = z.object({
  flockId: z.string().min(1),
  penSectionId: z.string().min(1),
  feedInventoryId: z.string().min(1),
  recordedDate: z.string(),
  quantityKg: z.number().positive(),
});

const inventoryUpdateSchema = z.object({
  feedInventoryId: z.string().min(1),
  addStockKg: z.number().positive().optional(),
  newCostPerKg: z.number().positive().optional(),
  reorderLevelKg: z.number().positive().optional(),
});

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') || '14');
  const since = new Date();
  since.setDate(since.getDate() - days);

  try {
    // FeedInventory now lives under store → farm → tenant
    const [inventory, consumption] = await Promise.all([
      prisma.feedInventory.findMany({
        where: { store: { farm: { tenantId: user.tenantId } } },
        include: { supplier: { select: { name: true } } },
      }),
      prisma.feedConsumption.findMany({
        where: {
          flock: { penSection: { pen: { farm: { tenantId: user.tenantId } } } },
          recordedDate: { gte: since },
        },
        include: {
          flock: { select: { batchCode: true } },
          feedInventory: { select: { feedType: true } },
          penSection: { include: { pen: { select: { name: true } } } },
        },
        orderBy: { recordedDate: 'desc' },
      }),
    ]);

    const dailyUsage = {};
    for (const c of consumption) {
      const key = c.feedInventoryId;
      if (!dailyUsage[key]) dailyUsage[key] = { totalKg: 0, days: new Set() };
      dailyUsage[key].totalKg += Number(c.quantityKg);
      dailyUsage[key].days.add(c.recordedDate.toISOString().split('T')[0]);
    }

    const enrichedInventory = inventory.map(inv => {
      const usage = dailyUsage[inv.id];
      const avgDailyUsage = usage
        ? parseFloat((usage.totalKg / Math.max(usage.days.size, 1)).toFixed(1))
        : 0;
      const daysRemaining = avgDailyUsage > 0
        ? Math.floor(Number(inv.currentStockKg) / avgDailyUsage)
        : null;
      return {
        ...inv,
        avgDailyUsage,
        daysRemaining,
        needsReorder: Number(inv.currentStockKg) <= Number(inv.reorderLevelKg),
      };
    });

    const fcrData = await prisma.$queryRawUnsafe(`
      SELECT
        fc."flockId",
        f."batchCode",
        SUM(fc."quantityKg")::float      AS "totalFeedKg",
        COUNT(fc.id)::int                AS "consumptionEntries"
      FROM feed_consumption fc
      JOIN flocks       f  ON f.id  = fc."flockId"
      JOIN pen_sections ps ON ps.id = f."penSectionId"
      JOIN pens         p  ON p.id  = ps."penId"
      JOIN farms        fm ON fm.id = p."farmId"
      WHERE fm."tenantId" = $1
        AND fc."recordedDate" >= $2
      GROUP BY fc."flockId", f."batchCode"
    `, user.tenantId, since);

    return NextResponse.json({
      inventory: enrichedInventory,
      consumption: consumption.slice(0, 50),
      fcrData,
      summary: {
        totalFeedValue: inventory.reduce((s, i) => s + Number(i.currentStockKg) * Number(i.costPerKg), 0).toFixed(2),
        lowStockCount: inventory.filter(i => Number(i.currentStockKg) <= Number(i.reorderLevelKg)).length,
      },
    });
  } catch (error) {
    console.error('Feed fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch feed data' }, { status: 500 });
  }
}

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'consumption';

  try {
    if (action === 'consumption') {
      const data = consumptionSchema.parse(await request.json());

      const feedItem = await prisma.feedInventory.findFirst({
        where: { id: data.feedInventoryId, store: { farm: { tenantId: user.tenantId } } },
      });
      if (!feedItem) return NextResponse.json({ error: 'Feed item not found' }, { status: 404 });
      if (Number(feedItem.currentStockKg) < data.quantityKg)
        return NextResponse.json({ error: 'Insufficient feed stock' }, { status: 422 });

      const flock = await prisma.flock.findFirst({
        where: { id: data.flockId, penSection: { pen: { farm: { tenantId: user.tenantId } } } },
      });
      if (!flock) return NextResponse.json({ error: 'Flock not found' }, { status: 404 });

      const gramsPerBird = flock.currentCount > 0
        ? parseFloat(((data.quantityKg * 1000) / flock.currentCount).toFixed(1))
        : null;

      const [record] = await prisma.$transaction([
        prisma.feedConsumption.create({
          data: {
            ...data,
            recordedDate: new Date(data.recordedDate),
            recordedById: user.sub,
            costAtTime: feedItem.costPerKg,
            currency: feedItem.currency,
            gramsPerBird,
          },
        }),
        prisma.feedInventory.update({
          where: { id: data.feedInventoryId },
          data: { currentStockKg: { decrement: data.quantityKg } },
        }),
      ]);

      return NextResponse.json({ record }, { status: 201 });
    }

    if (action === 'restock') {
      const data = inventoryUpdateSchema.parse(await request.json());

      const feedItem = await prisma.feedInventory.findFirst({
        where: { id: data.feedInventoryId, store: { farm: { tenantId: user.tenantId } } },
      });
      if (!feedItem) return NextResponse.json({ error: 'Feed item not found' }, { status: 404 });

      const updated = await prisma.feedInventory.update({
        where: { id: data.feedInventoryId },
        data: {
          ...(data.addStockKg && { currentStockKg: { increment: data.addStockKg } }),
          ...(data.newCostPerKg && { costPerKg: data.newCostPerKg }),
          ...(data.reorderLevelKg && { reorderLevelKg: data.reorderLevelKg }),
        },
      });

      return NextResponse.json({ feedItem: updated });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    if (error.name === 'ZodError')
      return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 422 });
    console.error('Feed action error:', error);
    return NextResponse.json({ error: 'Feed operation failed' }, { status: 500 });
  }
}


