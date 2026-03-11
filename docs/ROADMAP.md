# PoultryFarm Pro — Module Development Roadmap
> Last updated: 10 March 2026 (rev 5)
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
When a farm signs up, they select their operation mode: `LAYER_ONLY`, `BROILER_ONLY`, or `BOTH`. This single setting determines which nav items appear, which dashboards are shown, which task templates are generated, and which modules are licensed. It is the foundation of both the product experience and the monetisation model. A farm cannot see or access modules outside their selected mode.

**3. Brooding is the starting phase of both operations, not a separate solution.**
Every batch begins in the brooder. Brooding has its own metrics, task templates, and transition trigger (graduation to production pens). It is a phase within both Layer and Broiler workflows, not a standalone module — but it must be built as a distinct operational stage with its own screens, tasks, and KPIs.

**4. Data entry is part of the workflow, not a separate task.**
Workers complete tasks. When a task requires data, the form appears at completion. Pre-filled context, minimal inputs, one screen per action. The system captures data as a by-product of operational compliance.

**5. Verification is a reconciliation system, not an approval workflow.**
Its purpose is operational efficiency (catch errors while physical evidence exists) and theft/loss prevention (cross-validate records, surface anomalies automatically). The IC Officer acts on patterns — the system does the detection.

---

## Legend
| Symbol | Meaning |
|--------|---------|
| ✅ | Complete and deployed |
| 🔧 | In active fix / improvement cycle |
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

## Phase 8 — Operation Mode & Full Production Cycle Architecture 📋 NEXT

> **Goal:** Establish the operation mode selector as the foundational configuration layer. Define and separate all five operational modules (Brooding, Layer Production, Broiler Production, Feed Mill, Processing Plant) as independent solutions that share infrastructure but have distinct screens, metrics, task templates, and access controls. This phase is architecture-first — it determines the shape of everything that follows.

### 8A — Operation Mode Selector (Build First)

**This is the first thing built in Phase 8.** Everything else depends on it.

**Tenant-level operation mode:**
```
operationMode: LAYER_ONLY | BROILER_ONLY | BOTH

Optional modules (licensed separately):
  hasBroodingModule:    boolean  — always true if Layer or Broiler active
  hasFeedMillModule:    boolean  — for farms that produce their own feed
  hasProcessingModule:  boolean  — for farms with on-site processing/slaughter
```

**Where it lives:** Tenant settings model (`settings` JSON field, already exists). Readable from AppShell on every page load.

**What it controls:**
- **Nav items:** A `LAYER_ONLY` farm never sees Broiler production screens. A `BROILER_ONLY` farm never sees egg collection. A `BOTH` farm sees both, clearly labelled.
- **Dashboard panels:** Operation mode determines which KPI panels render on every role's dashboard.
- **Task templates:** When a new pen section is created, default task templates are generated based on the section's operation type AND the tenant's mode. A Broiler section on a `LAYER_ONLY` tenant cannot exist.
- **Reporting:** P&L, production reports, and owner analytics are scoped to active modules only.
- **Monetisation:** Each mode maps to a product tier or add-on (see Phase 13).

**Settings UI addition (`/settings` → Operations tab):**
- Operation mode selector (radio: Layers / Broilers / Both)
- Optional module toggles: Feed Mill, Processing Plant
- Warning on change: "Changing your operation mode will hide screens and data associated with the deactivated operation. Historical data is preserved."
- Role gate: FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN only

**AppShell changes:**
- Reads `tenant.settings.operationMode` on load
- Nav items conditionally rendered:
  ```
  LAYER_ONLY:   Brooding, Layer Production, Egg Collection, Health, Feed, Verification, Finance
  BROILER_ONLY: Brooding, Broiler Production, Health, Feed, Processing (if enabled), Verification, Finance
  BOTH:         Brooding, Layer Production, Broiler Production, Egg Collection, Health, Feed,
                Processing (if enabled), Verification, Finance
  Feed Mill nav item: only if hasFeedMillModule = true
  ```

### 8B — Brooding Module (Phase within Both Operations)

