# PoultryFarm Pro — Development Prompts
> Last updated: 24 March 2026 | Rev 1
> Usage: Copy the prompt for the current phase. Paste into a new session alongside MEMORY.md and ROADMAP.md.
> Each prompt is self-contained — it includes context, constraints, and exact deliverables.

---

## How to Start Every Session

Paste this preamble before any phase prompt:

```
You are a senior developer on the PoultryFarm Pro project.
Read ROADMAP.md and MEMORY.md fully before writing any code.
Stack: Next.js 16 App Router · Prisma 5.22 · PostgreSQL · JWT Auth (localStorage Bearer `pfp_token`) · Tailwind + custom CSS
Follow all 15 absolute rules from MEMORY.md. Never upgrade Prisma or pdfmake. Always use apiFetch, never raw fetch(). Always await params in dynamic routes. Always use z.string().min(1) — never .uuid().
```

---

## Phase 8C — Brooding Module

```
Implement Phase 8C — Brooding Module — as specified in ROADMAP.md §8C.

SCOPE:
Build the full brooding lifecycle: day-old chick arrival → daily monitoring → transfer to production pens.
Layer brooding = weeks 1–6. Broiler brooding = weeks 1–2.

DELIVERABLES:

1. SQL MIGRATION (provide as a .sql file — pgAdmin-ready)
   Create two new tables:
   - chick_arrivals: id (text PK), tenantId, flockId (FK → Flock), arrivalDate (@db.Date), chicksReceived (Int),
     supplier (text?), batchCode (text), status (enum: ACTIVE | TRANSFERRED | CLOSED),
     transferDate (@db.Date?), transferWeight (Float?), notes (text?), createdAt, updatedAt
   - temperature_logs: id (text PK), tenantId, chickArrivalId (FK → chick_arrivals), penSectionId (FK → PenSection),
     loggedAt (DateTime), zone (text — e.g. "Zone A"), tempCelsius (Float), humidity (Float?),
     taskId (text?), loggedBy (text FK → User), createdAt

2. API ROUTES (app/api/brooding/)
   - POST /arrivals — validate with Zod, create ChickArrival record, auto-generate 8 daily Task records
     (use the task template table from ROADMAP.md §8C), return arrival with generated task count
   - GET /arrivals — list active brooding batches for tenant, include section + flock + last temp reading
   - PATCH /arrivals/[id] — update status, record transfer (transferDate, transferWeight)
   - POST /temperature — log temperature reading linked to chickArrivalId, taskId optional
   - GET /[id]/summary — full brooding period: arrival info, daily temp chart data (avg per zone per day),
     early mortality rate (week 1 and 2), total feed consumed, survival rate, cost per surviving chick

3. PAGE: app/brooding/page.js
   Roles: PEN_MANAGER, FARM_MANAGER, FARM_ADMIN, CHAIRPERSON (read + action), PEN_WORKER (read only)
   Tabs: Active Batches | Arrivals | Temperature | Transfer
   - Active Batches tab: card grid per active batch — batch code, chicks in, days in brooder,
     current survival rate, latest temp reading, status pill
   - Arrivals tab: form to log new arrival (chicksReceived, supplier, date, pen section selector)
   - Temperature tab: line chart (Recharts) of avg brooder temp per day, zone breakdown, range bands
     (ideal 28–35°C week 1, 26–32°C week 2, 24–30°C week 3+)
   - Transfer tab: list ACTIVE batches with Transfer button → modal (transferDate, transferWeight,
     surviving count) → PATCH /arrivals/[id]

4. KPIs at transfer (shown in Transfer tab and summary):
   - Early mortality % (week 1 only, week 2 only, total)
   - Chick-to-transfer survival rate
   - Cost per surviving chick (chick purchase cost ÷ surviving count — farm admin enters chick cost on arrival)

5. NAV ITEM — add "Brooding" to AppShell. Visible when operationMode is LAYER_ONLY, BROILER_ONLY, or BOTH.
   Icon: 🐣 — position it after Dashboard, before Performance.

CONSTRAINTS:
- DB-first: provide SQL first, then run prisma db pull pattern. Do NOT edit schema.prisma directly.
- All route files: await params, verifyToken, tenantId scoping, include detail in 500 responses.
- Use z.string().min(1) for all ID fields.
- Temperature alert: if tempCelsius < 26 or > 38 — auto-create a Notification record for PEN_MANAGER.
- Task auto-generation uses existing Task model — map brooding task types to nearest valid TaskType enum values.
- After completing all code, update MEMORY.md: mark 8C complete, set next = 8D.
```

