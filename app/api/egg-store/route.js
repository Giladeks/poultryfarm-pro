// app/api/egg-store/route.js
// GET /api/egg-store?days=1&status=PENDING&penId=xxx
//
// Returns egg store receipts grouped by pen + collectionDate + collectionSession
// for the dedicated /egg-store page card view.
//
// Roles:
//   STORE_MANAGER, STORE_CLERK        — primary actors (acknowledge / dispute)
//   INTERNAL_CONTROL, FARM_MANAGER,
//   FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN — read + dispute resolution
//
// Response shape:
//   { groups: PenSessionGroup[], summary: { pending, disputed, acknowledged, total } }
//
//   PenSessionGroup {
//     penId, penName,
//     collectionDate, collectionSession, sessionLabel,
//     totalEggs, gradeACount, gradeBCount, crackedCount,
//     gradeACrates, gradeBCrates,
//     records: EggStoreReceiptRow[]  ← one per section
//   }
//
//   EggStoreReceiptRow {
//     id, status,
//     penSectionId, sectionName,
//     flockId, batchCode,
//     gradedGradeACrates, gradedGradeALoose, gradedGradeACount,
//     gradedGradeBCrates, gradedGradeBLoose, gradedGradeBCount,
//     gradedCrackedCount, gradedTotalEggs,
//     deliveredBy: { id, firstName, lastName } | null,
//     acknowledgedBy: { id, firstName, lastName } | null,
//     acknowledgedAt,
//     disputeNotes, disputedAt,
//     disputedBy: { id, firstName, lastName } | null,
//     resolvedAt, resolutionAction, resolutionNotes,
//     resolvedBy: { id, firstName, lastName } | null,
//     inventoryUpdated, createdAt
//   }
//
// CRITICAL: egg_store_receipts is a snake_case table — ALWAYS use $queryRawUnsafe
//           Never use prisma.egg_store_receipts accessor directly

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const VIEW_ROLES = [
  'STORE_MANAGER', 'STORE_CLERK',
  'INTERNAL_CONTROL', 'FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN',
];

// Build from-date using Date.UTC — server runs WAT (UTC+1), avoid shift bugs
function buildFrom(days) {
  const now = new Date();
  return new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - (days - 1),
  ));
}

