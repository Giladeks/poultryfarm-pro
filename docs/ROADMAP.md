# PoultryFarm Pro — Module Development Roadmap
> Last updated: 8 March 2026 (rev 2)
> Stack: Next.js 16 App Router · Prisma 5.22 · PostgreSQL · JWT Auth (localStorage Bearer) · Tailwind + custom CSS
> Currency: Nigerian Naira (₦) · Locale: en-NG

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

## Phase 1 — Core Operations ✅ COMPLETE

### ✅ Authentication & Shell
- JWT login / logout (localStorage `pfp_token`, Bearer header via `apiFetch`)
- Role-based navigation (11 roles)
- AppShell: collapsible sidebar, topbar, notification bell, user avatar
- AuthProvider: `apiFetch`, 401 auto-redirect
- Session expiry toast

### ✅ Dashboard (`/dashboard`)
- Role-differentiated views: PenWorker / PenManager / FarmManager / FarmAdmin+
- KPI cards: live birds, mortality, eggs, FCR
- Per-pen occupancy bars with Layer/Broiler colour coding
- ChartModal (2×2 chart grid): Layer and Broiler charts
  - Eggs & laying rate, Grade A %, daily mortality, feed consumption (Layer)
  - Live weight vs Ross 308 target, uniformity %, daily mortality, feed (Broiler)
- DayToggle (7/14/30d) on all charts
- Alert feed, task list, pen status cards
- Pen worker view: assigned sections with expandable KPI chips

### ✅ Farm Structure (`/farm-structure`)
- Farm → Pen → Section hierarchy
- Pen capacity and occupancy visualisation
- Layer and Broiler metric chips per section
- Add/edit modals for farms, pens, and sections
- Layer / Broiler tab switcher

### ✅ Flock Management (`/farm`)
- Flock card grid with survival rate, age, mortality
- Filter by status (Active/Harvested) and bird type
- FlockModal: detailed view with stats
- CreateModal: new flock batch

### ✅ Health Management (`/health`)
- Vaccination schedule: upcoming / overdue / completed tabs
- Quick-schedule sidebar with common vaccine shortcuts
- Mark-done modal with batch number recording
- Status summary widget
- Layer / Broiler tab switcher

### ✅ Feed Management (`/feed`)
- Inventory tab: stock cards, low-stock alerts, Layer vs Broiler chart, consumption log
- Log Consumption tab: flock selector, stock deduction preview, g/bird calculation
- Receipts (GRN) tab: delivery recording with QC status
- Purchase Orders tab: create, submit, approve, reject, fulfil flow
- Suppliers tab: supplier cards, add/edit modals
- Layer / Broiler tab switcher

### ✅ Egg Production (`/eggs`)
- Log egg collection with grade breakdown (A, B, Cracked, Dirty)
- Laying rate % calculation against flock size
- Crates calculation (÷ 30)
- 7/14/30/90d range filter
- By-flock breakdown view
- Records tab with edit/delete
- Flock loaded from farm-structure API (uses `activeFlock` per section)

### ✅ Mortality Records (`/mortality`)
- Log deaths with cause-of-death tile selector (9 causes)
- Mortality rate % calculation
- Cause breakdown chart (horizontal bar)
- Daily mortality bar chart with spike threshold line
- By-flock breakdown
- Records tab with edit/delete

### ✅ Verification (`/verification`)
- Pending / verified / discrepancy tabs
- Action modal: verify, flag discrepancy, reject, escalate, resolve
- Reject → worker sees rejection reason, can edit and resubmit
- StatCard KPI row
- **VERIFIER_ROLES (flat list):** `PEN_MANAGER, STORE_MANAGER, STORE_CLERK, FARM_MANAGER, FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN`
  - PEN_MANAGER added — can verify egg/mortality records submitted by their workers
  - Note: typed verification (role matched to record type) is planned for Phase 5

### ✅ User Admin (`/users`)
- Staff list with role colour coding
- Avatar component with role-based colours
- Create / edit modal with pen section assignment
- Role permission descriptions