---

## Phase 8D — Layer Production Module (Refactor)

```
Implement Phase 8D — Layer Production Module — as specified in ROADMAP.md §8D.

SCOPE:
Replace app/performance/page.js with a dedicated Layer Production module at /production/layers.
The old /performance route should redirect to /production/layers.
Accessible when operationMode is LAYER_ONLY or BOTH.

DELIVERABLES:

1. NEW PAGE: app/production/layers/page.js
   Roles: PEN_WORKER (read), PEN_MANAGER (read + grade entry), FARM_MANAGER/ADMIN/CHAIRPERSON (full)

   Layout — 3 sections:
   A. FLOCK STATUS STRIP — one pill per active layer flock:
      Status: Pre-lay (<18 weeks) | Peak (>80% lay rate) | Maintaining (65–80%) | Declining (50–65%) | Cull Recommended (<50% or feed cost/doz > revenue/doz for 2 wks)
   B. KPI CARDS (6): Hen-Housed Production %, Eggs Today, Grade A Rate, Feed Cost/Dozen, 7-Day Trend (sparkline), Mortality This Week
   C. CHARTS ROW:
      - 13-week laying rate trend (Recharts LineChart, one line per active flock)
      - Grade distribution pie/donut chart (Grade A / Grade B / Cracked)
      - Cumulative mortality vs flock age in weeks (AreaChart)

2. NEW METRICS (add to existing eggs API or new endpoint):
   - Hen-housed production rate = (total eggs collected) / (initial bird count placed) × 100
   - Feed cost per dozen = (feed consumed kg × feed cost/kg) / (eggs collected / 12)
   - Peak production week (highest 7-day avg laying rate)
   - Post-peak decline rate (% drop per week after peak)

3. EGG COLLECTION REFINEMENT:
   Batch field on EggProduction — Morning (AM) vs Afternoon (PM).
   If the batch field does not exist, add it via SQL migration first.
   Show AM and PM totals separately on the daily log table.

4. CULL RECOMMENDATION TRIGGER:
   Display a CullAlert banner if: feed cost per dozen > revenue per dozen for 2+ consecutive weeks.
   Revenue per dozen uses a configurable price (default ₦900/dozen — editable in settings).
   Banner has "Dismiss" (7 days) and "Schedule Cull" (links to flock management) actions.

5. REDIRECT: app/performance/page.js → import { redirect } from 'next/navigation'; redirect('/production/layers');

6. NAV UPDATE: Change "Performance" nav item to "Layer Production", update href to /production/layers.
   Only visible when operationMode is LAYER_ONLY or BOTH.

CONSTRAINTS:
- Preserve the existing eggs API contract — do not break the worker egg entry flow.
- SQL migration for batch field (AM/PM enum) if needed — DB-first, provide SQL.
- All Recharts charts must use the existing colour scheme (--purple, --green, --amber, --red).
- After completing, update MEMORY.md: mark 8D complete, set next = 8E. Note that /performance is now a redirect.
```

---

## Phase 8E — Broiler Production Module (Refactor)

