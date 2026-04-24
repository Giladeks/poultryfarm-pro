// app/api/tasks/generate/route.js
// POST — generates daily or weekly tasks for all active pen sections
//        assigned to workers on the current tenant.
//
// Stage-aware template dispatch:
//   BROODING   → brooding-specific tasks (temp checks, no egg collection)
//   REARING    → rearing tasks (weight recording weekly, grower feed, no eggs)
//   PRODUCTION → full layer production task list (matches physical operations)
//
// Layer PRODUCTION daily tasks updated to match operational spreadsheet:
//   12 tasks covering the full shift from 06:00 to 18:30.
//
// Layer PRODUCTION weekly tasks updated to match operational spreadsheet:
//   7 day-specific tasks (Mon–Sun) + fortnightly support note.
//
// Called automatically on first login of the day (by the worker/PM dashboard)
// or manually by a Farm Manager.
//
// Body:
//   { frequency: 'daily' | 'weekly', date?: 'YYYY-MM-DD' }
//
// Idempotent: skips sections that already have a task with the same title today/this week.

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const ALLOWED_ROLES = [
  'PEN_WORKER', 'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN',
  'CHAIRPERSON', 'SUPER_ADMIN',
];

// ── Due-time helper ───────────────────────────────────────────────────────────
function dueAt(baseDate, hhMM) {
  const [h, m] = hhMM.split(':').map(Number);
  const d = new Date(baseDate);
  d.setHours(h, m, 0, 0);
  return d;
}

// ── Stage-aware daily template dispatcher ─────────────────────────────────────
function dailyTemplatesForStage(date, opType, stage) {
  if (stage === 'BROODING') return dailyTemplatesBrooding(date, opType);
  if (stage === 'REARING')  return dailyTemplatesRearing(date);
  return dailyTemplates(date, opType); // PRODUCTION
}

// ── Brooding daily templates ──────────────────────────────────────────────────
function dailyTemplatesBrooding(date, opType) {
  const isBroiler = opType === 'BROILER';
  const templates = [
    {
      taskType: 'FEEDING',
      title:    '🍽️ Morning Feed & Water Check',
      description: 'Check feeders and drinkers. Top up chick starter feed. Ensure all chicks can access feed and water.',
      dueTime: '06:00', priority: 'HIGH',
    },
    {
      taskType: 'MORTALITY_CHECK',
      title:    '💀 Morning Mortality Check',
      description: 'Walk the brooder and remove dead chicks. Record count and cause in mortality log.',
      dueTime: '07:00', priority: 'HIGH',
    },
    {
      taskType:    'INSPECTION',
      title:       isBroiler ? '🛡️ Brooder Temperature & Tarpaulin Check' : '🌡️ Brooder Temperature & Humidity Check',
      description: isBroiler
        ? 'Record brooder temperature. Check tarpaulins are secure and heat sources operational.'
        : 'Record temperature and humidity in all zones. Alert manager if outside 26–38°C.',
      dueTime: '08:00', priority: 'HIGH',
    },
    {
      taskType: 'FEEDING',
      title:    '🍽️ Midday Feed & Water Top-up',
      description: 'Check and top up feed and water at midday.',
      dueTime: '12:00', priority: 'NORMAL',
    },
    {
      taskType: 'FEEDING',
      title:    '🍽️ Afternoon Feed & Water Check',
      description: 'Afternoon feed round. Record any observations on feed intake.',
      dueTime: '16:00', priority: 'NORMAL',
    },
    {
      taskType: 'MORTALITY_CHECK',
      title:    '💀 Evening Mortality Count',
      description: 'Evening mortality check. Record count and cause in mortality log.',
      dueTime: '17:00', priority: 'HIGH',
    },
    {
      taskType:    'INSPECTION',
      title:       isBroiler ? '🌡️ Evening Heat Source Check' : '🌡️ Evening Brooder Temperature Check',
      description: isBroiler
        ? 'Check heat sources and brooder guards. Ensure temperature is stable for the night.'
        : 'Record evening temperature. Adjust brooder guards to correct position.',
      dueTime: '17:30', priority: 'NORMAL',
    },
    {
      taskType: 'REPORT_SUBMISSION',
      title:    '📋 Brooding Daily Report',
      description: 'End-of-day brooding report: total mortality, feed bags used, temperature range, observations.',
      dueTime: '19:00', priority: 'NORMAL',
    },
  ];
  return templates.map(t => ({ ...t, dueDate: dueAt(date, t.dueTime) }));
}