### ✅ Analytics / BI (`/owner` or `/analytics`)
- Profitability by pen chart
- Cost breakdown bar chart
- 90-day revenue forecast (with confidence %)
- AI harvest predictor (optimal date, projected weight + margin)
- Export centre (PDF / CSV buttons — UI ready)
- Period selector: 7 / 30 / 90d
- Restricted to FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN

### ✅ Worker Portal (`/worker`)
- Assigned sections loaded from `/api/dashboard`
- Sections grouped by Layer / Broiler, each collapsible
- KPI chips per section: live birds, occupancy, laying rate/weight, 7d mortality, 7d eggs
- Action buttons inside expanded section: Log Eggs (layers), Log Mortality
- Modals pre-filled with section + flock context
- Real API calls with toast notifications

---

## Phase 2 — Quality & Foundation Fixes ✅ COMPLETE

### ✅ Shared UI Components
- `lib/utils/format.js` — currency, number, date formatters
- `lib/utils/roles.js` — role labels and permission helpers
- `components/ui/DayToggle.js` — 7/14/30/90d toggle
- `components/ui/ChartTip.js` — chart tooltip wrapper
- `components/ui/Modal.js` — `createPortal` modal base
- `components/ui/KpiCard.js` — shared KPI card
- `components/ui/TabBar.js` — shared underline tab bar
- `components/ui/Skeleton.js` — SkeletonBar + SkeletonCard

### ✅ Bug Fixes (Batch 5)
- `storeId` hardcoding in feed receipts — resolved via API auto-lookup
- Field name mismatches in ReceiptsTab (deliveryDate → receiptDate, etc.)
- POST endpoint correction for GRN route

### ✅ Global unicode sweep
- All `\uXXXX` escape sequences replaced with actual characters across all 35 JS files
- Affected: emoji, em dash, middle dot, ellipsis, angle brackets, and more

### ✅ ID validation fixes
- `z.string().uuid()` → `z.string().min(1)` across eggs, mortality, and other routes
- Seed data uses slug IDs (e.g. `flock-lay-1`), not UUIDs — uuid() validation was rejecting all saves

---

## Phase 3 — Feature Modules ✅ COMPLETE

### ✅ Egg Production module — full build
- API: `GET/POST /api/eggs`, `GET/PATCH/DELETE /api/eggs/[id]`
- Schema: `rejectionReason String?` added via SQL migration
- Worker-scoped GET (only sees sections assigned to them)

### ✅ Mortality Records module — full build
- API: `GET/POST /api/mortality`, `GET/PATCH/DELETE /api/mortality/[id]`
- Schema: `rejectionReason String?` added via SQL migration
- Worker-scoped GET (only sees sections assigned to them)

### ✅ Reports / Export (UI ready)
- PDF export engine (`lib/services/pdf-export.js`)
- Report pages: daily summary, egg production, mortality, feed consumption
- CSV export hooks

---

## Phase 4 — Advanced Features 🔧 IN PROGRESS

### ✅ Batch 1 — Audit Log Viewer
- `GET /api/audit-log` with filters: date range, entity type, action, user
- Full audit log page with paginated table
- Role-gated: FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN

### ✅ Batch 2 — PDF Export Engine
- `lib/services/pdf-export.js` using pdfmake
- Exportable: egg production report, mortality report, daily summary
- Triggered from Reports page and individual record pages

### ✅ Worker Dashboard — Complete rewrite
- Replaced stub page (fake setTimeout, no DB writes) with fully functional version
- Sections loaded from `/api/dashboard`, scoped to worker assignments
- Real API calls to `/api/eggs` and `/api/mortality`

### ✅ isActive bug fixes
- `penWorkerAssignment` has no `isActive` field — removed from all `where` clauses
- `penSection` has no `isActive` field — removed from all `where` clauses
- Affected: dashboard route, farm-structure route

### ✅ Worker-scoped data
- Eggs GET: filters by worker's assigned `penSectionId`s
- Mortality GET: filters by worker's assigned `penSectionId`s

