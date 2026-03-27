# PoultryFarm Pro — Developer Memory
> Last updated: 24 March 2026 | Rev 1
> Purpose: Persistent context for AI-assisted development sessions. Read this at the start of every session.

---

## Current State

**Phases complete:** 1 → 7 fully shipped. Phase 8A (operation mode selector) and 8B (production dashboards + worker experience) fully shipped.

**Next phase to build:** Phase 8C — Brooding Module.

**Branch convention:** `feature/8c-brooding`, `feature/8d-layer-production`, etc.

---

## What Was Just Built (Phase 8B — Final State)

All items closed out. The following shipped during 8B beyond the original spec:

| Feature | Key Files |
|---------|-----------|
| Main dashboard — all 11 roles | `app/dashboard/page.js` |
| Layer performance page | `app/performance/page.js` |
| Broiler performance page | `app/broiler-performance/page.js` |
| Dashboard APIs | `app/api/dashboard/route.js`, `/charts`, `/verifications` |
| Eggs API (crate-based 2-phase) | `app/api/eggs/route.js`, `app/api/eggs/[id]/route.js` |
| Weight records API | `app/api/weight-records/route.js` |
| WaterMeterModal | `components/water/WaterMeterModal.js` |
| WorkerFeedModal | `components/feed/WorkerFeedModal.js` |
| GradingModal | `components/eggs/GradingModal.js` |
| VerifyActions + COI guard | `components/verification/VerifyActions.js`, `lib/utils/conflictOfInterest.js` |
| DailySummaryCard + auto-submit | `components/daily/DailySummaryCard.js`, `lib/utils/autoSubmitSummary.js` |
| Spot Check system | `components/dashboard/SpotCheckPanel.js`, `components/tasks/SpotCheckCompleteModal.js` |
| Feed Requisition (6-stage) | `app/feed-requisitions/page.js`, `app/api/feed/requisitions/` |
| Investigation workflow | `app/api/investigations/` |
| Global search | `components/ui/GlobalSearch.js`, `app/api/search/route.js` |
| Notifications page | `app/notifications/page.js`, `app/api/notifications/route.js` |
| Profile / Avatar | `app/profile/page.js`, `app/api/profile/` |

---

## Database — Current Models (Confirmed in Schema)

### Core
`Tenant`, `User`, `Farm`, `Pen`, `PenSection`, `Flock`, `PenWorkerAssignment`

### Production
`EggProduction` (crate-based, two-phase), `MortalityRecord`, `WeightRecord` (NOT WeightSample), `WaterMeterReading`, `FeedConsumption` (bag-based), `FeedInventory`, `FeedReceipt`, `DailySummary`, `BroilerHarvest`

### Workflow
`Task`, `FeedRequisition`, `Investigation`, `SpotCheck`

### Finance (Phase 7)
`SupplierInvoice`, `SalesInvoice`, `Customer`, `Supplier`, `BankTransaction`, `PaymentReminder`

### Auth / Billing
`AuditLog`, `Subscription`, `Plan`, `Notification`

### Pending (Phase 8C+)
`chick_arrivals` — 📋 Phase 8C  
`temperature_logs` — 📋 Phase 8C  
`task_templates` — 📋 Phase 8G  
`daily_tasks` — 📋 Phase 8G  

---

## Critical Field Names (Burn These In)

| What | Correct | WRONG |
|------|---------|-------|
| Flock placement date | `dateOfPlacement` | `placementDate` |
| Pen operation type | `pen.operationType` | `penSection.operationType` |
| Active flock on section | `sec.activeFlock` (single object) | `sec.flocks.map(...)` |
| Weight model | `WeightRecord` | `WeightSample` |
| Auth token storage | `pfp_token` in localStorage | any cookie |
| Verification context | `"Pen Name — Section Name \| Flock: BATCH"` | split on `—` |

---

## Routing & Auth Patterns

```js
// Every dynamic API route — params is a Promise in Next.js 16
export async function GET(request, { params: rawParams }) {
  const params = await rawParams;
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // ...
  return NextResponse.json({ data }, { status: 200 });
  // Always include detail on 500:
  return NextResponse.json({ error: 'Failed', detail: error?.message }, { status: 500 });
}

// Client-side fetch — ALWAYS apiFetch, never raw fetch()
const { apiFetch } = useAuth();
const res = await apiFetch('/api/some-route');
if (!res.ok) { /* handle */ }
const data = await res.json();
```

---

## Zod Rules

```js
// IDs are slugs — NEVER .uuid()
z.string().min(1)   // ✅
z.string().uuid()   // ❌

// Optional strings → sanitise before POST
field: form.field || null   // ✅ prevents empty-string Zod failures
```

