# PoultryFarm Pro — Module Development Roadmap
> Last updated: 6 March 2026
> Stack: Next.js 14 App Router · Prisma · PostgreSQL · JWT Auth · Tailwind + custom CSS

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

## Phase 1 — Core Operations (Current)

### ✅ Authentication & Shell
- JWT login / logout
- Role-based navigation (11 roles)
- AppShell: collapsible sidebar, topbar, user avatar
- AuthProvider: `apiFetch`, 401 auto-redirect

### ✅ Dashboard (`/dashboard`)
- Role-differentiated views: Worker / PenManager / FarmManager
- KPI cards: live birds, mortality, eggs, FCR
- Per-pen occupancy bars
- ChartModal (2×2 chart grid): Layer and Broiler charts
  - Eggs & laying rate, Grade A %, daily mortality, feed consumption (Layer)
  - Live weight vs Ross 308 target, uniformity %, daily mortality, feed (Broiler)
- DayToggle (7/14/30d) on all charts
- Alert feed, task list, pen status cards

### ✅ Farm Structure (`/farm-structure`)
- Farm → Pen → Section hierarchy
- Pen capacity and occupancy visualisation
- Layer and Broiler metric chips per section
- Add/edit modals for farms, pens, and sections

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

### ✅ Feed Management (`/feed`)
- Inventory tab: stock cards, low-stock alerts, Layer vs Broiler chart, consumption log
- Log Consumption tab: flock selector, stock deduction preview, g/bird calculation
- Receipts (GRN) tab: delivery recording with QC status
- Purchase Orders tab: create, submit, approve, reject, fulfil flow
- Suppliers tab: supplier cards, add/edit modals

### ✅ Verification (`/verification`)
- Pending / verified / discrepancy tabs
- Action modal: verify, flag discrepancy, reject, escalate, resolve
- LoadingRows skeleton for table
- StatCard KPI row

### ✅ User Admin (`/users`)
- Staff list with role colour coding
- Avatar component with role-based colours
- Create / edit modal with pen section assignment
- Role permission descriptions

### ✅ Analytics / BI (`/owner`)
- Profitability by pen chart
- Cost breakdown bar chart
- 90-day revenue forecast (with confidence %)
- AI harvest predictor (optimal date, projected weight + margin)
- Export centre (PDF / CSV buttons — UI ready, export logic pending)
- Period selector: 7 / 30 / 90d

### ✅ Worker Portal (`/worker`)
- Daily check-in stepper: Feed → Mortality → Eggs → Observations
- Progress bar with % complete
- Task list with mark-done
- Quick action shortcuts

### ✅ Billing (`/billing`)
- Plan overview, usage meters
- Upgrade / cancel flow

---

## Phase 2 — Quality & Foundation Fixes (Active)

### 🔧 Batch 1 — Shared Foundation (Current)
**Files delivered:** `lib/utils/format.js`, `lib/constants/roles.js`,
`components/ui/DayToggle.js`, `components/ui/ChartTip.js`

- Centralise all `fmt` / `fmtCur` / `fmtDate` / `timeAgo` helpers
- Single `MANAGER_ROLES` and all role group constants
- Shared `DayToggle` and `ChartTip` components
- Eliminates ~8 instances of copy-pasted code

### 📋 Batch 2 — AppShell Fixes
- Wire notification bell to real `/api/notifications` GET endpoint
- Show unread count badge from live data
- Bell dropdown: list recent unread notifications with mark-all-read
- Session expiry: show "Session expired" toast before redirect on 401
- Fix: `FARM_OWNER` invalid role in `app/farm/page.js` → replace with `FARM_ADMIN`
- Fix: nav Feed item missing `PEN_MANAGER` role

### 📋 Batch 3 — Portal Modal Migration
- Migrate all remaining inline `modal-overlay` usages to `createPortal`
- Affected files: `app/health/page.js`, `app/farm/page.js`,
  `app/farm-structure/page.js`, `app/users/page.js`
- Extract shared `<Modal>` portal component to `components/ui/Modal.js`

### 📋 Batch 4 — Design System Consistency
- Standardise all pages to underline tab style (Health uses pill style — fix)
- Extract shared `<KpiCard>` component used by all pages
- Add `@keyframes pulse` + `.skeleton` utility class to `globals.css`
- Fix progress bar heights: all pages → 6px (currently 4px / 5px / 6px mixed)
- Remove inline font styles that duplicate `.section-header` CSS class

### 📋 Batch 5 — Bug Fixes
- Feed page `AddFeedTypeModal`: remove hardcoded `storeId`, resolve from tenant server-side
- `app/farm/page.js` line 7413: `FARM_OWNER` → `FARM_ADMIN`
- Align nav role lists in `AppShell.js` to match page-level RBAC

---

## Phase 3 — Feature Modules (Planned)

### 📋 Notifications Centre
**Route:** `/notifications`
**Depends on:** Batch 2 bell wiring, existing `Notification` Prisma model + write side
- Full notification inbox with filters (unread / all / by category)
- Mark as read, mark all as read, delete
- Notification categories: Low Stock, Overdue Vaccination, PO Approved, Mortality Spike, Task Overdue
- Push notification opt-in (browser)
- `/api/notifications` GET + PATCH routes

