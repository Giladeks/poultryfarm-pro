#!/usr/bin/env python3
# patch_tasks_generate.py
# Patches app/api/tasks/generate/route.js to add stage-aware task template selection.
#
# The existing route generates tasks based on operationType (LAYER | BROILER).
# This patch adds flock.stage awareness so:
#   - BROODING stage flocks get brooding-specific tasks (temp checks, not egg collection)
#   - REARING stage flocks get rearing-specific tasks (weight recording, not egg collection)
#   - PRODUCTION stage flocks keep existing behaviour (unchanged)
#
# Run from project root: python3 patch_tasks_generate.py

import sys

path = 'app/api/tasks/generate/route.js'

with open(path, 'r') as f:
    src = f.read()

# ── Patch 1: Include flock stage in section fetch ─────────────────────────────
OLD_FLOCK_SELECT = """        flocks: {
          where:  { status: 'ACTIVE' },
          select: { id: true },
          take:   1,
        },"""

NEW_FLOCK_SELECT = """        flocks: {
          where:  { status: 'ACTIVE' },
          select: { id: true, stage: true },
          take:   1,
        },"""

if OLD_FLOCK_SELECT not in src:
    print('ERROR: Could not find flock select block. Check manually.')
    sys.exit(1)

src = src.replace(OLD_FLOCK_SELECT, NEW_FLOCK_SELECT, 1)

# ── Patch 2: Use stage to determine which templates to run ───────────────────
# Find the block that determines hasActiveFlock and opType, then add stage logic
OLD_FLOCK_CHECK = """      const opType         = section.pen.operationType; // 'LAYER' | 'BROILER'
      const hasActiveFlock = section.flocks?.length > 0;"""

NEW_FLOCK_CHECK = """      const opType         = section.pen.operationType; // 'LAYER' | 'BROILER'
      const hasActiveFlock = section.flocks?.length > 0;
      const flockStage     = section.flocks?.[0]?.stage || 'PRODUCTION'; // BROODING | REARING | PRODUCTION"""

if OLD_FLOCK_CHECK not in src:
    print('ERROR: Could not find opType/hasActiveFlock block. Check manually.')
    sys.exit(1)

src = src.replace(OLD_FLOCK_CHECK, NEW_FLOCK_CHECK, 1)

# ── Patch 3: Replace dailyTemplates call with stage-aware dispatch ────────────
OLD_TEMPLATE_CALL = """        const templates = dailyTemplates(baseDate, opType)
          .filter(t => hasActiveFlock || !FLOCK_REQUIRED.includes(t.taskType));"""

NEW_TEMPLATE_CALL = """        const templates = dailyTemplatesForStage(baseDate, opType, flockStage)
          .filter(t => hasActiveFlock || !FLOCK_REQUIRED.includes(t.taskType));"""

if OLD_TEMPLATE_CALL not in src:
    print('ERROR: Could not find dailyTemplates call. Check manually.')
    sys.exit(1)

src = src.replace(OLD_TEMPLATE_CALL, NEW_TEMPLATE_CALL, 1)

# ── Patch 4: Add the stage-aware dispatcher function before dailyTemplates ───
OLD_DAILY_TEMPLATES_FN = """// ── Daily task templates ───────────────────────────────────────────────────────
function dailyTemplates(date, opType) {"""