```
Implement Phase 8E — Broiler Production Module — as specified in ROADMAP.md §8E.

SCOPE:
Replace app/broiler-performance/page.js with a dedicated Broiler Production module at /production/broilers.
The old /broiler-performance route should redirect to /production/broilers.
Accessible when operationMode is BROILER_ONLY or BOTH.

DELIVERABLES:

1. NEW PAGE: app/production/broilers/page.js
   Roles: PEN_WORKER (read), PEN_MANAGER (read + weight entry), FARM_MANAGER/ADMIN/CHAIRPERSON (full)

   Layout — 3 sections:
   A. BATCH OVERVIEW STRIP — one card per active broiler flock:
      Batch code, days in, live birds, projected harvest date, projected marketable weight,
      revenue estimate (projected weight × ₦1,300/kg default price)
   B. HARVEST CALENDAR VIEW — calendar component showing harvest windows across all active batches.
      Colour: green = on track, amber = weight below target, red = < 7 days and > 5% below target.
   C. PERFORMANCE CHARTS:
      - Weight growth vs Ross 308 breed standard curve (WeightRecord data vs standard weights by week)
      - FCR trend (7-day rolling)
      - Batch comparison table: last 5 closed batches — FCR, mortality %, revenue/bird, profit/batch

2. NEW METRICS (computed in API):
   - Projected harvest date: based on current avg weight + daily growth rate extrapolated to targetWeightG
   - Projected marketable weight: current avgWeightG + (days remaining × avg daily gain)
   - Revenue estimate: projected weight kg × configurable price/kg
   - Alert condition: projected weight > 5% below target with < 7 days to harvest → red flag in UI + Notification

3. BATCH PROFITABILITY SUMMARY (new API endpoint: GET /api/broiler/batch-summary):
   For each closed BroilerHarvest record in the last 6 months:
   - Revenue = dressedWeightKg × salePrice
   - Chick cost = chicksReceived × costPerChick (from chick_arrivals if linked, else manual)
   - Feed cost = sum FeedConsumption.quantityKg × avgFeedCostNGN for that flock
   - Profit = revenue − (chick + feed + processing estimate)
   - Margin %

4. REDIRECT: app/broiler-performance/page.js → redirect('/production/broilers')

5. NAV UPDATE: Change "Broiler Perf" nav item to "Broiler Production", href /production/broilers.
   Only visible when operationMode is BROILER_ONLY or BOTH.

CONSTRAINTS:
- Use WeightRecord model (NOT WeightSample — that model does not exist).
- API: /api/weight-records — do NOT create /api/weight-samples.
- Harvest calendar: use plain CSS grid for the calendar — do not add a calendar library dependency.
- After completing, update MEMORY.md: mark 8E complete, set next = 8F.
```

---

## Phase 8F — Worker PWA

```
Implement Phase 8F — Worker Progressive Web App — as specified in ROADMAP.md §8F.

SCOPE:
Transform the worker experience into an installable PWA with offline support.
Target roles: PEN_WORKER, PEN_MANAGER.

DELIVERABLES:

1. public/manifest.json
   - name: "PoultryFarm Pro"
   - short_name: "FarmPro"
   - display: "standalone"
   - start_url: "/worker"
   - theme_color: "#6c63ff"
   - background_color: "#ffffff"
   - icons: 192×192 and 512×512 (use a simple SVG-based placeholder if no actual PNG exists)

2. public/sw.js — Service Worker
   - Cache strategy: Cache-first for static assets, Network-first for API routes
   - Pre-cache on install: /worker, /dashboard, /offline.html
   - Offline fallback: serve /offline.html for navigation requests when network unavailable
   - IndexedDB offline queue: when a POST/PATCH to /api/* fails due to network, store the
     request payload in an IndexedDB store called "offline_queue". On reconnection, replay queued requests
     in order. Supported offline actions: egg entry, mortality entry, water reading, feed distribution.

3. public/offline.html — simple offline page:
   Purple/white theme matching the app. Message: "You're offline. Data entered will sync when you reconnect."
   Show queued item count from IndexedDB.

4. Web Push notification (7am shift-start):
   - Add VAPID keys to .env.example (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
   - API route: POST /api/push/subscribe — save PushSubscription to User record (new pushSubscription JSON field)
   - API route: POST /api/push/send — internal, called by a cron/scheduled function
   - SQL: add pushSubscription Json? column to User table. Provide SQL migration.
   - Notification payload: "Good morning! You have X tasks pending for today." — count from daily tasks

5. next.config.js update — add service worker headers:
   Add Content-Security-Policy header allowing service worker registration.

6. Connectivity indicator component: components/ui/ConnectivityBanner.js
   - Listens to window online/offline events
   - Shows a yellow banner at top of page: "⚠ You are offline — changes will sync when reconnected"
   - Shows queued item count: "3 records queued"
   - Import and render in app/worker/page.js and app/dashboard/page.js

CONSTRAINTS:
- SQL migration for pushSubscription column on User — DB-first, provide .sql file.
- Service worker must not cache /api/auth/* routes.
- Use the standard Web Push / Notifications API — do not add a push library to package.json.
- After completing, update MEMORY.md: mark 8F complete, set next = 8G.
```