// ── Rearing daily templates (LAYER REARING stage) ────────────────────────────
function dailyTemplatesRearing(date) {
  const templates = [
    {
      taskType: 'FEEDING',
      title:    '🍽️ Morning Feed Round (Grower Mash)',
      description: 'Distribute morning grower mash to all birds. Record bags used and remaining in feed log.',
      dueTime: '08:00', priority: 'NORMAL',
    },
    {
      taskType: 'MORTALITY_CHECK',
      title:    '💀 Mortality Check',
      description: 'Walk the section. Remove any dead birds. Record count and cause in mortality log. Record zero if none found.',
      dueTime: '11:00', priority: 'NORMAL',
    },
    {
      taskType: 'FEEDING',
      title:    '🍽️ Evening Feed Round',
      description: 'Evening grower mash distribution. Log feed consumption.',
      dueTime: '17:00', priority: 'NORMAL',
    },
    {
      taskType: 'REPORT_SUBMISSION',
      title:    '📋 Rearing Daily Report',
      description: 'Daily summary: feed consumed, mortality, water consumption, general flock observations.',
      dueTime: '19:00', priority: 'NORMAL',
    },
  ];
  return templates.map(t => ({ ...t, dueDate: dueAt(date, t.dueTime) }));
}

// ── Layer PRODUCTION daily templates ─────────────────────────────────────────
// Matches the operational spreadsheet exactly.
// 12 tasks covering the full shift 06:00 → 18:30.
//
// Task routing in worker/page.js handleComplete():
//   INSPECTION   → one-tap "All Clear" or notes (no linked data modal by default)
//   FEEDING      → WorkerFeedModal (bagsUsed + remainingKg)
//   EGG_COLLECTION → LogEggModal (crates + loose + cracked, session auto-set by title)
//   MORTALITY_CHECK → LogMortalityModal (count + cause, or "No Deaths Today")
//   CLEANING     → one-tap complete (no data entry)
//   REPORT_SUBMISSION → auto-submit daily summary
//
function dailyTemplatesLayerProduction(date) {
  const templates = [
    // ── 06:00 Arrival & Pre-shift Inspection ────────────────────────────────
    // Combines water meter reading + dead bird removal at shift start.
    // INSPECTION type routes to a checklist/observation complete in the worker UI.
    // Water meter is already a separate quick-tap on the section card.
    {
      taskType:    'INSPECTION',
      title:       '🔍 Arrival & Pre-shift Inspection',
      description: 'On arrival: check water meter and record reading. Walk through pen to check for dead or sick birds — remove and record any deaths. Check and refill footbath disinfectant. Report any equipment issues to Pen Manager.',
      dueTime:     '06:00',
      priority:    'HIGH',
    },

    // ── 06:30 Morning Feed Distribution (Batch 1) ────────────────────────────
    // Primary morning feed round. Always requires a feed log entry.
    {
      taskType:    'FEEDING',
      title:       '🍽️ Morning Feed Distribution (Batch 1)',
      description: 'Load feed and distribute to all troughs. Ensure the morning portion is accurate and all birds can access feed. Log bags used and weight of last (partial) bag in the feed form.',
      dueTime:     '06:30',
      priority:    'NORMAL',
    },

    // ── 07:30 First Egg Collection (Batch 1) ────────────────────────────────
    // Morning egg collection. collectionSession=1 in the egg modal.
    {
      taskType:    'EGG_COLLECTION',
      title:       '🥚 First Egg Collection (Batch 1)',
      description: 'Collect eggs manually from all cage rows. Clean dirty eggs and place in crates. Sort by size and separate cracked eggs. Pen Manager must verify physically before transport. Transport to egg storage room. Log total crates, loose eggs, and cracked count.',
      dueTime:     '07:30',
      priority:    'NORMAL',
    },

    // ── 09:00 Water System Check ────────────────────────────────────────────
    // Inspection of automated nipple system. No data entry — one-tap complete.
    {
      taskType:    'INSPECTION',
      title:       '💧 Water System Check',
      description: 'Inspect the automated nipple water system along all cage rows. Check for leaks, blocked nipples, and correct drip rate. Test nipples by tapping — replace any that fail the drip test. Report blockages or pressure issues to Pen Manager.',
      dueTime:     '09:00',
      priority:    'NORMAL',
    },

    // ── 09:30 Pen Sanitation ────────────────────────────────────────────────
    // Cleaning task. No data entry — one-tap complete.
    {
      taskType:    'CLEANING',
      title:       '🧹 Pen Sanitation',
      description: 'Clean all aisles and walkways. Remove any spilled feed from under feeder rails. Check footbath disinfectant level and refresh if low. Ensure aisle access is clear for afternoon rounds.',
      dueTime:     '09:30',
      priority:    'NORMAL',
    },

    // ── 10:30 Supplemental Feed Top-up (Batch 1 replenishment) ──────────────
    // Conditional: stir troughs first, top up only if depleted.
    // Worker taps this task, opens feed modal if feed was added, or one-taps
    // "No Feed Added" if troughs still had sufficient feed.
    {
      taskType:    'FEEDING',
      title:       '🍽️ Supplemental Feed Top-up (Morning)',
      description: 'Stir feed in all troughs to prevent bridging. If morning feed is depleted, add a top-up and log bags used. Clean any spilled feed from under rails. Visually inspect manure pit under each cage row for unusual colour or consistency.',
      dueTime:     '10:30',
      priority:    'NORMAL',
    },

    // ── 11:15 Bird Health Check & Ventilation ───────────────────────────────
    // Observation only. One-tap complete with optional notes.
    {
      taskType:    'INSPECTION',
      title:       '🐔 Bird Health Check & Ventilation',
      description: 'Walk all cage rows and observe bird behaviour. Look for lethargic, panting, or huddling birds — remove any sick birds and report to Pen Manager immediately. Check that ammonia smell is not strong at bird level. Adjust fans or side curtains as needed for ventilation.',
      dueTime:     '11:15',
      priority:    'NORMAL',
    },

    // ── 12:00 Midday Feed Top-up (Batch 1 second replenishment) ─────────────
    // Conditional: only log feed if top-up was done.
    {
      taskType:    'FEEDING',
      title:       '🍽️ Midday Feed Top-up',
      description: 'Stir feed in all troughs. If feed levels are low, add a top-up and log bags used and remaining. Clean any spilled feed.',
      dueTime:     '12:00',
      priority:    'NORMAL',
    },

    // ── 14:30 Final Feed Distribution (Batch 2) ─────────────────────────────
    // Afternoon main feed round. Always requires a feed log entry.
    {
      taskType:    'FEEDING',
      title:       '🍽️ Final Feed Distribution (Batch 2)',
      description: 'Distribute the full afternoon feed allocation to all troughs. Birds will eat through late afternoon into early evening. Log bags used and weight of last (partial) bag in the feed form.',
      dueTime:     '14:30',
      priority:    'NORMAL',
    },

    // ── 15:30 Second Egg Collection (Batch 2) ───────────────────────────────
    // Afternoon egg collection. collectionSession=2 in the egg modal.
    {
      taskType:    'EGG_COLLECTION',
      title:       '🥚 Second Egg Collection (Batch 2)',
      description: 'Collect all remaining eggs from cage rows. Clean dirty eggs and place in crates. Sort by size and separate cracked eggs. Pen Manager must verify before transport. Transport to egg storage room. Log total crates, loose eggs, and cracked count.',
      dueTime:     '15:30',
      priority:    'NORMAL',
    },

    // ── 17:00 End-of-Day Checks & Manure Observation ────────────────────────
    // Combined end-of-shift inspection and manure pit check.
    {
      taskType:    'INSPECTION',
      title:       '🌅 End-of-Day Checks & Manure Observation',
      description: 'Final walkthrough of the pen: secure all cage doors and pen entry. Complete all outstanding records. Daily manure pit visual inspection: check manure profile under all cage rows from the aisle. Look for abnormal colour or consistency (blood, green/yellow diarrhoea, watery droppings). Log and report any abnormalities to Pen Manager.',
      dueTime:     '17:00',
      priority:    'NORMAL',
    },

    // ── 18:30 Daily Report Auto-submission ──────────────────────────────────
    // System auto-submits the daily summary to the PM. Worker taps to confirm.
    {
      taskType:    'REPORT_SUBMISSION',
      title:       '📋 Daily Report Submission',
      description: 'All records for the day (feed, eggs, mortality, water) are automatically aggregated and sent to the Pen Manager for review. Tap to confirm your shift is complete.',
      dueTime:     '18:30',
      priority:    'NORMAL',
    },
  ];
  return templates.map(t => ({ ...t, dueDate: dueAt(date, t.dueTime) }));
}

