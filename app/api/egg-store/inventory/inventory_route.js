// app/api/egg-store/inventory/route.js
// GET /api/egg-store/inventory?penId=xxx&days=30
//
// Returns current egg inventory balance per pen and per-pen history.
// Used by Store Manager dashboard, Layer Analytics, and IC audit view.
//
// Roles: STORE_MANAGER, STORE_CLERK, INTERNAL_CONTROL,
//        FARM_MANAGER, FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN
//
// Response:
//   {
//     balances: PenBalance[],    ← today's (or latest) balance per pen
//     history:  DayBalance[],    ← daily history for `days` window (if penId supplied)
//   }
//
// CRITICAL: egg_inventory_balance is a snake_case table.
//           ALWAYS use $queryRawUnsafe — never prisma accessor.

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const VIEW_ROLES = [
  'STORE_MANAGER', 'STORE_CLERK',
  'INTERNAL_CONTROL', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!VIEW_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const penIdFilter = searchParams.get('penId') || null;
  const days        = Math.min(parseInt(searchParams.get('days') || '30'), 365);

  try {
    // ── 1. Latest balance per pen (today's row, or most recent if today not yet created) ──
    const balanceRows = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT ON (eib."penId")
        eib.id,
        eib."penId",
        p.name                   AS "penName",
        eib."balanceDate",
        eib."openingGradeA",
        eib."openingGradeB",
        eib."openingCracked",
        eib."receiptsGradeA",
        eib."receiptsGradeB",
        eib."receiptsCracked",
        eib."salesGradeA",
        eib."salesGradeB",
        eib."salesCracked",
        eib."adjustmentGradeA",
        eib."adjustmentGradeB",
        eib."adjustmentCracked",
        eib."closingGradeA",
        eib."closingGradeB",
        eib."closingCracked",
        eib."closingTotalEggs",
        eib."receiptsTotalEggs",
        eib."updatedAt"
      FROM egg_inventory_balance eib
      INNER JOIN pens  p ON p.id  = eib."penId"
      INNER JOIN farms f ON f.id  = p."farmId"
      WHERE f."tenantId" = $1
        ${penIdFilter ? 'AND eib."penId" = $2' : ''}
      ORDER BY eib."penId", eib."balanceDate" DESC
    `, ...[user.tenantId, ...(penIdFilter ? [penIdFilter] : [])]);

    const balances = balanceRows.map(r => ({
      penId:           r.penId,
      penName:         r.penName,
      balanceDate:     r.balanceDate instanceof Date
        ? r.balanceDate.toISOString().slice(0, 10)
        : String(r.balanceDate).slice(0, 10),
      // Opening
      openingGradeA:   Number(r.openingGradeA),
      openingGradeB:   Number(r.openingGradeB),
      openingCracked:  Number(r.openingCracked),
      // Receipts today
      receiptsGradeA:  Number(r.receiptsGradeA),
      receiptsGradeB:  Number(r.receiptsGradeB),
      receiptsCracked: Number(r.receiptsCracked),
      receiptsTotalEggs: Number(r.receiptsTotalEggs || 0),
      // Sales today
      salesGradeA:     Number(r.salesGradeA),
      salesGradeB:     Number(r.salesGradeB),
      salesCracked:    Number(r.salesCracked),
      // Adjustments
      adjustmentGradeA:  Number(r.adjustmentGradeA),
      adjustmentGradeB:  Number(r.adjustmentGradeB),
      adjustmentCracked: Number(r.adjustmentCracked),
      // Closing (current stock)
      closingGradeA:   Number(r.closingGradeA),
      closingGradeB:   Number(r.closingGradeB),
      closingCracked:  Number(r.closingCracked),
      closingTotal:    Number(r.closingTotalEggs || 0),
      // Derived: crate counts for display
      closingGradeACrates: Math.floor(Number(r.closingGradeA) / 30),
      closingGradeALoose:  Number(r.closingGradeA) % 30,
      closingGradeBCrates: Math.floor(Number(r.closingGradeB) / 30),
      closingGradeBLoose:  Number(r.closingGradeB) % 30,
      updatedAt: r.updatedAt,
    }));

    // ── 2. History (only when a specific pen is requested) ────────────────────
    let history = [];
    if (penIdFilter) {
      const now  = new Date();
      const from = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)
      ));

      const histRows = await prisma.$queryRawUnsafe(`
        SELECT
          eib."balanceDate",
          eib."openingGradeA",
          eib."openingGradeB",
          eib."openingCracked",
          eib."receiptsGradeA",
          eib."receiptsGradeB",
          eib."receiptsCracked",
          eib."salesGradeA",
          eib."salesGradeB",
          eib."salesCracked",
          eib."closingGradeA",
          eib."closingGradeB",
          eib."closingCracked",
          eib."closingTotalEggs",
          eib."receiptsTotalEggs"
        FROM egg_inventory_balance eib
        INNER JOIN pens  p ON p.id  = eib."penId"
        INNER JOIN farms f ON f.id  = p."farmId"
        WHERE f."tenantId" = $1
          AND eib."penId"  = $2
          AND eib."balanceDate" >= $3
        ORDER BY eib."balanceDate" ASC
      `, user.tenantId, penIdFilter, from);

      history = histRows.map(r => ({
        date:            r.balanceDate instanceof Date
          ? r.balanceDate.toISOString().slice(0, 10)
          : String(r.balanceDate).slice(0, 10),
        openingTotal:    Number(r.openingGradeA) + Number(r.openingGradeB) + Number(r.openingCracked),
        receipts:        Number(r.receiptsTotalEggs || 0),
        sales:           Number(r.salesGradeA) + Number(r.salesGradeB) + Number(r.salesCracked),
        closingGradeA:   Number(r.closingGradeA),
        closingGradeB:   Number(r.closingGradeB),
        closingCracked:  Number(r.closingCracked),
        closingTotal:    Number(r.closingTotalEggs || 0),
      }));
    }

    return NextResponse.json({ balances, history });

  } catch (err) {
    console.error('[GET /api/egg-store/inventory] error:', err);
    return NextResponse.json({ error: 'Failed to load egg inventory' }, { status: 500 });
  }
}