---

## Phase 8G — Worker Task System (Structured)

```
Implement Phase 8G — Structured Worker Task System — as specified in ROADMAP.md §8G.

SCOPE:
Replace the ad-hoc task generation with a structured template system.
Tasks are generated daily at midnight. Workers only see tasks for their assigned sections.
Time window enforcement: ±2 hours from scheduled time (configurable per tenant).

DELIVERABLES:

1. SQL MIGRATION — two new tables:
   task_templates:
     id (text PK), tenantId, penSectionId (text? — null = applies to all sections of type),
     operationType (text — LAYER | BROILER | BROODING), taskType (TaskType enum),
     title (text), scheduledTime (text — "06:00"), dataEntryType (text?), isDefault (Boolean default true),
     isActive (Boolean default true), createdAt, updatedAt

   daily_tasks:
     id (text PK), tenantId, penSectionId, assignedUserId (text? FK → User),
     templateId (text? FK → task_templates), taskType (TaskType enum),
     title (text), scheduledTime (text), dueDate (@db.Date), status (TaskStatus enum),
     completedAt (DateTime?), completedBy (text? FK → User), notes (text?),
     dataPayload (Json? — stores the submitted form data), createdAt, updatedAt

2. SEED DEFAULT TEMPLATES — migration or seeder that inserts the default templates from ROADMAP.md §8C
   (brooding) + standard layer and broiler daily templates (morning observations, feed, water, egg collection).

3. API ROUTES:
   - GET /api/task-templates — list templates for tenant (filterable by operationType, penSectionId)
   - POST /api/task-templates — create custom template
   - PATCH /api/task-templates/[id] — update time, title, deactivate
   - GET /api/daily-tasks — today's tasks for the calling user (PEN_WORKER: their sections only)
   - POST /api/daily-tasks/complete — complete a task; if dataEntryType set, accept dataPayload in body
   - POST /api/daily-tasks/generate — internal endpoint (called by cron) to generate tomorrow's tasks

4. CRON TRIGGER: api/cron/generate-tasks/route.js
   - Secured with a CRON_SECRET header check (add CRON_SECRET to .env.example)
   - Runs the daily task generation logic: for each active penSection + active flock,
     find matching templates, create daily_task records for the following day
   - Time window check on complete: if Math.abs(now - scheduledTime) > tenantWindowMinutes (default 120),
     flag as LATE_COMPLETION (add to dataPayload) and notify PEN_MANAGER

5. UI: app/worker/page.js — replace ad-hoc task list with daily_tasks feed
   - Tasks sorted by scheduledTime
   - Overdue indicator: scheduled time passed + not completed → amber border
   - Each task shows: time slot, title, section name, status pill, Complete button
   - On complete: if dataEntryType is set, open the appropriate modal (WaterMeterModal, WorkerFeedModal,
     GradingModal, etc.) and pass dataPayload back to PATCH daily_tasks/complete

CONSTRAINTS:
- DB-first: SQL migration first, then prisma db pull + generate.
- The existing Task model remains — daily_tasks is additive, not a replacement (yet).
- CRON_SECRET must be verified: if header 'x-cron-secret' !== process.env.CRON_SECRET → 401.
- After completing, update MEMORY.md: mark 8G complete, set next = 8H.
```

---

## Phase 8H — Feed Management Refactor