**What brooding is:** The period from day-old chick arrival to transfer into production pens. Layer brooding: approximately weeks 1–6 of life. Broiler brooding: approximately weeks 1–2 (merged with production in intensive systems, but tracked separately).

**Brooding-specific metrics:**
- Brooder temperature (°C) — multiple zones, recorded 3× daily
- Relative humidity % — recorded 3× daily
- Day-old chick arrival count and supplier details
- Chick uniformity score at intake (visual assessment: 1–5)
- Early mortality rate (week 1 and week 2 separately — high early mortality indicates hatchery or transport issues)
- Feed starter consumption (g/chick/day)
- Water consumption (estimated)
- Vaccination schedule for the brooding period
- Transfer date and weight at transfer

**Brooding task templates (auto-generated on chick arrival):**

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

**Brooding lifecycle:**
- Triggered by: chick arrival event (Farm Manager logs arrival — date, count, supplier, chick cost)
- Active period: defined by expected transfer date (set at arrival)
- Transfer event: Farm Manager records transfer date, transfer weight (mean sample), and destination pen section
- On transfer: brooding record closes, flock moves to production phase (Layer or Broiler)
- KPIs at transfer: total early mortality %, chick-to-transfer survival rate, cost per surviving chick

**New routes:**
```
POST  /api/brooding/arrivals          — log day-old chick arrival, trigger task generation
GET   /api/brooding/arrivals          — list active brooding batches
PATCH /api/brooding/arrivals/[id]     — update or record transfer to production
POST  /api/brooding/temperature       — log temperature reading (linked to task)
GET   /api/brooding/[id]/summary      — full brooding period summary for a batch
```

**New page: `/brooding`**
- Active batches tab: each batch card showing age (days), survival rate, latest temperature, days to transfer
- Arrivals tab: log new chick arrival (triggers new brooding batch + task generation)
- Temperature log: chart of temperature readings vs target range over time
- Transfer tab: record graduation of a batch to production

### 8C — Layer Production Module (Refactored)

Replaces the current shared egg/mortality pages with a Layer-scoped module. Accessible only when `operationMode` is `LAYER_ONLY` or `BOTH`.

**Layer-specific metrics (confirmed):**
- Hen-day production rate % — eggs laid ÷ hens alive × 100
- Hen-housed production rate % — eggs laid ÷ hens placed × 100
- Grade distribution per batch: A / B / Cracked / Dirty
- Feed cost per dozen eggs
- Laying persistence curve (production rate vs flock age in weeks)
- Peak production week and post-peak decline rate
- Cumulative mortality vs flock age (age-adjusted expectations)

**Egg collection batch tracking:**
- Batch 1 (morning): ~08:00
- Batch 2 (afternoon): ~16:00
- Each batch logged independently with grade breakdown
- Daily total auto-computed from both batches
- Links to task completion record

**New/refactored routes:**
```
GET/POST  /api/production/eggs            — Layer egg collection records
GET       /api/production/eggs/summary    — KPIs, laying rate trend, grade breakdown
GET/POST  /api/production/layer/flocks    — Layer flock management
```

**New page: `/production/layers`**
- Flock overview: age (weeks), hen-housed rate, current laying %, days in production
- Laying rate trend chart (13-week view)
- Grade distribution chart
- Flock lifecycle indicator: Pre-lay / Peak / Maintaining / Declining / Cull-recommended
- Cull recommendation trigger: when feed cost per dozen > revenue per dozen for 2+ consecutive weeks

### 8D — Broiler Production Module (Refactored)

Replaces current broiler dashboard content with a Broiler-scoped module. Accessible only when `operationMode` is `BROILER_ONLY` or `BOTH`.

**Broiler-specific metrics (confirmed):**
- Daily live weight sample vs Ross 308 / Cobb 500 breed standard curve
- FCR: cumulative feed consumed ÷ weight gained since brooding transfer
- Uniformity %: birds within ±10% of mean weight
- Daily and cumulative mortality rate
- Projected harvest date and marketable weight
- Estimated revenue and cost per kg live weight