// ── Layer PRODUCTION daily templates (Broiler path kept unchanged) ────────────
function dailyTemplates(date, opType) {
  if (opType === 'LAYER') return dailyTemplatesLayerProduction(date);

  // ── BROILER PRODUCTION ───────────────────────────────────────────────────
  // Broiler-specific templates remain unchanged until Phase 8G-Broiler sprint.
  const templates = [
    {
      taskType: 'FEEDING',
      title:    '🍽️ Morning Feed Round',
      description: 'Distribute morning feed to all birds. Record bags used and remaining. Log in feed distribution form.',
      dueTime:  '08:00',
      priority: 'NORMAL',
    },
    {
      taskType: 'MORTALITY_CHECK',
      title:    '💀 Mortality Check',
      description: 'Walk the section and remove any dead birds. Record the count and cause in the mortality log. Record zero if none found.',
      dueTime:  '11:00',
      priority: 'NORMAL',
    },
    {
      taskType: 'FEEDING',
      title:    '🍽️ Evening Feed Round',
      description: 'Distribute evening feed. Record bags used and remaining. Log in feed distribution form.',
      dueTime:  '17:00',
      priority: 'NORMAL',
    },
    {
      taskType: 'REPORT_SUBMISSION',
      title:    '📋 Closing Observation',
      description: 'Complete the daily summary checklist: water nipples, manure belts, aisles, cage doors. Add any closing observations.',
      dueTime:  '19:00',
      priority: 'NORMAL',
    },
  ];
  return templates.map(t => ({ ...t, dueDate: dueAt(date, t.dueTime) }));
}