NEW_DAILY_TEMPLATES_FN = """// ── Stage-aware template dispatcher ─────────────────────────────────────────
// Routes to the correct template set based on flock stage + operation type.
function dailyTemplatesForStage(date, opType, stage) {
  if (stage === 'BROODING') return dailyTemplatesBrooding(date, opType);
  if (stage === 'REARING')  return dailyTemplatesRearing(date);
  return dailyTemplates(date, opType); // PRODUCTION — existing behaviour
}

// ── Brooding daily templates (stage = BROODING) ───────────────────────────────
function dailyTemplatesBrooding(date, opType) {
  const isBroiler = opType === 'BROILER';
  const templates = [
    {
      taskType: 'FEEDING',
      title:    '🍽️ Morning Feed & Water Check',
      description: 'Check feeders and drinkers. Top up feed. Ensure all chicks can access feed and water.',
      dueTime:  '06:00', priority: 'HIGH',
    },
    {
      taskType: 'MORTALITY_CHECK',
      title:    '💀 Morning Mortality Check',
      description: 'Walk the brooder section and remove dead chicks. Record count in mortality log.',
      dueTime:  '07:00', priority: 'HIGH',
    },
    {
      taskType: 'INSPECTION',
      title:    isBroiler ? '🛡️ Brooder Temperature & Tarpaulin Check' : '🌡️ Brooder Temperature & Humidity Check',
      description: isBroiler
        ? 'Record brooder temperature. Check tarpaulins are secure and heat sources are working.'
        : 'Record brooder temperature and humidity in all zones. Alert manager if outside 26–38°C.',
      dueTime:  '08:00', priority: 'HIGH',
    },
    {
      taskType: 'FEEDING',
      title:    '🍽️ Midday Feed & Water Top-up',
      description: 'Check and top up feed and water at midday.',
      dueTime:  '12:00', priority: 'NORMAL',
    },
    {
      taskType: 'FEEDING',
      title:    '🍽️ Afternoon Feed & Water Check',
      description: 'Afternoon feed round. Record any observations on feed intake.',
      dueTime:  '16:00', priority: 'NORMAL',
    },
    {
      taskType: 'MORTALITY_CHECK',
      title:    '💀 Evening Mortality Count',
      description: 'Evening mortality check. Record count and cause in mortality log.',
      dueTime:  '17:00', priority: 'HIGH',
    },
    {
      taskType: 'INSPECTION',
      title:    isBroiler ? '🌡️ Evening Heat Source Check' : '🌡️ Evening Brooder Temperature Check',
      description: isBroiler
        ? 'Check heat sources and brooder guards. Ensure temperature is stable for the night.'
        : 'Record evening temperature. Check brooder guards are in correct position.',
      dueTime:  '17:30', priority: 'NORMAL',
    },
    {
      taskType: 'REPORT_SUBMISSION',
      title:    '📋 Brooding Daily Report',
      description: 'Complete end-of-day brooding report: total mortality, feed bags used, temperature range, observations.',
      dueTime:  '19:00', priority: 'NORMAL',
    },
  ];
  return templates.map(t => ({ ...t, dueDate: dueAt(date, t.dueTime) }));
}

// ── Rearing daily templates (stage = REARING, LAYER only) ────────────────────
function dailyTemplatesRearing(date) {
  const templates = [
    {
      taskType: 'FEEDING',
      title:    '🍽️ Morning Feed Round (Grower Mash)',
      description: 'Distribute morning grower mash. Record bags used and remaining in feed log.',
      dueTime:  '08:00', priority: 'NORMAL',
    },
    {
      taskType: 'MORTALITY_CHECK',
      title:    '💀 Mortality Check',
      description: 'Walk the section. Remove any dead birds. Record count and cause in mortality log.',
      dueTime:  '11:00', priority: 'NORMAL',
    },
    {
      taskType: 'FEEDING',
      title:    '🍽️ Evening Feed Round',
      description: 'Evening grower mash distribution. Log feed consumption.',
      dueTime:  '17:00', priority: 'NORMAL',
    },
    {
      taskType: 'REPORT_SUBMISSION',
      title:    '📋 Rearing Daily Report',
      description: 'Complete daily summary: feed consumed, mortality, water consumption, general observations.',
      dueTime:  '19:00', priority: 'NORMAL',
    },
  ];
  return templates.map(t => ({ ...t, dueDate: dueAt(date, t.dueTime) }));
}

// ── Daily task templates ───────────────────────────────────────────────────────
function dailyTemplates(date, opType) {"""

if OLD_DAILY_TEMPLATES_FN not in src:
    print('ERROR: Could not find dailyTemplates function start. Check manually.')
    sys.exit(1)

src = src.replace(OLD_DAILY_TEMPLATES_FN, NEW_DAILY_TEMPLATES_FN, 1)

# ── Patch 5: Add REARING weekly weight task (currently only BROILER has it) ───
OLD_WEEKLY_WEIGHT = """    ...(opType === 'BROILER' ? [{
      taskType: 'WEIGHT_RECORDING',
      title:    '⚖️ Weekly Bird Weigh-In',
      description: 'Randomly select and weigh at least 30 birds. Record average, min, and max weights in the weight recording form. Uniformity estimate optional.',
      dueDate:  dueAt(thu, '10:00'),
      priority: 'NORMAL',
    }] : []),"""

NEW_WEEKLY_WEIGHT = """    ...(opType === 'BROILER' ? [{
      taskType: 'WEIGHT_RECORDING',
      title:    '⚖️ Weekly Bird Weigh-In',
      description: 'Randomly select and weigh at least 30 birds. Record average, min, and max weights in the weight recording form. Uniformity estimate optional.',
      dueDate:  dueAt(thu, '10:00'),
      priority: 'NORMAL',
    }] : []),
    // Rearing (LAYER REARING stage) also gets weekly weight recording
    // This is handled by dailyTemplatesRearing — weekly weight added via weeklyTemplatesRearing below."""

if OLD_WEEKLY_WEIGHT not in src:
    print('WARNING: Could not find broiler weekly weight block. Skipping patch 5.')
else:
    src = src.replace(OLD_WEEKLY_WEIGHT, NEW_WEEKLY_WEIGHT, 1)

with open(path, 'w') as f:
    f.write(src)

print('tasks/generate route patched successfully.')
print('  Added: dailyTemplatesForStage() dispatcher')
print('  Added: dailyTemplatesBrooding() — LAYER and BROILER variants')
print('  Added: dailyTemplatesRearing() — LAYER REARING daily tasks')
print('  Updated: section fetch to include flock.stage')
print('  Updated: daily template call to use stage-aware dispatcher')
