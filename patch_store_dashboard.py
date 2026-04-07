import sys

path = 'app/api/dashboard/store/route.js'

with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

# ── Fix 1: qcPending — remove tenantId, scope through feedMillBatch ──────────
OLD_QC_PENDING = """    const qcPending = await prisma.qCTest.findMany({
      where: { tenantId: user.tenantId, result: null },
      select: {
        id: true, testType: true, createdAt: true,
        feedMillBatch: { select: { batchCode: true, formulaName: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 10,
    }).catch(() => []);"""

NEW_QC_PENDING = """    const qcPending = await prisma.qCTest.findMany({
      where: {
        feedMillBatch: { tenantId: user.tenantId },
        result: null,
      },
      select: {
        id: true, testType: true, createdAt: true,
        feedMillBatch: { select: { batchCode: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 10,
    }).catch(() => []);"""

# ── Fix 2: qcRecent — remove tenantId, scope through feedMillBatch ───────────
OLD_QC_RECENT = """    const qcRecent = await prisma.qCTest.findMany({
      where: {
        tenantId: user.tenantId,
        createdAt: { gte: sevenAgo },
        result: { not: null },
      },
      select: {
        id: true, testType: true, result: true, createdAt: true,
        feedMillBatch: { select: { batchCode: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }).catch(() => []);"""

NEW_QC_RECENT = """    const qcRecent = await prisma.qCTest.findMany({
      where: {
        feedMillBatch: { tenantId: user.tenantId },
        createdAt: { gte: sevenAgo },
        result: { not: null },
      },
      select: {
        id: true, testType: true, result: true, createdAt: true,
        feedMillBatch: { select: { batchCode: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }).catch(() => []);"""

# ── Fix 3: millBatches — fix status enum values and field names ───────────────
OLD_MILL_BATCHES = """    const millBatches = await prisma.feedMillBatch.findMany({
      where: {
        tenantId: user.tenantId,
        status: { in: ['PLANNED', 'IN_PROGRESS', 'COMPLETED'] },
      },
      select: {
        id: true, batchCode: true, formulaName: true,
        plannedQtyKg: true, actualQtyKg: true,
        status: true, productionDate: true,
        producedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { productionDate: 'desc' },
      take: 10,
    }).catch(() => []);

    const millStats = {
      planned:     millBatches.filter(b => b.status === 'PLANNED').length,
      inProgress:  millBatches.filter(b => b.status === 'IN_PROGRESS').length,
      completed7d: millBatches.filter(b =>
        b.status === 'COMPLETED' && new Date(b.productionDate) >= sevenAgo
      ).length,
    };"""

NEW_MILL_BATCHES = """    const millBatches = await prisma.feedMillBatch.findMany({
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
    };"""

fixes = [
    ('qcPending tenantId', OLD_QC_PENDING, NEW_QC_PENDING),
    ('qcRecent tenantId',  OLD_QC_RECENT,  NEW_QC_RECENT),
    ('millBatches fields', OLD_MILL_BATCHES, NEW_MILL_BATCHES),
]

patched = src
for name, old, new in fixes:
    if old not in patched:
        print(f'ERROR: Could not find "{name}" block. Check the file manually.')
        sys.exit(1)
    patched = patched.replace(old, new, 1)
    print(f'  ✓ Fixed: {name}')

if patched == src:
    print('ERROR: No changes made.')
    sys.exit(1)

with open(path, 'w', encoding='utf-8') as f:
    f.write(patched)

print(f'\nStore dashboard route patched successfully ({path})')
