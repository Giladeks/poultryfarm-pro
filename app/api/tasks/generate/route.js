// app/api/tasks/generate/route.js
// POST — generates daily or weekly tasks for all active pen sections
//        assigned to workers on the current tenant.
//
// Called automatically on first login of the day (by the worker/PM dashboard)
// or manually by a Farm Manager.
//
// Body:
//   { frequency: 'daily' | 'weekly', date?: 'YYYY-MM-DD' }
//
// Daily tasks (created each morning, once per section):
//   FEEDING        — Morning feed round          (due 08:00)
//   EGG_COLLECTION — Collect and count eggs      (due 10:00)
//   MORTALITY_CHECK— Record any deaths           (due 11:00)
//   FEEDING        — Evening feed round          (due 17:00)
//   REPORT_SUBMISSION — Closing observation      (due 19:00)
//
// Weekly tasks (created on Monday or first login of the week, once per section):
//   CLEANING       — Section deep clean          (due Friday 16:00)
//   BIOSECURITY    — Footbath, disinfection check(due Wednesday 10:00)
//   WEIGHT_RECORDING (broiler only) — Weigh sample (due Thursday 10:00)
//   STORE_COUNT    — Count remaining feed bags   (due Friday 14:00)
//
// Idempotent: skips sections that already have tasks of that type today/this week.

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const ALLOWED_ROLES = [
  'PEN_WORKER', 'PEN_MANAGER', 'FARM_MANAGER', 'FARM_ADMIN',
  'CHAIRPERSON', 'SUPER_ADMIN',
];

// ── Due-time helper: given a base date and HH:MM, returns a full Date ─────────
function dueAt(baseDate, hhMM) {
  const [h, m] = hhMM.split(':').map(Number);
  const d = new Date(baseDate);
  d.setHours(h, m, 0, 0);
  return d;
}

