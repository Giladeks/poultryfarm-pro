// prisma/seed.js — Full seed for PoultryFarm Pro v2.0 (all 16 modules)
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const hash = (pw) => bcrypt.hashSync(pw, 10);
const today = new Date();
const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
const daysFromNow = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };

async function main() {
  console.log('🌱 Seeding PoultryFarm Pro v2.0...\n');

  // ============================================================
  // PLANS
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
  // TENANT — Green Acres Poultry Farm
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

  // Currency config
  await prisma.tenantCurrency.upsert({
    where: { tenantId_currency: { tenantId: tenant.id, currency: 'USD' } }, update: {},
    create: { tenantId: tenant.id, currency: 'USD', exchangeRate: 1580.00 },
  });

  // Subscription
  await prisma.subscription.upsert({
    where: { tenantId: tenant.id }, update: {},
    create: {
      tenantId: tenant.id, planId: 'plan-founding', billingCycle: 'ANNUAL',
      currentPeriodStart: new Date('2026-01-01'),
      currentPeriodEnd: new Date('2026-12-31'),
      status: 'ACTIVE',
    },
  });
  console.log('✓ Subscription created');

  // ============================================================
  // FARM
  // ============================================================
  const farm = await prisma.farm.upsert({
    where: { id: 'farm-main' }, update: {},
    create: {
      id: 'farm-main',
      tenantId: tenant.id,
      name: 'Green Acres Main Farm',
      location: 'Ogun State, Nigeria',
      address: '12 Farm Road, Ogun State',
      phone: '+234-801-000-0001',
      email: 'farm@greenacres.ng',
      isActive: true,
    },
  });
  console.log(`✓ Farm: ${farm.name}`);

  // ============================================================
  // USERS (all 11 roles)
  // ============================================================
  const userDefs = [
    // Platform
    { id: 'user-superadmin', email: 'superadmin@poultryfarm.pro', pw: 'super123',    firstName: 'System',      lastName: 'Admin',      role: 'SUPER_ADMIN',      farmId: null },
    // Org level
    { id: 'user-chair',      email: 'chair@greenacres.ng',        pw: 'chair123',    firstName: 'Chukwuemeka', lastName: 'Okafor',     role: 'CHAIRPERSON',      farmId: null },
    // Farm admin
    { id: 'user-farmadmin',  email: 'admin@greenacres.ng',        pw: 'admin123',    firstName: 'Kemi',        lastName: 'Adeyinka',   role: 'FARM_ADMIN',       farmId: null },
    // Operations
    { id: 'user-manager',    email: 'manager@greenacres.ng',      pw: 'manager123',  firstName: 'Amina',       lastName: 'Bello',      role: 'FARM_MANAGER',     farmId: farm.id },
    { id: 'user-storemanager', email: 'store@greenacres.ng',      pw: 'store123',    firstName: 'Segun',       lastName: 'Fashola',    role: 'STORE_MANAGER',    farmId: farm.id },
    { id: 'user-millmanager',  email: 'mill@greenacres.ng',       pw: 'mill123',     firstName: 'Ibrahim',     lastName: 'Musa',       role: 'FEED_MILL_MANAGER',farmId: farm.id },
    { id: 'user-pm1',        email: 'penmanager1@greenacres.ng',  pw: 'pm123',       firstName: 'Tunde',       lastName: 'Adeyemi',    role: 'PEN_MANAGER',      farmId: farm.id },
    { id: 'user-pm2',        email: 'penmanager2@greenacres.ng',  pw: 'pm123',       firstName: 'Ngozi',       lastName: 'Eze',        role: 'PEN_MANAGER',      farmId: farm.id },
    // Staff
    { id: 'user-storeclerk', email: 'clerk@greenacres.ng',        pw: 'clerk123',    firstName: 'Bola',        lastName: 'Adesanya',   role: 'STORE_CLERK',      farmId: farm.id },
    { id: 'user-qc1',        email: 'qc@greenacres.ng',           pw: 'qc123',       firstName: 'Chisom',      lastName: 'Obi',        role: 'QC_TECHNICIAN',    farmId: farm.id },
    { id: 'user-prodstaff',  email: 'prodstaff@greenacres.ng',    pw: 'staff123',    firstName: 'Yusuf',       lastName: 'Garba',      role: 'PRODUCTION_STAFF', farmId: farm.id },
    { id: 'user-w1',         email: 'worker1@greenacres.ng',      pw: 'worker123',   firstName: 'Adewale',     lastName: 'Ogundimu',   role: 'PEN_WORKER',       farmId: farm.id },
    { id: 'user-w2',         email: 'worker2@greenacres.ng',      pw: 'worker123',   firstName: 'Chinwe',      lastName: 'Nwosu',      role: 'PEN_WORKER',       farmId: farm.id },
    { id: 'user-w3',         email: 'worker3@greenacres.ng',      pw: 'worker123',   firstName: 'Emeka',       lastName: 'Uzoma',      role: 'PEN_WORKER',       farmId: farm.id },
    { id: 'user-w4',         email: 'worker4@greenacres.ng',      pw: 'worker123',   firstName: 'Fatima',      lastName: 'Abdullahi',  role: 'PEN_WORKER',       farmId: farm.id },
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
  console.log(`✓ ${userDefs.length} users created (all 11 roles)`);

  // Update farm managerId
  await prisma.farm.update({ where: { id: farm.id }, data: { managerId: 'user-manager' } });

  // ============================================================
  // PENS — Separated Layer / Broiler
  // ============================================================
  const penDefs = [
    { id: 'pen-layer-a', name: 'Pen 1 — Layers A', operationType: 'LAYER',   capacity: 10000 },
    { id: 'pen-layer-b', name: 'Pen 2 — Layers B', operationType: 'LAYER',   capacity: 10000 },
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
  // PEN WORKER ASSIGNMENTS
  // ============================================================
  const assignments = [
    // Pen workers — each worker owns exactly ONE section
    { id: 'asn-1',    userId: 'user-w1',  penSectionId: 'pen-layer-a-sa' },
    { id: 'asn-2',    userId: 'user-w2',  penSectionId: 'pen-layer-a-sb' },
    { id: 'asn-3',    userId: 'user-w3',  penSectionId: 'pen-broiler-a-sa' },
    { id: 'asn-4',    userId: 'user-w4',  penSectionId: 'pen-broiler-a-sb' },
    // Pen manager 1 — manages Pen 1 (Layer A) + Pen 3 (Broiler A)
    // Pen managers — each manages exactly ONE pen (both sections within it)
    { id: 'asn-pm1-a', userId: 'user-pm1', penSectionId: 'pen-layer-a-sa' },
    { id: 'asn-pm1-b', userId: 'user-pm1', penSectionId: 'pen-layer-a-sb' },
    { id: 'asn-pm2-a', userId: 'user-pm2', penSectionId: 'pen-broiler-a-sa' },
    { id: 'asn-pm2-b', userId: 'user-pm2', penSectionId: 'pen-broiler-a-sb' },
  for (const a of assignments) {
    await prisma.penWorkerAssignment.upsert({
      where: { userId_penSectionId: { userId: a.userId, penSectionId: a.penSectionId } },
      update: {}, create: { userId: a.userId, penSectionId: a.penSectionId },
    });
  }
  console.log('✓ Worker-section assignments created');

  // ============================================================
  // STORE
  // ============================================================
  const feedStore = await prisma.store.upsert({
    where: { id: 'store-feed' }, update: {},
    create: {
      id: 'store-feed', farmId: farm.id, name: 'Main Feed Store',
      storeType: 'FEED', managerId: 'user-storemanager', location: 'Block A',
    },
  });
  const medStore = await prisma.store.upsert({
    where: { id: 'store-med' }, update: {},
    create: {
      id: 'store-med', farmId: farm.id, name: 'Medication & Vaccine Store',
      storeType: 'MEDICATION', managerId: 'user-storemanager', location: 'Block B',
    },
  });
  console.log('✓ Stores created');

  // ============================================================
  // SUPPLIERS
  // ============================================================
  const supplier1 = await prisma.supplier.upsert({
    where: { id: 'supplier-feeds' }, update: {},
    create: {
      id: 'supplier-feeds', tenantId: tenant.id, name: 'Lagos Agro Feeds Ltd',
      supplierType: 'FEED', contactName: 'Mr. Babatunde', phone: '+234-801-234-5678',
      email: 'sales@lagrosfeeds.ng', address: 'Apapa, Lagos', paymentTerms: 'Net 30', rating: 4,
    },
  });
  const supplier2 = await prisma.supplier.upsert({
    where: { id: 'supplier-chicks' }, update: {},
    create: {
      id: 'supplier-chicks', tenantId: tenant.id, name: 'Ogun Hatcheries Ltd',
      supplierType: 'CHICKS', contactName: 'Mrs. Taiwo', phone: '+234-802-345-6789',
      email: 'info@ogunhatch.ng', address: 'Abeokuta, Ogun State', rating: 5,
    },
  });
  const supplier3 = await prisma.supplier.upsert({
    where: { id: 'supplier-meds' }, update: {},
    create: {
      id: 'supplier-meds', tenantId: tenant.id, name: 'VetCare Nigeria Ltd',
      supplierType: 'MEDICATION', contactName: 'Dr. Adeola', phone: '+234-803-456-7890',
      email: 'orders@vetcare.ng', paymentTerms: 'Cash', rating: 4,
    },
  });
  console.log('✓ Suppliers created');

  // ============================================================
  // FEED INVENTORY
  // ============================================================
  const feedDefs = [
    { id: 'feed-starter',  feedType: 'Layer Starter Mash',   currentStockKg: 840,  reorderLevelKg: 1000, costPerKg: 185.00 },
    { id: 'feed-grower',   feedType: 'Layer Grower Pellets',  currentStockKg: 3200, reorderLevelKg: 1500, costPerKg: 172.00 },
    { id: 'feed-layer',    feedType: 'Layer Mesh',            currentStockKg: 5400, reorderLevelKg: 2000, costPerKg: 178.50 },
    { id: 'feed-broiler',  feedType: 'Broiler Finisher Mash', currentStockKg: 2800, reorderLevelKg: 1200, costPerKg: 165.00 },
  ];
  for (const f of feedDefs) {
    await prisma.feedInventory.upsert({
      where: { id: f.id }, update: {},
      create: {
        id: f.id, storeId: feedStore.id, tenantId: tenant.id,
        feedType: f.feedType, currentStockKg: f.currentStockKg,
        reorderLevelKg: f.reorderLevelKg, costPerKg: f.costPerKg,
        currency: 'NGN', supplierId: supplier1.id,
      },
    });
  }
  console.log('✓ Feed inventory created');

  // ============================================================
  // INVENTORY ITEMS (medications & vaccines)
  // ============================================================
  const inventoryItems = [
    { id: 'item-ndvax',   name: 'Newcastle Disease Vaccine', category: 'VACCINE',     unit: 'doses',  currentStock: 20000, reorderLevel: 5000,  costPerUnit: 0.25 },
    { id: 'item-ibvax',   name: 'IB Vaccine (H120)',         category: 'VACCINE',     unit: 'doses',  currentStock: 15000, reorderLevel: 5000,  costPerUnit: 0.18 },
    { id: 'item-gumboro', name: 'Gumboro IBD Vaccine',       category: 'VACCINE',     unit: 'doses',  currentStock: 12000, reorderLevel: 4000,  costPerUnit: 0.22 },
    { id: 'item-cocci',   name: 'Coccidiosis Treatment',     category: 'MEDICATION',  unit: 'litres', currentStock: 50,    reorderLevel: 10,    costPerUnit: 4500 },
    { id: 'item-disinfect', name: 'Farm Disinfectant',       category: 'DISINFECTANT',unit: 'litres', currentStock: 120,   reorderLevel: 30,    costPerUnit: 1200 },
    { id: 'item-crates',  name: 'Egg Crates (30s)',          category: 'PACKAGING',   unit: 'pieces', currentStock: 5000,  reorderLevel: 1000,  costPerUnit: 150 },
  ];
  for (const item of inventoryItems) {
    await prisma.inventoryItem.upsert({
      where: { id: item.id }, update: {},
      create: {
        id: item.id, storeId: item.category === 'VACCINE' || item.category === 'MEDICATION' ? medStore.id : feedStore.id,
        tenantId: tenant.id, name: item.name, category: item.category,
        unit: item.unit, currentStock: item.currentStock, reorderLevel: item.reorderLevel,
        costPerUnit: item.costPerUnit, currency: 'NGN', supplierId: supplier3.id,
      },
    });
  }
  console.log('✓ Inventory items created');

  // ============================================================
  // FLOCKS — Layer and Broiler separated
  // ============================================================
  const flockDefs = [
    // Layers
    {
      id: 'flock-lay-1', batchCode: 'LAY-2025-001', operationType: 'LAYER', breed: 'Isa Brown',
      penSectionId: 'pen-layer-a-sa', initialCount: 2500, currentCount: 2455,
      dateOfPlacement: new Date('2025-08-15'), expectedLayingStartDate: new Date('2025-12-01'),
      purchaseCost: 3000000,
    },
    {
      id: 'flock-lay-2', batchCode: 'LAY-2025-002', operationType: 'LAYER', breed: 'Isa Brown',
      penSectionId: 'pen-layer-a-sb', initialCount: 2500, currentCount: 2468,
      dateOfPlacement: new Date('2025-08-15'), expectedLayingStartDate: new Date('2025-12-01'),
      purchaseCost: 3000000,
    },
    {
      id: 'flock-lay-3', batchCode: 'LAY-2025-003', operationType: 'LAYER', breed: 'Lohmann Brown',
      penSectionId: 'pen-layer-b-sa', initialCount: 2500, currentCount: 2390,
      dateOfPlacement: new Date('2025-09-01'), expectedLayingStartDate: new Date('2025-12-15'),
      purchaseCost: 3000000,
    },
    {
      id: 'flock-lay-4', batchCode: 'LAY-2025-004', operationType: 'LAYER', breed: 'Lohmann Brown',
      penSectionId: 'pen-layer-b-sb', initialCount: 2500, currentCount: 2411,
      dateOfPlacement: new Date('2025-09-01'), expectedLayingStartDate: new Date('2025-12-15'),
      purchaseCost: 3000000,
    },
    // Broilers
    {
      id: 'flock-bro-1', batchCode: 'BRO-2026-001', operationType: 'BROILER', breed: 'Ross 308',
      penSectionId: 'pen-broiler-a-sa', initialCount: 2500, currentCount: 2480,
      dateOfPlacement: new Date('2026-02-01'), expectedHarvestDate: daysFromNow(13),
      targetWeightG: 2500, targetFCR: 1.75, purchaseCost: 875000,
    },
    {
      id: 'flock-bro-2', batchCode: 'BRO-2026-002', operationType: 'BROILER', breed: 'Ross 308',
      penSectionId: 'pen-broiler-a-sb', initialCount: 2500, currentCount: 2461,
      dateOfPlacement: new Date('2026-02-01'), expectedHarvestDate: daysFromNow(13),
      targetWeightG: 2500, targetFCR: 1.75, purchaseCost: 875000,
    },
    {
      id: 'flock-bro-3', batchCode: 'BRO-2026-003', operationType: 'BROILER', breed: 'Ross 308',
      penSectionId: 'pen-broiler-b-sa', initialCount: 2500, currentCount: 2390,
      dateOfPlacement: new Date('2026-02-08'), expectedHarvestDate: daysFromNow(20),
      targetWeightG: 2500, targetFCR: 1.75, purchaseCost: 875000,
    },
    {
      id: 'flock-bro-4', batchCode: 'BRO-2026-004', operationType: 'BROILER', breed: 'Ross 308',
      penSectionId: 'pen-broiler-b-sb', initialCount: 2500, currentCount: 2340,
      dateOfPlacement: new Date('2026-02-08'), expectedHarvestDate: daysFromNow(20),
      targetWeightG: 2500, targetFCR: 1.75, purchaseCost: 875000,
    },
  ];

  for (const f of flockDefs) {
    await prisma.flock.upsert({
      where: { tenantId_batchCode: { tenantId: tenant.id, batchCode: f.batchCode } },
      update: {}, create: { ...f, tenantId: tenant.id, source: 'PURCHASED', purchaseCurrency: 'NGN' },
    });
  }
  console.log(`✓ ${flockDefs.length} flocks created (4 layer, 4 broiler)`);

  // ============================================================
  // 30 DAYS MORTALITY RECORDS
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
          approvedAt: i > 1 ? daysAgo(i - 1) : null,
        },
      }).catch(() => {});
    }
  }
  console.log('✓ Mortality records created (30 days)');

  // ============================================================
  // 30 DAYS EGG PRODUCTION (layers only)
  // ============================================================
  const layerFlocks = flockDefs.filter(f => f.operationType === 'LAYER');
  for (let i = 29; i >= 0; i--) {
    const date = daysAgo(i);
    for (const flock of layerFlocks) {
      const total = Math.floor(flock.currentCount * (0.78 + Math.random() * 0.1));
      const gradeA = Math.floor(total * 0.88);
      const gradeB = Math.floor(total * 0.07);
      const dirty  = Math.floor(total * 0.02);
      const cracked = total - gradeA - gradeB - dirty;
      await prisma.eggProduction.create({
        data: {
          flockId: flock.id, penSectionId: flock.penSectionId,
          collectionDate: date, totalEggs: total,
          gradeACount: gradeA, gradeBCount: gradeB,
          crackedCount: cracked < 0 ? 0 : cracked, dirtyCount: dirty,
          layingRatePct: parseFloat(((total / flock.currentCount) * 100).toFixed(2)),
          cratesCount: Math.floor(total / 30),
          recordedById: 'user-w1',
          submissionStatus: i > 1 ? 'APPROVED' : 'PENDING',
          approvedById: i > 1 ? 'user-pm1' : null,
          approvedAt: i > 1 ? daysAgo(i - 1) : null,
        },
      }).catch(() => {});
    }
  }
  console.log('✓ Egg production records created (30 days)');

  // ============================================================
  // WEIGHT RECORDS (broilers — weekly)
  // ============================================================
  const broilerFlocks = flockDefs.filter(f => f.operationType === 'BROILER');
  const weightByAge = { 7:220, 14:550, 21:1020, 28:1580, 35:2080, 42:2450 };
  for (const flock of broilerFlocks) {
    const placeDays = Math.floor((today - flock.dateOfPlacement) / 86400000);
    const agePoints = Object.keys(weightByAge).map(Number).filter(a => a <= placeDays);
    for (const age of agePoints) {
      const baseW = weightByAge[age];
      const avg = baseW + Math.floor(Math.random() * 80) - 40;
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
  // FEED CONSUMPTION (30 days)
  // ============================================================
  for (let i = 29; i >= 0; i--) {
    const date = daysAgo(i);
    for (const flock of flockDefs) {
      const feedId = flock.operationType === 'LAYER' ? 'feed-layer' : 'feed-broiler';
      const costPerKg = flock.operationType === 'LAYER' ? 178.50 : 165.00;
      const kgPerBird = flock.operationType === 'LAYER' ? 0.125 : 0.145;
      const qty = parseFloat((flock.currentCount * kgPerBird * (0.95 + Math.random() * 0.1)).toFixed(1));
      await prisma.feedConsumption.create({
        data: {
          flockId: flock.id, penSectionId: flock.penSectionId,
          feedInventoryId: feedId, recordedDate: date,
          quantityKg: qty, gramsPerBird: kgPerBird * 1000,
          costAtTime: costPerKg, currency: 'NGN',
          recordedById: flock.operationType === 'LAYER' ? 'user-w1' : 'user-w3',
        },
      }).catch(() => {});
    }
  }
  console.log('✓ Feed consumption records created (30 days)');

  // ============================================================
  // DAILY REPORTS (last 5 days pending approval)
  // ============================================================
  for (let i = 4; i >= 0; i--) {
    const date = daysAgo(i);
    for (const flock of layerFlocks.slice(0, 2)) {
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
          submittedById: 'user-w1',
          submittedAt: date,
          status: i > 1 ? 'APPROVED' : 'PENDING',
          approvedById: i > 1 ? 'user-pm1' : null,
          approvedAt: i > 1 ? daysAgo(i - 1) : null,
        },
      });
    }
  }
  console.log('✓ Daily reports created');

  // ============================================================
  // VACCINATIONS
  // ============================================================
  await prisma.vaccination.createMany({
    skipDuplicates: true,
    data: [
      { flockId: 'flock-lay-1', vaccineName: 'Newcastle Disease', scheduledDate: daysFromNow(1), status: 'SCHEDULED', nextDueDate: daysFromNow(91) },
      { flockId: 'flock-lay-2', vaccineName: 'Infectious Bronchitis (H120)', scheduledDate: daysAgo(3), status: 'OVERDUE' },
      { flockId: 'flock-lay-3', vaccineName: "Marek's Disease", scheduledDate: daysAgo(7), administeredDate: daysAgo(7), administeredById: 'user-w2', status: 'COMPLETED', batchNumber: 'MRK-2026-009', withdrawalDays: 0 },
      { flockId: 'flock-lay-4', vaccineName: 'Fowl Pox', scheduledDate: daysFromNow(14), status: 'SCHEDULED' },
      { flockId: 'flock-bro-1', vaccineName: 'Gumboro (IBD)', scheduledDate: daysFromNow(5), status: 'SCHEDULED' },
      { flockId: 'flock-bro-2', vaccineName: 'Newcastle Disease (La Sota)', scheduledDate: daysAgo(2), status: 'OVERDUE' },
      { flockId: 'flock-bro-3', vaccineName: 'Infectious Bronchitis', scheduledDate: daysFromNow(8), status: 'SCHEDULED' },
    ],
  });
  console.log('✓ Vaccinations created');

  // ============================================================
  // HEALTH OBSERVATIONS
  // ============================================================
  await prisma.healthObservation.createMany({
    skipDuplicates: true,
    data: [
      {
        flockId: 'flock-lay-1', penSectionId: 'pen-layer-a-sa', observedById: 'user-w1',
        observationDate: daysAgo(2), symptomCodes: ['REDUCED_FEED_INTAKE','LETHARGY'],
        severity: 'MILD', affectedCount: 12,
        diagnosis: 'Possible heat stress', action: 'Increased ventilation and water supply',
        followUpDate: daysFromNow(1),
      },
      {
        flockId: 'flock-bro-1', penSectionId: 'pen-broiler-a-sa', observedById: 'user-w3',
        observationDate: daysAgo(5), symptomCodes: ['RESPIRATORY_SOUNDS','NASAL_DISCHARGE'],
        severity: 'MODERATE', affectedCount: 8,
        diagnosis: 'Suspected IB — vet notified', action: 'Isolation of affected birds, medication started',
        resolvedAt: daysAgo(1),
      },
    ],
  });
  console.log('✓ Health observations created');

  // ============================================================
  // TASKS
  // ============================================================
  const taskDefs = [
    { id: 'task-1', assignedToId: 'user-w1', penSectionId: 'pen-layer-a-sa', taskType: 'EGG_COLLECTION', title: 'Morning egg collection — Section A', dueDate: today, status: 'PENDING', priority: 'HIGH' },
    { id: 'task-2', assignedToId: 'user-w1', penSectionId: 'pen-layer-a-sb', taskType: 'FEEDING', title: 'Morning feed distribution — Section B', dueDate: today, status: 'COMPLETED', priority: 'HIGH' },
    { id: 'task-3', assignedToId: 'user-w2', penSectionId: 'pen-layer-b-sa', taskType: 'MORTALITY_CHECK', title: 'Daily mortality check & count', dueDate: today, status: 'PENDING', priority: 'NORMAL' },
    { id: 'task-4', assignedToId: 'user-w3', penSectionId: 'pen-broiler-a-sa', taskType: 'WEIGHT_RECORDING', title: 'Weekly weight sampling (50 birds)', dueDate: today, status: 'IN_PROGRESS', priority: 'NORMAL' },
    { id: 'task-5', assignedToId: 'user-w4', penSectionId: 'pen-broiler-b-sa', taskType: 'FEEDING', title: 'Afternoon feed distribution', dueDate: today, status: 'PENDING', priority: 'HIGH' },
    { id: 'task-6', assignedToId: 'user-w3', penSectionId: 'pen-broiler-a-sb', taskType: 'VACCINATION', title: 'IBD Vaccination — BRO-2026-001', dueDate: daysFromNow(5), status: 'PENDING', priority: 'HIGH' },
    { id: 'task-7', assignedToId: 'user-w1', penSectionId: 'pen-layer-a-sa', taskType: 'REPORT_SUBMISSION', title: 'Submit daily production report', dueDate: daysAgo(1), status: 'OVERDUE', priority: 'URGENT' },
    { id: 'task-8', assignedToId: 'user-w2', penSectionId: 'pen-layer-b-sb', taskType: 'CLEANING', title: 'Weekly deep clean — Section B', dueDate: daysFromNow(2), status: 'PENDING', priority: 'NORMAL' },
  ];
  for (const t of taskDefs) {
    await prisma.task.upsert({
      where: { id: t.id }, update: {}, create: {
        ...t, tenantId: tenant.id, createdById: 'user-pm1',
        completedAt: t.status === 'COMPLETED' ? daysAgo(0) : null,
      },
    });
  }
  console.log(`✓ ${taskDefs.length} tasks created`);

  // ============================================================
  // CUSTOMERS
  // ============================================================
  await prisma.customer.createMany({
    skipDuplicates: true,
    data: [
      { id: 'cust-1', tenantId: tenant.id, customerType: 'B2B', name: 'Shoprite Nigeria Ltd', companyName: 'Shoprite', contactName: 'Mrs. Adunola', phone: '+234-805-111-2222', email: 'procurement@shoprite.ng', creditLimit: 5000000, paymentTerms: 'Net 30', currency: 'NGN' },
      { id: 'cust-2', tenantId: tenant.id, customerType: 'B2B', name: 'Lagos Market Distributors', companyName: 'LMD', contactName: 'Mr. Chidi', phone: '+234-806-222-3333', creditLimit: 2000000, paymentTerms: 'Net 7', currency: 'NGN' },
      { id: 'cust-3', tenantId: tenant.id, customerType: 'OFFTAKER', name: 'FeedMaster Processing Co.', companyName: 'FeedMaster', contactName: 'Mr. Abubakar', phone: '+234-807-333-4444', email: 'buy@feedmaster.ng', creditLimit: 10000000, paymentTerms: 'Net 14', currency: 'NGN' },
      { id: 'cust-4', tenantId: tenant.id, customerType: 'B2C', name: 'Mama Titi', contactName: 'Mrs. Titilola Akande', phone: '+234-808-444-5555', currency: 'NGN' },
      { id: 'cust-5', tenantId: tenant.id, customerType: 'B2C', name: 'Mr. Emmanuel Osei', phone: '+234-809-555-6666', currency: 'NGN' },
    ],
  });
  console.log('✓ Customers created');

  // ============================================================
  // SALES ORDERS
  // ============================================================
  const salesOrder1 = await prisma.salesOrder.upsert({
    where: { tenantId_orderNumber: { tenantId: tenant.id, orderNumber: 'SO-2026-001' } },
    update: {}, create: {
      id: 'so-1', tenantId: tenant.id, orderNumber: 'SO-2026-001',
      customerId: 'cust-1', soldById: 'user-manager',
      orderDate: daysAgo(5), deliveryDate: daysAgo(3),
      orderType: 'CREDIT_SALE', status: 'DELIVERED',
      subtotal: 720000, taxAmount: 0, totalAmount: 720000,
      currency: 'NGN', paymentStatus: 'UNPAID',
      notes: 'Weekly egg supply — 240 crates Grade A',
    },
  });
  await prisma.salesOrderItem.upsert({
    where: { id: 'soi-1' }, update: {},
    create: {
      id: 'soi-1', salesOrderId: 'so-1', productType: 'EGGS',
      flockId: 'flock-lay-1', description: 'Grade A Eggs',
      quantity: 240, unit: 'crates', unitPrice: 3000, totalPrice: 720000, eggGrade: 'A',
    },
  });

  const salesOrder2 = await prisma.salesOrder.upsert({
    where: { tenantId_orderNumber: { tenantId: tenant.id, orderNumber: 'SO-2026-002' } },
    update: {}, create: {
      id: 'so-2', tenantId: tenant.id, orderNumber: 'SO-2026-002',
      customerId: 'cust-4', soldById: 'user-w1',
      orderDate: daysAgo(2), orderType: 'CASH_SALE', status: 'COMPLETED',
      subtotal: 9000, taxAmount: 0, totalAmount: 9000,
      currency: 'NGN', paymentStatus: 'PAID',
    },
  });
  await prisma.salesOrderItem.upsert({
    where: { id: 'soi-2' }, update: {},
    create: {
      id: 'soi-2', salesOrderId: 'so-2', productType: 'EGGS',
      description: 'Mixed grade eggs', quantity: 3, unit: 'crates', unitPrice: 3000, totalPrice: 9000,
    },
  });
  console.log('✓ Sales orders created');

  // ============================================================
  // PURCHASE ORDERS
  // ============================================================
  const po1 = await prisma.purchaseOrder.upsert({
    where: { tenantId_poNumber: { tenantId: tenant.id, poNumber: 'PO-2026-001' } },
    update: {}, create: {
      id: 'po-1', tenantId: tenant.id, poNumber: 'PO-2026-001',
      supplierId: 'supplier-feeds', createdById: 'user-manager',
      approvedById: 'user-chair', approvedAt: daysAgo(8),
      orderDate: daysAgo(10), expectedDelivery: daysAgo(3), actualDelivery: daysAgo(3),
      status: 'FULLY_RECEIVED', subtotal: 1780000, taxAmount: 0,
      totalAmount: 1780000, currency: 'NGN', paymentStatus: 'PAID',
      notes: 'Monthly feed restock — 10,000kg layer mesh',
    },
  });
  await prisma.pOLineItem.upsert({
    where: { id: 'poli-1' }, update: {},
    create: {
      id: 'poli-1', purchaseOrderId: 'po-1', description: 'Layer Mesh',
      quantity: 10000, unit: 'kg', unitPrice: 178.00, totalPrice: 1780000, receivedQty: 10000,
    },
  });
  console.log('✓ Purchase orders created');

  // ============================================================
  // PAYMENTS
  // ============================================================
  await prisma.payment.createMany({
    skipDuplicates: true,
    data: [
      { id: 'pay-1', tenantId: tenant.id, paymentDate: daysAgo(3), direction: 'OUTFLOW', amount: 1780000, currency: 'NGN', paymentMethod: 'BANK_TRANSFER', purchaseOrderId: 'po-1', description: 'Payment for PO-2026-001 — Feed supply', recordedById: 'user-manager' },
      { id: 'pay-2', tenantId: tenant.id, paymentDate: daysAgo(2), direction: 'INFLOW', amount: 9000, currency: 'NGN', paymentMethod: 'CASH', salesOrderId: 'so-2', description: 'Cash sale SO-2026-002', recordedById: 'user-w1' },
    ],
  });
  console.log('✓ Payments created');

  // ============================================================
  // PRODUCTION TARGETS
  // ============================================================
  await prisma.productionTarget.createMany({
    skipDuplicates: true,
    data: [
      {
        farmId: farm.id, operationType: 'LAYER', targetPeriod: '2026-Q1',
        targetLayingRatePct: 82.0, targetEggsPerDay: 8000,
        targetMortalityPct: 0.5,
      },
      {
        farmId: farm.id, operationType: 'BROILER', targetPeriod: '2026-Q1',
        targetWeightG: 2500, targetFCR: 1.75,
        targetDaysToHarvest: 42, targetGPD: 58.0,
      },
    ],
  });
  console.log('✓ Production targets created');

  // ============================================================
  // ALERT RULES
  // ============================================================
  await prisma.alertRule.createMany({
    skipDuplicates: true,
    data: [
      { tenantId: tenant.id, name: 'High Daily Mortality', module: 'pen_ops', metric: 'daily_mortality_count', operator: 'gt', threshold: 20, severity: 'WARNING', notifyRoles: ['PEN_MANAGER','FARM_MANAGER'] },
      { tenantId: tenant.id, name: 'Critical Mortality Spike', module: 'pen_ops', metric: 'daily_mortality_count', operator: 'gt', threshold: 50, severity: 'CRITICAL', notifyRoles: ['FARM_MANAGER','CHAIRPERSON','STORE_MANAGER'] },
      { tenantId: tenant.id, name: 'Low Laying Rate', module: 'layer_ops', metric: 'laying_rate_pct', operator: 'lt', threshold: 70, severity: 'WARNING', notifyRoles: ['PEN_MANAGER','FARM_MANAGER'] },
      { tenantId: tenant.id, name: 'Feed Stock Critical', module: 'feed', metric: 'days_remaining', operator: 'lt', threshold: 7, severity: 'CRITICAL', notifyRoles: ['STORE_MANAGER','FARM_MANAGER','CHAIRPERSON'] },
      { tenantId: tenant.id, name: 'Poor FCR', module: 'broiler_ops', metric: 'current_fcr', operator: 'gt', threshold: 2.2, severity: 'WARNING', notifyRoles: ['PEN_MANAGER','FARM_MANAGER'] },
      { tenantId: tenant.id, name: 'Overdue Vaccination', module: 'health', metric: 'overdue_vaccinations', operator: 'gt', threshold: 0, severity: 'WARNING', notifyRoles: ['PEN_MANAGER','FARM_MANAGER'] },
    ],
  });
  console.log('✓ Alert rules created');

  // ============================================================
  // NOTIFICATIONS (sample)
  // ============================================================
  await prisma.notification.createMany({
    skipDuplicates: true,
    data: [
      { tenantId: tenant.id, recipientId: 'user-pm1', type: 'ALERT', title: 'Overdue Vaccination', message: 'IB Vaccine for LAY-2025-002 is 3 days overdue. Please schedule immediately.', channel: 'IN_APP' },
      { tenantId: tenant.id, recipientId: 'user-manager', type: 'REPORT_SUBMITTED', title: 'Daily Report Submitted', message: 'Worker Adewale submitted daily report for Pen 1 Section A.', data: { penSectionId: 'pen-layer-a-sa' }, channel: 'IN_APP' },
      { tenantId: tenant.id, recipientId: 'user-storemanager', type: 'LOW_STOCK', title: 'Layer Starter Mash Running Low', message: 'Layer Starter Mash is at 840kg — below reorder level of 1,000kg.', channel: 'IN_APP' },
      { tenantId: tenant.id, recipientId: 'user-pm1', type: 'TASK_OVERDUE', title: 'Task Overdue', message: 'Adewale has an overdue task: Submit daily production report.', channel: 'IN_APP' },
    ],
  });
  console.log('✓ Notifications created');

  // ============================================================
  // AUDIT LOG (sample entries)
  // ============================================================
  await prisma.auditLog.createMany({
    skipDuplicates: true,
    data: [
      { tenantId: tenant.id, userId: 'user-farmadmin', action: 'CREATE', entityType: 'User', entityId: 'user-w1', changes: { after: { role: 'PEN_WORKER', email: 'worker1@greenacres.ng' } } },
      { tenantId: tenant.id, userId: 'user-manager', action: 'APPROVE', entityType: 'DailyReport', entityId: 'daily-report-1', changes: { status: 'APPROVED' } },
      { tenantId: tenant.id, userId: 'user-chair', action: 'APPROVE', entityType: 'PurchaseOrder', entityId: 'po-1', changes: { status: 'APPROVED', amount: 1780000 } },
    ],
  });
  console.log('✓ Audit logs created');

  // ============================================================
  // STAFF PROFILES (for key users)
  // ============================================================
  const staffProfiles = [
    { userId: 'user-manager', employeeId: 'EMP-001', dateOfJoining: new Date('2023-01-15'), baseSalary: 450000, contractType: 'PERMANENT', department: 'Operations' },
    { userId: 'user-pm1',     employeeId: 'EMP-002', dateOfJoining: new Date('2023-03-01'), baseSalary: 280000, contractType: 'PERMANENT', department: 'Pen Operations' },
    { userId: 'user-pm2',     employeeId: 'EMP-003', dateOfJoining: new Date('2023-03-01'), baseSalary: 280000, contractType: 'PERMANENT', department: 'Pen Operations' },
    { userId: 'user-w1',      employeeId: 'EMP-004', dateOfJoining: new Date('2024-01-10'), baseSalary: 85000,  contractType: 'PERMANENT', department: 'Pen Operations' },
    { userId: 'user-w2',      employeeId: 'EMP-005', dateOfJoining: new Date('2024-01-10'), baseSalary: 85000,  contractType: 'PERMANENT', department: 'Pen Operations' },
    { userId: 'user-w3',      employeeId: 'EMP-006', dateOfJoining: new Date('2024-02-01'), baseSalary: 85000,  contractType: 'PERMANENT', department: 'Pen Operations' },
    { userId: 'user-w4',      employeeId: 'EMP-007', dateOfJoining: new Date('2024-02-01'), baseSalary: 85000,  contractType: 'PERMANENT', department: 'Pen Operations' },
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
  // FEED MILL BATCH (sample)
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
  await prisma.qCTest.create({
    data: {
      feedMillBatchId: millBatch.id, testType: 'Crude Protein', testedById: 'user-qc1',
      testDate: daysAgo(2), result: '20.3%', passedSpec: true,
      specMin: 18.0, specMax: 22.0,
    },
  }).catch(() => {});
  await prisma.qCTest.create({
    data: {
      feedMillBatchId: millBatch.id, testType: 'Moisture', testedById: 'user-qc1',
      testDate: daysAgo(2), result: '11.2%', passedSpec: true,
      specMin: 0, specMax: 13.0,
    },
  }).catch(() => {});
  console.log('✓ Feed mill batch & QC tests created');

  // ============================================================
  // ASSETS
  // ============================================================
  await prisma.asset.createMany({
    skipDuplicates: true,
    data: [
      { id: 'asset-gen', tenantId: tenant.id, farmId: farm.id, assetCode: 'AST-001', name: 'Main Generator (100KVA)', category: 'GENERATOR', location: 'Power House', purchaseDate: new Date('2023-06-01'), purchaseCost: 3500000, currency: 'NGN', depreciationRate: 20, status: 'ACTIVE' },
      { id: 'asset-scale', tenantId: tenant.id, farmId: farm.id, assetCode: 'AST-002', name: 'Digital Weighing Scale', category: 'WEIGHING_SCALE', location: 'Store', purchaseDate: new Date('2024-01-15'), purchaseCost: 85000, currency: 'NGN', status: 'ACTIVE' },
      { id: 'asset-vent', tenantId: tenant.id, farmId: farm.id, assetCode: 'AST-003', name: 'Ventilation Fan System (Pen 1)', category: 'VENTILATION', location: 'Pen 1', purchaseDate: new Date('2023-01-10'), purchaseCost: 450000, currency: 'NGN', status: 'UNDER_MAINTENANCE' },
    ],
  });
  console.log('✓ Assets created');

  // ============================================================
  // DONE
  // ============================================================
  console.log('\n✅ Seed complete!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  LOGIN CREDENTIALS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Chairperson:      chair@greenacres.ng        / chair123');
  console.log('  Farm Admin:       admin@greenacres.ng         / admin123');
  console.log('  Farm Manager:     manager@greenacres.ng       / manager123');
  console.log('  Store Manager:    store@greenacres.ng         / store123');
  console.log('  Feed Mill Mgr:    mill@greenacres.ng          / mill123');
  console.log('  Pen Manager 1:    penmanager1@greenacres.ng   / pm123');
  console.log('  Pen Manager 2:    penmanager2@greenacres.ng   / pm123');
  console.log('  Store Clerk:      clerk@greenacres.ng         / clerk123');
  console.log('  QC Technician:    qc@greenacres.ng            / qc123');
  console.log('  Pen Worker 1:     worker1@greenacres.ng       / worker123');
  console.log('  Pen Worker 2:     worker2@greenacres.ng       / worker123');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