**Weight sampling:**
- Sample size: minimum 50 birds or 5% of flock, whichever is greater
- Recorded: mean weight (g), min, max, uniformity %
- Comparison against breed standard curve (pre-loaded Ross 308 and Cobb 500 data)
- FCR auto-calculated from cumulative feed and weight data

**Harvest planning:**
- System projects harvest date based on current growth rate vs target weight
- Revenue estimate: projected weight × current market price per kg (configurable)
- Alert when projected weight is > 5% below target with < 7 days to planned harvest

**New routes:**
```
GET/POST  /api/production/weights           — weight sample records
GET       /api/production/broiler/summary   — FCR, weight curve, harvest projection
GET/POST  /api/production/broiler/flocks    — Broiler flock management
```

**New page: `/production/broilers`**
- Active batches: age (days), current weight vs target, FCR, days to harvest, estimated revenue
- Weight chart: actual vs Ross 308 / Cobb 500 curve
- Batch history: last 5 batches — FCR, mortality %, revenue per bird, profit per batch
- Harvest scheduler: calendar view of upcoming harvests across all batches

### 8E — Worker Task System

**Built after 8A–8D** because task templates are operation-specific. A Layer task schedule cannot be defined until the Layer module exists.

**Task schedule principles:**
- Default templates auto-generated when a pen section is created based on its operation type
- Templates are editable per tenant — farms can adjust times, add tasks, remove tasks
- Tasks generated daily at midnight for the following day
- Workers only see tasks for their assigned sections
- Time window enforcement: ±2 hours from scheduled time (configurable)
- Observation tasks: one-tap complete or flag issue — no form
- Data-entry tasks: form slides up on complete, pre-filled with all context

**Full Layer task schedule:** (defined in 8.3 above)
**Full Broiler task schedule:** (defined in 8.3 above)
**Brooding task schedule:** (defined in 8B above)

**New DB models:**
```sql
task_templates  — recurring task definitions per section and operation type
daily_tasks     — generated daily instances with status and timestamps
temperature_logs — brooder temperature readings (Phase 8B)
weight_samples   — broiler weight sampling records (Phase 8D)
```

**API routes:** (defined in Phase 8 — Task System section above)

### 8F — Worker PWA

Mobile-optimised Progressive Web App for PEN_WORKER and PEN_MANAGER roles.

- `public/manifest.json` — standalone display, purple theme `#6c63ff`
- `public/sw.js` — offline caching and submission queue via IndexedDB
- Web Push — 7am shift-start notification with pending task count
- Task list as home screen — no navigation required
- Large inputs, thumb-reachable controls, connectivity indicator
- Photo documentation on flagged observation tasks
- One-tap "no issues" completion for observation tasks

### 8G — Feed Management Refactor

Existing feed module updated to reflect operation mode:

- Feed types tagged: `LAYER_STARTER` | `LAYER_GROWER` | `LAYER_LAYER` | `BROILER_STARTER` | `BROILER_GROWER` | `BROILER_FINISHER` | `BROODING_STARTER`
- Feed inventory filtered by active operation mode — irrelevant feed types hidden
- Consumption logging pre-filled from task context (section, flock, date)
- Separate low-stock alerts by feed type and operation
- Withdrawal period tracking for Broiler Finisher (days before harvest)

---

## Phase 9 — Feed Mill Module 📋 PLANNED

> **Goal:** Build the Feed Mill as an independent operational module for farms that produce their own feed. It is a supplier to the main feed inventory — raw materials in, finished feed batches out.

**Accessible when:** `tenant.settings.hasFeedMillModule = true`

### 9.1 — Raw Materials Inventory
- Raw material types: Maize, Soybean Meal, Fishmeal, Premix, Limestone, Salt, etc.
- Stock quantities with reorder levels
- Receive deliveries (linked to AP supplier invoice)
- Cost per kg per material

### 9.2 — Feed Batch Production
- Create a production run: formula name, batch size (kg), raw material quantities per formula
- Deduct raw materials from inventory on production
- Record actual vs formula quantities (variance tracking)
- Production cost per kg auto-calculated: (total raw material cost + overhead) ÷ batch kg