```
Implement Phase 8H — Feed Management Refactor — as specified in ROADMAP.md §8H.

SCOPE:
Tag all feed types to operation phase. Filter feed inventory and consumption logging by operation mode.
Pre-fill consumption logging from task context. Add withdrawal period tracking for Broiler Finisher.

DELIVERABLES:

1. FEED TYPE ENUM EXTENSION — SQL migration to add new values to FeedType enum (or add a feedPhase column):
   LAYER_STARTER, LAYER_GROWER, LAYER_LAYER (pullet stages)
   BROILER_STARTER, BROILER_GROWER, BROILER_FINISHER
   BROODING_STARTER
   Keep existing values (STARTER, GROWER, FINISHER, LAYER) as legacy — do not remove.

2. SQL: add withdrawalDays (Int? default null) column to FeedInventory.
   Only relevant for BROILER_FINISHER — number of days before harvest to stop using this feed.

3. FEED INVENTORY PAGE (app/feed/page.js) — update:
   - Filter inventory list by operationType of the calling user's assigned pen section
   - Add "Feed Phase" badge on each inventory row (colour-coded by operation type)
   - For BROILER_FINISHER items: show withdrawal deadline if a linked flock has an expectedHarvestDate
     (harvDate - withdrawalDays = stop-use date). Highlight red if today >= stop-use date.

4. API UPDATE: GET /api/feed/inventory — accept ?operationType=LAYER|BROILER query param.
   Filter by feedType prefix if param is present.

5. FEED CONSUMPTION MODAL (WorkerFeedModal.js) — update:
   - Accept optional taskContext prop: { penSectionId, flockId, feedType }
   - If taskContext is provided, pre-select the section and filter inventory to matching feedType
   - This wires up to Phase 8G daily_tasks: when a FEED_DISTRIBUTION task is completed,
     pass the task's dataEntryContext as taskContext to WorkerFeedModal

6. FEED REQUISITION (app/feed-requisitions/page.js + API) — update:
   - Add feedPhase column to the requisition form and table
   - Auto-suggest quantity using the existing feedRequisitionCalc utility

CONSTRAINTS:
- DB-first for all schema changes. Provide .sql for enum extension and new columns.
- The existing FeedConsumption and FeedInventory APIs must remain backward-compatible.
- After completing, update MEMORY.md: mark 8H complete, set next = Phase 9.
```

---

## Phase 9 — Feed Mill Module

```
Implement Phase 9 — Feed Mill Module — as specified in ROADMAP.md §9.

SCOPE:
Build the Feed Mill as an independent operational module.
Accessible when tenant.settings.hasFeedMillModule = true.

DELIVERABLES:

1. SQL MIGRATION — new tables: raw_materials, feed_formulas, formula_ingredients, feed_mill_batches,
   qc_tests, mill_batch_releases. Provide complete .sql with all foreign keys.

2. API ROUTES under /api/feed-mill/:
   - /materials — GET (list), POST (create), PATCH /[id] (update stock, reorder level)
   - /formulas — GET, POST (formula + ingredient list in one request)
   - /batches — GET (list with status), POST (create production run — deduct raw materials)
   - /qc — POST (submit QC test for a batch), GET /[batchId] (QC results for batch)
   - /releases — POST (approve batch, transfer to feed inventory as a FeedReceipt)

3. PAGES:
   - /feed-mill — dashboard: active runs, raw material levels vs reorder, cost/kg trend, batch yield
   - /feed-mill/materials — raw material inventory management
   - /feed-mill/formulas — formula builder (ingredient list with target %)
   - /feed-mill/batches — production run management with QC status
   Access gated: hasFeedMillModule = true in tenant.settings. Show upgrade prompt if false.

4. NAV: Add "Feed Mill" nav section (visible only when hasFeedMillModule = true).
   Roles: FEED_MILL_MANAGER, FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN.

5. RELEASE FLOW: When a batch passes QC and is released:
   - Create a FeedReceipt record in the main feed inventory
   - costPrice = batch production cost ÷ yield kg
   - Link: FeedReceipt.source = 'FEED_MILL', FeedReceipt.sourceBatchId = mill batch id

CONSTRAINTS:
- All gating: check tenant.settings.hasFeedMillModule — if false, return 403 with { error: 'Module not enabled', upgrade: true }.
- Failed QC batches must be quarantined: status = QUARANTINED, excluded from releases query.
- After completing, update MEMORY.md: mark Phase 9 complete, set next = Phase 10.
```

---

## Phase 10 — Processing Plant Module