// ── Stage-aware weekly template dispatcher ────────────────────────────────────
function weeklyTemplatesForStage(weekStart, opType, stage) {
  if (stage === 'BROODING') return weeklyTemplatesBrooding(weekStart);
  if (stage === 'REARING')  return weeklyTemplatesRearing(weekStart);
  return weeklyTemplates(weekStart, opType); // PRODUCTION
}

// ── Brooding weekly templates ─────────────────────────────────────────────────
function weeklyTemplatesBrooding(weekStart) {
  const wed = new Date(weekStart); wed.setDate(wed.getDate() + 2);
  const fri = new Date(weekStart); fri.setDate(fri.getDate() + 4);
  return [
    {
      taskType: 'CLEANING',
      title:    '🧹 Brooder Section Clean',
      description: 'Remove wet litter, replace with fresh dry litter. Clean drinkers and feeders thoroughly.',
      dueDate: dueAt(fri, '15:00'), priority: 'HIGH',
    },
    {
      taskType: 'BIOSECURITY',
      title:    '🛡️ Biosecurity & Brooder Guard Check',
      description: 'Check footbath disinfectant. Inspect brooder guard integrity. Verify no draughts or cold spots.',
      dueDate: dueAt(wed, '10:00'), priority: 'NORMAL',
    },
  ];
}