### 9.3 — QC Testing
- Moisture content %, protein %, energy density (MJ/kg) — entered by QC Technician
- Pass/fail against formula spec
- Failed batches quarantined — cannot be released to main feed inventory
- QC certificate attached to each passing batch

### 9.4 — Release to Feed Inventory
- Approved batch transferred to main farm feed inventory
- Transfer creates a feed receipt in the main inventory with cost price = production cost per kg
- Full traceability: main feed inventory record → production batch → raw material lots

### 9.5 — Feed Mill Dashboard
- Active production runs
- Raw material stock levels vs reorder points
- Cost per kg trend by formula over time
- Batch yield efficiency: actual kg out vs formula expected kg out

**New roles:**
- `FEED_MILL_MANAGER` — already exists, now has a proper module
- `FEED_MILL_OPERATOR` — new: operates equipment, logs production runs (create only, cannot approve)

**New routes:**
```
/api/feed-mill/materials        — raw material inventory
/api/feed-mill/formulas         — feed formulas (recipes)
/api/feed-mill/batches          — production run management
/api/feed-mill/qc               — QC test records
/api/feed-mill/releases         — transfer to main inventory
```

---

## Phase 10 — Processing Plant Module 📋 PLANNED

> **Goal:** Build the Processing Plant as an independent operational module covering slaughter, dressing, packaging, cold storage, and dispatch. It sits between Broiler Production and Sales in the production cycle.

**Accessible when:** `tenant.settings.hasProcessingModule = true`

### 10.1 — Harvest Intake
- Receive live birds from Broiler Production: batch ID, pen section, bird count, mean live weight
- Creates a processing batch linked to the originating broiler flock
- Transport mortality recorded: birds dead on arrival (DOA count)

### 10.2 — Processing Records
- Birds processed: count, total live weight
- Dressed weight: total after slaughter and dressing (target: 70–75% of live weight)
- Dressing %: dressed weight ÷ live weight × 100 (key efficiency metric)
- By-product capture: offal weight, feathers (sold or disposed), blood
- Processing cost per bird: labour, utilities, packaging materials

### 10.3 — Output & Packaging
- Whole bird, cut parts (breast, thighs, wings, drumsticks, backs)
- Weight per pack, packs produced per category
- Cold storage intake: product type, quantity, storage temperature, storage location
- Best-before date based on processing date + configurable shelf life

### 10.4 — Cold Storage Inventory
- Real-time stock of each product type and cut
- FIFO alerts: oldest stock flagged when newer stock is being dispatched first
- Temperature log: cold room temperature recorded twice daily (task-linked)
- Dispatch records: quantity dispatched, customer, linked to AR sales invoice

### 10.5 — Processing Dashboard
- Today's processing run: birds processed, dressed weight, dressing %
- Cold storage current stock by product type
- Dispatch vs intake trend (7/14/30d)
- Yield efficiency trend: dressing % over last 10 batches

**New roles:**
- `PROCESSING_MANAGER` — manages processing plant, approves dispatch
- `PROCESSING_STAFF` — already exists (`PRODUCTION_STAFF`), logs processing records

**New routes:**
```
/api/processing/intake          — harvest intake from broiler production
/api/processing/batches         — processing run records
/api/processing/storage         — cold storage inventory
/api/processing/dispatch        — dispatch records (linked to AR invoices)
/api/processing/temperature     — cold room temperature logs
```

---

## Phase 11 — Verification & Internal Control 📋 PLANNED

> **Goal:** Transform verification from a manual approval queue into an intelligent reconciliation system that actively surfaces anomalies across all operational modules.

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

**Self-verification prevention:** Enforced at API level. The verifier must be a different user from the submitter regardless of role.

### 11.2 — Near-Real-Time Verification
- On task completion, assigned verifier notified within 5 minutes (in-app + SMS)
- Batched notification logic: morning group at 11:30, afternoon group at 17:30
- Urgent override: mortality above threshold, temperature outside range, or any flagged observation → immediate notification