```
Implement Phase 10 — Processing Plant Module — as specified in ROADMAP.md §10.

SCOPE:
Cover slaughter, dressing, packaging, cold storage, and dispatch.
Accessible when tenant.settings.hasProcessingModule = true.

DELIVERABLES:

1. SQL MIGRATION — new tables: processing_batches, processing_records, product_outputs,
   cold_storage_stock, cold_room_temperature_logs, dispatch_records. Provide complete .sql.

2. API ROUTES under /api/processing/:
   - /intake — POST (receive live birds from broiler flock, log DOA, create processing_batch)
   - /batches — GET, PATCH /[id] (update processing record: dressed weight, dressing %, by-products)
   - /storage — GET (cold storage inventory by product type), POST (intake to cold storage)
   - /storage/temperature — POST (log cold room temp — triggers alert if > 4°C for > 30 min)
   - /dispatch — POST (dispatch record linked to SalesInvoice AR)

3. PAGES:
   - /processing — dashboard: today's run, cold storage stock, dispatch vs intake trend, yield efficiency
   - /processing/batches — processing run management
   - /processing/storage — cold storage inventory with FIFO alerts and temp log
   Access gated: hasProcessingModule = true.

4. ALERT: Cold room temp > 4°C for > 30 minutes → Notification to PROCESSING_MANAGER.

5. YIELD TRACKING: Dressing % = dressedWeightKg / liveWeightKg × 100. Alert if < 65%.

6. NAV: Add "Processing" nav section. Roles: PROCESSING_MANAGER (new role? or use PRODUCTION_STAFF),
   FARM_ADMIN, CHAIRPERSON.

CONSTRAINTS:
- Gate all routes: check tenant.settings.hasProcessingModule.
- Dispatch records must link to an AR SalesInvoice — validate the invoice exists and belongs to tenant.
- After completing, update MEMORY.md: mark Phase 10 complete, set next = Phase 11.
```

---

## Phase 11 — Verification & Internal Control

```
Implement Phase 11 — Verification & Internal Control — as specified in ROADMAP.md §11.

SCOPE:
Transform verification into an intelligent reconciliation system with cross-record validation and anomaly detection.

DELIVERABLES:

1. TYPED VERIFICATION (§11.1):
   Update verification routes to enforce the role × record type matrix from ROADMAP.md.
   Add `recordType` and `moduleSource` fields to VerificationRecord if not present (SQL migration).
   Update VERIFIER_ROLES, REJECT_ROLES, MANAGER_ROLES arrays in both route files and the verification page.

2. NEAR-REAL-TIME NOTIFICATIONS (§11.2):
   After every verification-eligible task completion, create a Notification record for the assigned verifier.
   Batching logic: collect records, send digest at 11:30 and 17:30. Urgent override for mortality spikes,
   out-of-range temperature, and flagged observations → immediate notification (already partly done — verify).

3. CROSS-RECORD VALIDATION ENGINE (§11.3):
   Create lib/services/validationEngine.js — export function runValidationRules(recordType, record, context).
   Implement all 11 rules from ROADMAP.md §11.3. Each rule returns:
   { triggered: boolean, severity: 'warn' | 'critical', message: string, notifyRoles: string[] }
   Call this engine from relevant POST routes (eggs, mortality, feed consumption, temperature, weight).
   On trigger: create a Notification + create an AuditLog entry with action = 'ANOMALY_FLAGGED'.

4. IC DASHBOARD FRONTEND (§11.4) — app/audit/page.js:
   Roles: IC_OFFICER (full), FARM_ADMIN, CHAIRPERSON (read-only view)
   Sections:
   A. Anomaly feed — sorted by severity, filterable by date/type/user/section/module
   B. Pending verifications with age (oldest unverified records flagged red if > 48h)
   C. Compliance heatmap — section × day × 14 days — colour by completion rate
   D. Worker performance — task completion rate, rejection rate, anomaly flags per worker (last 30 days)
   E. Physical count reconciliation tab (§11.5) — trigger surprise count, enter physical count,
      system computes variance = system count − physical count. Types: BIRDS | EGGS_IN_STORE | FEED_STOCK.

5. EXPORT: PDF and CSV export for the anomaly feed and worker performance tables.
   Use existing pdfmake + Helvetica pattern. CSV via native JS string generation.

CONSTRAINTS:
- Validation engine must be pure — no side effects. Side effects (notifications, audit logs) happen in the calling route.
- Self-verification prevention: verifier !== submitter — already enforced by conflictOfInterest.js, verify it covers all new record types.
- After completing, update MEMORY.md: mark Phase 11 complete, set next = Phase 12.
```

---

## Phase 12 — Owner Intelligence