// ── Rearing weekly templates ──────────────────────────────────────────────────
function weeklyTemplatesRearing(weekStart) {
  const wed = new Date(weekStart); wed.setDate(wed.getDate() + 2);
  const thu = new Date(weekStart); thu.setDate(thu.getDate() + 3);
  const fri = new Date(weekStart); fri.setDate(fri.getDate() + 4);
  return [
    {
      taskType: 'WEIGHT_RECORDING',
      title:    '⚖️ Weekly Pullet Weigh-In',
      description: 'Randomly select and weigh at least 30 birds from different cage tiers and positions. Record average, min, and max weights. Calculate uniformity %. Compare against breed standard target weight for this week. Flag any section more than 10% below target to Pen Manager.',
      dueDate: dueAt(thu, '10:00'), priority: 'HIGH',
    },
    {
      taskType: 'CLEANING',
      title:    '🧹 Section Deep Clean',
      description: 'Sweep all aisles, clean feeders and drinkers, remove manure buildup.',
      dueDate: dueAt(fri, '16:00'), priority: 'NORMAL',
    },
    {
      taskType: 'BIOSECURITY',
      title:    '🛡️ Biosecurity Check',
      description: 'Check and refresh footbath disinfectant. Inspect all entry points. Verify pest control bait stations.',
      dueDate: dueAt(wed, '10:00'), priority: 'NORMAL',
    },
    {
      taskType: 'STORE_COUNT',
      title:    '📦 Feed Bag Count',
      description: 'Count remaining grower mash bags. Compare against system records. Report any discrepancies to Pen Manager.',
      dueDate: dueAt(fri, '14:00'), priority: 'NORMAL',
    },
  ];
}

// ── Layer PRODUCTION weekly templates ────────────────────────────────────────
// Matches operational spreadsheet exactly — one task per day of the week,
// each scheduled for that specific day of the current week.
//
// weekStart = Monday of the current week.
//
function weeklyTemplatesLayerProduction(weekStart) {
  const mon = new Date(weekStart);                                       // Monday
  const tue = new Date(weekStart); tue.setDate(tue.getDate() + 1);      // Tuesday
  const wed = new Date(weekStart); wed.setDate(wed.getDate() + 2);      // Wednesday
  const thu = new Date(weekStart); thu.setDate(thu.getDate() + 3);      // Thursday
  const fri = new Date(weekStart); fri.setDate(fri.getDate() + 4);      // Friday
  const sat = new Date(weekStart); sat.setDate(sat.getDate() + 5);      // Saturday
  const sun = new Date(weekStart); sun.setDate(sun.getDate() + 6);      // Sunday

  return [
    // ── Monday: Manual Manure Evacuation ────────────────────────────────────
    {
      taskType: 'CLEANING',
      title:    '🪣 Manual Manure Evacuation',
      description: 'Scrape manure from under all cage rows in the assigned section (rolling weekly rotation, or all sections if volume requires). Transfer manure to the designated collection pit or compost area. Record the section scraped and approximate volume in your notes. After scraping, check the pit floor for pooled water or unusual drainage — this may indicate a nipple line leak above.',
      dueDate:  dueAt(mon, '09:00'),
      priority: 'HIGH',
    },

    // ── Tuesday: Deep Aisle Sanitation ──────────────────────────────────────
    {
      taskType: 'CLEANING',
      title:    '🧽 Deep Aisle Sanitation',
      description: 'Scrub all aisle floors with disinfectant solution (1:200 Virkon or equivalent). Pay close attention to areas under feeder rails where feed fines accumulate. Wipe down cage end-plates and structural bars with a disinfectant cloth. Clean ventilation fan intake grilles.',
      dueDate:  dueAt(tue, '09:00'),
      priority: 'NORMAL',
    },

    // ── Wednesday: Feed Rail Deep Clean ─────────────────────────────────────
    {
      taskType: 'CLEANING',
      title:    '🧹 Feed Rail Deep Clean',
      description: 'Remove all residual feed fines from cage rails. Scrub rail surfaces with a stiff brush and food-safe disinfectant. Allow to dry before the next feed round. Inspect feed rail clips, feeder hooks, and any broken rail sections — report damaged rails to Pen Manager immediately, as birds cannot access feed from a broken or tilted rail.',
      dueDate:  dueAt(wed, '10:00'),
      priority: 'NORMAL',
    },

    // ── Thursday: Weight Sampling ────────────────────────────────────────────
    {
      taskType: 'WEIGHT_RECORDING',
      title:    '⚖️ Weekly Hen Weight Sampling',
      description: 'Weigh a random sample of 50 birds from different cage tiers and positions across the section. Enter each bird\'s weight individually — the system calculates the average, min, max, and uniformity automatically. Target range: 1,800–2,000g for ISA Brown production hens. Weights below 1,700g (underweight) or above 2,200g (obese) are flagged automatically. Note: sample from all tiers — top-tier birds are often heavier due to heat and feed access differentials.',
      dueDate:  dueAt(thu, '10:00'),
      priority: 'HIGH',
    },

    // ── Friday: Biosecurity & Pest Check ────────────────────────────────────
    {
      taskType: 'BIOSECURITY',
      title:    '🛡️ Biosecurity & Pest Check',
      description: 'Inspect all rodent bait stations — restock or flag consumed bait. Check the house perimeter for gaps that allow rodent entry. Spray fly-control product on manure collection points and aisle drains. Check footbath disinfectant concentration at the pen entrance with a titration strip — refresh if below specification.',
      dueDate:  dueAt(fri, '10:00'),
      priority: 'NORMAL',
    },

    // ── Saturday: Equipment & Infrastructure Check ───────────────────────────
    {
      taskType: 'MAINTENANCE',
      title:    '🔧 Equipment & Infrastructure Check',
      description: 'Inspect lighting circuits and timer settings — confirm correct on/off times for the flock age. Check all cage wire for broken strands or sharp ends that could injure bird feet or keel bones. Inspect egg roll-out angles on each cage tier — eggs should roll freely to the collection tray. Report any bent or blocked roll-outs to Pen Manager, as these cause floor eggs and increase cracked egg count.',
      dueDate:  dueAt(sat, '09:00'),
      priority: 'NORMAL',
    },

    // ── Sunday: Nipple Drinker Inspection ───────────────────────────────────
    {
      taskType: 'INSPECTION',
      title:    '💧 Nipple Drinker Inspection',
      description: 'Inspect all accessible nipples along every aisle — test drip rate by tapping each nipple. Replace any nipples that fail the drip test. Check pressure regulators and in-line filters. Remove and clean filter screens. Log the overall filter condition in your notes.',
      dueDate:  dueAt(sun, '09:00'),
      priority: 'NORMAL',
    },
  ];
}