export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!VIEW_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const days      = Math.min(parseInt(searchParams.get('days')   || '7'),  90);
  const statusFilter = searchParams.get('status') || 'ALL'; // ALL | PENDING | DISPUTED | ACKNOWLEDGED
  const penIdFilter  = searchParams.get('penId')  || null;

  const from = buildFrom(days);

  try {
    // ── 1. Fetch receipts via raw SQL (snake_case table rule) ─────────────────
    // Join to users table for deliveredBy, acknowledgedBy, disputedBy, resolvedBy
    // Scope by tenantId through pen → farm → tenant chain
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        esr.id,
        esr."tenantId",
        esr."eggProductionId",
        esr."penSectionId",
        esr."penId",
        esr."collectionDate",
        esr."collectionSession",
        esr."flockId",
        esr."batchCode",
        esr."gradedGradeACrates",
        esr."gradedGradeALoose",
        esr."gradedGradeACount",
        esr."gradedGradeBCrates",
        esr."gradedGradeBLoose",
        esr."gradedGradeBCount",
        esr."gradedCrackedCount",
        esr."gradedTotalEggs",
        esr."status",
        esr."acknowledgedAt",
        esr."disputeNotes",
        esr."disputedAt",
        esr."resolvedAt",
        esr."resolutionAction",
        esr."resolutionNotes",
        esr."inventoryUpdated",
        esr."createdAt",
        -- Pen name
        p.name                         AS "penName",
        -- Section name
        ps.name                        AS "sectionName",
        -- deliveredBy
        du.id                          AS "deliveredById",
        du."firstName"                 AS "deliveredByFirst",
        du."lastName"                  AS "deliveredByLast",
        -- acknowledgedBy
        au.id                          AS "acknowledgedById",
        au."firstName"                 AS "acknowledgedByFirst",
        au."lastName"                  AS "acknowledgedByLast",
        -- disputedBy
        dpu.id                         AS "disputedById",
        dpu."firstName"                AS "disputedByFirst",
        dpu."lastName"                 AS "disputedByLast",
        -- resolvedBy
        ru.id                          AS "resolvedById",
        ru."firstName"                 AS "resolvedByFirst",
        ru."lastName"                  AS "resolvedByLast"
      FROM egg_store_receipts esr
      INNER JOIN pens         p   ON p.id   = esr."penId"
      INNER JOIN farms        f   ON f.id   = p."farmId"
      INNER JOIN pen_sections ps  ON ps.id  = esr."penSectionId"
      LEFT  JOIN users        du  ON du.id  = esr."deliveredById"
      LEFT  JOIN users        au  ON au.id  = esr."acknowledgedById"
      LEFT  JOIN users        dpu ON dpu.id = esr."disputedById"
      LEFT  JOIN users        ru  ON ru.id  = esr."resolvedById"
      WHERE f."tenantId"          = $1
        AND esr."collectionDate" >= $2
        ${statusFilter !== 'ALL' ? `AND esr."status" = $3` : ''}
        ${penIdFilter ? `AND esr."penId" = ${statusFilter !== 'ALL' ? '$4' : '$3'}` : ''}
      ORDER BY
        esr."collectionDate" DESC,
        esr."collectionSession" ASC,
        p.name ASC,
        ps.name ASC
    `,
      ...[
        user.tenantId,
        from,
        ...(statusFilter !== 'ALL' ? [statusFilter] : []),
        ...(penIdFilter  ? [penIdFilter]  : []),
      ]
    );

    // ── 2. Shape raw rows into receipt objects ────────────────────────────────
    const receipts = rows.map(r => ({
      id:                   r.id,
      eggProductionId:      r.eggProductionId,
      penSectionId:         r.penSectionId,
      sectionName:          r.sectionName,
      penId:                r.penId,
      penName:              r.penName,
      collectionDate:       r.collectionDate,
      collectionSession:    Number(r.collectionSession),
      sessionLabel:         Number(r.collectionSession) === 1 ? 'Morning' : 'Afternoon',
      flockId:              r.flockId,
      batchCode:            r.batchCode,
      gradedGradeACrates:   Number(r.gradedGradeACrates),
      gradedGradeALoose:    Number(r.gradedGradeALoose),
      gradedGradeACount:    Number(r.gradedGradeACount),
      gradedGradeBCrates:   Number(r.gradedGradeBCrates),
      gradedGradeBLoose:    Number(r.gradedGradeBLoose),
      gradedGradeBCount:    Number(r.gradedGradeBCount),
      gradedCrackedCount:   Number(r.gradedCrackedCount),
      gradedTotalEggs:      Number(r.gradedTotalEggs),
      status:               r.status,
      acknowledgedAt:       r.acknowledgedAt,
      disputeNotes:         r.disputeNotes,
      disputedAt:           r.disputedAt,
      resolvedAt:           r.resolvedAt,
      resolutionAction:     r.resolutionAction,
      resolutionNotes:      r.resolutionNotes,
      inventoryUpdated:     r.inventoryUpdated,
      createdAt:            r.createdAt,
      deliveredBy: r.deliveredById ? {
        id: r.deliveredById, firstName: r.deliveredByFirst, lastName: r.deliveredByLast,
      } : null,
      acknowledgedBy: r.acknowledgedById ? {
        id: r.acknowledgedById, firstName: r.acknowledgedByFirst, lastName: r.acknowledgedByLast,
      } : null,
      disputedBy: r.disputedById ? {
        id: r.disputedById, firstName: r.disputedByFirst, lastName: r.disputedByLast,
      } : null,
      resolvedBy: r.resolvedById ? {
        id: r.resolvedById, firstName: r.resolvedByFirst, lastName: r.resolvedByLast,
      } : null,
    }));

    // ── 3. Group by pen + collectionDate + collectionSession ──────────────────
    const groupMap = new Map();
    receipts.forEach(r => {
      const dateKey = r.collectionDate instanceof Date
        ? r.collectionDate.toISOString().slice(0, 10)
        : String(r.collectionDate).slice(0, 10);
      const key = `${r.penId}|${dateKey}|${r.collectionSession}`;

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          penId:             r.penId,
          penName:           r.penName,
          collectionDate:    dateKey,
          collectionSession: r.collectionSession,
          sessionLabel:      r.sessionLabel,
          // Aggregate totals — summed across sections below
          totalEggs:         0,
          gradeACount:       0,
          gradeBCount:       0,
          crackedCount:      0,
          gradeACrates:      0,
          gradeBCrates:      0,
          // Status roll-up: group is PENDING if any record is PENDING,
          // DISPUTED if any is DISPUTED, ACKNOWLEDGED only if all are ACKNOWLEDGED
          hasAnyPending:     false,
          hasAnyDisputed:    false,
          allAcknowledged:   true,
          records:           [],
        });
      }

      const g = groupMap.get(key);
      g.totalEggs   += r.gradedTotalEggs;
      g.gradeACount += r.gradedGradeACount;
      g.gradeBCount += r.gradedGradeBCount;
      g.crackedCount += r.gradedCrackedCount;
      g.gradeACrates += r.gradedGradeACrates;
      g.gradeBCrates += r.gradedGradeBCrates;

      if (r.status === 'PENDING')      g.hasAnyPending  = true;
      if (r.status === 'DISPUTED')     g.hasAnyDisputed = true;
      if (r.status !== 'ACKNOWLEDGED' && r.status !== 'FORCE_ACCEPTED') {
        g.allAcknowledged = false;
      }

      g.records.push(r);
    });

    // Convert map to array and compute group-level status
    const groups = [...groupMap.values()].map(g => {
      const groupStatus = g.hasAnyDisputed
        ? 'DISPUTED'
        : g.hasAnyPending
          ? 'PENDING'
          : g.allAcknowledged
            ? 'ACKNOWLEDGED'
            : 'PARTIAL';

      // Compute loose egg totals for display
      const gradeALoose = g.records.reduce((s, r) => s + r.gradedGradeALoose, 0);
      const gradeBLoose = g.records.reduce((s, r) => s + r.gradedGradeBLoose, 0);

      return {
        penId:             g.penId,
        penName:           g.penName,
        collectionDate:    g.collectionDate,
        collectionSession: g.collectionSession,
        sessionLabel:      g.sessionLabel,
        groupStatus,
        totalEggs:         g.totalEggs,
        gradeACount:       g.gradeACount,
        gradeACrates:      g.gradeACrates,
        gradeALoose,
        gradeBCount:       g.gradeBCount,
        gradeBCrates:      g.gradeBCrates,
        gradeBLoose,
        crackedCount:      g.crackedCount,
        records:           g.records,
      };
    });

    // ── 4. Summary counts ─────────────────────────────────────────────────────
    const allRecords = receipts;
    const summary = {
      total:        allRecords.length,
      pending:      allRecords.filter(r => r.status === 'PENDING').length,
      disputed:     allRecords.filter(r => r.status === 'DISPUTED').length,
      acknowledged: allRecords.filter(r =>
        r.status === 'ACKNOWLEDGED' || r.status === 'FORCE_ACCEPTED').length,
      recountRequested: allRecords.filter(r => r.status === 'RECOUNT_REQUESTED').length,
    };

    return NextResponse.json({ groups, summary });

  } catch (err) {
    console.error('[GET /api/egg-store] error:', err);
    return NextResponse.json({ error: 'Failed to load egg store receipts' }, { status: 500 });
  }
}