```
Implement Phase 12 — Owner Intelligence — as specified in ROADMAP.md §12.

SCOPE:
Unified CHAIRPERSON dashboard with cross-operation visibility, batch profitability, and lifecycle analytics.

DELIVERABLES:

1. UNIFIED OWNER DASHBOARD — app/owner/page.js (replace current placeholder):
   Role: CHAIRPERSON only.
   Panels rendered conditionally based on active modules:
   - Always: AR/AP summary (from finance API), total active birds split by Brooding/Layer/Broiler
   - If LAYER_ONLY or BOTH: Layer panel — current laying rate, eggs this week, feed cost/dozen,
     active flocks with status pills (Pre-lay/Peak/Declining/Cull Recommended)
   - If BROILER_ONLY or BOTH: Broiler panel — active batches, harvest countdown, revenue estimate
   - If hasProcessingModule: Processing panel — cold storage stock, dispatched this week, yield trend
   - If hasFeedMillModule: Feed Mill panel — raw material days remaining, batches in production

2. BATCH PROFITABILITY (§12.2) — new API: GET /api/owner/batch-profitability
   Full lifecycle P&L per broiler batch: revenue, chick cost, feed cost, processing cost, vet/drugs.
   Return: margin per batch, per bird, per kg. Last 10 closed batches.
   Display as a sortable table with sparkline margin trend.

3. LAYER FLOCK LIFECYCLE ANALYTICS (§12.3) — new API: GET /api/owner/layer-lifecycle
   For each active layer flock:
   - Laying rate vs flock age on natural curve (weekly data points)
   - Projected peak week (if not yet reached)
   - Projected end-of-lay week (when rate expected to drop below 50%)
   - Recommended cull date
   - Replacement planning alert: if < 8 weeks to recommended cull, show "Plan replacement intake" banner

4. OPERATION MIX ANALYSIS (§12.4) — only for BOTH tenants:
   Layer vs Broiler revenue as % of total, feed cost by operation, profitability recommendation.
   Display as donut chart (Recharts) + summary text.

CONSTRAINTS:
- All owner endpoints must be scoped to CHAIRPERSON role (plus SUPER_ADMIN).
- Lifecycle projections are estimates — label clearly in UI: "Projected" / "Estimated".
- After completing, update MEMORY.md: mark Phase 12 complete, set next = Phase 13.
```

---

## Phase 13 — Monetisation & Tiers

```
Implement Phase 13 — Monetisation & Tiers — as specified in ROADMAP.md §13.

SCOPE:
Map operation modes and modules to Stripe product tiers. Gate module access by plan.

DELIVERABLES:

1. STRIPE PRODUCTS — create 4 products in Stripe (provide the creation script or instructions):
   Starter, Growth, Professional, Enterprise — with monthly and annual prices in NGN.

2. PLAN GATING MIDDLEWARE — lib/middleware/planGate.js:
   export function requirePlan(minTier) — returns a helper that checks tenant subscription tier.
   Tier order: starter < growth < professional < enterprise.
   Returns 402 with { error: 'Plan upgrade required', currentPlan, requiredPlan, upgradeUrl: '/billing' }

3. GATE THE FOLLOWING:
   - IC Dashboard full features → professional+
   - Feed Mill module → hasFeedMillModule flag (add-on, not tier-gated alone)
   - Processing Plant module → hasProcessingModule flag
   - BOTH operation mode → growth+
   - Audit log export → professional+
   - Physical count → professional+

4. UPGRADE PROMPTS — component: components/ui/UpgradePrompt.js
   Props: { feature, requiredPlan, currentPlan }
   Shows a locked overlay with plan name and "Upgrade" button linking to /billing.
   Use this component in any page that renders conditionally on plan.

5. 14-DAY TRIAL: When a new tenant signs up, set trialEndsAt = now + 14 days.
   During trial: all features unlocked (Enterprise-level access).
   After trial: downgrade to Starter unless payment added.
   Show trial banner in AppShell when trialEndsAt is in the future.

6. BILLING PAGE UPDATE (app/billing/page.js):
   Show tier comparison table with operation modes and modules per tier.
   Highlight current plan. Show trial countdown if applicable.

CONSTRAINTS:
- Use existing Stripe integration in app/api/billing/. Do not restructure the webhook handler.
- After completing, update MEMORY.md: mark Phase 13 complete, set next = Phase 14.
```