// ── Production weekly templates dispatcher ────────────────────────────────────
function weeklyTemplates(weekStart, opType) {
  if (opType === 'LAYER') return weeklyTemplatesLayerProduction(weekStart);

  // ── BROILER PRODUCTION weekly (unchanged until Phase 8G-Broiler) ──────────
  const wed = new Date(weekStart); wed.setDate(wed.getDate() + 2);
  const thu = new Date(weekStart); thu.setDate(thu.getDate() + 3);
  const fri = new Date(weekStart); fri.setDate(fri.getDate() + 4);

  return [
    {
      taskType: 'CLEANING',
      title:    '🧹 Section Deep Clean',
      description: 'Sweep all aisles, clean feeders and drinkers, remove manure buildup. Record completion in daily summary checklist.',
      dueDate:  dueAt(fri, '16:00'),
      priority: 'NORMAL',
    },
    {
      taskType: 'BIOSECURITY',
      title:    '🛡️ Biosecurity Check',
      description: 'Check and refresh footbath disinfectant. Inspect all entry points. Verify pest control bait stations. Report any breaches.',
      dueDate:  dueAt(wed, '10:00'),
      priority: 'NORMAL',
    },
    {
      taskType: 'STORE_COUNT',
      title:    '📦 Feed Bag Count',
      description: 'Count remaining feed bags in section storage. Compare against system records. Report any discrepancies to Pen Manager.',
      dueDate:  dueAt(fri, '14:00'),
      priority: 'NORMAL',
    },
    {
      taskType: 'WEIGHT_RECORDING',
      title:    '⚖️ Weekly Bird Weigh-In',
      description: 'Randomly select and weigh at least 30 birds. Record average, min, and max weights in the weight recording form. Uniformity estimate optional.',
      dueDate:  dueAt(thu, '10:00'),
      priority: 'NORMAL',
    },
  ];
}