// ── Daily task templates ───────────────────────────────────────────────────────
function dailyTemplates(date, opType) {
  const templates = [
    {
      taskType: 'FEEDING',
      title:    '🍽️ Morning Feed Round',
      description: 'Distribute morning feed to all birds. Record bags used and remaining. Log in feed distribution form.',
      dueTime:  '08:00',
      priority: 'NORMAL',
    },
    ...(opType === 'LAYER' ? [{
      taskType: 'EGG_COLLECTION',
      title:    '🥚 Egg Collection & Count',
      description: 'Collect all eggs from nesting boxes. Count crates, loose, and cracked eggs. Log in egg collection form.',
      dueTime:  '10:00',
      priority: 'NORMAL',
    }] : []),
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
  return templates.map(t => ({
    ...t,
    dueDate: dueAt(date, t.dueTime),
  }));
}

// ── Weekly task templates ──────────────────────────────────────────────────────
function weeklyTemplates(weekStart, opType) {
  // weekStart = Monday of the current week
  const wed = new Date(weekStart); wed.setDate(wed.getDate() + 2); // Wednesday
  const thu = new Date(weekStart); thu.setDate(thu.getDate() + 3); // Thursday
  const fri = new Date(weekStart); fri.setDate(fri.getDate() + 4); // Friday

  const templates = [
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
    ...(opType === 'BROILER' ? [{
      taskType: 'WEIGHT_RECORDING',
      title:    '⚖️ Weekly Bird Weigh-In',
      description: 'Randomly select and weigh at least 30 birds. Record average, min, and max weights in the weight recording form. Uniformity estimate optional.',
      dueDate:  dueAt(thu, '10:00'),
      priority: 'NORMAL',
    }] : []),
  ];
  return templates;
}

// ── Get Monday of the week containing a given date ────────────────────────────
function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun, 1=Mon...
  const diff = day === 0 ? -6 : 1 - day; // adjust to Monday
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
    const dateParam = body.date;

    if (!['daily', 'weekly'].includes(frequency))
      return NextResponse.json({ error: 'frequency must be daily or weekly' }, { status: 400 });

    const baseDate = dateParam
      ? (() => { const d = new Date(dateParam); d.setHours(0,0,0,0); return d; })()
      : (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();

    const weekStart = getWeekStart(baseDate);

    // ── Fetch all active sections with their assigned workers ─────────────────
    // Scope: workers only see their own sections; managers see all
    const sectionFilter = ['PEN_WORKER', 'PEN_MANAGER'].includes(user.role)
      ? {
          workerAssignments: {
            some: { userId: user.sub, isActive: true },
          },
        }
      : {};

    const sections = await prisma.penSection.findMany({
      where: {
        pen: { farm: { tenantId: user.tenantId } },
        isActive: true,
        flocks:   { some: { status: 'ACTIVE' } }, // only sections with live flocks
        ...sectionFilter,
      },
      include: {
        pen: { select: { operationType: true, name: true } },
        workerAssignments: {
          where:  { isActive: true },
          include: { user: { select: { id: true, role: true, isActive: true } } },
        },
      },
    });

    if (sections.length === 0)
      return NextResponse.json({ created: 0, skipped: 0, message: 'No active sections found' });

    let created = 0;
    let skipped = 0;

    for (const section of sections) {
      const opType = section.pen.operationType; // 'LAYER' | 'BROILER'

      // Find all active workers assigned to this section
      const workers = section.workerAssignments
        .map(a => a.user)
        .filter(u => u.isActive && ['PEN_WORKER', 'PEN_MANAGER'].includes(u.role));

      if (workers.length === 0) { skipped++; continue; }

      // One worker gets assigned per task — the first active PEN_WORKER, or PM if none
      const primaryWorker = workers.find(u => u.role === 'PEN_WORKER') || workers[0];

      if (frequency === 'daily') {
        const templates = dailyTemplates(baseDate, opType);

        // Check which task types already have tasks today for this section
        const existingToday = await prisma.task.findMany({
          where: {
            tenantId:    user.tenantId,
            penSectionId:section.id,
            dueDate:     { gte: baseDate, lt: new Date(baseDate.getTime() + 86400000) },
            status:      { not: 'CANCELLED' },
          },
          select: { taskType: true, title: true },
        });

        const existingTitles = new Set(existingToday.map(t => t.title));

        for (const tmpl of templates) {
          if (existingTitles.has(tmpl.title)) { skipped++; continue; }

          await prisma.task.create({
            data: {
              tenantId:     user.tenantId,
              penSectionId: section.id,
              assignedToId: primaryWorker.id,
              createdById:  user.sub,
              taskType:     tmpl.taskType,
              title:        tmpl.title,
              description:  tmpl.description,
              dueDate:      tmpl.dueDate,
              priority:     tmpl.priority,
              status:       'PENDING',
              isRecurring:  true,
              recurrenceRule: 'DAILY',
            },
          });
          created++;
        }
      }

      if (frequency === 'weekly') {
        const templates = weeklyTemplates(weekStart, opType);

        // Check which weekly tasks already exist this week for this section
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);

        const existingWeek = await prisma.task.findMany({
          where: {
            tenantId:    user.tenantId,
            penSectionId:section.id,
            dueDate:     { gte: weekStart, lt: weekEnd },
            status:      { not: 'CANCELLED' },
            isRecurring: true,
            recurrenceRule: 'WEEKLY',
          },
          select: { taskType: true, title: true },
        });

        const existingTitles = new Set(existingWeek.map(t => t.title));

        for (const tmpl of templates) {
          if (existingTitles.has(tmpl.title)) { skipped++; continue; }

          await prisma.task.create({
            data: {
              tenantId:     user.tenantId,
              penSectionId: section.id,
              assignedToId: primaryWorker.id,
              createdById:  user.sub,
              taskType:     tmpl.taskType,
              title:        tmpl.title,
              description:  tmpl.description,
              dueDate:      tmpl.dueDate,
              priority:     tmpl.priority,
              status:       'PENDING',
              isRecurring:  true,
              recurrenceRule: 'WEEKLY',
            },
          });
          created++;
        }
      }
    }

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

// ── GET /api/tasks/generate — check if tasks need generating today/this week ──
// Returns { dailyGenerated: bool, weeklyGenerated: bool } so the UI can decide
// whether to trigger generation on login.
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ALLOWED_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const today     = new Date(); today.setHours(0,0,0,0);
  const tomorrow  = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const weekStart = getWeekStart(today);
  const weekEnd   = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);

  const [dailyCount, weeklyCount] = await Promise.all([
    prisma.task.count({
      where: {
        tenantId:  user.tenantId,
        dueDate:   { gte: today, lt: tomorrow },
        isRecurring: true,
        recurrenceRule: 'DAILY',
        status:    { not: 'CANCELLED' },
      },
    }),
    prisma.task.count({
      where: {
        tenantId:  user.tenantId,
        dueDate:   { gte: weekStart, lt: weekEnd },
        isRecurring: true,
        recurrenceRule: 'WEEKLY',
        status:    { not: 'CANCELLED' },
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