### ✅ Dashboard hooks order fix
- Moved early `if (!user) return null` guard to after all hooks (React Rules of Hooks)
- Replaced raw `fetch()` with `apiFetch` in dashboard page

### ✅ Section expand/collapse — Worker dashboard
- Section cards collapse by default, show KPI chips + chart button on click
- Chevron indicator rotates to show open/closed state

### 📋 Batch 3 — Termii SMS Alerts (NEXT UP)
- `lib/services/sms.js` — Termii REST client (`POST https://api.ng.termii.com/api/sms/send`)
- Requires `TERMII_API_KEY` env var
- Alert triggers:
  - High mortality event → notify Farm Manager + Pen Manager
  - Low feed stock → notify Store Manager
  - Verification rejected → notify submitting worker
- Settings UI: enable/disable SMS per tenant, configure phone numbers
- Hook into: `/api/mortality` (POST), `/api/feed/inventory`, `/api/verification/[id]` (PATCH)

---

## Phase 5 — Production Hardening 📋 PLANNED

### 📋 Typed Verification (Role × Record Type)
- Current: flat `VERIFIER_ROLES` list — any verifier can verify any record type
- Planned: verification route checks both role AND `referenceType`
  ```
  EggProduction    → PEN_MANAGER, FARM_MANAGER, FARM_ADMIN, CHAIRPERSON
  MortalityRecord  → PEN_MANAGER, FARM_MANAGER, FARM_ADMIN, CHAIRPERSON
  FeedConsumption  → STORE_MANAGER, STORE_CLERK, FARM_MANAGER, FARM_ADMIN, CHAIRPERSON
  StoreReceipt     → STORE_MANAGER, FARM_MANAGER, FARM_ADMIN, CHAIRPERSON
  DailyReport      → PEN_MANAGER, FARM_MANAGER, FARM_ADMIN, CHAIRPERSON
  ```
- Frontend: soft warning if verifier's role doesn't match expected role for that record type
- Prevents Store Clerk from verifying egg counts, Pen Manager from verifying store receipts

### 📋 Multi-tenant Onboarding Flow
- New tenant sign-up form
- Automated provisioning: tenant record, default farm, admin user
- Welcome email with credentials
- Trial period handling (14-day, Stripe integration)

### 📋 Email Notifications
- `lib/services/email.js` — Nodemailer / Resend integration
- Triggers: low stock, overdue vaccination, mortality spike, verification rejected
- Configurable per-user in profile settings

### 📋 Rate Limiting & API Security
- Per-tenant request rate limiting on all API routes
- Input sanitisation middleware
- Audit all routes for missing `tenantId` scoping

### 📋 Test Suite
- Unit tests: format utils, role helpers, calculation functions
- API integration tests: eggs, mortality, verification flows
- Seed-based test fixtures

---

## Phase 6 — Scale & Monetisation 🔮 FUTURE

### 🔮 Stripe Billing — Full Integration
- Subscription tiers: Starter / Growth / Enterprise
- Usage-based limits (users, farms, flocks)
- Billing portal (upgrade, downgrade, cancel)
- Webhook handling: payment failed, subscription cancelled
- Dunning emails

### 🔮 Mobile App (React Native)
- Worker daily log (eggs + mortality) — offline-capable
- Push notifications for tasks and alerts
- QR code scan for pen/flock identification

### 🔮 Feed Mill Module — Full Build
- Feed batch production tracking
- QC testing records with pass/fail
- Raw material inventory
- Cost per kg calculation
- Integration with main feed inventory

### 🔮 HR / Payroll Module
- Staff attendance tracking
- Leave management
- Basic payroll calculation (salary + deductions)
- Payslip generation (PDF)

### 🔮 Asset Management
- Equipment register with depreciation
- Maintenance scheduling and history
- Asset utilisation reports

### 🔮 Multi-farm / Multi-tenant Dashboard
- Chairperson view: cross-farm KPI aggregation
- Farm comparison charts
- Consolidated P&L