### 11.3 — Cross-Record Validation Engine

Anomaly detection rules across all modules:

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

### 11.4 — IC Dashboard & Audit Page
- Anomaly feed sorted by severity
- Pending verifications with submission age
- Compliance heatmap: section × day grid, 14-day view
- Worker performance: completion rate, rejection rate, anomaly flags per worker
- Shrinkage indicators: system vs physical count per section

**Audit page (`/audit`) — fully built:**
- Filters: date range, record type, action, user, section, module
- Flagged records tab with rule description
- Physical count reconciliation tab
- Export: PDF and CSV
- FARM_ADMIN and CHAIRPERSON: full access. IC_OFFICER: read-only

### 11.5 — Physical Count Reconciliation
- Surprise count triggered by FARM_ADMIN or IC_OFFICER — workers not notified
- Count types: BIRDS | EGGS_IN_STORE | FEED_STOCK | PROCESSED_PRODUCT
- Variance = system count − physical count (negative = loss)
- Verifier must be different from counter
- Results feed into IC dashboard shrinkage tracker

---

## Phase 12 — Owner Intelligence 📋 PLANNED

> **Goal:** Give the Chairperson a genuinely useful strategic view across all active operations.

### 12.1 — Unified Owner Dashboard
Replaces the current `/owner` analytics page. Renders only panels relevant to active operation modules.

**Always visible:**
- Total active birds (Brooding / Layer / Broiler counts separately)
- Revenue this month vs last month
- Feed cost as % of revenue (target: < 65%)
- Outstanding AR and AP summary

**Layer panel (if active):**
- Overall laying rate % vs last week
- 13-week laying rate trend chart
- Grade A % trend
- Revenue per hen per week
- Flock lifecycle status for each active flock

**Broiler panel (if active):**
- Active batches: age, weight vs target, FCR, days to harvest
- Next harvest: date, projected weight, projected revenue
- Historical batch comparison: last 5 batches — FCR, mortality %, profit per bird

**Processing panel (if active):**
- This week: birds processed, dressing %, cold storage current stock
- Dispatch vs production trend

**Feed Mill panel (if active):**
- Raw material stock vs reorder levels
- Cost per kg by formula (last 4 batches)
- Production efficiency trend

### 12.2 — Batch Profitability (Broiler + Processing)
Full lifecycle P&L per broiler batch:
- Revenue: sale price × dressed weight (linked to AR invoice)
- Chick cost (supplier invoice at arrival)
- Feed cost: total consumed × average price per kg
- Processing cost: labour + utilities + packaging
- Vet/drugs: health expenditure tagged to flock
- Margin per batch, per bird, and per kg

### 12.3 — Layer Flock Lifecycle Analytics
- Laying rate vs flock age — where each flock sits on the natural curve
- Projected peak week, projected end-of-lay, recommended cull date
- Replacement planning: surface prompt when cull is < 8 weeks away
- Cull trigger: feed cost per dozen > revenue per dozen for 2+ consecutive weeks

### 12.4 — Operation Mix Analysis (BOTH tenants)
- Layer revenue vs Broiler revenue as % of total (which operation is more profitable)
- Feed cost breakdown by operation type
- Labour allocation estimate by operation type
- Recommendation: is the current operation mix optimal given current market prices?

---

## Phase 13 — Monetisation & Tiers 📋 PLANNED

> **Goal:** Map operation modes and modules directly to product tiers. Pricing reflects value delivered per operational scope.

### Proposed Tier Structure

**Starter — Single Operation:**
- Layer Only OR Broiler Only (tenant chooses at signup)
- Includes: Brooding, core production module, feed management, basic verification, finance (AP/AR only)
- User limit: up to 10 users
- Price: per month flat rate

**Growth — Dual Operation:**
- Layer + Broiler
- Includes: everything in Starter × 2 operations, full finance module (P&L, reconciliation), owner dashboard, SMS alerts
- User limit: up to 25 users
- Price: higher flat rate or per-active-bird pricing

