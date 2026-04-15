// lib/utils/feedRequisitionCalc.js
// Feed requisition calculation utility — PoultryFarm Pro
//
// PRIMARY formula (bag-count method — matches operational Excel model):
//   bagsRequired = emptyBagsToday + 1 - fullBagsRemainingInSection
//   where:
//     emptyBagsToday          = sum(bagsUsed) across all sessions today for this section
//     fullBagsRemainingInSection = Math.floor(lastSessionRemainingKg / bagWeightKg)
//     +1                      = the new bag being opened today still needs a replacement
//
//   calculatedQtyKg = bagsRequired × bagWeightKg + (lastSessionRemainingKg % bagWeightKg)
//
// FALLBACK formula (7-day kg average — used when no bagsUsed data exists):
//   dailyAvgKg × (1 + bufferPct/100)
//   Used for: new flocks on day 1, legacy records without bagsUsed, no history at all.
//
// Called from:
//   1. upsertDraftRequisition() in app/api/feed/consumption/route.js
//   2. POST /api/feed/requisitions (manual PM creation)

/**
 * Calculate the bag-count-based recommended feed quantity for one section.
 *
 * @param {object}  params
 * @param {Array}   params.todayLogs         — FeedConsumption rows for TODAY only for this section+feedInventory
 *                                             each: { bagsUsed: Int|null, remainingKg: Decimal|null,
 *                                                     bagWeightKg: Decimal|null, quantityKg: Decimal,
 *                                                     recordedDate: Date, feedTime: Date }
 * @param {Array}   params.recentLogs        — FeedConsumption rows for past 7 days (fallback only)
 *                                             each: { quantityKg: Decimal, recordedDate: Date }
 * @param {number}  params.currentBirdCount  — flock.currentCount
 * @param {number}  params.bagWeightKg       — kg per full bag (from feedInventory.bagWeightKg)
 * @param {number}  params.bufferPct         — safety buffer for fallback formula only (default 5%)
 *
 * @returns {object}
 *   bagsRequired           — whole bags to requisition (primary formula result)
 *   remainderKg            — partial-bag kg remaining in section (rolls into next day)
 *   calculatedQtyKg        — total kg represented by bagsRequired + remainderKg
 *   avgConsumptionPerBirdG — grams per bird per day (for display/logging)
 *   calculationDays        — days of history used (0 = fallback, >0 = formula or 7d avg)
 *   formulaUsed            — 'BAG_COUNT' | 'SEVEN_DAY_AVG' | 'DEFAULT'
 *   basis                  — human-readable explanation string
 */
