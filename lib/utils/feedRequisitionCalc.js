// lib/utils/feedRequisitionCalc.js
// Feed requisition calculation utility — PoultryFarm Pro
//
// PRIMARY formula (projection-based — forward-looking):
//   Answers: "given what's already in the section, how many whole bags do we
//   need to add to cover tomorrow's projected consumption?"
//
//   Step 1 — Determine consumption basis:
//     sevenDayAvgKg = average daily kg over last 7 days (excluding today)
//     todayActualKg = total kg consumed today across all sessions
//     deviation     = (todayActual - sevenDayAvg) / sevenDayAvg
//     basis = todayActualKg  if deviation > +15%  (override up: flock needs more)
//     basis = sevenDayAvgKg  otherwise             (stable / deviation down: use average)
//
//   Step 2 — Project tomorrow's need with buffer:
//     projectedNeedKg = basis × (1 + bufferPct/100)
//
//   Step 3 — Subtract carry-over already in section:
//     carryOverKg  = openingStockKg - todayActualKg  (tracked from prior acknowledgement)
//     shortfallKg  = max(0, projectedNeedKg - carryOverKg)
//
//   Step 4 — Round up to whole bags:
//     bagsRequired    = ceil(shortfallKg / bagWeightKg)
//     calculatedQtyKg = bagsRequired × bagWeightKg
//
// WHY ceil NOT floor: sections must never run short. One extra bag occasionally
// is far less harmful than birds going without feed.
//
// FALLBACK (no today logs or no recent history): 7-day average → default g/bird estimate.
//
// Called from:
//   1. upsertDraftRequisition() in app/api/feed/consumption/route.js
//   2. POST /api/feed/requisitions (manual PM creation)

/**
 * Calculate the projected feed bag requirement for one section.
 *
 * @param {object}  params
 * @param {Array}   params.todayLogs         — FeedConsumption rows for TODAY only
 *                                             each: { bagsUsed, remainingKg, bagWeightKg,
 *                                                     quantityKg, recordedDate, feedTime }
 * @param {Array}   params.recentLogs        — FeedConsumption rows for past 7 days (excl. today)
 *                                             each: { quantityKg, recordedDate }
 * @param {number}  params.currentBirdCount  — flock.currentCount
 * @param {number}  params.bagWeightKg       — kg per full bag
 * @param {number}  params.bufferPct         — safety buffer % (default 5)
 * @param {number|null} params.openingStockKg — kg in section at start of day;
 *                                             null = bootstrap fallback (use worker remainingKg)
 *
 * @returns {object}
 *   bagsRequired           — whole bags to requisition (always ceil — never short-change)
 *   remainderKg            — sub-bag carry-over in section (informational, not requisitioned)
 *   carryOverKg            — total carry-over kg (= openingStock - consumed; rolls to tomorrow)
 *   calculatedQtyKg        — kg the store must issue (bagsRequired × bagWeightKg)
 *   avgConsumptionPerBirdG — grams per bird today (for display / dashboards)
 *   calculationDays        — days of history used (0 = default estimate)
 *   formulaUsed            — 'PROJECTION' | 'PROJECTION_OVERRIDE' | 'SEVEN_DAY_AVG' | 'DEFAULT'
 *   basis                  — human-readable explanation for the PM's review
 */
