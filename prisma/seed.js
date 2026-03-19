// prisma/seed.js — PoultryFarm Pro v2.1 (Phase 8B workflow schema)
//
// What changed from v2.0:
//   EggProduction  — removed gradeACount/gradeBCount/dirtyCount/cratesCount (worker fields)
//                    added cratesCollected, looseEggs, collectionSession (worker entry)
//                    added gradeBCrates, gradeBLoose, crackedConfirmed (PM grading)
//                    added gradeACount, gradeBCount, gradeAPct (PM-computed)
//                    added approvedById, updatedAt
//                    TWO sessions per day (morning + afternoon)
//   FeedConsumption — removed feedBatch, added feedTime (TIMESTAMPTZ)
//                    added bagsUsed, remainingKg, bagWeightKg (snapshot)
//                    added approvedById, submissionStatus, rejectionReason, updatedAt
//                    2–3 distributions per day to show open-ended feedTime
//   FeedInventory  — added bagWeightKg (default 25)
//   Farm           — added autoSummaryTime (default "19:00")
//   WaterMeterReading — new model, 7 days of odometer readings
//   DailySummary   — new model, last 5 days seeded
//
// Everything else (plans, tenant, users, pens, flocks, mortality,
// vaccinations, tasks, sales, finance, assets …) is identical to v2.0.

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const hash        = (pw) => bcrypt.hashSync(pw, 10);
const today       = new Date();
const daysAgo     = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
const daysFromNow = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };

// Return a copy of `date` with the clock set to hh:mm
const atTime = (date, hh, mm = 0) => {
  const d = new Date(date);
  d.setHours(hh, mm, 0, 0);
  return d;
};

// ── egg helpers ──────────────────────────────────────────────────────────────
// totalEggs = (cratesCollected × 30) + looseEggs + crackedCount
const eggTotal    = (crates, loose, cracked) => crates * 30 + loose + cracked;
const layingRate  = (total, birds) => parseFloat(((total / birds) * 100).toFixed(2));

// ── feed helpers ─────────────────────────────────────────────────────────────
// quantityKg = (bagsUsed × bagWeightKg) + (bagWeightKg − remainingKg)
const feedQty = (bags, remaining, bagWt) =>
  parseFloat(((bags * bagWt) + (bagWt - remaining)).toFixed(1));