export function calculateSectionRequisition({
  todayLogs        = [],
  recentLogs       = [],
  currentBirdCount = 0,
  bagWeightKg      = 25,
  bufferPct        = 5,
}) {
  const bw = Number(bagWeightKg) || 25;

  // Guard — no birds
  if (!currentBirdCount || currentBirdCount <= 0) {
    return {
      bagsRequired:           0,
      remainderKg:            0,
      calculatedQtyKg:        0,
      avgConsumptionPerBirdG: null,
      calculationDays:        0,
      formulaUsed:            'DEFAULT',
      basis:                  'No active birds in this section.',
    };
  }

  // ── PRIMARY: bag-count formula ──────────────────────────────────────────────
  // Requires at least one today log with bagsUsed populated (bag-based modal path)
  const bagBasedLogs = todayLogs.filter(l => l.bagsUsed != null);

  if (bagBasedLogs.length > 0) {
    // Sort by feedTime/recordedDate to identify the last session
    const sorted = [...bagBasedLogs].sort((a, b) => {
      const ta = a.feedTime ? new Date(a.feedTime) : new Date(a.recordedDate);
      const tb = b.feedTime ? new Date(b.feedTime) : new Date(b.recordedDate);
      return tb - ta; // newest first
    });

    // Total empty bags across all sessions today
    const emptyBagsToday = bagBasedLogs.reduce((s, l) => s + (Number(l.bagsUsed) || 0), 0);

    // Remaining kg from the LAST session logged (evening distribution = closing stock)
    const lastSession    = sorted[0];
    const lastRemKg      = Number(lastSession.remainingKg ?? 0);

    // Full bags remaining in the section = how many complete bags in that remainder
    const fullBagsRemaining = Math.floor(lastRemKg / bw);

    // Core formula
    const bagsRequired  = Math.max(0, emptyBagsToday + 1 - fullBagsRemaining);

    // The partial kg that stays in the section (< 1 bag worth)
    const remainderKg   = parseFloat((lastRemKg % bw).toFixed(2));

    // Total kg the requisition covers
    const calculatedQtyKg = parseFloat((bagsRequired * bw + remainderKg).toFixed(2));

    // g/bird/day from today's total consumption
    const todayTotalKg  = todayLogs.reduce((s, l) => s + Number(l.quantityKg || 0), 0);
    const avgConsumptionPerBirdG = currentBirdCount > 0
      ? parseFloat((todayTotalKg * 1000 / currentBirdCount).toFixed(2))
      : null;

    return {
      bagsRequired,
      remainderKg,
      calculatedQtyKg,
      avgConsumptionPerBirdG,
      calculationDays:  1,   // based on today's actual data
      formulaUsed:      'BAG_COUNT',
      basis: `Today: ${emptyBagsToday} empty bag${emptyBagsToday !== 1 ? 's' : ''} + 1 − ${fullBagsRemaining} full bag${fullBagsRemaining !== 1 ? 's' : ''} remaining = ${bagsRequired} bag${bagsRequired !== 1 ? 's' : ''} required. Partial remainder: ${remainderKg} kg stays in section.`,
    };
  }

  // ── FALLBACK: 7-day kg average ──────────────────────────────────────────────
  // Used when: new flock day 1, or legacy consumption records without bagsUsed
  if (recentLogs.length > 0) {
    const dailyTotals = {};
    recentLogs.forEach(log => {
      const dk = new Date(log.recordedDate).toISOString().slice(0, 10);
      dailyTotals[dk] = (dailyTotals[dk] || 0) + Number(log.quantityKg || 0);
    });

    const days       = Object.keys(dailyTotals).length;
    const totalKg    = Object.values(dailyTotals).reduce((s, v) => s + v, 0);
    const dailyAvgKg = days > 0 ? totalKg / days : 0;
    const withBuf    = parseFloat((dailyAvgKg * (1 + bufferPct / 100)).toFixed(2));

    // Express in bags for consistency
    const bagsRequired  = Math.ceil(withBuf / bw);
    const remainderKg   = parseFloat((withBuf % bw).toFixed(2));

    const avgConsumptionPerBirdG = currentBirdCount > 0
      ? parseFloat((dailyAvgKg * 1000 / currentBirdCount).toFixed(2))
      : null;

    return {
      bagsRequired,
      remainderKg,
      calculatedQtyKg:        withBuf,
      avgConsumptionPerBirdG,
      calculationDays:        days,
      formulaUsed:            'SEVEN_DAY_AVG',
      basis: `No bag-count data yet. Based on ${days}d avg: ${dailyAvgKg.toFixed(1)} kg/day × ${1 + bufferPct / 100} buffer = ${withBuf} kg (${bagsRequired} bags).`,
    };
  }

  // ── DEFAULT: no history at all (new flock, first day) ─────────────────────
  // Layer hens: ~115 g/bird/day; use as safe starting point.
  const defaultGpb    = 115;
  const rawKg         = parseFloat(((currentBirdCount * defaultGpb) / 1000).toFixed(2));
  const withBuf       = parseFloat((rawKg * (1 + bufferPct / 100)).toFixed(2));
  const bagsRequired  = Math.ceil(withBuf / bw);
  const remainderKg   = parseFloat((withBuf % bw).toFixed(2));

  return {
    bagsRequired,
    remainderKg,
    calculatedQtyKg:        withBuf,
    avgConsumptionPerBirdG: defaultGpb,
    calculationDays:        0,
    formulaUsed:            'DEFAULT',
    basis: `No history. Estimated from default ${defaultGpb} g/bird/day × ${currentBirdCount.toLocaleString('en-NG')} birds + ${bufferPct}% buffer = ${withBuf} kg (${bagsRequired} bags).`,
  };
}

/**
 * Generate the next requisition number for a tenant.
 * Format: REQ-YYYY-NNNNN (zero-padded to 5 digits, resets each year)
 */
export async function nextRequisitionNumber(prisma, tenantId) {
  const year   = new Date().getFullYear();
  const prefix = `REQ-${year}-`;

  const last = await prisma.feedRequisition.findFirst({
    where:   { tenantId, requisitionNumber: { startsWith: prefix } },
    orderBy: { requisitionNumber: 'desc' },
    select:  { requisitionNumber: true },
  });

  let seq = 1;
  if (last) {
    const parts  = last.requisitionNumber.split('-');
    const lastSeq = parseInt(parts[2] || '0', 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(5, '0')}`;
}

/**
 * Compute deviation percentage between requested and calculated quantities.
 * Positive = PM requested more; negative = PM requested less.
 */
export function calcDeviationPct(requestedQtyKg, calculatedQtyKg) {
  if (!calculatedQtyKg || calculatedQtyKg === 0) return 0;
  return parseFloat(
    (((requestedQtyKg - calculatedQtyKg) / calculatedQtyKg) * 100).toFixed(2)
  );
}

/**
 * Severity of a deviation — UI colour coding and IC warning logic.
 */
export function deviationSeverity(deviationPct) {
  const abs = Math.abs(deviationPct);
  if (abs <= 10) return 'ok';
  if (abs <= 20) return 'warn';
  return 'high';
}

// ── Legacy export name — kept so existing callers don't break ────────────────
// The manual POST /api/feed/requisitions still uses calculateRequisitionQty.
// It only has recentLogs (no todayLogs), so it always hits the 7-day fallback.
export function calculateRequisitionQty({ recentLogs = [], currentBirdCount = 0, bufferPct = 5 }) {
  return calculateSectionRequisition({
    todayLogs:       [],
    recentLogs,
    currentBirdCount,
    bagWeightKg:     25, // default — manual callers don't have bagWeightKg
    bufferPct,
  });
}