export function calculateSectionRequisition({
  todayLogs        = [],
  recentLogs       = [],
  currentBirdCount = 0,
  bagWeightKg      = 25,
  bufferPct        = 5,
  openingStockKg   = null,
}) {
  const bw  = Number(bagWeightKg) || 25;
  const buf = 1 + (Number(bufferPct) || 5) / 100;

  // Guard — no birds
  if (!currentBirdCount || currentBirdCount <= 0) {
    return {
      bagsRequired:           0,
      remainderKg:            0,
      carryOverKg:            0,
      calculatedQtyKg:        0,
      avgConsumptionPerBirdG: null,
      calculationDays:        0,
      formulaUsed:            'DEFAULT',
      basis:                  'No active birds in this section.',
    };
  }

  // ── Compute today's total consumption from all sessions ───────────────────
  const totalConsumedKg = todayLogs.reduce((s, l) => s + Number(l.quantityKg || 0), 0);

  const avgConsumptionPerBirdG = totalConsumedKg > 0 && currentBirdCount > 0
    ? parseFloat((totalConsumedKg * 1000 / currentBirdCount).toFixed(2))
    : null;

  // ── Compute 7-day average (excluding today) ───────────────────────────────
  let sevenDayAvgKg = null;
  let calculationDays = 0;
  if (recentLogs.length > 0) {
    const dailyTotals = {};
    recentLogs.forEach(log => {
      const dk = new Date(log.recordedDate).toISOString().slice(0, 10);
      dailyTotals[dk] = (dailyTotals[dk] || 0) + Number(log.quantityKg || 0);
    });
    calculationDays = Object.keys(dailyTotals).length;
    const totalKg   = Object.values(dailyTotals).reduce((s, v) => s + v, 0);
    sevenDayAvgKg   = calculationDays > 0 ? totalKg / calculationDays : null;
  }

  // ── PRIMARY: projection formula (requires today logs OR 7-day history) ────
  if (totalConsumedKg > 0 || sevenDayAvgKg != null) {

    // Step 1 — Consumption basis with override logic
    let basisKg;
    let formulaUsed;
    let overrideNote = '';

    if (totalConsumedKg > 0 && sevenDayAvgKg != null) {
      // Both available — check if today deviates significantly from average
      const deviation = (totalConsumedKg - sevenDayAvgKg) / sevenDayAvgKg;
      if (deviation > 0.15) {
        // Today is >15% above average — override up: use today's actual
        // Protects against underfed sections on high-consumption days
        basisKg    = totalConsumedKg;
        formulaUsed = 'PROJECTION_OVERRIDE';
        overrideNote = ` Today (+${(deviation * 100).toFixed(0)}% above 7d avg of ${sevenDayAvgKg.toFixed(1)} kg) — override applied.`;
      } else {
        // Within normal range or below average — use 7-day avg (smoother, avoids over-ordering)
        basisKg    = sevenDayAvgKg;
        formulaUsed = 'PROJECTION';
        if (deviation < -0.15) {
          overrideNote = ` Today (${(deviation * 100).toFixed(0)}% below avg) — using 7d avg to avoid under-provisioning.`;
        }
      }
    } else if (totalConsumedKg > 0) {
      // No 7-day history (new flock) — use today's actual only
      basisKg    = totalConsumedKg;
      formulaUsed = 'PROJECTION';
    } else {
      // No today logs yet — use 7-day average only (mid-day requisition before first session)
      basisKg    = sevenDayAvgKg;
      formulaUsed = 'SEVEN_DAY_AVG';
    }

    // Step 2 — Apply buffer
    const projectedNeedKg = parseFloat((basisKg * buf).toFixed(2));

    // Step 3 — Subtract carry-over
    // carryOverKg = what's physically left in the section from today's opening stock
    // If openingStockKg is known (from prior acknowledged req), compute precisely.
    // If not (bootstrap day), fall back to worker-entered remainingKg from last session.
    let carryOverKg;
    if (openingStockKg != null && openingStockKg >= 0) {
      carryOverKg = Math.max(0, parseFloat((openingStockKg - totalConsumedKg).toFixed(2)));
    } else if (todayLogs.length > 0) {
      // Bootstrap fallback: use worker's last-session remainingKg
      const sorted    = [...todayLogs]
        .filter(l => l.remainingKg != null)
        .sort((a, b) => {
          const ta = a.feedTime ? new Date(a.feedTime) : new Date(a.recordedDate);
          const tb = b.feedTime ? new Date(b.feedTime) : new Date(b.recordedDate);
          return tb - ta;
        });
      carryOverKg = sorted.length > 0 ? Math.max(0, Number(sorted[0].remainingKg)) : 0;
    } else {
      carryOverKg = 0;
    }

    const shortfallKg = Math.max(0, parseFloat((projectedNeedKg - carryOverKg).toFixed(2)));

    // Step 4 — Ceil to whole bags (never short-change a section)
    const bagsRequired    = Math.ceil(shortfallKg / bw);
    const remainderKg     = parseFloat((carryOverKg % bw).toFixed(2));
    const calculatedQtyKg = parseFloat((bagsRequired * bw).toFixed(2));

    const carryOverNote = openingStockKg != null
      ? `carry-over ${carryOverKg.toFixed(1)} kg`
      : `carry-over est. ${carryOverKg.toFixed(1)} kg (worker entry)`;

    return {
      bagsRequired,
      remainderKg,
      carryOverKg,
      calculatedQtyKg,
      avgConsumptionPerBirdG,
      calculationDays: calculationDays || 1,
      formulaUsed,
      basis: `Projected need: ${projectedNeedKg.toFixed(1)} kg (basis ${basisKg.toFixed(1)} kg × ${buf.toFixed(2)} buffer). ${carryOverNote}. Shortfall: ${shortfallKg.toFixed(1)} kg → ${bagsRequired} bag${bagsRequired !== 1 ? 's' : ''} (${calculatedQtyKg} kg issued).${overrideNote}`,
    };
  }

  // ── DEFAULT: no history at all (new flock, first day, no logs yet) ────────
  // ISA Brown standard: ~115 g/bird/day as safe starting estimate
  const defaultGpb      = 115;
  const rawKg           = parseFloat(((currentBirdCount * defaultGpb) / 1000).toFixed(2));
  const projectedNeedKg = parseFloat((rawKg * buf).toFixed(2));
  const bagsRequired    = Math.ceil(projectedNeedKg / bw);
  const calculatedQtyKg = parseFloat((bagsRequired * bw).toFixed(2));

  return {
    bagsRequired,
    remainderKg:            0,
    carryOverKg:            0,
    calculatedQtyKg,
    avgConsumptionPerBirdG: defaultGpb,
    calculationDays:        0,
    formulaUsed:            'DEFAULT',
    basis: `No history. Estimated from ISA Brown standard ${defaultGpb} g/bird/day × ${currentBirdCount.toLocaleString('en-NG')} birds + ${bufferPct}% buffer = ${projectedNeedKg.toFixed(1)} kg → ${bagsRequired} bag${bagsRequired !== 1 ? 's' : ''}.`,
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
    const parts   = last.requisitionNumber.split('-');
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
export function calculateRequisitionQty({ recentLogs = [], currentBirdCount = 0, bufferPct = 5 }) {
  return calculateSectionRequisition({
    todayLogs:       [],
    recentLogs,
    currentBirdCount,
    bagWeightKg:     25,
    bufferPct,
  });
}