---

## Phase 14 — Production Hardening

```
Implement Phase 14 — Production Hardening — as specified in ROADMAP.md §14.

SCOPE:
Multi-tenant onboarding, API security, test suite, offline PWA hardening.

DELIVERABLES:

1. SELF-SERVICE ONBOARDING (§14.1):
   - app/auth/signup/page.js — multi-step form: (1) farm details, (2) operation mode selector,
     (3) admin user creation
   - POST /api/auth/signup — create Tenant + Farm + FARM_ADMIN user + trial subscription in one transaction
   - Welcome email via existing invoiceEmail service
   - Redirect to /dashboard after signup with a welcome banner

2. API SECURITY (§14.2):
   - lib/middleware/rateLimit.js — in-memory per-tenant rate limiter:
     100 requests/minute per tenant for write routes, 300 for read routes.
     Return 429 with Retry-After header on breach.
   - lib/middleware/sanitise.js — strip null bytes, trim strings, validate Content-Type on POST routes.
   - Audit: scan all routes — verify every query includes tenantId scope. Provide a checklist in a comment
     block at top of each route file: // TENANT SCOPE: confirmed.

3. TEST SUITE (§14.3) — using Jest (add to package.json if not present):
   - Unit tests in __tests__/utils/ — cover format.js, feedRequisitionCalc.js, conflictOfInterest.js
   - Unit tests in __tests__/services/ — cover validationEngine.js rules (at least 6 rules)
   - Integration test sketch in __tests__/api/ — document the test pattern (can be stubs if DB unavailable)
   - npm run test script in package.json

4. OFFLINE PWA HARDENING (§14.4):
   - Extend public/sw.js offline queue to cover all worker data-entry endpoints
   - Conflict resolution: if a queued record conflicts with a server record (same date + section),
     flag it in the UI rather than silently overwriting
   - Connectivity indicator: enhance ConnectivityBanner.js to show sync progress ("Syncing 2/3 records...")
   - 24-hour cache of task list and section data in IndexedDB

CONSTRAINTS:
- Rate limiter must be tenant-scoped, not IP-scoped (farms use shared NAT IPs).
- Test files must be runnable with: npm test -- --testPathPattern=utils
- After completing, update MEMORY.md: mark Phase 14 complete, set next = Phase 15 (future modules).
```

---

## Hotfix / Debt Prompt Template

```
HOTFIX: [brief description]

File(s) affected: [list specific files]

Problem: [exact error or behaviour]

Known constraints:
- [copy any relevant constraints from MEMORY.md]

Expected behaviour after fix:
- [describe]

Do NOT:
- Change the Prisma schema directly
- Upgrade any package versions
- Alter unrelated files

After the fix, note in MEMORY.md under "Hotfixes Applied" with date and one-line summary.
```

---

## Quick Reference — Common Patterns

### New API Route (dynamic)
```js
// app/api/[module]/[id]/route.js
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { verifyToken } from '@/lib/middleware/auth';

export async function GET(request, { params: rawParams }) {
  const params = await rawParams;
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const record = await prisma.someModel.findFirst({
      where: { id: params.id, tenantId: user.tenantId },
    });
    if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(record);
  } catch (error) {
    return NextResponse.json({ error: 'Failed', detail: error?.message }, { status: 500 });
  }
}
```

### New Page (client component)
```js
'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/layout/AuthProvider';
import AppShell from '@/components/layout/AppShell';

export default function MyPage() {
  const { user, loading, apiFetch } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!user) return;
    apiFetch('/api/my-endpoint').then(r => r.json()).then(setData);
  }, [user]);

  if (loading || !user) return null;

  return (
    <AppShell>
      <div className="page-content">
        {/* content */}
      </div>
    </AppShell>
  );
}
```

### SQL Migration Pattern
```sql
-- migration_phase_8c.sql
-- Run in pgAdmin against the poultryfarm_pro database
-- After running: npx prisma db pull && npx prisma generate && restart dev server

CREATE TABLE IF NOT EXISTS chick_arrivals (
  id           TEXT PRIMARY KEY,
  "tenantId"   TEXT NOT NULL,
  ...
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS chick_arrivals_tenant_idx ON chick_arrivals("tenantId");
```