---

## Technical Debt & Known Constraints

| Item | Status | Notes |
|------|--------|-------|
| Prisma version | ✅ Locked at 5.22.0 | Do NOT upgrade to 7.x — breaking changes |
| Next.js version | ✅ 16 | `serverExternalPackages` (top-level), `turbopack: {}` |
| Auth token location | ✅ localStorage `pfp_token` | Always use `apiFetch` — never raw `fetch()` |
| Seed IDs | ✅ Slugs, not UUIDs | Use `z.string().min(1)` not `.uuid()` in all Zod schemas |
| `penWorkerAssignment` | ✅ No `isActive` field | Never filter by it |
| `penSection` | ✅ No `isActive` field | Never filter by it |
| `.btn` CSS class | ⚠️ global `display:block; width:100%` | Never use `className="btn"` on buttons inside flex rows |
| Unicode in repo dump | ✅ Fixed | All `\uXXXX` escapes replaced across all 35 files |
| `schema.prisma` | ⚠️ Do not replace | Add fields via SQL (`npx prisma db execute`) then `npx prisma generate` |
| `operationType` vs `birdType` | ⚠️ Both exist on flocks | Feed/Health pages use `birdType`; pen/structure pages use `operationType` |
| `storeId` in verification | ✅ Fixed | API auto-resolves via `prisma.store.findFirst` — never send from client |
| React hooks order | ✅ Fixed | All hooks declared before any early returns (Rules of Hooks) |
| Next.js 16 — `params` must be awaited | ✅ Fixed (all routes) | In Next.js 16, `params` in dynamic route handlers is a Promise — always destructure as `{ params: rawParams }` then `const params = await rawParams;` at the top of every handler. Affected: `verification/[id]`, `eggs/[id]`, `mortality/[id]`, `feed/consumption/[id]`, `feed/mill/[id]`, `feed/receipts/[id]`. Apply to ALL new dynamic routes — failure manifests as Prisma "needs at least one of `id`" error. |
| Verification — three separate role constants | ✅ Fixed | Three distinct role arrays exist: `VERIFIER_ROLES` (see/act), `REJECT_ROLES` (reject back to worker), `MANAGER_ROLES` (resolve escalations). Adding a role to one does NOT add it to the others. When granting any role access to verification, update ALL THREE lists in both `app/api/verification/route.js`, `app/api/verification/[id]/route.js`, AND `app/verification/page.js`. |
| `activeFlock` vs `flocks[]` in farm-structure API | ✅ Fixed | The farm-structure API returns `activeFlock` (single object) per section — NOT a `flocks[]` array. Pages must use `sec.activeFlock`, never `sec.flocks.map(...)`. Affected: eggs page, mortality page, any page loading flocks via `/api/farm-structure`. |

---

## Role × Feature Access Matrix

| Feature | PEN_WORKER | PEN_MANAGER | STORE_CLERK | STORE_MANAGER | FARM_MANAGER | FARM_ADMIN | CHAIRPERSON |
|---------|-----------|------------|------------|--------------|-------------|-----------|------------|
| Worker Dashboard | ✅ | — | — | — | — | — | — |
| Log Eggs / Mortality | ✅ | — | — | — | — | — | — |
| Egg Production page | — | ✅ | — | — | ✅ | ✅ | ✅ |
| Mortality page | — | ✅ | — | — | ✅ | ✅ | ✅ |
| Verify Records | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Feed Management | — | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| Health Management | — | ✅ | — | — | ✅ | ✅ | ✅ |
| Farm Structure | — | ✅ | — | — | ✅ | ✅ | ✅ |
| Flock Management | — | ✅ | — | — | ✅ | ✅ | ✅ |
| User Admin | — | — | — | — | — | ✅ | ✅ |
| Audit Log | — | — | — | — | — | ✅ | ✅ |
| Analytics / BI | — | — | — | — | — | ✅ | ✅ |
| Billing | — | — | — | — | — | ✅ | ✅ |
