# PoultryFarm Pro — Module Development Roadmap
> Last updated: 19 March 2026 (rev 6)
> Stack: Next.js 16 App Router · Prisma 5.22 · PostgreSQL · JWT Auth (localStorage Bearer) · Tailwind + custom CSS
> Currency: Nigerian Naira (₦) · Locale: en-NG

---

## Strategic Foundations

**1. The full poultry production cycle is the product.**
PoultryFarm Pro covers every node in the chain:

```
RAW MATERIALS → FEED MILL → FEED INVENTORY
                                   ↓
DAY-OLD CHICKS → BROODING → LAYER PRODUCTION → EGG COLLECTION → SALES
                          ↘
                            BROILER PRODUCTION → PROCESSING PLANT → SALES
```

Each node is a distinct operational module. A farm may operate some or all of them. The system adapts to what each farm actually does.

**2. Operation mode is a tenant-level setting — it drives everything.**
When a farm signs up, they select their operation mode: `LAYER_ONLY`, `BROILER_ONLY`, or `BOTH`. This single setting determines which nav items appear, which dashboards are shown, which task templates are generated, and which modules are licensed. It is the foundation of both the product experience and the monetisation model.

**3. Brooding is the starting phase of both operations, not a separate solution.**
Every batch begins in the brooder. Brooding has its own metrics, task templates, and transition trigger (graduation to production pens). It is a phase within both Layer and Broiler workflows, not a standalone module.

**4. Data entry is part of the workflow, not a separate task.**
Workers complete tasks. When a task requires data, the form appears at completion. Pre-filled context, minimal inputs, one screen per action. The system captures data as a by-product of operational compliance.

**5. Verification is a reconciliation system, not an approval workflow.**
Its purpose is operational efficiency (catch errors while physical evidence exists) and theft/loss prevention (cross-validate records, surface anomalies automatically). The IC Officer acts on patterns — the system does the detection.

---

## Legend
| Symbol | Meaning |
|--------|---------|
| ✅ | Complete and deployed |
| 🔧 | Partially built — needs completion |
| 📋 | Planned — spec defined |
| 🔮 | Future — identified, not yet specced |
| ❌ | Blocked or deprioritised |

---

## Phases 1–7: Completed Work

### ✅ Phase 1 — Core Operations
Authentication, AppShell, role-based nav (13 roles), farm structure, flock management, health management, feed management (inventory, consumption, GRN, POs, suppliers), egg production, mortality records, verification, user admin, analytics/BI, worker portal.

### ✅ Phase 2 — Quality & Foundation Fixes
Shared UI components, bug fixes, unicode sweep, ID validation fixes.

### ✅ Phase 3 — Feature Modules
Egg and mortality APIs with worker-scoped data, PDF export engine, reports.

### ✅ Phase 4 — Advanced Features
Audit log viewer, PDF export engine (pdfmake v0.2.x, Helvetica only), worker dashboard rewrite, Termii SMS alerts (mortality, low feed, rejection), SMS settings UI.

### ✅ Phase 6 — Billing
Stripe integration, subscription tiers, billing portal, webhooks.

### ✅ Phase 7 — Finance Module
Accounts Payable, Accounts Receivable, Profit & Loss, Bank Reconciliation, invoice email delivery, PDF invoices with QR codes, Accountant Dashboard, payment reminder system, user password management.

---

## Phase 8 — Operation Mode & Full Production Cycle Architecture

> **Goal:** Establish the operation mode selector as the foundational configuration layer. Define and build all operational modules (Brooding, Layer Production, Broiler Production, Feed Mill, Processing Plant) as independent solutions that share infrastructure.

### ✅ 8A — Operation Mode Selector
- Tenant-level `operationMode`: `LAYER_ONLY | BROILER_ONLY | BOTH`
- Optional module flags: `hasFeedMillModule`, `hasProcessingModule`
- Settings UI (`/settings` → Operations tab) with role-gated access (FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN)
- AppShell nav conditionally renders items based on active operation mode
- Farm page and dashboard panels scoped to active modules