async function main() {
  console.log('🌱 Seeding PoultryFarm Pro v2.1...\n');

  // ============================================================
  // PLANS  (unchanged)
  // ============================================================
  await Promise.all([
    prisma.plan.upsert({
      where: { id: 'plan-starter' }, update: {},
      create: {
        id: 'plan-starter', name: 'Starter', maxBirds: 5000, maxUsers: 5, maxFarms: 1,
        monthlyPrice: 49.00, annualPrice: 470.00,
        features: ['flock_mgmt','health','feed','production','mobile_app','csv_export','basic_analytics'],
      },
    }),
    prisma.plan.upsert({
      where: { id: 'plan-professional' }, update: {},
      create: {
        id: 'plan-professional', name: 'Professional', maxBirds: 50000, maxUsers: 25, maxFarms: 3,
        monthlyPrice: 199.00, annualPrice: 1910.00,
        features: ['flock_mgmt','health','feed','production','mobile_app','csv_export',
                   'advanced_analytics','staff_tasks','pdf_reports','compliance',
                   'procurement','sales','hr_basic','maintenance'],
      },
    }),
    prisma.plan.upsert({
      where: { id: 'plan-enterprise' }, update: {},
      create: {
        id: 'plan-enterprise', name: 'Enterprise', maxBirds: 9999999, maxUsers: 9999, maxFarms: 999,
        monthlyPrice: 599.00, annualPrice: 5990.00,
        features: ['flock_mgmt','health','feed','production','mobile_app','csv_export',
                   'predictive_ai','staff_tasks','hatchery','pdf_reports','compliance',
                   'procurement','sales','financials','hr_full','maintenance',
                   'feed_mill','verification','multi_farm','api_full'],
      },
    }),
    prisma.plan.upsert({
      where: { id: 'plan-founding' }, update: {},
      create: {
        id: 'plan-founding', name: 'Founding Farm', maxBirds: 50000, maxUsers: 9999, maxFarms: 5,
        monthlyPrice: 0.00, annualPrice: 0.00,
        features: ['flock_mgmt','health','feed','production','mobile_app','csv_export',
                   'advanced_analytics','staff_tasks','hatchery','pdf_reports','compliance',
                   'procurement','sales','financials','hr_full','maintenance',
                   'feed_mill','verification','multi_farm','api_full'],
      },
    }),
  ]);
  console.log('✓ Plans created');

  // ============================================================
  // TENANT
  // ============================================================
  const tenant = await prisma.tenant.upsert({
    where: { subdomain: 'greenacres' }, update: {},
    create: {
      id: 'tenant-founding',
      farmName: 'Green Acres Poultry Farm',
      subdomain: 'greenacres',
      country: 'NG',
      timezone: 'Africa/Lagos',
      defaultCurrency: 'NGN',
      secondaryCurrency: 'USD',
      exchangeRate: 1580.00,
      address: '12 Farm Road, Ogun State, Nigeria',
      phone: '+234-801-000-0001',
      email: 'admin@greenacres.ng',
      status: 'ACTIVE',
      hasFeedMill: true,
      hasHatchery: false,
    },
  });
  console.log(`✓ Tenant: ${tenant.farmName}`);

  await prisma.tenantCurrency.upsert({
    where: { tenantId_currency: { tenantId: tenant.id, currency: 'USD' } }, update: {},
    create: { tenantId: tenant.id, currency: 'USD', exchangeRate: 1580.00 },
  });

  await prisma.subscription.upsert({
    where: { tenantId: tenant.id }, update: {},
    create: {
      tenantId: tenant.id, planId: 'plan-founding', billingCycle: 'ANNUAL',
      currentPeriodStart: new Date('2026-01-01'),
      currentPeriodEnd:   new Date('2026-12-31'),
      status: 'ACTIVE',
    },
  });
  console.log('✓ Tenant & subscription created');

  // ============================================================
  // FARM  — now includes autoSummaryTime
  // ============================================================
  const farm = await prisma.farm.upsert({
    where: { id: 'farm-main' },
    update: { autoSummaryTime: '19:00' },
    create: {
      id: 'farm-main',
      tenantId: tenant.id,
      name: 'Green Acres Main Farm',
      location: 'Ogun State, Nigeria',
      address: '12 Farm Road, Ogun State',
      phone: '+234-801-000-0001',
      email: 'farm@greenacres.ng',
      isActive: true,
      autoSummaryTime: '19:00',
    },
  });
  console.log(`✓ Farm: ${farm.name}  (autoSummaryTime = ${farm.autoSummaryTime})`);

  // ============================================================
  // USERS  (unchanged)
  // ============================================================
  const userDefs = [
    { id: 'user-superadmin',   email: 'superadmin@poultryfarm.pro',  pw: 'super123',   firstName: 'System',      lastName: 'Admin',      role: 'SUPER_ADMIN',       farmId: null },
    { id: 'user-chair',        email: 'chair@greenacres.ng',          pw: 'chair123',   firstName: 'Chukwuemeka', lastName: 'Okafor',     role: 'CHAIRPERSON',       farmId: null },
    { id: 'user-farmadmin',    email: 'admin@greenacres.ng',          pw: 'admin123',   firstName: 'Kemi',        lastName: 'Adeyinka',   role: 'FARM_ADMIN',        farmId: null },
    { id: 'user-manager',      email: 'manager@greenacres.ng',        pw: 'manager123', firstName: 'Amina',       lastName: 'Bello',      role: 'FARM_MANAGER',      farmId: farm.id },
    { id: 'user-storemanager', email: 'store@greenacres.ng',          pw: 'store123',   firstName: 'Segun',       lastName: 'Fashola',    role: 'STORE_MANAGER',     farmId: farm.id },
    { id: 'user-millmanager',  email: 'mill@greenacres.ng',           pw: 'mill123',    firstName: 'Ibrahim',     lastName: 'Musa',       role: 'FEED_MILL_MANAGER', farmId: farm.id },
    { id: 'user-pm1',          email: 'penmanager1@greenacres.ng',    pw: 'pm123',      firstName: 'Tunde',       lastName: 'Adeyemi',    role: 'PEN_MANAGER',       farmId: farm.id },
    { id: 'user-pm2',          email: 'penmanager2@greenacres.ng',    pw: 'pm123',      firstName: 'Ngozi',       lastName: 'Eze',        role: 'PEN_MANAGER',       farmId: farm.id },
    { id: 'user-storeclerk',   email: 'clerk@greenacres.ng',          pw: 'clerk123',   firstName: 'Bola',        lastName: 'Adesanya',   role: 'STORE_CLERK',       farmId: farm.id },
    { id: 'user-qc1',          email: 'qc@greenacres.ng',             pw: 'qc123',      firstName: 'Chisom',      lastName: 'Obi',        role: 'QC_TECHNICIAN',     farmId: farm.id },
    { id: 'user-prodstaff',    email: 'prodstaff@greenacres.ng',      pw: 'staff123',   firstName: 'Yusuf',       lastName: 'Garba',      role: 'PRODUCTION_STAFF',  farmId: farm.id },
    { id: 'user-w1',           email: 'worker1@greenacres.ng',        pw: 'worker123',  firstName: 'Adewale',     lastName: 'Ogundimu',   role: 'PEN_WORKER',        farmId: farm.id },
    { id: 'user-w2',           email: 'worker2@greenacres.ng',        pw: 'worker123',  firstName: 'Chinwe',      lastName: 'Nwosu',      role: 'PEN_WORKER',        farmId: farm.id },
    { id: 'user-w3',           email: 'worker3@greenacres.ng',        pw: 'worker123',  firstName: 'Emeka',       lastName: 'Uzoma',      role: 'PEN_WORKER',        farmId: farm.id },
    { id: 'user-w4',           email: 'worker4@greenacres.ng',        pw: 'worker123',  firstName: 'Fatima',      lastName: 'Abdullahi',  role: 'PEN_WORKER',        farmId: farm.id },
  ];

  for (const u of userDefs) {
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
      update: {},
      create: {
        id: u.id, tenantId: tenant.id, farmId: u.farmId,
        email: u.email, passwordHash: hash(u.pw),
        firstName: u.firstName, lastName: u.lastName, role: u.role,
      },
    });
  }
  await prisma.farm.update({ where: { id: farm.id }, data: { managerId: 'user-manager' } });
  console.log(`✓ ${userDefs.length} users created (all 11 roles)`);

  // ============================================================
  // PENS + SECTIONS  (unchanged)
  // ============================================================
  const penDefs = [
    { id: 'pen-layer-a',   name: 'Pen 1 — Layers A',   operationType: 'LAYER',   capacity: 10000 },
    { id: 'pen-layer-b',   name: 'Pen 2 — Layers B',   operationType: 'LAYER',   capacity: 10000 },
    { id: 'pen-broiler-a', name: 'Pen 3 — Broilers A', operationType: 'BROILER', capacity: 10000 },
    { id: 'pen-broiler-b', name: 'Pen 4 — Broilers B', operationType: 'BROILER', capacity: 10000 },
  ];

  for (const p of penDefs) {
    await prisma.pen.upsert({
      where: { id: p.id }, update: {},
      create: { id: p.id, farmId: farm.id, name: p.name, operationType: p.operationType, capacity: p.capacity },
    });
    for (const sec of ['A','B','C','D']) {
      const sId = `${p.id}-s${sec.toLowerCase()}`;
      await prisma.penSection.upsert({
        where: { id: sId }, update: {},
        create: { id: sId, penId: p.id, name: `Section ${sec}`, capacity: 2500 },
      });
    }
  }
  console.log('✓ 4 pens with 16 sections created');

  // ============================================================
  // PEN WORKER ASSIGNMENTS  (unchanged)
  // ============================================================
  const assignments = [
    { userId: 'user-w1',  penSectionId: 'pen-layer-a-sa' },
    { userId: 'user-w2',  penSectionId: 'pen-layer-a-sb' },
    { userId: 'user-w3',  penSectionId: 'pen-broiler-a-sa' },
    { userId: 'user-w4',  penSectionId: 'pen-broiler-a-sb' },
    { userId: 'user-pm1', penSectionId: 'pen-layer-a-sa' },
    { userId: 'user-pm1', penSectionId: 'pen-layer-a-sb' },
    { userId: 'user-pm2', penSectionId: 'pen-broiler-a-sa' },
    { userId: 'user-pm2', penSectionId: 'pen-broiler-a-sb' },
  ];
  for (const a of assignments) {
    await prisma.penWorkerAssignment.upsert({
      where: { userId_penSectionId: { userId: a.userId, penSectionId: a.penSectionId } },
      update: {}, create: { userId: a.userId, penSectionId: a.penSectionId },
    });
  }
  console.log('✓ Worker-section assignments created');

  // ============================================================
  // STORES + SUPPLIERS  (unchanged)
  // ============================================================
  const feedStore = await prisma.store.upsert({
    where: { id: 'store-feed' }, update: {},
    create: { id: 'store-feed', farmId: farm.id, name: 'Main Feed Store', storeType: 'FEED', managerId: 'user-storemanager', location: 'Block A' },
  });
  const medStore = await prisma.store.upsert({
    where: { id: 'store-med' }, update: {},
    create: { id: 'store-med', farmId: farm.id, name: 'Medication & Vaccine Store', storeType: 'MEDICATION', managerId: 'user-storemanager', location: 'Block B' },
  });

  const supplier1 = await prisma.supplier.upsert({ where: { id: 'supplier-feeds' }, update: {}, create: { id: 'supplier-feeds', tenantId: tenant.id, name: 'Lagos Agro Feeds Ltd', supplierType: 'FEED', contactName: 'Mr. Babatunde', phone: '+234-801-234-5678', email: 'sales@lagrosfeeds.ng', address: 'Apapa, Lagos', paymentTerms: 'Net 30', rating: 4 } });
  const supplier2 = await prisma.supplier.upsert({ where: { id: 'supplier-chicks' }, update: {}, create: { id: 'supplier-chicks', tenantId: tenant.id, name: 'Ogun Hatcheries Ltd', supplierType: 'CHICKS', contactName: 'Mrs. Taiwo', phone: '+234-802-345-6789', email: 'info@ogunhatch.ng', address: 'Abeokuta, Ogun State', rating: 5 } });
  const supplier3 = await prisma.supplier.upsert({ where: { id: 'supplier-meds' }, update: {}, create: { id: 'supplier-meds', tenantId: tenant.id, name: 'VetCare Nigeria Ltd', supplierType: 'MEDICATION', contactName: 'Dr. Adeola', phone: '+234-803-456-7890', email: 'orders@vetcare.ng', paymentTerms: 'Cash', rating: 4 } });
  console.log('✓ Stores & suppliers created');

  // ============================================================
  // FEED INVENTORY  — NEW: bagWeightKg added
  // ============================================================
  const feedDefs = [
    { id: 'feed-starter',  feedType: 'Layer Starter Mash',    currentStockKg: 840,  reorderLevelKg: 1000, costPerKg: 185.00, bagWeightKg: 25 },
    { id: 'feed-grower',   feedType: 'Layer Grower Pellets',   currentStockKg: 3200, reorderLevelKg: 1500, costPerKg: 172.00, bagWeightKg: 25 },
    { id: 'feed-layer',    feedType: 'Layer Mesh',              currentStockKg: 5400, reorderLevelKg: 2000, costPerKg: 178.50, bagWeightKg: 25 },
    { id: 'feed-broiler',  feedType: 'Broiler Finisher Mash',   currentStockKg: 2800, reorderLevelKg: 1200, costPerKg: 165.00, bagWeightKg: 25 },
  ];
  for (const f of feedDefs) {
    await prisma.feedInventory.upsert({
      where: { id: f.id },
      update: { bagWeightKg: f.bagWeightKg },
      create: {
        id: f.id, storeId: feedStore.id, tenantId: tenant.id,
        feedType: f.feedType, currentStockKg: f.currentStockKg,
        reorderLevelKg: f.reorderLevelKg, costPerKg: f.costPerKg,
        bagWeightKg: f.bagWeightKg,
        currency: 'NGN', supplierId: supplier1.id,
      },
    });
  }
  console.log('✓ Feed inventory created (with bagWeightKg = 25 kg)');

  // ============================================================
  // INVENTORY ITEMS  (unchanged)
  // ============================================================
  const inventoryItems = [
    { id: 'item-ndvax',     name: 'Newcastle Disease Vaccine', category: 'VACCINE',      unit: 'doses',  currentStock: 20000, reorderLevel: 5000,  costPerUnit: 0.25  },
    { id: 'item-ibvax',     name: 'IB Vaccine (H120)',          category: 'VACCINE',      unit: 'doses',  currentStock: 15000, reorderLevel: 5000,  costPerUnit: 0.18  },
    { id: 'item-gumboro',   name: 'Gumboro IBD Vaccine',        category: 'VACCINE',      unit: 'doses',  currentStock: 12000, reorderLevel: 4000,  costPerUnit: 0.22  },
    { id: 'item-cocci',     name: 'Coccidiosis Treatment',      category: 'MEDICATION',   unit: 'litres', currentStock: 50,    reorderLevel: 10,    costPerUnit: 4500  },
    { id: 'item-disinfect', name: 'Farm Disinfectant',          category: 'DISINFECTANT', unit: 'litres', currentStock: 120,   reorderLevel: 30,    costPerUnit: 1200  },
    { id: 'item-crates',    name: 'Egg Crates (30s)',           category: 'PACKAGING',    unit: 'pieces', currentStock: 5000,  reorderLevel: 1000,  costPerUnit: 150   },
  ];
  for (const item of inventoryItems) {
    await prisma.inventoryItem.upsert({
      where: { id: item.id }, update: {},
      create: {
        id: item.id,
        storeId: (item.category === 'VACCINE' || item.category === 'MEDICATION') ? medStore.id : feedStore.id,
        tenantId: tenant.id, name: item.name, category: item.category,
        unit: item.unit, currentStock: item.currentStock, reorderLevel: item.reorderLevel,
        costPerUnit: item.costPerUnit, currency: 'NGN', supplierId: supplier3.id,
      },
    });
  }
  console.log('✓ Inventory items created');

  // ============================================================
  // FLOCKS  (unchanged)
  // ============================================================
  const flockDefs = [
    { id: 'flock-lay-1', batchCode: 'LAY-2025-001', operationType: 'LAYER',   breed: 'Isa Brown',     penSectionId: 'pen-layer-a-sa', initialCount: 2500, currentCount: 2455, dateOfPlacement: new Date('2025-08-15'), expectedLayingStartDate: new Date('2025-12-01'), purchaseCost: 3000000 },
    { id: 'flock-lay-2', batchCode: 'LAY-2025-002', operationType: 'LAYER',   breed: 'Isa Brown',     penSectionId: 'pen-layer-a-sb', initialCount: 2500, currentCount: 2468, dateOfPlacement: new Date('2025-08-15'), expectedLayingStartDate: new Date('2025-12-01'), purchaseCost: 3000000 },
    { id: 'flock-lay-3', batchCode: 'LAY-2025-003', operationType: 'LAYER',   breed: 'Lohmann Brown', penSectionId: 'pen-layer-b-sa', initialCount: 2500, currentCount: 2390, dateOfPlacement: new Date('2025-09-01'), expectedLayingStartDate: new Date('2025-12-15'), purchaseCost: 3000000 },
    { id: 'flock-lay-4', batchCode: 'LAY-2025-004', operationType: 'LAYER',   breed: 'Lohmann Brown', penSectionId: 'pen-layer-b-sb', initialCount: 2500, currentCount: 2411, dateOfPlacement: new Date('2025-09-01'), expectedLayingStartDate: new Date('2025-12-15'), purchaseCost: 3000000 },
    { id: 'flock-bro-1', batchCode: 'BRO-2026-001', operationType: 'BROILER', breed: 'Ross 308',      penSectionId: 'pen-broiler-a-sa', initialCount: 2500, currentCount: 2480, dateOfPlacement: new Date('2026-02-01'), expectedHarvestDate: daysFromNow(13), targetWeightG: 2500, targetFCR: 1.75, purchaseCost: 875000 },
    { id: 'flock-bro-2', batchCode: 'BRO-2026-002', operationType: 'BROILER', breed: 'Ross 308',      penSectionId: 'pen-broiler-a-sb', initialCount: 2500, currentCount: 2461, dateOfPlacement: new Date('2026-02-01'), expectedHarvestDate: daysFromNow(13), targetWeightG: 2500, targetFCR: 1.75, purchaseCost: 875000 },
    { id: 'flock-bro-3', batchCode: 'BRO-2026-003', operationType: 'BROILER', breed: 'Ross 308',      penSectionId: 'pen-broiler-b-sa', initialCount: 2500, currentCount: 2390, dateOfPlacement: new Date('2026-02-08'), expectedHarvestDate: daysFromNow(20), targetWeightG: 2500, targetFCR: 1.75, purchaseCost: 875000 },
    { id: 'flock-bro-4', batchCode: 'BRO-2026-004', operationType: 'BROILER', breed: 'Ross 308',      penSectionId: 'pen-broiler-b-sb', initialCount: 2500, currentCount: 2340, dateOfPlacement: new Date('2026-02-08'), expectedHarvestDate: daysFromNow(20), targetWeightG: 2500, targetFCR: 1.75, purchaseCost: 875000 },
  ];
  for (const f of flockDefs) {
    await prisma.flock.upsert({
      where: { tenantId_batchCode: { tenantId: tenant.id, batchCode: f.batchCode } },
      update: {}, create: { ...f, tenantId: tenant.id, source: 'PURCHASED', purchaseCurrency: 'NGN' },
    });
  }
  console.log(`✓ ${flockDefs.length} flocks created (4 layer, 4 broiler)`);

  const layerFlocks   = flockDefs.filter(f => f.operationType === 'LAYER');
  const broilerFlocks = flockDefs.filter(f => f.operationType === 'BROILER');

  // ============================================================
  // MORTALITY RECORDS  30 days  (unchanged)
  // ============================================================
  const causes = ['UNKNOWN','DISEASE','HEAT_STRESS','FEED_ISSUE','RESPIRATORY'];
  for (let i = 29; i >= 0; i--) {
    const date = daysAgo(i);
    for (const flock of flockDefs) {
      const count = Math.floor(Math.random() * 5) + 1;
      await prisma.mortalityRecord.create({
        data: {
          flockId: flock.id, penSectionId: flock.penSectionId,
          recordedById: flock.operationType === 'LAYER' ? 'user-w1' : 'user-w3',
          recordDate: date, count,
          causeCode: causes[Math.floor(Math.random() * causes.length)],
          submissionStatus: i > 1 ? 'APPROVED' : 'PENDING',
          approvedById: i > 1 ? 'user-pm1' : null,
          approvedAt:   i > 1 ? daysAgo(i - 1) : null,
        },
      }).catch(() => {});
    }
  }
  console.log('✓ Mortality records created (30 days)');

  // ============================================================
  // EGG PRODUCTION  — REWRITTEN for Phase 8B schema
  //
  // Two sessions per day (morning = 1, afternoon = 2):
  //   Days 2–29:  both sessions fully graded by PM  (submissionStatus APPROVED)
  //   Day 1:      morning APPROVED, afternoon PENDING (PM hasn't graded yet)
  //   Day 0 today: morning PENDING (just submitted), afternoon not yet collected
  //
  // Worker fields:  cratesCollected, looseEggs, crackedCount, collectionSession
  // PM fields:      gradeBCrates, gradeBLoose, crackedConfirmed
  // Computed:       gradeBCount, gradeACount, gradeAPct  (null until PM grades)
  // ============================================================
  for (let i = 29; i >= 0; i--) {
    const date = daysAgo(i);

    for (const flock of layerFlocks) {
      const birds = flock.currentCount;

      // ── Morning session ──────────────────────────────────────
      // ~55 % of daily total; realistic: 2455 birds × 82% rate ÷ 30 ≈ 67 crates
      const mCrates  = Math.floor(birds * 0.45 / 30);
      const mLoose   = Math.floor(Math.random() * 20) + 5;     // 5–24 loose eggs
      const mCracked = Math.floor(Math.random() * 5);           // 0–4 cracked
      const mTotal   = eggTotal(mCrates, mLoose, mCracked);

      // PM grading breakdown
      const mGBCrates = Math.floor(mCrates * 0.06);
      const mGBLoose  = Math.floor(Math.random() * 8);
      const mGradeB   = mGBCrates * 30 + mGBLoose;
      const mGradeA   = mTotal - mGradeB - mCracked;

      // Morning is APPROVED for days 1+, PENDING today (i=0)
      const mApproved = i > 0;

      await prisma.eggProduction.create({
        data: {
          flockId: flock.id, penSectionId: flock.penSectionId,
          collectionDate: date,
          collectionSession: 1,
          cratesCollected: mCrates,
          looseEggs: mLoose,
          crackedCount: mCracked,
          totalEggs: mTotal,
          layingRatePct: layingRate(mTotal, birds),
          // PM grading — set once approved
          gradeBCrates:     mApproved ? mGBCrates : null,
          gradeBLoose:      mApproved ? mGBLoose  : null,
          crackedConfirmed: mApproved ? mCracked   : null,
          gradeBCount:      mApproved ? mGradeB    : null,
          gradeACount:      mApproved ? mGradeA    : null,
          gradeAPct:        mApproved ? parseFloat(((mGradeA / mTotal) * 100).toFixed(2)) : null,
          recordedById: 'user-w1',
          submissionStatus: mApproved ? 'APPROVED' : 'PENDING',
          approvedById: mApproved ? 'user-pm1' : null,
          approvedAt:   mApproved ? daysAgo(i - 1) : null,
        },
      }).catch(() => {});

      // ── Afternoon session ────────────────────────────────────
      // Skip entirely on day 0 (not yet collected)
      if (i === 0) continue;

      const aCrates  = Math.floor(birds * 0.37 / 30);
      const aLoose   = Math.floor(Math.random() * 15) + 3;
      const aCracked = Math.floor(Math.random() * 4);
      const aTotal   = eggTotal(aCrates, aLoose, aCracked);

      const aGBCrates = Math.floor(aCrates * 0.06);
      const aGBLoose  = Math.floor(Math.random() * 6);
      const aGradeB   = aGBCrates * 30 + aGBLoose;
      const aGradeA   = aTotal - aGradeB - aCracked;

      // Afternoon on day 1 is PENDING (PM hasn't done the grading yet)
      const aApproved = i > 1;

      await prisma.eggProduction.create({
        data: {
          flockId: flock.id, penSectionId: flock.penSectionId,
          collectionDate: date,
          collectionSession: 2,
          cratesCollected: aCrates,
          looseEggs: aLoose,
          crackedCount: aCracked,
          totalEggs: aTotal,
          layingRatePct: layingRate(aTotal, birds),
          gradeBCrates:     aApproved ? aGBCrates : null,
          gradeBLoose:      aApproved ? aGBLoose  : null,
          crackedConfirmed: aApproved ? aCracked   : null,
          gradeBCount:      aApproved ? aGradeB    : null,
          gradeACount:      aApproved ? aGradeA    : null,
          gradeAPct:        aApproved ? parseFloat(((aGradeA / aTotal) * 100).toFixed(2)) : null,
          recordedById: 'user-w1',
          submissionStatus: aApproved ? 'APPROVED' : 'PENDING',
          approvedById: aApproved ? 'user-pm1' : null,
          approvedAt:   aApproved ? daysAgo(i - 1) : null,
        },
      }).catch(() => {});
    }
  }
  console.log('✓ Egg production created (30 days × 2 sessions, new crate-based schema)');
  console.log('  → Today: morning session PENDING (no grading yet)');
  console.log('  → Yesterday: morning APPROVED, afternoon PENDING grading');
  console.log('  → Days 2–29: both sessions fully graded');

  // ============================================================
  // FEED CONSUMPTION  — REWRITTEN for Phase 8B schema
  //
  // Worker fields:  bagsUsed, remainingKg, bagWeightKg (snapshot), feedTime
  // Computed:       quantityKg = (bagsUsed × bagWeightKg) + (bagWeightKg − remainingKg)
  //
  // Distribution pattern per day:
  //   07:00  Morning feed   (always)
  //   16:30  Afternoon feed (always, except today's afternoon omitted ~30% of time)
  //   13:00  Midday top-up  (20% of days — demonstrates open-ended feedTime)
  // ============================================================
  const BAG_WT = 25; // kg — matches FeedInventory.bagWeightKg

  for (let i = 29; i >= 0; i--) {
    const date = daysAgo(i);

    for (const flock of flockDefs) {
      const isLayer   = flock.operationType === 'LAYER';
      const feedId    = isLayer ? 'feed-layer' : 'feed-broiler';
      const costPerKg = isLayer ? 178.50 : 165.00;
      const workerId  = isLayer ? 'user-w1' : 'user-w3';

      // ── Morning feed (07:00) ─────────────────────────────────
      const mBags = isLayer ? 12 : 14;
      const mRem  = parseFloat((2 + Math.random() * 8).toFixed(1));   // 2–10 kg remaining
      await prisma.feedConsumption.create({
        data: {
          flockId: flock.id, penSectionId: flock.penSectionId,
          feedInventoryId: feedId, recordedDate: date,
          feedTime: atTime(date, 7, 0),
          bagsUsed: mBags, remainingKg: mRem, bagWeightKg: BAG_WT,
          quantityKg: feedQty(mBags, mRem, BAG_WT),
          gramsPerBird: parseFloat((feedQty(mBags, mRem, BAG_WT) / flock.currentCount * 1000).toFixed(1)),
          costAtTime: costPerKg, currency: 'NGN',
          recordedById: workerId,
          submissionStatus: i > 1 ? 'APPROVED' : 'PENDING',
          approvedById: i > 1 ? 'user-pm1' : null,
          approvedAt:   i > 1 ? daysAgo(i - 1) : null,
        },
      }).catch(() => {});

      // ── Afternoon feed (16:30) ───────────────────────────────
      // Skip today's afternoon ~30 % of the time to simulate "not yet done"
      const skipAfternoon = (i === 0 && Math.random() < 0.3);
      if (!skipAfternoon) {
        const aBags = isLayer ? 10 : 12;
        const aRem  = parseFloat((1 + Math.random() * 6).toFixed(1));
        await prisma.feedConsumption.create({
          data: {
            flockId: flock.id, penSectionId: flock.penSectionId,
            feedInventoryId: feedId, recordedDate: date,
            feedTime: atTime(date, 16, 30),
            bagsUsed: aBags, remainingKg: aRem, bagWeightKg: BAG_WT,
            quantityKg: feedQty(aBags, aRem, BAG_WT),
            gramsPerBird: parseFloat((feedQty(aBags, aRem, BAG_WT) / flock.currentCount * 1000).toFixed(1)),
            costAtTime: costPerKg, currency: 'NGN',
            recordedById: workerId,
            submissionStatus: i > 1 ? 'APPROVED' : 'PENDING',
            approvedById: i > 1 ? 'user-pm1' : null,
            approvedAt:   i > 1 ? daysAgo(i - 1) : null,
          },
        }).catch(() => {});
      }

      // ── Midday top-up (13:00) — ~20 % of days ───────────────
      // Demonstrates that feedTime is open-ended (not just 2 fixed batches)
      if (i > 0 && Math.random() < 0.20) {
        const tBags = 4;
        const tRem  = parseFloat((1 + Math.random() * 5).toFixed(1));
        await prisma.feedConsumption.create({
          data: {
            flockId: flock.id, penSectionId: flock.penSectionId,
            feedInventoryId: feedId, recordedDate: date,
            feedTime: atTime(date, 13, 0),
            bagsUsed: tBags, remainingKg: tRem, bagWeightKg: BAG_WT,
            quantityKg: feedQty(tBags, tRem, BAG_WT),
            gramsPerBird: parseFloat((feedQty(tBags, tRem, BAG_WT) / flock.currentCount * 1000).toFixed(1)),
            costAtTime: costPerKg, currency: 'NGN',
            recordedById: workerId,
            submissionStatus: 'APPROVED',
            approvedById: 'user-pm1',
            approvedAt: daysAgo(i - 1),
          },
        }).catch(() => {});
      }
    }
  }
  console.log('✓ Feed consumption created (30 days, bag-based formula, 2–3 distributions/day)');
  console.log('  → formula: (bagsUsed × 25 kg) + (25 − remainingKg)');

  // ============================================================
  // WEIGHT RECORDS  (broilers — unchanged)
  // ============================================================
  const weightByAge = { 7: 220, 14: 550, 21: 1020, 28: 1580, 35: 2080, 42: 2450 };
  for (const flock of broilerFlocks) {
    const placeDays = Math.floor((today - flock.dateOfPlacement) / 86400000);
    const agePoints = Object.keys(weightByAge).map(Number).filter(a => a <= placeDays);
    for (const age of agePoints) {
      const baseW = weightByAge[age];
      const avg   = baseW + Math.floor(Math.random() * 80) - 40;
      await prisma.weightRecord.create({
        data: {
          flockId: flock.id, penSectionId: flock.penSectionId,
          recordDate: new Date(flock.dateOfPlacement.getTime() + age * 86400000),
          ageInDays: age, sampleSize: 50,
          avgWeightG: avg, minWeightG: avg - 120, maxWeightG: avg + 140,
          uniformityPct: 85 + Math.random() * 10,
          recordedById: 'user-w3',
        },
      }).catch(() => {});
    }
  }
  console.log('✓ Broiler weight records created');

  // ============================================================
  // WEIGHT SAMPLES  (broilers — feeds /api/weight-samples & broiler performance page)
  // WeightSample = worker-submitted weigh-in record (distinct from WeightRecord which
  // is the dashboard-summary model). We create weekly samples from placement date.
  // ============================================================
  for (const flock of broilerFlocks) {
    const placeDays = Math.floor((today - flock.dateOfPlacement) / 86400000);
    const sampleAges = Object.keys(weightByAge).map(Number).filter(a => a <= placeDays);
    let prevMeanG    = null;
    let prevDate     = null;

    for (const age of sampleAges) {
      const baseW       = weightByAge[age];
      const meanWeightG = baseW + Math.floor(Math.random() * 60) - 30;
      const sampleDate  = new Date(flock.dateOfPlacement.getTime() + age * 86400000);

      // Estimate FCR: ~110 g feed/bird/day; divide by weight gain per bird
      let estimatedFCR = null;
      if (prevMeanG && prevDate) {
        const gainPerBird = meanWeightG - prevMeanG;
        const days        = Math.max(1, Math.round((sampleDate - prevDate) / 86400000));
        const totalFeedKg = flock.currentCount * 0.110 * days;
        const totalGainKg = (gainPerBird / 1000) * flock.currentCount;
        if (totalGainKg > 0) estimatedFCR = parseFloat((totalFeedKg / totalGainKg).toFixed(2));
      }

      const worker = flock.penSectionId.includes('pen-broiler-a') ? 'user-w3' : 'user-w4';

      await prisma.weightSample.create({
        data: {
          tenantId:      tenant.id,
          flockId:       flock.id,
          penSectionId:  flock.penSectionId,
          sampleDate,
          sampleCount:   50,
          meanWeightG,
          minWeightG:    meanWeightG - 110,
          maxWeightG:    meanWeightG + 130,
          uniformityPct: parseFloat((84 + Math.random() * 12).toFixed(1)),
          estimatedFCR,
          recordedById:  worker,
        },
      }).catch(() => {});  // idempotent — skip if already exists

      prevMeanG = meanWeightG;
      prevDate  = sampleDate;
    }
  }
  console.log('✓ Weight samples created (broiler performance page)');


  // ============================================================
  // WATER METER READINGS  — NEW in Phase 8B
  //
  // Odometer-style: meterReading is a cumulative value.
  // consumptionL = today's reading − yesterday's reading (null for oldest row).
  // consumptionLPB = consumptionL / currentBirdCount
  // Unique constraint: one reading per (penSectionId, readingDate)
  // ============================================================
  const waterSections = [
    { sectionId: 'pen-layer-a-sa',   flockId: 'flock-lay-1', birds: 2455, baseReading: 142500, lpbBase: 0.31 },
    { sectionId: 'pen-layer-a-sb',   flockId: 'flock-lay-2', birds: 2468, baseReading: 138200, lpbBase: 0.30 },
    { sectionId: 'pen-broiler-a-sa', flockId: 'flock-bro-1', birds: 2480, baseReading:  95400, lpbBase: 0.26 },
    { sectionId: 'pen-broiler-a-sb', flockId: 'flock-bro-2', birds: 2461, baseReading:  91800, lpbBase: 0.25 },
  ];

  for (const ws of waterSections) {
    // Build 8 readings (day 7 → day 0) so every day has a prior reading for delta calc
    let meterValue = ws.baseReading;
    const readings = [];

    for (let i = 7; i >= 0; i--) {
      const dailyConsumption = parseFloat((ws.birds * ws.lpbBase * (0.88 + Math.random() * 0.24)).toFixed(1));
      meterValue = parseFloat((meterValue + dailyConsumption).toFixed(1));
      readings.push({ i, date: daysAgo(i), meterValue, dailyConsumption });
    }

    for (const r of readings) {
      await prisma.waterMeterReading.upsert({
        where: { penSectionId_readingDate: { penSectionId: ws.sectionId, readingDate: r.date } },
        update: {},
        create: {
          tenantId: tenant.id,
          penSectionId: ws.sectionId,
          flockId: ws.flockId,
          readingDate: r.date,
          meterReading: r.meterValue,
          // consumptionL is null for the oldest reading (no prior reading to diff against)
          consumptionL:   r.i < 7 ? r.dailyConsumption : null,
          consumptionLPB: r.i < 7 ? parseFloat((r.dailyConsumption / ws.birds).toFixed(4)) : null,
          recordedById: ws.sectionId.includes('layer') ? 'user-w1' : 'user-w3',
        },
      }).catch(() => {});
    }
  }
  console.log('✓ Water meter readings created (8 days, 4 sections, odometer format)');

  // ============================================================
  // DAILY SUMMARIES  — NEW in Phase 8B
  //
  // Status flow: PENDING → SUBMITTED → REVIEWED / FLAGGED
  // Days 3–4:  REVIEWED (PM signed off)
  // Day 2:     SUBMITTED (submitted, not yet reviewed)
  // Day 1:     SUBMITTED (some pending verifications flagged)
  // Day 0:     PENDING (auto-submit hasn't fired yet — it's before 19:00)
  // ============================================================
  const summaryFlocks = layerFlocks.slice(0, 2); // pen-layer-a-sa and pen-layer-a-sb

  for (let i = 4; i >= 0; i--) {
    const date = daysAgo(i);

    for (const flock of summaryFlocks) {
      let status, submittedAt, reviewedById, reviewedAt, pendingEgg, pendingFeed;

      if (i >= 3) {
        status = 'REVIEWED'; submittedAt = daysAgo(i); reviewedById = 'user-pm1'; reviewedAt = daysAgo(i - 1);
        pendingEgg = 0; pendingFeed = 0;
      } else if (i === 2) {
        status = 'SUBMITTED'; submittedAt = daysAgo(i); reviewedById = null; reviewedAt = null;
        pendingEgg = 0; pendingFeed = 0;
      } else if (i === 1) {
        // Yesterday: afternoon egg session still pending PM grading
        status = 'SUBMITTED'; submittedAt = daysAgo(i); reviewedById = null; reviewedAt = null;
        pendingEgg = 1; pendingFeed = 0;  // 1 egg record awaiting Grade B entry
      } else {
        // Today: auto-submit hasn't fired yet
        status = 'PENDING'; submittedAt = null; reviewedById = null; reviewedAt = null;
        pendingEgg = 1; pendingFeed = 0;  // morning egg record PENDING
      }

      const approxEggs = Math.floor(flock.currentCount * 0.82);
      const approxFeed = parseFloat((flock.currentCount * 0.125 * 2).toFixed(1)); // 2 feeds

      await prisma.dailySummary.upsert({
        where: { penSectionId_summaryDate: { penSectionId: flock.penSectionId, summaryDate: date } },
        update: {},
        create: {
          tenantId: tenant.id,
          farmId: farm.id,
          penSectionId: flock.penSectionId,
          summaryDate: date,
          status,
          submittedAt,
          // Aggregates
          totalEggsCollected: approxEggs,
          totalFeedKg: approxFeed,
          totalMortality: Math.floor(Math.random() * 4),
          waterConsumptionL: parseFloat((flock.currentCount * 0.30).toFixed(1)),
          // Cleaning checklist
          waterNipplesChecked:  true,
          manureBeltsRun:       true,
          aislesSwept:          i > 0 ? true : null,   // today not yet done
          cageDoorsInspected:   true,
          // Observation
          closingObservation: i === 0
            ? 'Slight reduction in water intake noted in Section A. Will monitor.'
            : null,
          // Pending verification counts
          pendingEggVerifications:  pendingEgg,
          pendingFeedVerifications: pendingFeed,
          pendingMortalityVerifications: 0,
          // PM review
          reviewedById,
          reviewedAt,
          reviewNotes: (i >= 3) ? 'All records verified. Good performance.' : null,
        },
      }).catch(() => {});
    }
  }
  console.log('✓ Daily summaries created (5 days, mixed statuses)');
  console.log('  → Today: PENDING (before auto-submit time)');
  console.log('  → Yesterday + day before: SUBMITTED (1 pending egg grading)');
  console.log('  → Days 3–4: REVIEWED');

  // ============================================================
  // DAILY REPORTS  (legacy model — kept for compat, unchanged)
  // ============================================================
  for (let i = 4; i >= 0; i--) {
    const date = daysAgo(i);
    for (const flock of summaryFlocks) {
      await prisma.dailyReport.upsert({
        where: { penSectionId_reportDate: { penSectionId: flock.penSectionId, reportDate: date } },
        update: {}, create: {
          farmId: farm.id, penSectionId: flock.penSectionId, flockId: flock.id,
          reportDate: date, operationType: 'LAYER',
          totalMortality: Math.floor(Math.random() * 4),
          totalFeedKg: parseFloat((flock.currentCount * 0.125).toFixed(1)),
          totalEggs: Math.floor(flock.currentCount * 0.82),
          layingRatePct: 82.0,
          observations: i === 0 ? 'Noticed slight reduction in water intake in Section A. Monitoring.' : null,
          submittedById: 'user-w1', submittedAt: date,
          status: i > 1 ? 'APPROVED' : 'PENDING',
          approvedById: i > 1 ? 'user-pm1' : null,
          approvedAt: i > 1 ? daysAgo(i - 1) : null,
        },
      });
    }
  }
  console.log('✓ Daily reports created (legacy model)');

  // ============================================================
  // VACCINATIONS  (unchanged)
  // ============================================================
  await prisma.vaccination.createMany({
    skipDuplicates: true,
    data: [
      { flockId: 'flock-lay-1', vaccineName: 'Newcastle Disease',           scheduledDate: daysFromNow(1),  status: 'SCHEDULED', nextDueDate: daysFromNow(91) },
      { flockId: 'flock-lay-2', vaccineName: 'Infectious Bronchitis (H120)', scheduledDate: daysAgo(3),      status: 'OVERDUE' },
      { flockId: 'flock-lay-3', vaccineName: "Marek's Disease",             scheduledDate: daysAgo(7),      administeredDate: daysAgo(7), administeredById: 'user-w2', status: 'COMPLETED', batchNumber: 'MRK-2026-009', withdrawalDays: 0 },
      { flockId: 'flock-lay-4', vaccineName: 'Fowl Pox',                    scheduledDate: daysFromNow(14), status: 'SCHEDULED' },
      { flockId: 'flock-bro-1', vaccineName: 'Gumboro (IBD)',               scheduledDate: daysFromNow(5),  status: 'SCHEDULED' },
      { flockId: 'flock-bro-2', vaccineName: 'Newcastle Disease (La Sota)', scheduledDate: daysAgo(2),      status: 'OVERDUE' },
      { flockId: 'flock-bro-3', vaccineName: 'Infectious Bronchitis',       scheduledDate: daysFromNow(8),  status: 'SCHEDULED' },
    ],
  });
  console.log('✓ Vaccinations created');

  // ============================================================
  // HEALTH OBSERVATIONS  (unchanged)
  // ============================================================
  await prisma.healthObservation.createMany({
    skipDuplicates: true,
    data: [
      { flockId: 'flock-lay-1', penSectionId: 'pen-layer-a-sa', observedById: 'user-w1', observationDate: daysAgo(2), symptomCodes: ['REDUCED_FEED_INTAKE','LETHARGY'], severity: 'MILD', affectedCount: 12, diagnosis: 'Possible heat stress', action: 'Increased ventilation and water supply', followUpDate: daysFromNow(1) },
      { flockId: 'flock-bro-1', penSectionId: 'pen-broiler-a-sa', observedById: 'user-w3', observationDate: daysAgo(5), symptomCodes: ['RESPIRATORY_SOUNDS','NASAL_DISCHARGE'], severity: 'MODERATE', affectedCount: 8, diagnosis: 'Suspected IB — vet notified', action: 'Isolation of affected birds, medication started', resolvedAt: daysAgo(1) },
    ],
  });
  console.log('✓ Health observations created');

  // ============================================================
  // TASKS  — updated to reflect today's full workflow for user-w1
  // ============================================================
  const taskDefs = [
    // user-w1 (Layer Sec A) — today's workflow, mixed statuses
    { id: 'task-1',  assignedToId: 'user-w1', penSectionId: 'pen-layer-a-sa', taskType: 'INSPECTION',     title: 'Read water meter — Section A',           dueDate: today, status: 'COMPLETED', priority: 'HIGH'   },
    { id: 'task-2',  assignedToId: 'user-w1', penSectionId: 'pen-layer-a-sa', taskType: 'FEEDING',        title: 'Morning feed distribution — Section A',  dueDate: today, status: 'COMPLETED', priority: 'HIGH'   },
    { id: 'task-3',  assignedToId: 'user-w1', penSectionId: 'pen-layer-a-sa', taskType: 'EGG_COLLECTION', title: 'Morning egg collection — Section A',      dueDate: today, status: 'COMPLETED', priority: 'HIGH'   },
    { id: 'task-4',  assignedToId: 'user-w1', penSectionId: 'pen-layer-a-sa', taskType: 'MORTALITY_CHECK',title: 'Mortality check — Section A',             dueDate: today, status: 'COMPLETED', priority: 'NORMAL' },
    { id: 'task-5',  assignedToId: 'user-w1', penSectionId: 'pen-layer-a-sa', taskType: 'CLEANING',       title: 'Clean nipples, manure belts, aisles',    dueDate: today, status: 'IN_PROGRESS', priority: 'NORMAL' },
    { id: 'task-6',  assignedToId: 'user-w1', penSectionId: 'pen-layer-a-sa', taskType: 'FEEDING',        title: 'Afternoon feed distribution — Section A',dueDate: today, status: 'PENDING',    priority: 'HIGH'   },
    { id: 'task-7',  assignedToId: 'user-w1', penSectionId: 'pen-layer-a-sa', taskType: 'EGG_COLLECTION', title: 'Afternoon egg collection — Section A',    dueDate: today, status: 'PENDING',    priority: 'HIGH'   },
    // user-w2 (Layer Sec B)
    { id: 'task-8',  assignedToId: 'user-w2', penSectionId: 'pen-layer-a-sb', taskType: 'EGG_COLLECTION', title: 'Morning egg collection — Section B',      dueDate: today, status: 'COMPLETED', priority: 'HIGH'   },
    { id: 'task-9',  assignedToId: 'user-w2', penSectionId: 'pen-layer-a-sb', taskType: 'MORTALITY_CHECK',title: 'Daily mortality check — Section B',       dueDate: today, status: 'PENDING',    priority: 'NORMAL' },
    // user-w3 (Broiler Sec A)
    { id: 'task-10', assignedToId: 'user-w3', penSectionId: 'pen-broiler-a-sa', taskType: 'WEIGHT_RECORDING', title: 'Weekly weight sampling (50 birds)',   dueDate: today, status: 'IN_PROGRESS', priority: 'NORMAL' },
    { id: 'task-11', assignedToId: 'user-w3', penSectionId: 'pen-broiler-a-sa', taskType: 'FEEDING',      title: 'Morning feed — Broiler A',               dueDate: today, status: 'COMPLETED', priority: 'HIGH'   },
    // user-w4 (Broiler Sec B)
    { id: 'task-12', assignedToId: 'user-w4', penSectionId: 'pen-broiler-a-sb', taskType: 'FEEDING',      title: 'Afternoon feed — Broiler B',              dueDate: today, status: 'PENDING',    priority: 'HIGH'   },
    // Upcoming
    { id: 'task-13', assignedToId: 'user-w1', penSectionId: 'pen-layer-a-sa', taskType: 'VACCINATION',    title: 'Newcastle Disease vaccination due',       dueDate: daysFromNow(1), status: 'PENDING', priority: 'HIGH' },
    { id: 'task-14', assignedToId: 'user-w2', penSectionId: 'pen-layer-b-sb', taskType: 'CLEANING',       title: 'Weekly deep clean — Section B',           dueDate: daysFromNow(2), status: 'PENDING', priority: 'NORMAL' },
  ];
  for (const t of taskDefs) {
    await prisma.task.upsert({
      where: { id: t.id }, update: {},
      create: {
        ...t, tenantId: tenant.id, createdById: 'user-pm1',
        completedAt: t.status === 'COMPLETED' ? today : null,
      },
    });
  }
  console.log(`✓ ${taskDefs.length} tasks created (full today-workflow for user-w1)`);

  // ============================================================
  // CUSTOMERS  (unchanged)
  // ============================================================
  await prisma.customer.createMany({
    skipDuplicates: true,
    data: [
      { id: 'cust-1', tenantId: tenant.id, customerType: 'B2B',      name: 'Shoprite Nigeria Ltd',       companyName: 'Shoprite',   contactName: 'Mrs. Adunola',  phone: '+234-805-111-2222', email: 'procurement@shoprite.ng', creditLimit: 5000000,  paymentTerms: 'Net 30', currency: 'NGN' },
      { id: 'cust-2', tenantId: tenant.id, customerType: 'B2B',      name: 'Lagos Market Distributors',  companyName: 'LMD',        contactName: 'Mr. Chidi',     phone: '+234-806-222-3333', creditLimit: 2000000,  paymentTerms: 'Net 7',  currency: 'NGN' },
      { id: 'cust-3', tenantId: tenant.id, customerType: 'OFFTAKER',  name: 'FeedMaster Processing Co.', companyName: 'FeedMaster', contactName: 'Mr. Abubakar',  phone: '+234-807-333-4444', email: 'buy@feedmaster.ng', creditLimit: 10000000, paymentTerms: 'Net 14', currency: 'NGN' },
      { id: 'cust-4', tenantId: tenant.id, customerType: 'B2C',       name: 'Mama Titi',                 contactName: 'Mrs. Titilola Akande', phone: '+234-808-444-5555', currency: 'NGN' },
      { id: 'cust-5', tenantId: tenant.id, customerType: 'B2C',       name: 'Mr. Emmanuel Osei',         phone: '+234-809-555-6666', currency: 'NGN' },
    ],
  });
  console.log('✓ Customers created');

  // ============================================================
  // SALES ORDERS  (unchanged)
  // ============================================================
  await prisma.salesOrder.upsert({
    where: { tenantId_orderNumber: { tenantId: tenant.id, orderNumber: 'SO-2026-001' } },
    update: {}, create: { id: 'so-1', tenantId: tenant.id, orderNumber: 'SO-2026-001', customerId: 'cust-1', soldById: 'user-manager', orderDate: daysAgo(5), deliveryDate: daysAgo(3), orderType: 'CREDIT_SALE', status: 'DELIVERED', subtotal: 720000, taxAmount: 0, totalAmount: 720000, currency: 'NGN', paymentStatus: 'UNPAID', notes: 'Weekly egg supply — 240 crates Grade A' },
  });
  await prisma.salesOrderItem.upsert({
    where: { id: 'soi-1' }, update: {},
    create: { id: 'soi-1', salesOrderId: 'so-1', productType: 'EGGS', flockId: 'flock-lay-1', description: 'Grade A Eggs', quantity: 240, unit: 'crates', unitPrice: 3000, totalPrice: 720000, eggGrade: 'A' },
  });
  await prisma.salesOrder.upsert({
    where: { tenantId_orderNumber: { tenantId: tenant.id, orderNumber: 'SO-2026-002' } },
    update: {}, create: { id: 'so-2', tenantId: tenant.id, orderNumber: 'SO-2026-002', customerId: 'cust-4', soldById: 'user-w1', orderDate: daysAgo(2), orderType: 'CASH_SALE', status: 'COMPLETED', subtotal: 9000, taxAmount: 0, totalAmount: 9000, currency: 'NGN', paymentStatus: 'PAID' },
  });
  await prisma.salesOrderItem.upsert({
    where: { id: 'soi-2' }, update: {},
    create: { id: 'soi-2', salesOrderId: 'so-2', productType: 'EGGS', description: 'Mixed grade eggs', quantity: 3, unit: 'crates', unitPrice: 3000, totalPrice: 9000 },
  });
  console.log('✓ Sales orders created');

  // ============================================================
  // PURCHASE ORDERS + PAYMENTS  (unchanged)
  // ============================================================
  await prisma.purchaseOrder.upsert({
    where: { tenantId_poNumber: { tenantId: tenant.id, poNumber: 'PO-2026-001' } },
    update: {}, create: { id: 'po-1', tenantId: tenant.id, poNumber: 'PO-2026-001', supplierId: 'supplier-feeds', createdById: 'user-manager', approvedById: 'user-chair', approvedAt: daysAgo(8), orderDate: daysAgo(10), expectedDelivery: daysAgo(3), actualDelivery: daysAgo(3), status: 'FULLY_RECEIVED', subtotal: 1780000, taxAmount: 0, totalAmount: 1780000, currency: 'NGN', paymentStatus: 'PAID', notes: 'Monthly feed restock — 10,000kg layer mesh' },
  });
  await prisma.pOLineItem.upsert({
    where: { id: 'poli-1' }, update: {},
    create: { id: 'poli-1', purchaseOrderId: 'po-1', description: 'Layer Mesh', quantity: 10000, unit: 'kg', unitPrice: 178.00, totalPrice: 1780000, receivedQty: 10000 },
  });
  await prisma.payment.createMany({
    skipDuplicates: true,
    data: [
      { id: 'pay-1', tenantId: tenant.id, paymentDate: daysAgo(3), direction: 'OUTFLOW', amount: 1780000, currency: 'NGN', paymentMethod: 'BANK_TRANSFER', purchaseOrderId: 'po-1', description: 'Payment for PO-2026-001 — Feed supply', recordedById: 'user-manager' },
      { id: 'pay-2', tenantId: tenant.id, paymentDate: daysAgo(2), direction: 'INFLOW',  amount: 9000,    currency: 'NGN', paymentMethod: 'CASH',           salesOrderId:    'so-2', description: 'Cash sale SO-2026-002',                   recordedById: 'user-w1' },
    ],
  });
  console.log('✓ Purchase orders & payments created');

  // ============================================================
  // PRODUCTION TARGETS  (unchanged)
  // ============================================================
  await prisma.productionTarget.createMany({
    skipDuplicates: true,
    data: [
      { farmId: farm.id, operationType: 'LAYER',   targetPeriod: '2026-Q1', targetLayingRatePct: 82.0, targetEggsPerDay: 8000, targetMortalityPct: 0.5 },
      { farmId: farm.id, operationType: 'BROILER', targetPeriod: '2026-Q1', targetWeightG: 2500, targetFCR: 1.75, targetDaysToHarvest: 42, targetGPD: 58.0 },
    ],
  });
  console.log('✓ Production targets created');

  // ============================================================
  // ALERT RULES  (unchanged)
  // ============================================================
  await prisma.alertRule.createMany({
    skipDuplicates: true,
    data: [
      { tenantId: tenant.id, name: 'High Daily Mortality',     module: 'pen_ops',    metric: 'daily_mortality_count', operator: 'gt', threshold: 20,  severity: 'WARNING',  notifyRoles: ['PEN_MANAGER','FARM_MANAGER'] },
      { tenantId: tenant.id, name: 'Critical Mortality Spike', module: 'pen_ops',    metric: 'daily_mortality_count', operator: 'gt', threshold: 50,  severity: 'CRITICAL', notifyRoles: ['FARM_MANAGER','CHAIRPERSON','STORE_MANAGER'] },
      { tenantId: tenant.id, name: 'Low Laying Rate',          module: 'layer_ops',  metric: 'laying_rate_pct',       operator: 'lt', threshold: 70,  severity: 'WARNING',  notifyRoles: ['PEN_MANAGER','FARM_MANAGER'] },
      { tenantId: tenant.id, name: 'Feed Stock Critical',      module: 'feed',       metric: 'days_remaining',        operator: 'lt', threshold: 7,   severity: 'CRITICAL', notifyRoles: ['STORE_MANAGER','FARM_MANAGER','CHAIRPERSON'] },
      { tenantId: tenant.id, name: 'Poor FCR',                 module: 'broiler_ops',metric: 'current_fcr',           operator: 'gt', threshold: 2.2, severity: 'WARNING',  notifyRoles: ['PEN_MANAGER','FARM_MANAGER'] },
      { tenantId: tenant.id, name: 'Overdue Vaccination',      module: 'health',     metric: 'overdue_vaccinations',  operator: 'gt', threshold: 0,   severity: 'WARNING',  notifyRoles: ['PEN_MANAGER','FARM_MANAGER'] },
    ],
  });
  console.log('✓ Alert rules created');

  // ============================================================
  // NOTIFICATIONS  — updated to include Phase 8B alerts
  // ============================================================
  await prisma.notification.createMany({
    skipDuplicates: true,
    data: [
      { tenantId: tenant.id, recipientId: 'user-pm1',          type: 'ALERT',            title: 'Overdue Vaccination',            message: 'IB Vaccine for LAY-2025-002 is 3 days overdue. Please schedule immediately.',                channel: 'IN_APP' },
      { tenantId: tenant.id, recipientId: 'user-manager',      type: 'REPORT_SUBMITTED', title: 'Daily Report Submitted',         message: 'Worker Adewale submitted daily report for Pen 1 Section A.',                                 data: { penSectionId: 'pen-layer-a-sa' }, channel: 'IN_APP' },
      { tenantId: tenant.id, recipientId: 'user-storemanager', type: 'LOW_STOCK',         title: 'Layer Starter Mash Running Low', message: 'Layer Starter Mash is at 840 kg — below reorder level of 1,000 kg.',                        channel: 'IN_APP' },
      { tenantId: tenant.id, recipientId: 'user-pm1',          type: 'TASK_OVERDUE',      title: 'Pending Egg Grading',            message: 'Afternoon egg collection for LAY-2025-001 is awaiting your Grade B count.',                  channel: 'IN_APP' },
      { tenantId: tenant.id, recipientId: 'user-pm1',          type: 'ALERT',             title: 'Daily Summary Pending Review',   message: '2 daily summaries submitted yesterday are awaiting your review.',                            channel: 'IN_APP' },
    ],
  });
  console.log('✓ Notifications created');

  // ============================================================
  // AUDIT LOG  (unchanged + one Phase 8B entry)
  // ============================================================
  await prisma.auditLog.createMany({
    skipDuplicates: true,
    data: [
      { tenantId: tenant.id, userId: 'user-farmadmin', action: 'CREATE', entityType: 'User',          entityId: 'user-w1',            changes: { after: { role: 'PEN_WORKER', email: 'worker1@greenacres.ng' } } },
      { tenantId: tenant.id, userId: 'user-manager',   action: 'APPROVE',entityType: 'DailyReport',   entityId: 'daily-report-1',     changes: { status: 'APPROVED' } },
      { tenantId: tenant.id, userId: 'user-chair',     action: 'APPROVE',entityType: 'PurchaseOrder', entityId: 'po-1',               changes: { status: 'APPROVED', amount: 1780000 } },
      { tenantId: tenant.id, userId: 'user-pm1',       action: 'APPROVE',entityType: 'EggProduction', entityId: 'graded-example',     changes: { gradeBCrates: 5, gradeBLoose: 3, gradeACount: 1814, gradeAPct: 92.4 } },
    ],
  });
  console.log('✓ Audit logs created');

  // ============================================================
  // STAFF PROFILES  (unchanged)
  // ============================================================
  const staffProfiles = [
    { userId: 'user-manager',      employeeId: 'EMP-001', dateOfJoining: new Date('2023-01-15'), baseSalary: 450000, contractType: 'PERMANENT', department: 'Operations' },
    { userId: 'user-pm1',          employeeId: 'EMP-002', dateOfJoining: new Date('2023-03-01'), baseSalary: 280000, contractType: 'PERMANENT', department: 'Pen Operations' },
    { userId: 'user-pm2',          employeeId: 'EMP-003', dateOfJoining: new Date('2023-03-01'), baseSalary: 280000, contractType: 'PERMANENT', department: 'Pen Operations' },
    { userId: 'user-w1',           employeeId: 'EMP-004', dateOfJoining: new Date('2024-01-10'), baseSalary: 85000,  contractType: 'PERMANENT', department: 'Pen Operations' },
    { userId: 'user-w2',           employeeId: 'EMP-005', dateOfJoining: new Date('2024-01-10'), baseSalary: 85000,  contractType: 'PERMANENT', department: 'Pen Operations' },
    { userId: 'user-w3',           employeeId: 'EMP-006', dateOfJoining: new Date('2024-02-01'), baseSalary: 85000,  contractType: 'PERMANENT', department: 'Pen Operations' },
    { userId: 'user-w4',           employeeId: 'EMP-007', dateOfJoining: new Date('2024-02-01'), baseSalary: 85000,  contractType: 'PERMANENT', department: 'Pen Operations' },
    { userId: 'user-storemanager', employeeId: 'EMP-008', dateOfJoining: new Date('2023-06-01'), baseSalary: 250000, contractType: 'PERMANENT', department: 'Store' },
  ];
  for (const sp of staffProfiles) {
    await prisma.staffProfile.upsert({
      where: { userId: sp.userId }, update: {},
      create: { ...sp, currency: 'NGN' },
    });
  }
  console.log(`✓ ${staffProfiles.length} staff profiles created`);

  // ============================================================
  // FEED MILL BATCH + QC  (unchanged)
  // ============================================================
  const millBatch = await prisma.feedMillBatch.upsert({
    where: { tenantId_batchCode: { tenantId: tenant.id, batchCode: 'FMB-2026-001' } },
    update: {}, create: {
      tenantId: tenant.id, farmId: farm.id, batchCode: 'FMB-2026-001',
      targetQuantityKg: 5000, actualQuantityKg: 4980,
      productionDate: daysAgo(3), status: 'QC_PASSED',
      producedById: 'user-prodstaff', qcStatus: 'PASSED',
      qcCertifiedById: 'user-qc1', qcCertifiedAt: daysAgo(2),
      costPerKg: 155.00, notes: 'Broiler Finisher batch for March 2026',
    },
  });
  await prisma.qCTest.create({ data: { feedMillBatchId: millBatch.id, testType: 'Crude Protein', testedById: 'user-qc1', testDate: daysAgo(2), result: '20.3%', passedSpec: true, specMin: 18.0, specMax: 22.0 } }).catch(() => {});
  await prisma.qCTest.create({ data: { feedMillBatchId: millBatch.id, testType: 'Moisture',       testedById: 'user-qc1', testDate: daysAgo(2), result: '11.2%', passedSpec: true, specMin: 0,    specMax: 13.0 } }).catch(() => {});
  console.log('✓ Feed mill batch & QC tests created');

  // ============================================================
  // ASSETS  (unchanged)
  // ============================================================
  await prisma.asset.createMany({
    skipDuplicates: true,
    data: [
      { id: 'asset-gen',   tenantId: tenant.id, farmId: farm.id, assetCode: 'AST-001', name: 'Main Generator (100KVA)',         category: 'GENERATOR',      location: 'Power House', purchaseDate: new Date('2023-06-01'), purchaseCost: 3500000, currency: 'NGN', depreciationRate: 20, status: 'ACTIVE' },
      { id: 'asset-scale', tenantId: tenant.id, farmId: farm.id, assetCode: 'AST-002', name: 'Digital Weighing Scale',          category: 'WEIGHING_SCALE', location: 'Store',       purchaseDate: new Date('2024-01-15'), purchaseCost: 85000,   currency: 'NGN', status: 'ACTIVE' },
      { id: 'asset-vent',  tenantId: tenant.id, farmId: farm.id, assetCode: 'AST-003', name: 'Ventilation Fan System (Pen 1)', category: 'VENTILATION',    location: 'Pen 1',       purchaseDate: new Date('2023-01-10'), purchaseCost: 450000,  currency: 'NGN', status: 'UNDER_MAINTENANCE' },
    ],
  });
  console.log('✓ Assets created');

  // ============================================================
  // DONE
  // ============================================================
  console.log('\n✅ Seed v2.1 complete!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  LOGIN CREDENTIALS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Chairperson:    chair@greenacres.ng           / chair123');
  console.log('  Farm Admin:     admin@greenacres.ng            / admin123');
  console.log('  Farm Manager:   manager@greenacres.ng          / manager123');
  console.log('  Store Manager:  store@greenacres.ng            / store123');
  console.log('  Feed Mill Mgr:  mill@greenacres.ng             / mill123');
  console.log('  Pen Manager 1:  penmanager1@greenacres.ng      / pm123   → Layer Pen');
  console.log('  Pen Manager 2:  penmanager2@greenacres.ng      / pm123   → Broiler Pen');
  console.log('  Store Clerk:    clerk@greenacres.ng            / clerk123');
  console.log('  QC Technician:  qc@greenacres.ng               / qc123');
  console.log('  Pen Worker 1:   worker1@greenacres.ng          / worker123  → Layer Sec A');
  console.log('  Pen Worker 2:   worker2@greenacres.ng          / worker123  → Layer Sec B');
  console.log('  Pen Worker 3:   worker3@greenacres.ng          / worker123  → Broiler Sec A');
  console.log('  Pen Worker 4:   worker4@greenacres.ng          / worker123  → Broiler Sec B');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  PHASE 8B TEST SCENARIOS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Egg grading:');
  console.log('    Today       → morning session PENDING  (gradeA/B null — PM not graded yet)');
  console.log('    Yesterday   → morning APPROVED, afternoon PENDING grading');
  console.log('    Days 2–29   → both sessions fully graded (gradeA/B/Pct populated)');
  console.log('  Feed logs:');
  console.log('    Every day   → morning (07:00) + afternoon (16:30) distributions');
  console.log('    ~20% days   → extra midday top-up (13:00) — tests open-ended feedTime');
  console.log('    Formula     → quantityKg = (bagsUsed × 25) + (25 − remainingKg)');
  console.log('  Water meter:');
  console.log('    8 readings per section, oldest has consumptionL = null (no prior day)');
  console.log('    Sections: pen-layer-a-sa/sb, pen-broiler-a-sa/sb');
  console.log('  Daily summaries:');
  console.log('    Today       → PENDING  (before 19:00 auto-submit)');
  console.log('    Yesterday   → SUBMITTED, 1 pending egg grading');
  console.log('    Day before  → SUBMITTED, clean');
  console.log('    Days 3–4    → REVIEWED by PM');
  console.log('  Worker 1 tasks today: 4 COMPLETED, 1 IN_PROGRESS, 2 PENDING');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