### 📋 Egg Production Module
**Route:** `/eggs`
**Depends on:** existing `/api/eggs/route.js`
- Daily egg log: total, Grade A / B / cracked, laying rate
- 7/14/30d trend charts by pen and flock
- Grade A % tracking vs farm target
- Egg inventory: trays on hand, sold, wastage
- Production calendar heatmap

### 📋 Mortality Records
**Route:** `/mortality`
**Depends on:** existing `/api/mortality/route.js`
- Daily mortality log with cause classification
- Cumulative mortality rate by flock
- Anomaly detection alerts (z-score based — logic exists in `notifications.js`)
- Mortality trend chart with flock comparison
- Post-mortem notes field

### 📋 Global Command Search
**Shortcut:** `Cmd+K` / `Ctrl+K`
**Component:** `components/ui/CommandPalette.js`
- Full-text search across: flocks, pens, suppliers, users, feed types
- Recent pages shortlist
- Keyboard-navigable results
- No new API route needed — uses existing endpoints with `?search=` param

### 📋 Reports & Export Engine
**Route:** `/reports`
**Depends on:** Analytics page Export Centre (UI exists, logic pending)
- Monthly production report (PDF)
- Financial summary (PDF + CSV)
- Feed analysis (CSV)
- Mortality records (CSV)
- Compliance report for regulatory submissions
- Date range selector
- Background generation with download link

---

## Phase 4 — Advanced Features (Future)

### 🔮 Mobile Responsive Layout
- Responsive sidebar: hamburger menu on < 768px
- Stacked card grids on mobile
- Touch-friendly modals and forms
- Worker Portal optimised for mobile-first (most critical for field workers)

### 🔮 Feed Mill Module
**Route:** `/mill`
**Depends on:** existing `/api/feed/mill/route.js` (partially built)
- Production batch management
- Formula management with ingredient ratios
- QC sign-off workflow
- Mill output vs feed inventory reconciliation

### 🔮 Real-Time Dashboard Updates
- WebSocket or Server-Sent Events for live KPI updates
- No full page refresh on new data
- Live alert badge counter

### 🔮 Multi-Farm View
- Organisation-level dashboard across multiple farms
- Aggregate KPIs per tenant
- Cross-farm flock transfer workflow

### 🔮 Audit Log Viewer
**Route:** `/audit`
**Depends on:** `prisma.auditLog` (already written to across all API routes)
- Who changed what, when
- Filter by entity type, date range, user
- Export to CSV for compliance

### 🔮 Integrations
- Accounting export: QuickBooks / Sage CSV format
- SMS alerts via Termii (Nigerian SMS gateway) for critical alerts
- WhatsApp notifications via Twilio for farm managers

---

## Technical Debt Tracker

| # | Issue | Severity | Batch |
|---|-------|----------|-------|
| T1 | `fmt`, `fmtCur`, `fmtDate` duplicated in 6+ files | Medium | Batch 1 ✅ |
| T2 | `MANAGER_ROLES` declared 8+ times inconsistently | Medium | Batch 1 ✅ |
| T3 | `DayToggle` duplicated in dashboard + feed | Low | Batch 1 ✅ |
| T4 | `ChartTip` duplicated in dashboard | Low | Batch 1 ✅ |
| T5 | Hardcoded "3" on notification bell | High | Batch 2 |
| T6 | No session-expiry UX on 401 | Medium | Batch 2 |
| T7 | `FARM_OWNER` (invalid role) in farm/page.js | High | Batch 2 |
| T8 | Health/Farm/FarmStructure/Users modals not portal-rendered | Medium | Batch 3 |
| T9 | Health page uses pill tabs instead of underline tabs | Low | Batch 4 |
| T10 | No shared `KpiCard` component — 4 different implementations | Low | Batch 4 |
| T11 | `@keyframes pulse` not in globals.css (defined inline per-page) | Low | Batch 4 |
| T12 | Progress bar heights inconsistent (4/5/6px) | Low | Batch 4 |
| T13 | Feed `AddFeedTypeModal` missing `storeId` resolution | High | Batch 5 |
| T14 | Nav role lists mismatched with page-level RBAC | Medium | Batch 5 |

---

## Conventions & Standards

### File Naming
- Pages: `app/[route]/page.js`
- API routes: `app/api/[resource]/route.js`
- Shared components: `components/ui/ComponentName.js`
- Layout: `components/layout/FileName.js`
- Utilities: `lib/utils/name.js`
- Constants: `lib/constants/name.js`
- Services: `lib/services/name.js`

### Component Patterns
- All modals → `createPortal` to `document.body`
- All pages wrap in `<AppShell>` + `<div className="animate-in">`
- All authenticated fetches → `apiFetch` from `useAuth()`
- Role checks on client → import from `lib/constants/roles.js`
- Date formatting → `lib/utils/format.js`
- Tab style → underline (3px solid `var(--purple)` bottom border)
- Loading state → `.skeleton` class or `<Skeleton>` component

### Colour Semantics (never use raw hex for status)
| Purpose | Token |
|---------|-------|
| Brand / primary | `var(--purple)` |
| Success / healthy | `var(--green)` |
| Warning / low stock | `var(--amber)` |
| Error / critical | `var(--red)` |
| Info / scheduled | `var(--blue)` |
| Layer flocks | `#f59e0b` (amber) |
| Broiler flocks | `#3b82f6` (blue) |
| Breeder flocks | `#8b5cf6` (violet) |