**Professional — Full Cycle:**
- Layer + Broiler + Processing Plant OR Feed Mill (one add-on included)
- Includes: everything in Growth + chosen module, IC dashboard, audit log, physical count reconciliation
- User limit: up to 50 users
- Price: per module add-on pricing

**Enterprise — Complete:**
- All modules: Layer + Broiler + Brooding + Feed Mill + Processing Plant
- Includes: everything, multi-farm support, dedicated onboarding, SLA
- User limit: unlimited
- Price: negotiated annually

**Module add-ons (available on Growth+):**
- Feed Mill module: flat monthly add-on
- Processing Plant module: flat monthly add-on
- WhatsApp data entry channel: flat monthly add-on (Phase 14)

### Implementation
- Operation mode toggle in settings gates module access
- Stripe subscription plan maps to tier
- Attempting to enable a module outside current tier shows an upgrade prompt
- Trial (14 days): full Enterprise access to allow proper evaluation

---

## Phase 14 — Production Hardening 📋 PLANNED

### 14.1 — Multi-tenant Onboarding
- Self-service signup: operation mode selection is step 2 of onboarding (after basic details)
- Automated provisioning: tenant record, default farm, admin user, default task templates per selected mode
- Welcome email with setup guide
- 14-day trial with auto-conversion to selected tier

### 14.2 — API Security
- Per-tenant rate limiting
- Input sanitisation middleware
- Full audit of `tenantId` scoping across all routes and all new modules

### 14.3 — Test Suite
- Unit tests: format utils, role helpers, calculation functions
- Integration tests: task completion flow, verification flow, finance flows, brooding lifecycle
- Seed-based fixtures for all modules

### 14.4 — Offline-First PWA Hardening
- 24-hour cache of task list and section data
- IndexedDB offline submission queue with auto-sync
- Conflict resolution for offline/online duplicates
- Connectivity indicator always visible

---

## Phase 15 — Future Modules 🔮

### 🔮 WhatsApp Data Entry Channel
Termii WhatsApp Business API. Workers send structured messages: "Pen 3 eggs 240 A 220 B 20 cracked." Parser maps to structured record. Confirmation message sent back. Removes the app barrier entirely for low-tech workers.

### 🔮 Native Mobile App (React Native)
Once PWA usage data justifies the investment. Camera, reliable push, barcode/QR scan for pen/flock/product identification.

### 🔮 HR / Payroll
Attendance derived from task completion records (already captured). Leave management, payroll calculation, payslip PDF.

### 🔮 Asset Management
Equipment register, maintenance scheduling linked to the task system, depreciation, utilisation reports.

### 🔮 Budget Module
Annual budget by cost category, monthly actuals vs budget variance, links into Accountant Dashboard and P&L.

### 🔮 Multi-farm Consolidated View
Cross-farm KPI aggregation for groups. Consolidated P&L across sites.

### 🔮 Market Price Integration
Live market price feeds for eggs, broiler (per kg), maize, soybean meal. Auto-updates revenue estimates and profitability projections in the owner dashboard.

---

## Implementation Sequence

