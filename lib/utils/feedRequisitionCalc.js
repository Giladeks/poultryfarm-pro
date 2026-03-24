// lib/utils/feedRequisitionCalc.js
// Pure calculation utility for feed requisition drafts.
//
// Given a section's recent consumption history and current flock state,
// returns the recommended quantity for the next day plus the calculation basis
// so it can be displayed to the PM and stored on the requisition record.
//
// Called from two places:
//   1. feed/consumption POST hook — after worker saves a feed log
//   2. GET /api/feed/requisitions/calculate — so PM can see the basis before confirming

/**
 * Calculate recommended feed quantity for the next day.
 *
 * @param {object} params
 * @param {Array}  params.recentLogs        — FeedConsumption rows, last N days, newest first
 *                                            each: { quantityKg: Decimal, recordedDate: Date, penSectionId }
 * @param {number} params.currentBirdCount  — flock.currentCount
 * @param {number} params.bufferPct         — safety buffer (default 5%)
 * @param {number} params.lookbackDays      — how many days of history to use (default 7)
 *
 * @returns {object}
 *   calculatedQtyKg        — recommended quantity in kg (rounded to 1 decimal)
 *   avgConsumptionPerBirdG — average grams per bird per day over the lookback window
 *   currentBirdCount
 *   calculationDays        — actual days of data used (may be < lookbackDays if new flock)
 *   dailyAvgKg             — average total kg per day across the section
 *   bufferPct
 *   basis                  — human-readable explanation string
 */
export function calculateRequisitionQty({
  recentLogs        = [],
  currentBirdCount  = 0,
  bufferPct         = 5,
  lookbackDays      = 7,
}) {
  // Guard — no birds or no history
  if (!currentBirdCount || currentBirdCount <= 0) {
    return {
      calculatedQtyKg:        0,
      avgConsumptionPerBirdG: null,
      currentBirdCount:       0,
      calculationDays:        0,
      dailyAvgKg:             0,
      bufferPct,
      basis: 'No active birds in this section.',
    };
  }

  if (recentLogs.length === 0) {
    // No history — fall back to a species-appropriate default:
    // Layer hens: ~115 g/bird/day; Broilers (age-dependent): use 100 g as safe default
    const defaultGramsPerBird = 115;
    const rawKg  = (currentBirdCount * defaultGramsPerBird) / 1000;
    const withBuf = parseFloat((rawKg * (1 + bufferPct / 100)).toFixed(1));
    return {
      calculatedQtyKg:        withBuf,
      avgConsumptionPerBirdG: defaultGramsPerBird,
      currentBirdCount,
      calculationDays:        0,
      dailyAvgKg:             rawKg,
      bufferPct,
      basis: `No consumption history found. Using default of ${defaultGramsPerBird} g/bird/day for ${currentBirdCount.toLocaleString('en-NG')} birds + ${bufferPct}% buffer.`,
    };
  }

  // ── Aggregate daily totals ────────────────────────────────────────────────
  // Multiple logs may exist per day (morning + afternoon sessions).
  // Group by date string and sum quantities within each day.
  const dailyTotals = {};
  recentLogs.forEach(log => {
    const dateKey = new Date(log.recordedDate).toISOString().slice(0, 10);
    dailyTotals[dateKey] = (dailyTotals[dateKey] || 0) + Number(log.quantityKg);
  });

  const days       = Object.keys(dailyTotals).length;
  const totalKg    = Object.values(dailyTotals).reduce((s, v) => s + v, 0);
  const dailyAvgKg = days > 0 ? totalKg / days : 0;

  // ── Grams per bird per day ────────────────────────────────────────────────
  const avgConsumptionPerBirdG = currentBirdCount > 0
    ? parseFloat(((dailyAvgKg * 1000) / currentBirdCount).toFixed(2))
    : null;

  // ── Apply buffer ──────────────────────────────────────────────────────────
  const rawCalc         = dailyAvgKg;
  const calculatedQtyKg = parseFloat((rawCalc * (1 + bufferPct / 100)).toFixed(1));

  const basis = `Based on ${days} day${days !== 1 ? 's' : ''} of history: `
    + `avg ${dailyAvgKg.toFixed(1)} kg/day `
    + `(${avgConsumptionPerBirdG?.toFixed(1) ?? '—'} g/bird) `
    + `× ${1 + bufferPct / 100} buffer `
    + `= ${calculatedQtyKg} kg recommended.`;

  return {
    calculatedQtyKg,
    avgConsumptionPerBirdG,
    currentBirdCount,
    calculationDays: days,
    dailyAvgKg:      parseFloat(dailyAvgKg.toFixed(2)),
    bufferPct,
    basis,
  };
}

/**
 * Generate the next requisition number for a tenant.
 * Format: REQ-YYYY-NNNNN (zero-padded to 5 digits, resets each year)
 *
 * @param {object} prisma        — Prisma client
 * @param {string} tenantId
 * @returns {Promise<string>}    — e.g. "REQ-2026-00042"
 */
export async function nextRequisitionNumber(prisma, tenantId) {
  const year   = new Date().getFullYear();
  const prefix = `REQ-${year}-`;

  // Find the highest number issued this year for this tenant
  const last = await prisma.feedRequisition.findFirst({
    where: {
      tenantId,
      requisitionNumber: { startsWith: prefix },
    },
    orderBy: { requisitionNumber: 'desc' },
    select: { requisitionNumber: true },
  });

  let seq = 1;
  if (last) {
    const parts = last.requisitionNumber.split('-');
    const lastSeq = parseInt(parts[2] || '0', 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(5, '0')}`;
}

/**
 * Compute deviation percentage between requested and calculated quantities.
 * Positive = PM requested more than calculated; negative = less.
 *
 * @param {number} requestedQtyKg
 * @param {number} calculatedQtyKg
 * @returns {number}  deviation as a percentage, e.g. 12.5 or -8.3
 */
export function calcDeviationPct(requestedQtyKg, calculatedQtyKg) {
  if (!calculatedQtyKg || calculatedQtyKg === 0) return 0;
  return parseFloat(
    (((requestedQtyKg - calculatedQtyKg) / calculatedQtyKg) * 100).toFixed(2)
  );
}

/**
 * Severity of a deviation — used for UI colour coding and IC warning logic.
 * @param {number} deviationPct
 * @returns {'ok' | 'warn' | 'high'}
 */
export function deviationSeverity(deviationPct) {
  const abs = Math.abs(deviationPct);
  if (abs <= 10) return 'ok';
  if (abs <= 20) return 'warn';
  return 'high';
}