### 🔧 8B — Production Dashboards & Worker Experience (Mostly Complete)

> This sub-phase diverged from the original spec to prioritise worker-facing dashboards and role-specific KPI views before building the brooding module. The core dashboard architecture is complete. Several data-entry modals remain.

#### ✅ Completed in Phase 8B
- **Main dashboard** (`app/dashboard/page.js`) — all 11 roles fully implemented:
  - Pen Worker: 3-column section grid, click-to-chart modal, attention pill navigation to flagged sections
  - Pen Manager: KPI blocks (Layer + Broiler), attention pill (section-level), pending verifications panel (2-column compact grid, scoped to PM's pens, 240px max-height scroll)
  - Farm Manager / Farm Admin: attention pill (pen-level, one row per pen), tabbed Layer/Broiler KPI blocks, harvest countdown, pen list
  - Store Manager, Store Clerk, Feed Mill Manager, QC Technician, Accountant, Internal Control: role-specific dashboards
- **Layer performance page** (`app/performance/page.js`): 6 KPI cards (Live Birds → Lay Rate → Eggs Today → Grade A Rate → Water Intake → Mortality), daily eggs chart, laying rate trend chart, grade breakdown, daily log table
- **Broiler performance page** (`app/broiler-performance/page.js`): 6 KPI cards in order (Live Birds → Harvest Countdown → Avg Live Weight → Feed Conv. Ratio → Water Intake → Mortality), weight growth trend chart, FCR trend, flock uniformity, log table
- **Dashboard APIs**: `/api/dashboard`, `/api/dashboard/charts` (Phase 8B field-compatible), `/api/dashboard/verifications`
- **Eggs API** (`/api/eggs` GET + POST, `/api/eggs/[id]` PATCH): Phase 8B crate-based two-phase workflow
- **Weight records API** (`/api/weight-records` GET + POST): reads `WeightRecord` model with field aliases for broiler performance page
- **`components/ui/Modal.js`**: portal-rendered modal component (was missing, now created)
- **`components/ui/KpiCard.js`**: status-colour KPI card with `onClick` support
- **Prisma schema** (Phase 8B): `EggProduction` (crate-based), `FeedConsumption` (bag-based), `WaterMeterReading`, `DailySummary`, `WeightRecord`, `BroilerHarvest`, all enums
- **Seed v2.2**: 4 layer flocks + 4 broiler flocks, 30 days egg records, weight records, water readings, daily summaries, all user roles, realistic Nigerian farm data

#### 🔧 Remaining in Phase 8B (build next session)

**Priority 1 — Worker data entry modals (core workflow gaps)**

| Item | Description |
|------|-------------|
| **Water meter reading modal** | Worker logs daily odometer reading. `POST /api/water-readings`. Model: `WaterMeterReading` (`penSectionId`, `readingDate`, `meterReading`). System computes `consumptionL = today − yesterday`, `consumptionLPB`. Unique constraint: `(penSectionId, readingDate)`. |
| **Feed log modal** | Worker logs daily feed distribution. `POST /api/feed-consumption`. Body: `bagsUsed`, `remainingKg`, `feedInventoryId`, `feedTime`. `quantityKg = (bagsUsed × bagWeightKg) − remainingKg`. `feedTime` is TIMESTAMPTZ replacing old `feedBatch INT`. |
| **PM Grade B grading modal** | PM enters `gradeBCrates`, `gradeBLoose`, `crackedConfirmed` for a pending egg record. `PATCH /api/eggs/[id]` with grading fields. System computes and stores `gradeBCount`, `gradeACount`, `gradeAPct`, sets `submissionStatus = 'APPROVED'`. |

**Priority 2 — Verification wiring**

| Item | Description |
|------|-------------|
| **PM dashboard Verify/Flag PATCH** | Current buttons POST to `/api/verification` (creates new record). Should PATCH existing pending record. `/api/verification/[id]` PATCH endpoint exists — wire it from the dashboard panel. |
| **Full verification page** | `app/verification/page.js` is built (uploaded during session). Verify it wires correctly to `PATCH /api/verification/[id]` for approve/query/escalate actions. |

**Priority 3 — Daily summary**

| Item | Description |
|------|-------------|
| **Daily summary card UI** | Shows `DailySummary` per pen section: checklist booleans, production aggregates, `closingObservation`. Auto-submitted at `Farm.autoSummaryTime` (default `"19:00"`). `GET/POST /api/daily-summary`. |
| **Farm settings: auto-submit time picker** | Add time picker to Settings page for `Farm.autoSummaryTime`. |

**Priority 4 — Minor fixes**
- `WATER_CHECK` TaskType enum — deferred. Use `INSPECTION` in all task references.
- Broiler worker process flow parity with layer worker (equivalent modals on worker page).

### 📋 8C — Brooding Module

**What it covers:** Day-old chick arrival through transfer to production pens. Layer brooding: weeks 1–6. Broiler brooding: weeks 1–2.

**Brooding-specific metrics:** Brooder temperature (3× daily, multiple zones), relative humidity, chick arrival count, uniformity score at intake, early mortality rate (week 1 and 2 separately), feed starter consumption, transfer date and weight.

**Task templates (auto-generated on arrival):**
| Time | Task | Data Entry |
|------|------|-----------|
| 06:00 | Record brooder temperature — all zones | TEMPERATURE_LOG |
| 07:00 | Distribute feed starter | FEED_DISTRIBUTION |
| 08:00 | Observe chicks / remove dead | MORTALITY |
| 12:00 | Record brooder temperature — all zones | TEMPERATURE_LOG |
| 13:00 | Check drinkers | OBSERVATION |
| 16:00 | Record brooder temperature — all zones | TEMPERATURE_LOG |
| 17:00 | Distribute feed starter | FEED_DISTRIBUTION |
| 17:30 | Observe chicks / remove dead | MORTALITY |

**New routes:**
```
POST  /api/brooding/arrivals          — log day-old chick arrival, trigger task generation
GET   /api/brooding/arrivals          — list active brooding batches
PATCH /api/brooding/arrivals/[id]     — update or record transfer to production
POST  /api/brooding/temperature       — log temperature reading (linked to task)
GET   /api/brooding/[id]/summary      — full brooding period summary for a batch
```

**New page: `/brooding`** — Active batches, arrivals tab, temperature chart, transfer tab. KPIs at transfer: total early mortality %, chick-to-transfer survival rate, cost per surviving chick.

**New DB models needed:**
```
chick_arrivals      — brooding batch record
temperature_logs    — brooder temperature readings
```

### 📋 8D — Layer Production Module (Refactor)

Replaces the current performance page with a dedicated Layer module. Accessible when `operationMode` is `LAYER_ONLY` or `BOTH`.

**Metrics to add:** Hen-housed production rate %, feed cost per dozen, laying persistence curve (production rate vs flock age in weeks), peak production week, post-peak decline rate, cumulative mortality vs age.

**Egg collection refinement:** Morning (08:00) and afternoon (16:00) batches tracked independently with grade breakdown. Daily total auto-computed.

**New page: `/production/layers`** — Flock lifecycle indicator (Pre-lay / Peak / Maintaining / Declining / Cull-recommended), 13-week laying rate trend, grade distribution, cull recommendation trigger (feed cost per dozen > revenue per dozen for 2+ consecutive weeks).

### 📋 8E — Broiler Production Module (Refactor)

Replaces the current broiler performance page with a dedicated Broiler module.

**Metrics to add:** Projected harvest date and marketable weight based on current growth rate, revenue estimate (projected weight × market price/kg), alert when projected weight > 5% below target with < 7 days to harvest, batch history comparison (last 5 batches — FCR, mortality %, revenue per bird, profit per batch).

**New page: `/production/broilers`** — Active batches with harvest scheduler (calendar view across all batches), weight chart vs Ross 308/Cobb 500 curve, batch profitability summary.

### 📋 8F — Worker PWA
Mobile-optimised Progressive Web App for PEN_WORKER and PEN_MANAGER.
- `public/manifest.json` — standalone display, purple theme `#6c63ff`
- `public/sw.js` — offline caching and IndexedDB submission queue
- Web Push — 7am shift-start notification with pending task count
- Task list as home screen, large inputs, thumb-reachable controls, connectivity indicator
- Photo documentation on flagged observation tasks
- One-tap "no issues" completion for observation tasks

### 📋 8G — Worker Task System (Structured)
**Built after 8C–8E** because task templates are operation-specific.
- Default templates auto-generated on pen section creation based on operation type
- Templates editable per tenant (times, additions, removals)
- Tasks generated daily at midnight for the following day
- Workers only see tasks for their assigned sections
- Time window enforcement: ±2 hours from scheduled time (configurable)
- **New DB models:** `task_templates`, `daily_tasks`

### 📋 8H — Feed Management Refactor
- Feed types tagged by operation phase: `LAYER_STARTER` | `LAYER_GROWER` | `LAYER_LAYER` | `BROILER_STARTER` | `BROILER_GROWER` | `BROILER_FINISHER` | `BROODING_STARTER`
- Feed inventory filtered by active operation mode
- Consumption logging pre-filled from task context
- Withdrawal period tracking for Broiler Finisher (days before harvest)

---

## Phase 9 — Feed Mill Module 📋

> **Goal:** Build the Feed Mill as an independent operational module for farms that produce their own feed.
> **Accessible when:** `tenant.settings.hasFeedMillModule = true`

### 9.1 — Raw Materials Inventory
Stock quantities with reorder levels, receive deliveries (linked to AP invoice), cost per kg per material.

### 9.2 — Feed Batch Production
Production run creation (formula, batch size, raw material quantities), raw material deduction on production, variance tracking (actual vs formula), production cost per kg auto-calculated.

### 9.3 — QC Testing
Moisture %, protein %, energy density — entered by QC Technician. Pass/fail against formula spec. Failed batches quarantined. QC certificate per passing batch.

### 9.4 — Release to Feed Inventory
Approved batch transferred to main inventory as a feed receipt. Cost price = production cost per kg. Full traceability: inventory → batch → raw material lots.

### 9.5 — Feed Mill Dashboard
Active production runs, raw material levels vs reorder, cost per kg trend by formula, batch yield efficiency.

**New routes:** `/api/feed-mill/materials`, `/api/feed-mill/formulas`, `/api/feed-mill/batches`, `/api/feed-mill/qc`, `/api/feed-mill/releases`

---

## Phase 10 — Processing Plant Module 📋

> **Goal:** Cover slaughter, dressing, packaging, cold storage, and dispatch.
> **Accessible when:** `tenant.settings.hasProcessingModule = true`

### 10.1 — Harvest Intake
Receive live birds from Broiler Production, record transport mortality (DOA count), create processing batch linked to originating flock.

### 10.2 — Processing Records
Birds processed, total live weight, dressed weight, dressing % (target 70–75%), by-product capture, processing cost per bird.

### 10.3 — Output & Packaging
Whole bird and cut parts, packs produced per category, cold storage intake with temperature and location, best-before date.

### 10.4 — Cold Storage Inventory
Real-time stock by product type and cut, FIFO alerts, temperature log (task-linked), dispatch records linked to AR sales invoices.

### 10.5 — Processing Dashboard
Today's processing run metrics, cold storage stock, dispatch vs intake trend, yield efficiency trend.

**New routes:** `/api/processing/intake`, `/api/processing/batches`, `/api/processing/storage`, `/api/processing/dispatch`, `/api/processing/temperature`

---

## Phase 11 — Verification & Internal Control 📋

> **Goal:** Transform verification into an intelligent reconciliation system that actively surfaces anomalies.

### 11.1 — Typed Verification (Role × Record Type × Module)
| Record Type | Module | Primary Verifier | Secondary |
|-------------|--------|-----------------|-----------|
| EggCollection | Layer | PEN_MANAGER | FARM_MANAGER, FARM_ADMIN |
| MortalityRecord | Layer / Broiler / Brooding | PEN_MANAGER | FARM_MANAGER |
| WeightSample | Broiler | PEN_MANAGER | FARM_MANAGER |
| FeedDistribution | Layer / Broiler / Brooding | PEN_MANAGER | FARM_MANAGER |
| FeedConsumption | Store | STORE_MANAGER | FARM_MANAGER |
| StoreReceipt | Store | STORE_MANAGER | FARM_ADMIN |
| TemperatureLog | Brooding | PEN_MANAGER | FARM_MANAGER |
| ProcessingRecord | Processing | PROCESSING_MANAGER | FARM_MANAGER |
| FeedMillBatch | Feed Mill | FEED_MILL_MANAGER | FARM_ADMIN |

**Self-verification prevention:** Enforced at API level — verifier must be a different user from the submitter.

### 11.2 — Near-Real-Time Verification Notifications
- On task completion: assigned verifier notified within 5 minutes (in-app + SMS)
- Batched: morning group at 11:30, afternoon at 17:30
- Urgent override: mortality above threshold, temperature out of range, or flagged observation → immediate

### 11.3 — Cross-Record Validation Engine
| Rule | Trigger | Alert To |
|------|---------|----------|
| Feed distributed > birds × max g/bird/day × 1.2 | Feed submission | PEN_MANAGER |
| Mortality logged but next feed log unchanged | Next feed submission | PEN_MANAGER, FARM_MANAGER |
| Egg count > 110% of 7-day average | Egg submission | PEN_MANAGER |
| Egg count < 60% of 7-day average (no disease logged) | Egg submission | FARM_MANAGER |
| Brooder temp outside 28–35°C range (week 1) | Temperature log | PEN_MANAGER |
| Weight sample > 15% below breed standard for age | Weight submission | FARM_MANAGER |
| Dressing % < 65% (processing) | Processing record | PROCESSING_MANAGER |
| Zero mortality 14+ consecutive days (large flock) | Daily check | IC_OFFICER |
| Worker submits implausibly round numbers repeatedly | Weekly pattern | IC_OFFICER |
| Task completed outside ±2hr window | Task submission | PEN_MANAGER |
| Cold room temp > 4°C for > 30 minutes | Temperature log | PROCESSING_MANAGER |

### 11.4 — IC Dashboard & Audit Page (`/audit`)
Anomaly feed (severity-sorted), pending verifications with age, compliance heatmap (section × day, 14-day view), worker performance (completion rate, rejection rate, anomaly flags), shrinkage indicators. Filters: date range, record type, action, user, section, module. Physical count reconciliation tab. Export: PDF and CSV.

### 11.5 — Physical Count Reconciliation
Surprise count triggered by FARM_ADMIN or IC_OFFICER. Count types: BIRDS | EGGS_IN_STORE | FEED_STOCK | PROCESSED_PRODUCT. Variance = system count − physical count.

---

## Phase 12 — Owner Intelligence 📋

> **Goal:** Unified Chairperson dashboard across all active operation modules.

### 12.1 — Unified Owner Dashboard
Total active birds (Brooding / Layer / Broiler separately), revenue vs last month, feed cost as % of revenue, AR/AP summary. Layer panel, Broiler panel, Processing panel, and Feed Mill panel — each rendered only when module is active.

### 12.2 — Batch Profitability (Broiler + Processing)
Full lifecycle P&L per broiler batch: revenue (sale × dressed weight), chick cost, feed cost, processing cost, vet/drugs. Margin per batch, per bird, and per kg.

### 12.3 — Layer Flock Lifecycle Analytics
Laying rate vs flock age on the natural curve, projected peak week, projected end-of-lay, recommended cull date, replacement planning prompt (< 8 weeks to cull), cull trigger logic.

### 12.4 — Operation Mix Analysis (BOTH tenants)
Layer vs Broiler revenue as % of total, feed cost by operation, labour allocation estimate, profitability recommendation based on current market prices.

---

## Phase 13 — Monetisation & Tiers 📋

> **Goal:** Map operation modes and modules to Stripe product tiers.

| Tier | Operations | Key Inclusions | User Limit |
|------|-----------|----------------|------------|
| **Starter** | Layer Only OR Broiler Only | Brooding, core production, feed, basic verification, AP/AR | 10 users |
| **Growth** | Layer + Broiler | Everything × 2 ops, full finance, owner dashboard, SMS alerts | 25 users |
| **Professional** | Layer + Broiler + 1 add-on | Everything + IC dashboard, audit log, physical count | 50 users |
| **Enterprise** | All modules | All modules, multi-farm, dedicated onboarding, SLA | Unlimited |

**Add-ons (Growth+):** Feed Mill module, Processing Plant module, WhatsApp data entry channel.

**Implementation:** Operation mode toggle gates module access. Stripe plan maps to tier. Upgrade prompt when accessing out-of-tier module. 14-day trial with full Enterprise access.

---

## Phase 14 — Production Hardening 📋

### 14.1 — Multi-tenant Onboarding
Self-service signup, operation mode as step 2, automated tenant provisioning, welcome email, 14-day trial auto-conversion.

### 14.2 — API Security
Per-tenant rate limiting, input sanitisation middleware, full `tenantId` scoping audit across all routes.

### 14.3 — Test Suite
Unit tests (format utils, role helpers, calculation functions), integration tests (task completion, verification, finance, brooding lifecycle), seed-based fixtures.

### 14.4 — Offline-First PWA Hardening
24-hour cache of task list and section data, IndexedDB offline queue with auto-sync, conflict resolution, connectivity indicator always visible.

---

## Phase 15 — Future Modules 🔮

| Module | Description |
|--------|-------------|
| **WhatsApp Data Entry** | Termii WhatsApp Business API. Workers send structured messages; parser maps to structured records. |
| **Native Mobile App** | React Native. Camera, reliable push, barcode/QR scan for pen/flock/product ID. |
| **HR / Payroll** | Attendance from task completion records, leave management, payroll, payslip PDF. |
| **Asset Management** | Equipment register, maintenance scheduling (task-linked), depreciation, utilisation reports. |
| **Budget Module** | Annual budget by cost category, monthly actuals vs budget variance, integrated into P&L. |
| **Multi-farm Consolidated View** | Cross-farm KPI aggregation for groups, consolidated P&L across sites. |
| **Market Price Integration** | Live price feeds for eggs, broiler/kg, maize, soybean. Auto-updates revenue projections. |

---

## Implementation Sequence

```
COMPLETE  Phase 8A    Operation mode selector — DONE
          Phase 8B    Production dashboards — MOSTLY DONE (data entry modals remaining)
                      ├── ✅ Main dashboard (all 11 roles)
                      ├── ✅ Layer performance page
                      ├── ✅ Broiler performance page
                      ├── ✅ Dashboard APIs + eggs API + weight-records API
                      ├── 🔧 Water meter modal + Feed log modal + PM grading modal
                      ├── 🔧 PM verification PATCH wiring
                      └── 🔧 Daily summary UI

NEXT      Phase 8C    Brooding module (chick arrival → transfer lifecycle)
THEN      Phase 8D    Layer Production refactor (hen-housed rate, laying persistence, cull trigger)
THEN      Phase 8E    Broiler Production refactor (harvest scheduler, batch profitability)
THEN      Phase 8F    Worker PWA (manifest, service worker, offline, push notifications)
THEN      Phase 8G    Worker task system (structured templates, daily_tasks model)
THEN      Phase 8H    Feed management refactor (operation-typed feed categories)
THEN      Phase 9     Feed Mill Module
THEN      Phase 10    Processing Plant Module
THEN      Phase 11    Verification & Internal Control (cross-record validation engine)
THEN      Phase 12    Owner Intelligence (unified cross-operation dashboard)
THEN      Phase 13    Monetisation & Tiers
THEN      Phase 14    Production Hardening (onboarding, security, tests, offline)
FUTURE    Phase 15    WhatsApp, Native App, HR, Assets, Budget, Market Prices
```

---

## Technical Debt & Known Constraints

| Item | Status | Notes |
|------|--------|-------|
| Prisma version | ✅ Locked at 5.22.0 | NEVER upgrade to 7.x |
| pdfmake version | ✅ Locked at v0.2.x | NEVER upgrade — use `pdfmake/src/printer.js` |
| Next.js version | ✅ 16 | `serverExternalPackages` (top-level), `turbopack: {}` |
| Auth token | ✅ localStorage `pfp_token` | Always use `apiFetch` — never raw `fetch()` |
| Seed IDs | ✅ Slugs, not UUIDs | Use `z.string().min(1)` not `.uuid()` in all Zod schemas |
| `penWorkerAssignment` | ✅ No `tenantId` field | Filter only with `{ userId: user.sub }` |
| `penWorkerAssignment` | ✅ No `isActive` field | Never filter by it |
| `penSection` | ✅ No `isActive` field | Never filter by it |
| `.btn` CSS class | ⚠️ global `display:block; width:100%` | Never use inside flex rows |
| `schema.prisma` | ✅ DB-first only | SQL → pgAdmin → `npx prisma db pull` → `npx prisma generate`. Never edit schema directly. Prisma comments use `//` not `--` |
| `WeightSample` model | ❌ Does NOT exist | Use `WeightRecord` model and `/api/weight-records` endpoint instead |
| `aggregateProduction` import | ❌ Removed from eggs API | `@/lib/services/analytics` may not be deployed — do not re-import |
| `operationType` field | ⚠️ On `Pen` model | Not on `PenSection`. Access via `pen.operationType` |
| Flock placement date | ✅ `dateOfPlacement` | NOT `placementDate` |
| Egg two-phase workflow | ✅ LOCKED | Worker enters crates/loose/cracked → system totals. PM enters gradeBCrates/gradeBLoose/crackedConfirmed → system computes gradeA. NEVER return to single-phase. |
| `TaskType` enum | ✅ No `WATER_CHECK` | Use `INSPECTION` for water checks until enum is extended |
| Verification context format | ✅ `"Pen Name — Section Name | Flock: BATCH"` | Pen names contain ` — ` — use `startsWith` matching, never `split('—')` |
| React hooks order | ✅ Fixed | All hooks before any early returns |
| Next.js 16 `params` | ✅ Fixed | Always `const params = await rawParams` at top of every dynamic route |
| Verification role constants | ✅ Three arrays | Update `VERIFIER_ROLES`, `REJECT_ROLES`, `MANAGER_ROLES` in both route files AND page when adding record types |
| `activeFlock` | ✅ Fixed | `sec.activeFlock` (single object), never `sec.flocks.map(...)` |
| pdfmake fonts | ✅ Helvetica only | Always `defaultStyle: { font: 'Helvetica' }` |
| Currency in PDFs | ✅ ASCII only | `NGN `, `$` — never `₦`, `€`, `£`, `₵` |
| `SupplierInvoice` linked relations | ✅ Manual fetch | No Prisma `@relation` on `linkedReceiptId`/`linkedPOId` |
| Empty strings in Zod | ✅ Sanitise to null | `field: form.field \|\| null` before every POST/PATCH |
| Prisma `{ not: null }` filter | ✅ Use `{ not: undefined }` | Prisma v5 rejects `{ not: null }` in string filters |
| bcrypt in routes | ✅ Top-level import | `import bcrypt from 'bcryptjs'` + `await bcrypt.hash()`. Never `require()` inside handlers |
| `@db.Date` columns | ✅ Normalise `since` | Always call `since.setHours(0,0,0,0)` before using a JS Date in a `gte`/`lte` filter against a `@db.Date` column |
| 500 error visibility | ✅ Pattern established | Include `detail: error?.message` in all 500 responses for server-side error diagnosis |
| Tab switcher pattern | 📋 Phase 8D/8E | Remove when Layer/Broiler modules are fully separated into `/production/layers` and `/production/broilers` |
| Brooding DB models | 📋 Phase 8C | `chick_arrivals`, `temperature_logs` — SQL migration required |
| Task system DB models | 📋 Phase 8G | `task_templates`, `daily_tasks` — SQL migration required |
| Feed Mill DB models | 📋 Phase 9 | New schema required |
| Processing Plant DB models | 📋 Phase 10 | New schema required |
| Offline PWA | 📋 Phase 8F/14.4 | Service worker not yet implemented |
| Audit page frontend | 📋 Phase 11.4 | API exists, nav accessible to IC, full frontend in Phase 11 |
| Operation mode toggle | ✅ Phase 8A done | `tenant.settings.operationMode`, settings UI, AppShell gating all live |

---

## Role × Feature Access Matrix

| Feature | PEN_WORKER | PEN_MANAGER | STORE_CLERK | STORE_MGR | FEED_MILL_MGR | PROCESSING_MGR | FARM_MGR | FARM_ADMIN | CHAIRPERSON | ACCOUNTANT | IC_OFFICER |
|---------|:---------:|:-----------:|:-----------:|:---------:|:-------------:|:--------------:|:--------:|:----------:|:-----------:|:----------:|:----------:|
| Worker Task Dashboard | ✅ | ✅ | — | — | — | — | — | — | — | — | — |
| Complete Tasks / Log Data | ✅ | ✅ | — | — | — | — | — | — | — | — | — |
| Brooding module | — | ✅ | — | — | — | — | ✅ | ✅ | ✅ | — | — |
| Layer Performance page | ✅ | ✅ | — | — | — | — | ✅ | ✅ | ✅ | — | — |
| Broiler Performance page | ✅ | ✅ | — | — | — | — | ✅ | ✅ | ✅ | — | — |
| PM Pending Verifications panel | — | ✅ | — | — | — | — | — | — | — | — | — |
| Weight Tracking | — | ✅ | — | — | — | — | ✅ | ✅ | ✅ | — | — |
| Feed Management | — | — | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | — | — |
| Feed Mill module | — | — | — | — | ✅ | — | ✅ | ✅ | ✅ | — | — |
| Processing Plant | — | — | — | — | — | ✅ | ✅ | ✅ | ✅ | — | — |
| Health Management | — | ✅ | — | — | — | — | ✅ | ✅ | ✅ | — | — |
| Farm Structure | — | ✅ | — | — | — | — | ✅ | ✅ | ✅ | — | — |
| Flock Management | — | ✅ | — | — | — | — | ✅ | ✅ | ✅ | — | — |
| Verify Records | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| Task Compliance View | — | ✅ | — | — | — | — | ✅ | ✅ | ✅ | — | ✅ |
| Anomaly / IC Dashboard | — | — | — | — | — | — | — | ✅ | ✅ | — | ✅ |
| Physical Count | — | — | — | — | — | — | — | ✅ | ✅ | — | ✅ |
| Audit Log | — | — | — | — | — | — | — | ✅ | ✅ | — | ✅ read-only |
| Owner Dashboard | — | — | — | — | — | — | — | — | ✅ | — | — |
| User Admin | — | — | — | — | — | — | — | ✅ | ✅ | — | — |
| Finance (view) | — | — | — | — | — | — | — | ✅ | ✅ | ✅ | ✅ |
| Finance (actions) | — | — | — | — | — | — | — | ✅ | ✅ | ✅ | — |
| Bank Reconciliation | — | — | — | — | — | — | — | ✅ | — | ✅ | — |
| Accountant Dashboard | — | — | — | — | — | — | — | — | — | ✅ | — |
| Operation Mode Settings | — | — | — | — | — | — | — | ✅ | ✅ | — | — |
| Billing | — | — | — | — | — | — | — | ✅ | ✅ | — | — |
