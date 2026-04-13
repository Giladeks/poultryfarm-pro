// prisma/seed.js — PoultryFarm Pro v3.0 (Phase 8C clean test seed)
//
// WHAT'S NEW vs v2.1:
//   - All operations data wiped (flocks, eggs, feed, mortality, weight,
//     temperature, transfers, tasks, daily summaries, water, chick_arrivals)
//   - ONE layer flock seeded in PRODUCTION with 90 days of realistic data
//     (Layers Pen 1 · Section A — ISA Brown, 2,450 birds)
//   - ONE broiler flock seeded in PRODUCTION with 35 days of realistic data
//     (Broilers Pen 1 · Section A — Ross 308, 2,390 birds)
//   - ALL other sections are empty — ready for brooding module testing
//   - Brooding section (Brooding Pen · Section A) stays empty for full
//     brooding lifecycle test (intake → temp → End Brooding → transfer)
//   - Users, pens, sections, assignments, stores, suppliers,
//     feed inventory, assets unchanged from v2.1

import { PrismaClient } from '@prisma/client';
import bcrypt           from 'bcryptjs';

const prisma = new PrismaClient();

// ── Helpers ────────────────────────────────────────────────────────────────
function daysAgo(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randF(min, max, dp = 1) { return parseFloat((Math.random() * (max - min) + min).toFixed(dp)); }

async function main() {
  console.log('🌱 PoultryFarm Pro v3.0 seed starting…\n');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 1 — WIPE OPERATIONS DATA (keep structure: users, pens, sections)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('🗑  Wiping all operations data…');

  // Order matters — children before parents
  await prisma.$executeRawUnsafe(`DELETE FROM temperature_logs`);
  await prisma.$executeRawUnsafe(`DELETE FROM chick_arrivals`);
  await prisma.$executeRawUnsafe(`DELETE FROM weight_samples`);
  await prisma.weightRecord.deleteMany({});
  await prisma.waterMeterReading.deleteMany({});
  await prisma.feedConsumption.deleteMany({});
  await prisma.eggProduction.deleteMany({});
  await prisma.mortalityRecord.deleteMany({});
  await prisma.dailySummary.deleteMany({});
  await prisma.dailyReport.deleteMany({});
  await prisma.$executeRawUnsafe(`DELETE FROM flock_transfers`);
  await prisma.task.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.vaccination.deleteMany({});
  await prisma.healthObservation.deleteMany({});
  await prisma.$executeRawUnsafe(`DELETE FROM medication_logs`);
  await prisma.salesOrderItem.deleteMany({});
  await prisma.salesOrder.deleteMany({});
  await prisma.flock.deleteMany({});

  console.log('✓ Operations data wiped\n');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 2 — UPSERT STRUCTURE (idempotent — same as v2.1)
  // ══════════════════════════════════════════════════════════════════════════

  // ── Plans ─────────────────────────────────────────────────────────────────
  await prisma.plan.upsert({ where: { id: 'plan-pro' }, update: {}, create: { id: 'plan-pro', name: 'Professional', maxBirds: 100000, maxUsers: 50, maxFarms: 3, monthlyPrice: 49900, annualPrice: 499000, features: ['analytics','reports','api'], isPublic: true } });

  // ── Tenant ────────────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where:  { id: 'tenant-founding' },
    update: {},
    create: { id: 'tenant-founding', farmName: 'Green Acres Farms Ltd', subdomain: 'greenacres', country: 'NG', timezone: 'Africa/Lagos', status: 'ACTIVE', settings: { operationMode: 'BOTH', currency: 'NGN', autoSummaryTime: '19:00' } },
  });

  // ── Farm ──────────────────────────────────────────────────────────────────
  const farm = await prisma.farm.upsert({
    where:  { id: 'farm-main' },
    update: {},
    create: { id: 'farm-main', tenantId: tenant.id, name: 'Green Acres Main Farm', location: 'Ogun State, Nigeria', isActive: true },
  });

  // ── Users ─────────────────────────────────────────────────────────────────
  const pw = async (p) => bcrypt.hash(p, 10);
  const users = [
    // ── Management ─────────────────────────────────────────────────────────
    { id: 'user-chair',   email: 'chair@greenacres.ng',     firstName: 'Emeka',     lastName: 'Okafor',    role: 'CHAIRPERSON',       passwordHash: await pw('chair123')    },
    { id: 'user-admin',   email: 'admin@greenacres.ng',     firstName: 'Fatima',    lastName: 'Sule',      role: 'FARM_ADMIN',        passwordHash: await pw('admin123')    },
    { id: 'user-manager', email: 'manager@greenacres.ng',   firstName: 'Amina',     lastName: 'Bello',     role: 'FARM_MANAGER',      passwordHash: await pw('manager123')  },
    // ── Store & Feed Mill ───────────────────────────────────────────────────
    { id: 'user-mill',    email: 'mill@greenacres.ng',      firstName: 'Babatunde', lastName: 'Okonkwo',   role: 'FEED_MILL_MANAGER', passwordHash: await pw('mill123')     },
    { id: 'user-store',   email: 'store@greenacres.ng',     firstName: 'Chidi',     lastName: 'Obi',       role: 'STORE_MANAGER',     passwordHash: await pw('store123')    },
    { id: 'user-clerk',   email: 'clerk@greenacres.ng',     firstName: 'Aisha',     lastName: 'Balogun',   role: 'STORE_CLERK',       passwordHash: await pw('clerk123')    },
    { id: 'user-qc',      email: 'qc@greenacres.ng',        firstName: 'Seun',      lastName: 'Adebayo',   role: 'QC_TECHNICIAN',     passwordHash: await pw('qc123')       },
    // ── Pen Managers ────────────────────────────────────────────────────────
    { id: 'user-pm1',     email: 'penmanager1@greenacres.ng',firstName: 'Tunde',    lastName: 'Adeyemi',   role: 'PEN_MANAGER',       passwordHash: await pw('pm123')       },
    { id: 'user-pm2',     email: 'penmanager2@greenacres.ng',firstName: 'Ngozi',    lastName: 'Eze',       role: 'PEN_MANAGER',       passwordHash: await pw('pm123')       },
    { id: 'user-pm3',     email: 'jreacher@greenacres.ng',  firstName: 'Jack',      lastName: 'Reacher',   role: 'PEN_MANAGER',       passwordHash: await pw('reacher123')  },
    // ── Pen Workers ─────────────────────────────────────────────────────────
    { id: 'user-w1',      email: 'worker1@greenacres.ng',   firstName: 'Adewale',   lastName: 'Ogundimu',  role: 'PEN_WORKER',        passwordHash: await pw('worker123')   },
    { id: 'user-w2',      email: 'worker2@greenacres.ng',   firstName: 'Chinwe',    lastName: 'Nwosu',     role: 'PEN_WORKER',        passwordHash: await pw('worker123')   },
    { id: 'user-w3',      email: 'worker3@greenacres.ng',   firstName: 'Emeka',     lastName: 'Uzoma',     role: 'PEN_WORKER',        passwordHash: await pw('worker123')   },
    { id: 'user-w4',      email: 'worker4@greenacres.ng',   firstName: 'Fatima',    lastName: 'Abdullahi', role: 'PEN_WORKER',        passwordHash: await pw('worker123')   },
    { id: 'user-w5',      email: 'jwindek@greenacres.ng',   firstName: 'Joseph',    lastName: 'Windek',    role: 'PEN_WORKER',        passwordHash: await pw('worker123')   },
    { id: 'user-w6',      email: 'mduro@greenacres.ng',     firstName: 'Monday',    lastName: 'Duro',      role: 'PEN_WORKER',        passwordHash: await pw('worker123')   },
    { id: 'user-w7',      email: 'jwick@greenacres.ng',     firstName: 'John',      lastName: 'Wick',      role: 'PEN_WORKER',        passwordHash: await pw('johnwick123') },
    // ── Internal Control & Finance ──────────────────────────────────────────
    { id: 'user-ic',      email: 'abandle@greenacres.ng',   firstName: 'Augustus',  lastName: 'Bandle',    role: 'INTERNAL_CONTROL',  passwordHash: await pw('control123')  },
    { id: 'user-acc',     email: 'ralero@greenacres.ng',    firstName: 'Rufai',     lastName: 'Alero',     role: 'ACCOUNTANT',        passwordHash: await pw('account123')  },
  ];
  // Track actual user ids (may differ from seed ids if users already exist)
  const userIdMap = {};
  for (const u of users) {
    const existing = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: u.email } });
    if (existing) {
      // Update non-id fields only — never change id (breaks FK constraints)
      await prisma.user.update({
        where: { id: existing.id },
        data:  { firstName: u.firstName, lastName: u.lastName, role: u.role, passwordHash: u.passwordHash, isActive: true },
      });
      userIdMap[u.id] = existing.id;
    } else {
      await prisma.user.create({
        data: { ...u, tenantId: tenant.id, farmId: farm.id, isActive: true },
      });
      userIdMap[u.id] = u.id;
    }
  }
  // Helper to resolve actual user id from seed id
  const uid = (seedId) => userIdMap[seedId] || seedId;
  console.log('✓ Users upserted');

  // ── Pens & Sections ───────────────────────────────────────────────────────
  const pens = [
    { id: 'pen-layer-a',   name: 'Layers Pen 1',    operationType: 'LAYER',   penPurpose: 'PRODUCTION', capacity: 10000 },
    { id: 'pen-layer-b',   name: 'Layers Pen 2',    operationType: 'LAYER',   penPurpose: 'PRODUCTION', capacity: 10000 },
    { id: 'pen-broiler-a', name: 'Broilers Pen 1',  operationType: 'BROILER', penPurpose: 'PRODUCTION', capacity: 10000 },
    { id: 'pen-broiler-b', name: 'Broilers Pen 2',  operationType: 'BROILER', penPurpose: 'PRODUCTION', capacity: 10000 },
    { id: 'pen-brooding',  name: 'Brooding House',  operationType: 'LAYER',   penPurpose: 'BROODING',   capacity: 10000 },
  ];
  for (const p of pens) {
    await prisma.pen.upsert({
      where:  { id: p.id },
      update: { name: p.name, penPurpose: p.penPurpose },
      create: { id: p.id, farmId: farm.id, name: p.name, operationType: p.operationType, penPurpose: p.penPurpose, capacity: p.capacity, isActive: true },
    });
    for (const sec of ['A','B','C','D']) {
      const sId = `${p.id}-s${sec.toLowerCase()}`;
      await prisma.penSection.upsert({
        where:  { id: sId },
        update: {},
        create: { id: sId, penId: p.id, name: `Section ${sec}`, capacity: 2500, isActive: true },
      });
    }
  }
  console.log('✓ Pens and sections upserted (5 pens, 20 sections)');

  // ── Worker Assignments ────────────────────────────────────────────────────
  const assignments = [
    // ── Brooding House — Jack Reacher (PM) + John Wick (Worker) ────────────
    { userId: uid('user-pm3'), penSectionId: 'pen-brooding-sa',  isActive: true },
    { userId: uid('user-pm3'), penSectionId: 'pen-brooding-sb',  isActive: true },
    { userId: uid('user-pm3'), penSectionId: 'pen-brooding-sc',  isActive: true },
    { userId: uid('user-pm3'), penSectionId: 'pen-brooding-sd',  isActive: true },
    { userId: uid('user-w7'),  penSectionId: 'pen-brooding-sa',  isActive: true }, // John Wick

    // ── Layers Pen 1 — Tunde Adeyemi (PM) ──────────────────────────────────
    { userId: uid('user-pm1'), penSectionId: 'pen-layer-a-sa',   isActive: true },
    { userId: uid('user-pm1'), penSectionId: 'pen-layer-a-sb',   isActive: true },
    { userId: uid('user-pm1'), penSectionId: 'pen-layer-a-sc',   isActive: true },
    { userId: uid('user-pm1'), penSectionId: 'pen-layer-a-sd',   isActive: true },
    { userId: uid('user-w1'),  penSectionId: 'pen-layer-a-sa',   isActive: true }, // Adewale
    { userId: uid('user-w2'),  penSectionId: 'pen-layer-a-sb',   isActive: true }, // Chinwe
    { userId: uid('user-w3'),  penSectionId: 'pen-layer-a-sc',   isActive: true }, // Emeka
    { userId: uid('user-w5'),  penSectionId: 'pen-layer-a-sd',   isActive: true }, // Joseph Windek

    // ── Layers Pen 2 — Tunde Adeyemi (PM) ──────────────────────────────────
    { userId: uid('user-pm1'), penSectionId: 'pen-layer-b-sa',   isActive: true },
    { userId: uid('user-pm1'), penSectionId: 'pen-layer-b-sb',   isActive: true },
    { userId: uid('user-pm1'), penSectionId: 'pen-layer-b-sc',   isActive: true },
    { userId: uid('user-pm1'), penSectionId: 'pen-layer-b-sd',   isActive: true },

    // ── Broilers Pen 1 — Ngozi Eze (PM) ────────────────────────────────────
    { userId: uid('user-pm2'), penSectionId: 'pen-broiler-a-sa', isActive: true },
    { userId: uid('user-pm2'), penSectionId: 'pen-broiler-a-sb', isActive: true },
    { userId: uid('user-pm2'), penSectionId: 'pen-broiler-a-sc', isActive: true },
    { userId: uid('user-pm2'), penSectionId: 'pen-broiler-a-sd', isActive: true },
    { userId: uid('user-w6'),  penSectionId: 'pen-broiler-a-sa', isActive: true }, // Monday Duro
    { userId: uid('user-w4'),  penSectionId: 'pen-broiler-a-sb', isActive: true }, // Fatima

    // ── Broilers Pen 2 — Ngozi Eze (PM) ────────────────────────────────────
    { userId: uid('user-pm2'), penSectionId: 'pen-broiler-b-sa', isActive: true },
    { userId: uid('user-pm2'), penSectionId: 'pen-broiler-b-sb', isActive: true },
    { userId: uid('user-pm2'), penSectionId: 'pen-broiler-b-sc', isActive: true },
    { userId: uid('user-pm2'), penSectionId: 'pen-broiler-b-sd', isActive: true },
  ];
  for (const a of assignments) {
    await prisma.penWorkerAssignment.upsert({
      where:  { userId_penSectionId: { userId: a.userId, penSectionId: a.penSectionId } },
      update: { isActive: a.isActive },
      create: { userId: a.userId, penSectionId: a.penSectionId, isActive: a.isActive },
    });
  }
  console.log('✓ Worker assignments upserted');

  // ── Stores ────────────────────────────────────────────────────────────────
  await prisma.store.upsert({ where: { id: 'store-feed' }, update: {}, create: { id: 'store-feed', farmId: farm.id, name: 'Main Feed Store', storeType: 'FEED', managerId: uid('user-store'), location: 'Block A' } });
  await prisma.store.upsert({ where: { id: 'store-med' },  update: {}, create: { id: 'store-med',  farmId: farm.id, name: 'Medication & Vaccine Store', storeType: 'MEDICATION', managerId: uid('user-store'), location: 'Block B' } });
  await prisma.store.upsert({ where: { id: 'store-gen' },  update: {}, create: { id: 'store-gen',  farmId: farm.id, name: 'General Store', storeType: 'GENERAL', managerId: uid('user-store'), location: 'Block C' } });

  // ── Suppliers ─────────────────────────────────────────────────────────────
  await prisma.supplier.upsert({ where: { id: 'supplier-feeds' },  update: {}, create: { id: 'supplier-feeds',  tenantId: tenant.id, name: 'Lagos Agro Feeds Ltd',   supplierType: 'FEED',   contactName: 'Mr. Babatunde', phone: '+234-801-234-5678', email: 'sales@lagrosfeeds.ng',    address: 'Apapa, Lagos',          paymentTerms: 'Net 30', rating: 4 } });
  await prisma.supplier.upsert({ where: { id: 'supplier-chicks' }, update: {}, create: { id: 'supplier-chicks', tenantId: tenant.id, name: 'Ogun Hatcheries Ltd',     supplierType: 'CHICKS', contactName: 'Mrs. Adeyemi',  phone: '+234-802-345-6789', email: 'info@ogunhatch.ng',       address: 'Abeokuta, Ogun State',  paymentTerms: 'Cash',   rating: 5 } });
  await prisma.supplier.upsert({ where: { id: 'supplier-meds' },   update: {}, create: { id: 'supplier-meds',   tenantId: tenant.id, name: 'VetPlus Nigeria Ltd',     supplierType: 'MEDICATION', contactName: 'Dr. Okonkwo', phone: '+234-803-456-7890', email: 'orders@vetplus.ng',       address: 'Victoria Island, Lagos',paymentTerms: 'Net 14', rating: 4 } });

  // ── Feed Inventory ────────────────────────────────────────────────────────
  const feedTypes = [
    { id: 'feed-layer-mash',      feedType: 'Layer Mash (18% CP)',       bagWeightKg: 25, costPerKg: 320, currentStockKg: 12500, reorderLevelKg: 2500 },
    { id: 'feed-chick-starter',   feedType: 'Chick Starter (22% CP)',    bagWeightKg: 25, costPerKg: 380, currentStockKg: 5000,  reorderLevelKg: 1000 },
    { id: 'feed-broiler-finisher',feedType: 'Broiler Finisher (20% CP)', bagWeightKg: 25, costPerKg: 340, currentStockKg: 8750,  reorderLevelKg: 1750 },
    { id: 'feed-grower-mash',     feedType: 'Grower Mash (16% CP)',      bagWeightKg: 25, costPerKg: 300, currentStockKg: 6250,  reorderLevelKg: 1250 },
  ];
  for (const f of feedTypes) {
    await prisma.feedInventory.upsert({
      where:  { id: f.id },
      update: { currentStockKg: f.currentStockKg },
      create: { id: f.id, tenantId: tenant.id, storeId: 'store-feed', supplierId: 'supplier-feeds', ...f, currency: 'NGN' },
    });
  }
  console.log('✓ Stores, suppliers, feed inventory upserted');

  // ── Assets ────────────────────────────────────────────────────────────────
  await prisma.asset.createMany({ skipDuplicates: true, data: [
    { id: 'asset-gen',   tenantId: tenant.id, assetCode: 'AST-001', name: 'Main Generator (100KVA)',        category: 'GENERATOR',      location: 'Power House', purchaseDate: new Date('2023-06-01'), purchaseCost: 3500000, currency: 'NGN', depreciationRate: 20, status: 'ACTIVE' },
    { id: 'asset-scale', tenantId: tenant.id, assetCode: 'AST-002', name: 'Digital Weighing Scale',         category: 'WEIGHING_SCALE', location: 'Store',       purchaseDate: new Date('2024-01-15'), purchaseCost: 85000,   currency: 'NGN', status: 'ACTIVE' },
    { id: 'asset-vent',  tenantId: tenant.id, assetCode: 'AST-003', name: 'Ventilation Fan System (Pen 1)',category: 'VENTILATION',    location: 'Pen 1',       purchaseDate: new Date('2023-01-10'), purchaseCost: 450000,  currency: 'NGN', status: 'UNDER_MAINTENANCE' },
  ]});
  console.log('✓ Assets upserted');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 3 — LAYER FLOCK (Layers Pen 1 · Section A)
  //   ISA Brown, 2,500 placed, 50 DOA = 2,450 live
  //   Placed 90 days ago → age 90d → 12.8 weeks → PRODUCTION stage
  //   Laying since day 20 (18 weeks = 126d but we're accelerating for demo)
  //   90 days of egg, feed, mortality, water data
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n📊 Seeding layer flock data…');

  const LAYER_SECTION  = 'pen-layer-a-sa';
  const LAYER_PLACED   = daysAgo(90);
  const LAYER_INITIAL  = 2500;
  const LAYER_DOA      = 50;
  const LAYER_LIVE     = LAYER_INITIAL - LAYER_DOA; // 2450

  // Cumulative mortality over 90 days
  let layerCurrentCount = LAYER_LIVE;
  const layerMortalityByDay = [];
  for (let i = 90; i >= 1; i--) {
    const deaths = rand(0, i < 14 ? 3 : 1); // slightly higher early on
    layerMortalityByDay.push({ daysAgoN: i, deaths });
    layerCurrentCount -= deaths;
  }
  const LAYER_CURRENT = Math.max(layerCurrentCount, 2300);

  const layerFlock = await prisma.flock.create({
    data: {
      id:                    'flock-layer-001',
      tenantId:              tenant.id,
      penSectionId:          LAYER_SECTION,
      batchCode:             'ISA-0101-001',
      operationType:         'LAYER',
      breed:                 'ISA Brown',
      dateOfPlacement:       LAYER_PLACED,
      initialCount:          LAYER_LIVE,
      currentCount:          LAYER_CURRENT,
      stage:                 'PRODUCTION',
      stageUpdatedAt:        daysAgo(70), // brooding ended day 20
      broodingEndDate:       daysAgo(70),
      rearingStartDate:      daysAgo(70),
      pointOfLayDate:        daysAgo(55), // started laying day 35
      status:                'ACTIVE',
      source:                'PURCHASED',
      purchaseCost:          350,
      purchaseCurrency:      'NGN',
      expectedLayingStartDate: daysAgo(55),
    },
  });
  console.log(`  ✓ Layer flock created: ${layerFlock.batchCode} — ${LAYER_CURRENT} birds`);

  // ── Mortality records — 90 days ────────────────────────────────────────
  const mortalityCauses = ['UNKNOWN','DISEASE','INJURY','CULLED'];
  for (const { daysAgoN, deaths } of layerMortalityByDay) {
    if (deaths === 0) continue;
    await prisma.mortalityRecord.create({ data: {
      flockId:       layerFlock.id,
      penSectionId:  LAYER_SECTION,
      recordDate:    daysAgo(daysAgoN),
      count:         deaths,
      causeCode:     mortalityCauses[rand(0, mortalityCauses.length - 1)],
      recordedById:  uid('user-w1'),
      submissionStatus: 'APPROVED',
    }});
  }
  console.log('  ✓ Layer mortality records (90 days)');

  // ── Feed consumption — 90 days (layer mash) ───────────────────────────
  for (let i = 90; i >= 1; i--) {
    const kgPerDay = randF(85, 110); // ~37–45g/bird/day for 2400 birds
    const gpb      = parseFloat((kgPerDay * 1000 / LAYER_CURRENT).toFixed(1));
    await prisma.feedConsumption.create({ data: {
      flockId:        layerFlock.id,
      penSectionId:   LAYER_SECTION,
      feedInventoryId:'feed-layer-mash',
      recordedDate:   daysAgo(i),
      quantityKg:     kgPerDay,
      gramsPerBird:   gpb,
      costAtTime:     parseFloat((kgPerDay * 320).toFixed(4)),
      currency:       'NGN',
      bagsUsed:       Math.ceil(kgPerDay / 25),
      recordedById:   uid('user-w1'),
      submissionStatus:'APPROVED',
    }});
  }
  console.log('  ✓ Layer feed consumption (90 days)');

  // ── Egg production — days 55 to today (when laying started) ──────────
  for (let i = 55; i >= 1; i--) {
    // Laying rate: ramps from 60% at day 55 → peaks ~88% at day 20 → slight decline
    const daysLaying  = 55 - i;
    const baseRate    = Math.min(88, 60 + daysLaying * 1.2);
    const layingRate  = Math.max(72, randF(baseRate - 4, baseRate + 4));
    const totalEggs   = Math.round((layingRate / 100) * LAYER_CURRENT);
    const gradeA      = Math.round(totalEggs * randF(0.88, 0.94));
    const gradeB      = Math.round((totalEggs - gradeA) * randF(0.5, 0.7));
    const cracked     = totalEggs - gradeA - gradeB;
    const cratesCollected = Math.floor(totalEggs / 30);
    const looseEggs   = totalEggs % 30;

    await prisma.eggProduction.create({ data: {
      flockId:           layerFlock.id,
      penSectionId:      LAYER_SECTION,
      collectionDate:    daysAgo(i),
      totalEggs,
      gradeACount:       gradeA,
      gradeBCount:       gradeB,
      crackedCount:      cracked,
      crackedConfirmed:  cracked,
      gradeAPct:         parseFloat(((gradeA / totalEggs) * 100).toFixed(2)),
      layingRatePct:     parseFloat(layingRate.toFixed(2)),
      cratesCollected,
      looseEggs,
      collectionSession: 1,
      submissionStatus:  'APPROVED',
      recordedById:      uid('user-w1'),
      approvedById:      uid('user-pm1'),
    }});
  }
  console.log('  ✓ Layer egg production (55 days)');

  // ── Water meter readings — 30 days ────────────────────────────────────
  let waterOdometer = 1200; // start lower since we're going back 90 days
  for (let i = 90; i >= 1; i--) {
    const dailyConsumption = randF(230, 280); // ~100ml/bird/day
    waterOdometer += dailyConsumption;
    await prisma.waterMeterReading.create({ data: {
      tenantId:       tenant.id,
      flockId:        layerFlock.id,
      penSectionId:   LAYER_SECTION,
      readingDate:    daysAgo(i),
      meterReading:   parseFloat(waterOdometer.toFixed(1)),
      consumptionL:   parseFloat(dailyConsumption.toFixed(1)),
      consumptionLPB: parseFloat((dailyConsumption / LAYER_CURRENT).toFixed(4)),
      recordedById:   uid('user-w1'),
    }});
  }
  console.log('  ✓ Layer water readings (30 days)');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 4 — BROILER FLOCK (Broilers Pen 1 · Section A)
  //   Ross 308, 2,500 placed, 110 DOA = 2,390 live
  //   Placed 35 days ago → age 35d → PRODUCTION stage (brooding ended day 14)
  //   35 days of feed, mortality, weight, water data
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n📊 Seeding broiler flock data…');

  const BROILER_SECTION = 'pen-broiler-a-sa';
  const BROILER_PLACED  = daysAgo(35);
  const BROILER_INITIAL = 2500;
  const BROILER_DOA     = 110;
  const BROILER_LIVE    = BROILER_INITIAL - BROILER_DOA; // 2390

  let broilerCurrentCount = BROILER_LIVE;
  for (let i = 35; i >= 1; i--) {
    const deaths = rand(0, i > 21 ? 4 : 2); // higher early mortality
    broilerCurrentCount -= deaths;
  }
  const BROILER_CURRENT = Math.max(broilerCurrentCount, 2200);

  const broilerFlock = await prisma.flock.create({
    data: {
      id:                  'flock-broiler-001',
      tenantId:            tenant.id,
      penSectionId:        BROILER_SECTION,
      batchCode:           'ROS-0101-001',
      operationType:       'BROILER',
      breed:               'Ross 308',
      dateOfPlacement:     BROILER_PLACED,
      initialCount:        BROILER_LIVE,
      currentCount:        BROILER_CURRENT,
      stage:               'PRODUCTION',
      stageUpdatedAt:      daysAgo(21), // End Brooding at day 14
      broodingEndDate:     daysAgo(21),
      status:              'ACTIVE',
      source:              'PURCHASED',
      purchaseCost:        280,
      purchaseCurrency:    'NGN',
      expectedHarvestDate: new Date(Date.now() + 7 * 86400000), // harvest in 7 days
      targetFCR:           1.85,
    },
  });
  console.log(`  ✓ Broiler flock created: ${broilerFlock.batchCode} — ${BROILER_CURRENT} birds`);

  // ── Broiler mortality — 35 days ────────────────────────────────────────
  broilerCurrentCount = BROILER_LIVE;
  for (let i = 35; i >= 1; i--) {
    const deaths = rand(0, i > 21 ? 4 : 2);
    if (deaths > 0) {
      await prisma.mortalityRecord.create({ data: {
        flockId:      broilerFlock.id,
        penSectionId: BROILER_SECTION,
        recordDate:   daysAgo(i),
        count:        deaths,
        causeCode:    mortalityCauses[rand(0, mortalityCauses.length - 1)],
        recordedById: uid('user-w6'),
        submissionStatus: 'APPROVED',
      }});
    }
    broilerCurrentCount -= deaths;
  }
  console.log('  ✓ Broiler mortality records (35 days)');

  // ── Broiler feed consumption — 35 days ────────────────────────────────
  // g/bird/day: ~15g at day 1, increasing to ~130g at day 35
  for (let i = 35; i >= 1; i--) {
    const ageInDays   = 36 - i;
    const gpbTarget   = Math.min(130, 15 + ageInDays * 3.3);
    const gpb         = randF(gpbTarget * 0.92, gpbTarget * 1.08);
    const kgPerDay    = parseFloat((gpb * BROILER_CURRENT / 1000).toFixed(1));
    const feedId      = ageInDays <= 14 ? 'feed-chick-starter' : 'feed-broiler-finisher';
    const feedCostPerKg = feedId === 'feed-chick-starter' ? 380 : 340;
    await prisma.feedConsumption.create({ data: {
      flockId:        broilerFlock.id,
      penSectionId:   BROILER_SECTION,
      feedInventoryId:feedId,
      recordedDate:   daysAgo(i),
      quantityKg:     kgPerDay,
      gramsPerBird:   parseFloat(gpb.toFixed(1)),
      costAtTime:     parseFloat((kgPerDay * feedCostPerKg).toFixed(4)),
      currency:       'NGN',
      bagsUsed:       Math.ceil(kgPerDay / 25),
      recordedById:   uid('user-w6'),
      submissionStatus:'APPROVED',
    }});
  }
  console.log('  ✓ Broiler feed consumption (35 days)');

  // ── Broiler weight samples — weekly day 7, 14, 21, 28, 35 ──────────────
  // Uses weight_samples table (has estimatedFCR) for the FCR trend chart
  // Ross 308 standard: day7=170g, day14=420g, day21=850g, day28=1450g, day35=2100g
  const broilerWeights = [
    { daysAgoN: 28, age: 7,  avgG: rand(160, 185),  minG: 140, maxG: 200, uniformity: randF(82, 90), prevAvgG: 42   },
    { daysAgoN: 21, age: 14, avgG: rand(400, 440),  minG: 360, maxG: 480, uniformity: randF(80, 88), prevAvgG: 172  },
    { daysAgoN: 14, age: 21, avgG: rand(820, 880),  minG: 740, maxG: 960, uniformity: randF(78, 86), prevAvgG: 420  },
    { daysAgoN: 7,  age: 28, avgG: rand(1400, 1500),minG: 1260,maxG: 1640,uniformity: randF(76, 84), prevAvgG: 850  },
    { daysAgoN: 0,  age: 35, avgG: rand(2050, 2150),minG: 1850,maxG: 2380,uniformity: randF(74, 82), prevAvgG: 1450 },
  ];
  for (const w of broilerWeights) {
    const periodDays   = 7;
    const feedKgPeriod = BROILER_CURRENT * 0.11 * periodDays; // ~110g/bird/day avg
    const gainKg       = ((w.avgG - w.prevAvgG) / 1000) * BROILER_CURRENT;
    const estimatedFCR = gainKg > 0 ? parseFloat((feedKgPeriod / gainKg).toFixed(2)) : null;
    // weight_samples — the table the FCR trend chart reads from
    await prisma.$executeRawUnsafe(
      `INSERT INTO weight_samples
         (id, "tenantId", "flockId", "penSectionId", "sampleDate", "sampleCount",
          "meanWeightG", "minWeightG", "maxWeightG", "uniformityPct", "estimatedFCR", "recordedById")
       VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT DO NOTHING`,
      tenant.id, broilerFlock.id, BROILER_SECTION,
      daysAgo(w.daysAgoN), 30,
      w.avgG, w.minG, w.maxG, w.uniformity, estimatedFCR,
      uid('user-w6')
    );
    // Also seed weight_records for the dashboard API latestWeightG
    await prisma.weightRecord.create({ data: {
      flockId:       broilerFlock.id,
      penSectionId:  BROILER_SECTION,
      recordDate:    daysAgo(w.daysAgoN),
      ageInDays:     w.age,
      sampleSize:    30,
      avgWeightG:    w.avgG,
      minWeightG:    w.minG,
      maxWeightG:    w.maxG,
      uniformityPct: w.uniformity,
      recordedById:  uid('user-w6'),
    }}).catch(() => {}); // skip if already exists
  }
  console.log('  ✓ Broiler weight samples + weight records (5 weigh-ins)');

  // ── Broiler water — 30 days ────────────────────────────────────────────
  let broilerOdometer = 100;
  for (let i = 35; i >= 1; i--) {
    const ageInDays = 36 - i;
    const dailyL    = parseFloat((BROILER_CURRENT * (0.08 + ageInDays * 0.003) / 1000 * 1000 / 1000).toFixed(1));
    // simpler: ~180L early, growing to ~350L at day 35
    const consumption = randF(150 + ageInDays * 5, 200 + ageInDays * 5);
    broilerOdometer += consumption;
    await prisma.waterMeterReading.create({ data: {
      tenantId:       tenant.id,
      flockId:        broilerFlock.id,
      penSectionId:   BROILER_SECTION,
      readingDate:    daysAgo(i),
      meterReading:   parseFloat(broilerOdometer.toFixed(1)),
      consumptionL:   parseFloat(consumption.toFixed(1)),
      consumptionLPB: parseFloat((consumption / BROILER_CURRENT).toFixed(4)),
      recordedById:   uid('user-w6'),
    }});
  }
  console.log('  ✓ Broiler water readings (30 days)');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 5 — DAILY SUMMARIES (last 7 days for layer section)
  //   Days 7-2: REVIEWED (approved by PM)
  //   Day 1: SUBMITTED (awaiting PM review)
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n📊 Seeding daily summaries…');

  for (let i = 7; i >= 1; i--) {
    const isToday    = i === 1;
    const status     = isToday ? 'SUBMITTED' : 'REVIEWED';
    const dayDate    = daysAgo(i);

    // Pull matching egg/feed/mortality data for this day from what we seeded
    // Feed: ~90-110 kg/day for layers
    const feedKg     = randF(85, 110);
    // Eggs: day 55-i from placement = laying day (55-i)
    const daysLaying = 55 - i;
    const baseRate   = Math.min(88, 60 + Math.max(0, daysLaying) * 1.2);
    const layingRate = Math.max(72, randF(baseRate - 4, baseRate + 4));
    const totalEggs  = Math.round((layingRate / 100) * 2384); // approximate current count
    const mortality  = rand(0, 1);
    const waterL     = randF(230, 280);

    await prisma.dailySummary.create({ data: {
      tenantId:           tenant.id,
      farmId:             farm.id,
      penSectionId:       LAYER_SECTION,
      summaryDate:        dayDate,
      status,
      submittedAt:        new Date(dayDate.getTime() + 19 * 3600 * 1000), // submitted at 7pm
      totalEggsCollected: totalEggs,
      totalFeedKg:        parseFloat(feedKg.toFixed(2)),
      totalMortality:     mortality,
      waterConsumptionL:  parseFloat(waterL.toFixed(2)),
      waterNipplesChecked:   true,
      manureBeltsRun:        true,
      aislesSwept:           true,
      cageDoorsInspected:    true,
      closingObservation: isToday
        ? 'All birds active. Feed intake normal. Awaiting PM sign-off.'
        : 'Normal day. No issues observed.',
      reviewedById:  isToday ? null : uid('user-pm1'),
      reviewedAt:    isToday ? null : new Date(dayDate.getTime() + 22 * 3600 * 1000),
      reviewNotes:   isToday ? null : 'Verified. Records consistent.',
    }});
  }
  console.log('  ✓ Daily summaries (7 days — last one awaiting PM review)');

  // ══════════════════════════════════════════════════════════════════════════
  // STEP 6 — SUMMARY
  // ══════════════════════════════════════════════════════════════════════════
  console.log('\n✅  Seed v3.0 complete!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ACTIVE FLOCKS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ISA-0101-001  LAYER    Layers Pen 1 · Section A   ${LAYER_CURRENT} birds  90d PRODUCTION`);
  console.log(`  ROS-0101-001  BROILER  Broilers Pen 1 · Section A ${BROILER_CURRENT} birds  35d PRODUCTION`);
  console.log('\n  ALL OTHER SECTIONS: empty — ready for brooding module testing');
  console.log('  Brooding House · Section A: empty — ready for full intake test\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  LOGIN CREDENTIALS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Chairperson:   chair@greenacres.ng      / chair123');
  console.log('  Farm Admin:    admin@greenacres.ng       / admin123');
  console.log('  Farm Manager:  manager@greenacres.ng     / manager123');
  console.log('  Store Manager: store@greenacres.ng       / store123');
  console.log('  Pen Manager 1: penmanager1@greenacres.ng / pm123    → Brooding + Layers Pen 1');
  console.log('  Pen Manager 2: penmanager2@greenacres.ng / pm123    → Broilers Pen 1 & 2');
  console.log('  Tunde Adeyemi: penmanager1@greenacres.ng / pm123      → Layers PM');
  console.log('  Ngozi Eze:     penmanager2@greenacres.ng / pm123      → Broilers PM');
  console.log('  Jack Reacher:  jreacher@greenacres.ng    / reacher123 → Brooding PM');
  console.log('  Adewale:       worker1@greenacres.ng     / worker123  → Layers P1 SA');
  console.log('  Chinwe:        worker2@greenacres.ng     / worker123  → Layers P1 SB');
  console.log('  Emeka:         worker3@greenacres.ng     / worker123  → Layers P1 SC');
  console.log('  Fatima:        worker4@greenacres.ng     / worker123  → Broilers P1 SB');
  console.log('  Joseph Windek: jwindek@greenacres.ng     / worker123  → Layers P1 SD');
  console.log('  Monday Duro:   mduro@greenacres.ng       / worker123  → Broilers P1 SA');
  console.log('  John Wick:     jwick@greenacres.ng       / johnwick123→ Brooding SA');
  console.log('  Augustus:      abandle@greenacres.ng     / control123 → Internal Control');
  console.log('  Rufai:         ralero@greenacres.ng      / account123 → Accountant');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main()
  .catch(e => { console.error('❌ Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