---

## Prisma Rules

```js
// DB-first always
// SQL in pgAdmin → npx prisma db pull → npx prisma generate → restart

// Filters
{ not: undefined }   // ✅
{ not: null }        // ❌ Prisma v5 rejects this in string filters

// No @relation on SupplierInvoice.linkedReceiptId / linkedPOId
// Fetch those manually with a second query

// penWorkerAssignment — no tenantId, no isActive fields
// penSection — no isActive field

// Date filter on @db.Date columns — always normalise
since.setHours(0, 0, 0, 0);
```

---

## pdfmake Rules

```js
// Always Helvetica — VFS/Roboto loading fails in Next.js routes
defaultStyle: { font: 'Helvetica' }

// Currency: ASCII only in PDFs
'NGN '   // ✅
'₦'      // ❌ causes encoding errors
```

---

## Operation Mode (Phase 8A — Live)

Stored in `tenant.settings` JSON:

```json
{
  "operationMode": "LAYER_ONLY | BROILER_ONLY | BOTH",
  "hasFeedMillModule": false,
  "hasProcessingModule": false
}
```

AppShell conditionally renders nav based on these flags. Settings UI at `/settings` → Operations tab. Role-gated: FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN.

---

## CSS Gotchas

```css
/* .btn has global display:block; width:100% — NEVER use inside flex rows */
/* Use inline styles or a wrapper with class override instead */
```

Key CSS variables:
```css
--purple: #6c63ff
--purple-light: (tint)
--red, --amber, --green, --blue (with -bg and -border variants)
--bg-surface, --bg-elevated, --bg-hover
--border, --border-card
--text-primary, --text-secondary, --text-muted
--shadow-md, --shadow-lg
```

---

## Role Reference (All 13 Valid Roles)

```
SUPER_ADMIN, CHAIRPERSON, FARM_ADMIN, FARM_MANAGER,
INTERNAL_CONTROL, ACCOUNTANT, STORE_MANAGER, FEED_MILL_MANAGER,
PEN_MANAGER, STORE_CLERK, QC_TECHNICIAN, PRODUCTION_STAFF, PEN_WORKER
```

Dashboard routing:
- `ACCOUNTANT` → `<AccountantDashboard />`
- `INTERNAL_CONTROL` → `<IcDashboard />`
- Store / Mill / QC → role-specific dashboards
- All others → main farm operations dashboard

---

## Finance Role Constants (inline in finance routes — not in roles.js)

```js
FINANCE_VIEW_ROLES     = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT','INTERNAL_CONTROL']
FINANCE_ROLES          = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT']
INVOICE_APPROVAL_ROLES = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','FARM_MANAGER']
RECONCILIATION_ROLES   = ['SUPER_ADMIN','FARM_ADMIN','ACCOUNTANT']
```

---

## Locked Dependency Versions

| Package | Version | Note |
|---------|---------|------|
| Next.js | 16.x | `serverExternalPackages` top-level, `turbopack: {}` |
| Prisma | 5.22.0 | NEVER upgrade — v7 has breaking changes |
| pdfmake | v0.2.x | NEVER upgrade — v0.3.x different API |
| bcryptjs | any | Always top-level import, never require() inside handlers |

---

## Next Steps

### Immediate — Phase 8C (Brooding Module)

1. **SQL migration** — create `chick_arrivals` and `temperature_logs` tables in pgAdmin, then `npx prisma db pull` + `npx prisma generate`.
2. **API routes:**
   - `POST /api/brooding/arrivals` — log day-old chick arrival, trigger task generation
   - `GET /api/brooding/arrivals` — list active brooding batches
   - `PATCH /api/brooding/arrivals/[id]` — update or record transfer to production
   - `POST /api/brooding/temperature` — log temperature reading
   - `GET /api/brooding/[id]/summary` — full brooding period summary
3. **Page: `/brooding`** — active batches, arrivals tab, temperature chart, transfer tab. KPIs at transfer: early mortality %, chick-to-transfer survival rate, cost per surviving chick.
4. **Task auto-generation** on chick arrival (8 daily tasks per the roadmap template).
5. **Brooding nav item** — appears when `operationMode` is `LAYER_ONLY`, `BROILER_ONLY`, or `BOTH`.

### After 8C
- Phase 8D: Layer Production refactor → `/production/layers`
- Phase 8E: Broiler Production refactor → `/production/broilers`
- Phase 8F: Worker PWA (manifest + service worker)
- Phase 8G: Structured task system (`task_templates`, `daily_tasks`)
- Phase 8H: Feed management refactor (operation-typed feed categories)