```
NOW       Phase 8   — Operation Mode & Full Production Cycle Architecture
          ├── 8A    Operation mode selector (tenant settings + AppShell gating)  ← FIRST
          ├── 8B    Brooding module (both operations share this)
          ├── 8C    Layer Production module (refactor existing)
          ├── 8D    Broiler Production module (refactor existing)
          ├── 8E    Worker Task System (operation-specific templates)
          ├── 8F    Worker PWA (manifest, service worker, mobile UX)
          └── 8G    Feed management refactor (operation-typed feed categories)

NEXT      Phase 9   — Feed Mill Module (for farms producing own feed)
THEN      Phase 10  — Processing Plant Module (for farms with on-site slaughter)
THEN      Phase 11  — Verification & Internal Control (all modules covered)
THEN      Phase 12  — Owner Intelligence (unified cross-operation dashboard)
THEN      Phase 13  — Monetisation & Tiers (operation mode → Stripe tiers)
THEN      Phase 14  — Production Hardening (onboarding, security, tests, offline)
FUTURE    Phase 15  — WhatsApp, Native App, HR, Assets, Budget, Market Prices
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
| `penWorkerAssignment` | ✅ No `isActive` field | Never filter by it |
| `penSection` | ✅ No `isActive` field | Never filter by it |
| `.btn` CSS class | ⚠️ global `display:block; width:100%` | Never use inside flex rows |
| `schema.prisma` | ✅ DB-first only | SQL → pgAdmin → `npx prisma db pull` → `npx prisma generate`. Never edit directly |
| `operationType` vs `birdType` | ⚠️ To be standardised in Phase 8 | Currently: Feed/Health = `birdType`; pen/structure = `operationType` |
| React hooks order | ✅ Fixed | All hooks before any early returns |
| Next.js 16 `params` | ✅ Fixed | Always `const params = await rawParams` at top of every dynamic route |
| Verification role constants | ✅ Three separate arrays | Update `VERIFIER_ROLES`, `REJECT_ROLES`, `MANAGER_ROLES` in both route files AND page |
| `activeFlock` | ✅ Fixed | `sec.activeFlock` (single object), never `sec.flocks.map(...)` |
| pdfmake fonts | ✅ Helvetica only | Always `defaultStyle: { font: 'Helvetica' }` |
| Currency in PDFs | ✅ ASCII only | `NGN `, `$`, `GBP `, `EUR ` — never `₦`, `€`, `£`, `₵` |
| `SupplierInvoice` linked relations | ✅ Manual fetch | No Prisma `@relation` on `linkedReceiptId`/`linkedPOId` |
| Empty strings in Zod | ✅ Sanitise to null | `field: form.field \|\| null` before every POST/PATCH |
| Prisma `{ not: null }` filter | ✅ Use `{ not: undefined }` | Prisma v5 rejects `{ not: null }` in string filters |
| bcrypt in routes | ✅ Top-level import | `import bcrypt from 'bcryptjs'` + `await bcrypt.hash()`. Never `require()` inside handlers |
| Audit page | 📋 Phase 11.4 | API exists, nav hidden from IC, full frontend in Phase 11 |
| Tab switcher pattern | 📋 Phase 8C/8D | Removed when Layer/Broiler modules are separated |
| Operation mode toggle | 📋 Phase 8A | `tenant.settings.operationMode` field, settings UI, AppShell gating |
| Task system DB models | 📋 Phase 8E | `task_templates`, `daily_tasks` — migration required |
| Brooding DB models | 📋 Phase 8B | `chick_arrivals`, `temperature_logs` — migration required |
| Weight sample DB model | 📋 Phase 8D | `weight_samples` — migration required |
| Feed Mill DB models | 📋 Phase 9 | New schema required |
| Processing Plant DB models | 📋 Phase 10 | New schema required |
| Offline PWA | 📋 Phase 8F/14.4 | Service worker not yet implemented |

---

## Role × Feature Access Matrix

| Feature | PEN_WORKER | PEN_MANAGER | STORE_CLERK | STORE_MGR | FEED_MILL_MGR | PROCESSING_MGR | FARM_MGR | FARM_ADMIN | CHAIRPERSON | ACCOUNTANT | IC_OFFICER |
|---------|:---------:|:-----------:|:-----------:|:---------:|:-------------:|:--------------:|:--------:|:----------:|:-----------:|:----------:|:----------:|
| Worker Task Dashboard | ✅ | ✅ | — | — | — | — | — | — | — | — | — |
| Complete Tasks / Log Data | ✅ | ✅ | — | — | — | — | — | — | — | — | — |
| Brooding module | — | ✅ | — | — | — | — | ✅ | ✅ | ✅ | — | — |
| Layer Production | — | ✅ | — | — | — | — | ✅ | ✅ | ✅ | — | — |
| Broiler Production | — | ✅ | — | — | — | — | ✅ | ✅ | ✅ | — | — |
| Egg Collection page | — | ✅ | — | — | — | — | ✅ | ✅ | ✅ | — | — |
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