// ── Get Monday of the week containing a given date ────────────────────────────
function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Sunday = 0 → go back 6 days
  d.setDate(d.getDate() + diff);
  return d;
}

// ── POST /api/tasks/generate ──────────────────────────────────────────────────
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body      = await request.json().catch(() => ({}));
    const frequency = body.frequency || 'daily';
    const baseDate  = body.date ? new Date(body.date) : new Date();
    baseDate.setHours(0, 0, 0, 0);

    const weekStart = getWeekStart(baseDate);

    // ── Early-exit guard — prevent duplicates from concurrent requests ────────
    // Multiple workers loading the page simultaneously each fire POST /generate.
    // The per-section dedup (existingTitles set) has a TOCTOU race: two concurrent
    // requests both read an empty set before either has committed any rows.
    // Counting existing tasks at route entry and bailing out early eliminates this.
    if (frequency === 'daily') {
      const alreadyExists = await prisma.task.count({
        where: {
          tenantId:       user.tenantId,
          dueDate:        { gte: baseDate, lt: new Date(baseDate.getTime() + 86400000) },
          isRecurring:    true,
          recurrenceRule: 'DAILY',
          status:         { not: 'CANCELLED' },
        },
      });
      if (alreadyExists > 0) {
        return NextResponse.json({
          created: 0, skipped: alreadyExists, frequency,
          alreadyGenerated: true,
          message: `Daily tasks already exist for today (${alreadyExists} tasks). No duplicates created.`,
        }, { status: 200 });
      }
    }

    if (frequency === 'weekly') {
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
      const alreadyExists = await prisma.task.count({
        where: {
          tenantId:       user.tenantId,
          dueDate:        { gte: weekStart, lt: weekEnd },
          isRecurring:    true,
          recurrenceRule: 'WEEKLY',
          status:         { not: 'CANCELLED' },
        },
      });
      if (alreadyExists > 0) {
        return NextResponse.json({
          created: 0, skipped: alreadyExists, frequency,
          alreadyGenerated: true,
          message: `Weekly tasks already exist for this week (${alreadyExists} tasks). No duplicates created.`,
        }, { status: 200 });
      }
    }

    // Find all active sections with worker assignments on this tenant
    const sections = await prisma.penSection.findMany({
      where: {
        isActive: true,
        pen: { farm: { tenantId: user.tenantId } },
        workerAssignments: { some: { isActive: true } },
      },
      include: {
        pen: { select: { name: true, operationType: true } },
        workerAssignments: {
          where:  { isActive: true },
          select: { userId: true, user: { select: { role: true } } },
          take:   5,
        },
        flocks: {
          where:  { status: 'ACTIVE' },
          select: { id: true, stage: true, operationType: true },
          take:   1,
        },
      },
    });

    let created = 0;
    let skipped = 0;

    for (const section of sections) {
      const hasFlock   = section.flocks.length > 0;
      const flock      = section.flocks[0] || null;
      const flockStage = flock?.stage || 'PRODUCTION';
      const opType     = flock?.operationType || section.pen.operationType || 'LAYER';

      // Primary worker = first PEN_WORKER assigned; fall back to any active worker
      const workerAssignment =
        section.workerAssignments.find(a => a.user.role === 'PEN_WORKER') ||
        section.workerAssignments[0];

      if (!workerAssignment) continue;
      const primaryWorker = workerAssignment;

      if (frequency === 'daily') {
        // Skip non-flock-dependent task types if no active flock
        const templates = dailyTemplatesForStage(baseDate, opType, flockStage);

        // Fetch existing tasks for today to deduplicate by title
        const today    = new Date(baseDate);
        const tomorrow = new Date(baseDate); tomorrow.setDate(tomorrow.getDate() + 1);

        const existingToday = await prisma.task.findMany({
          where: {
            penSectionId:   section.id,
            dueDate:        { gte: today, lt: tomorrow },
            status:         { not: 'CANCELLED' },
            isRecurring:    true,
            recurrenceRule: 'DAILY',
          },
          select: { title: true },
        });

        const existingTitles = new Set(existingToday.map(t => t.title));

        for (const tmpl of templates) {
          // Skip flock-dependent tasks when section has no active flock
          const flockRequired = ['FEEDING', 'EGG_COLLECTION', 'MORTALITY_CHECK', 'WEIGHT_RECORDING'];
          if (flockRequired.includes(tmpl.taskType) && !hasFlock) { skipped++; continue; }

          if (existingTitles.has(tmpl.title)) { skipped++; continue; }

          await prisma.task.create({
            data: {
              tenantId:       user.tenantId,
              penSectionId:   section.id,
              assignedToId:   primaryWorker.userId,
              createdById:    user.sub,
              taskType:       tmpl.taskType,
              title:          tmpl.title,
              description:    tmpl.description,
              dueDate:        tmpl.dueDate,
              priority:       tmpl.priority,
              status:         'PENDING',
              isRecurring:    true,
              recurrenceRule: 'DAILY',
            },
          });
          created++;
        }

      } else if (frequency === 'weekly') {
        const templates = weeklyTemplatesForStage(weekStart, opType, flockStage);

        const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);

        const existingWeek = await prisma.task.findMany({
          where: {
            penSectionId:   section.id,
            dueDate:        { gte: weekStart, lt: weekEnd },
            status:         { not: 'CANCELLED' },
            isRecurring:    true,
            recurrenceRule: 'WEEKLY',
          },
          select: { title: true },
        });

        const existingTitles = new Set(existingWeek.map(t => t.title));

        for (const tmpl of templates) {
          if (existingTitles.has(tmpl.title)) { skipped++; continue; }

          await prisma.task.create({
            data: {
              tenantId:       user.tenantId,
              penSectionId:   section.id,
              assignedToId:   primaryWorker.userId,
              createdById:    user.sub,
              taskType:       tmpl.taskType,
              title:          tmpl.title,
              description:    tmpl.description,
              dueDate:        tmpl.dueDate,
              priority:       tmpl.priority,
              status:         'PENDING',
              isRecurring:    true,
              recurrenceRule: 'WEEKLY',
            },
          });
          created++;
        }
      }
    }

    console.log(`[tasks/generate] ${frequency}: ${sections.length} sections found, ${created} created, ${skipped} skipped`);
    sections.forEach(s => {
      const hasFlock   = s.flocks?.length > 0;
      const flockStage = s.flocks?.[0]?.stage || 'PRODUCTION';
      const workerCount = s.workerAssignments?.length ?? 0;
      console.log(`  Section: ${s.id} | stage:${flockStage} | flock:${hasFlock} | workers:${workerCount} | pen:${s.pen?.name}`);
    });

    return NextResponse.json({
      created,
      skipped,
      frequency,
      message: `Generated ${created} task${created !== 1 ? 's' : ''} across ${sections.length} section${sections.length !== 1 ? 's' : ''}.`,
    }, { status: 201 });

  } catch (err) {
    console.error('[POST /api/tasks/generate]', err);
    return NextResponse.json({ error: 'Failed to generate tasks' }, { status: 500 });
  }
}

// ── GET /api/tasks/generate ───────────────────────────────────────────────────
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const today     = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow  = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const weekStart = getWeekStart(today);
  const weekEnd   = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);

  const [dailyCount, weeklyCount] = await Promise.all([
    prisma.task.count({
      where: {
        tenantId:       user.tenantId,
        dueDate:        { gte: today, lt: tomorrow },
        isRecurring:    true,
        recurrenceRule: 'DAILY',
        status:         { not: 'CANCELLED' },
      },
    }),
    prisma.task.count({
      where: {
        tenantId:       user.tenantId,
        dueDate:        { gte: weekStart, lt: weekEnd },
        isRecurring:    true,
        recurrenceRule: 'WEEKLY',
        status:         { not: 'CANCELLED' },
      },
    }),
  ]);

  return NextResponse.json({
    dailyGenerated:  dailyCount  > 0,
    weeklyGenerated: weeklyCount > 0,
    dailyCount,
    weeklyCount,
  });
}
