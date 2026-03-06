# 🐔 PoultryFarm Pro

A full-stack, multi-tenant SaaS platform for managing poultry farm operations of all sizes.
Built with **Next.js 14**, **Prisma + PostgreSQL**, **JWT auth**, and **Stripe billing**.

---

## 📁 Project Structure

```
poultryfarm-pro/
├── app/                        # Next.js App Router pages + API routes
│   ├── api/
│   │   ├── auth/login/         # POST — login, issue JWT
│   │   ├── auth/logout/        # POST — clear session
│   │   ├── auth/users/         # GET/POST/PATCH — staff management
│   │   ├── farms/dashboard/    # GET — farm-wide KPI summary
│   │   ├── flocks/             # GET/POST — flock batches
│   │   ├── mortality/          # GET/POST — death records
│   │   ├── eggs/               # GET/POST — egg production
│   │   ├── feed/               # GET/POST — inventory + consumption
│   │   ├── health/             # GET/POST — vaccinations
│   │   ├── tasks/              # GET/POST — worker tasks
│   │   ├── analytics/          # GET — profitability, forecast, BI
│   │   └── billing/            # GET/POST + Stripe webhook
│   ├── auth/login/page.js      # Login page with demo accounts
│   ├── dashboard/page.js       # Farm Manager overview
│   ├── worker/page.js          # Pen Worker daily check-in
│   ├── farm/page.js            # Flock management
│   ├── health/page.js          # Health & vaccinations
│   ├── feed/page.js            # Feed inventory & FCR
│   ├── owner/page.js           # Owner BI dashboard
│   └── billing/page.js         # Subscription management
├── components/
│   ├── layout/
│   │   ├── AppShell.js         # Sidebar + topbar shell
│   │   └── AuthProvider.js     # Auth context + apiFetch helper
│   └── ui/
│       └── DashboardWidgets.js # KPI cards, charts, task list, alerts
├── lib/
│   ├── db/prisma.js            # Singleton Prisma client
│   ├── middleware/auth.js      # JWT verification + RBAC helpers
│   └── services/
│       ├── analytics.js        # FCR, mortality, forecast calculations
│       └── notifications.js    # Email alerts + in-app alert generator
├── prisma/
│   ├── schema.prisma           # Full database schema (17 models)
│   └── seed.js                 # Realistic founding farm seed data
├── middleware.js               # Edge middleware — route protection + roles
├── next.config.js
├── tailwind.config.js
├── postcss.config.js
└── .env.example
```

---

## 🚀 Quick Start

### 1. Prerequisites

- **Node.js** v18+ — [nodejs.org](https://nodejs.org)
- **PostgreSQL** v14+ — [postgresql.org](https://postgresql.org) or use [Supabase](https://supabase.com) (free tier)
- **Git** (optional)

### 2. Install dependencies

```bash
cd poultryfarm-pro
npm install
```

### 3. Configure environment

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in at minimum:

```env
DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/poultryfarm_pro"
NEXTAUTH_SECRET="any-long-random-string-here"
NEXTAUTH_URL="http://localhost:3000"
JWT_SECRET="another-long-random-string-here"
```

> **Tip:** For a free cloud database, sign up at [supabase.com](https://supabase.com),
> create a project, and copy the connection string from Settings → Database.

### 4. Set up the database

```bash
# Generate Prisma client
npm run db:generate

# Push schema to database (creates all tables)
npm run db:push

# Seed with founding farm demo data
npm run db:seed
```

### 5. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you'll be redirected to the login page.

---

## 🔐 Demo Login Accounts

After seeding, these accounts are ready to use:

| Role | Email | Password | Dashboard |
|------|-------|----------|-----------|
| Farm Owner | owner@greenacres.ng | owner123 | `/owner` |
| Farm Manager | manager@greenacres.ng | manager123 | `/dashboard` |
| Pen Manager | penmanager1@greenacres.ng | pm123 | `/dashboard` |
| Pen Worker | worker1@greenacres.ng | worker123 | `/worker` |

---

## 🏗 Database Setup (Detailed)

### Option A — Local PostgreSQL

1. Install PostgreSQL from [postgresql.org](https://postgresql.org/download/windows/)
2. Open pgAdmin or psql and create a database:
   ```sql
   CREATE DATABASE poultryfarm_pro;
   ```
3. Set `DATABASE_URL` in `.env.local`:
   ```
   DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/poultryfarm_pro"
   ```

### Option B — Supabase (Recommended for beginners)

1. Sign up at [supabase.com](https://supabase.com)
2. Create a new project
3. Go to **Settings → Database → Connection string → URI**
4. Copy the URI and paste as `DATABASE_URL` (replace `[YOUR-PASSWORD]` with your project password)

---

## 💳 Stripe Setup (Optional)

To enable billing features:

1. Sign up at [stripe.com](https://stripe.com)
2. Copy keys from the Stripe Dashboard:
   ```env
   STRIPE_SECRET_KEY="sk_test_..."
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."
   ```
3. For webhooks in development, install [Stripe CLI](https://stripe.com/docs/stripe-cli):
   ```bash
   stripe listen --forward-to localhost:3000/api/billing/webhook
   ```
4. Copy the webhook signing secret into `.env.local`:
   ```env
   STRIPE_WEBHOOK_SECRET="whsec_..."
   ```

---

## 📊 Database Schema Overview

| Model | Purpose |
|-------|---------|
| `Tenant` | One record per farm (multi-tenant isolation) |
| `Plan` | Starter / Professional / Enterprise tiers |
| `Subscription` | Links tenant → plan with Stripe subscription ID |
| `User` | Staff with role-based access (5 roles) |
| `Pen` | Physical pen buildings |
| `PenSection` | Sections within each pen (A/B/C/D) |
| `Flock` | Bird batches with breed, count, placement date |
| `MortalityRecord` | Daily death records with cause codes |
| `EggProduction` | Daily egg collection with grade breakdown |
| `FeedInventory` | Stock levels per feed type |
| `FeedConsumption` | Daily feed usage per flock (for FCR) |
| `WeightRecord` | Periodic weight samples for broilers |
| `Vaccination` | Scheduled and completed vaccination events |
| `MedicationLog` | Medication courses per flock |
| `Task` | Daily worker task assignments |
| `HatchBatch` | Hatchery incubation batches |
| `AuditLog` | Full audit trail of all changes |

---

## 🔑 API Reference

All API routes are under `/api/`. Include the JWT in requests:
```
Authorization: Bearer <token>
```

### Auth
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/login` | Login → returns JWT + user object |
| POST | `/api/auth/logout` | Clear session cookie |
| GET | `/api/auth/users` | List all farm staff |
| POST | `/api/auth/users` | Create new staff member |
| PATCH | `/api/auth/users` | Update role / deactivate user |

### Farm Data
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/farms/dashboard` | Full KPI summary for dashboard |
| GET | `/api/flocks` | List flocks (filter by status, birdType) |
| POST | `/api/flocks` | Create new flock batch |
| GET | `/api/mortality?days=30` | Mortality records + daily totals |
| POST | `/api/mortality` | Record deaths (auto-updates flock count) |
| GET | `/api/eggs?days=30` | Egg production records + summary |
| POST | `/api/eggs` | Record egg collection |
| GET | `/api/feed?days=14` | Feed inventory + consumption |
| POST | `/api/feed?action=consumption` | Record feed usage |
| POST | `/api/feed?action=restock` | Add stock to inventory |
| GET | `/api/health` | Vaccinations list + summary |
| POST | `/api/health?action=schedule` | Schedule a vaccination |
| POST | `/api/health?action=complete` | Mark vaccination as done |
| GET | `/api/tasks` | Today's task list |
| POST | `/api/tasks?action=create` | Create task assignment |
| POST | `/api/tasks?action=start` | Mark task in progress |
| POST | `/api/tasks?action=complete` | Mark task complete |

### Analytics & Billing
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/analytics?report=overview` | Pen profitability breakdown |
| GET | `/api/analytics?report=forecast` | 90-day revenue forecast |
| GET | `/api/analytics?report=mortality_analysis` | Anomaly detection |
| GET | `/api/billing` | Current plan + all plans |
| POST | `/api/billing?action=create_checkout` | Stripe checkout redirect |
| POST | `/api/billing?action=cancel` | Cancel subscription |
| POST | `/api/billing/webhook` | Stripe webhook handler |

---

## 🎭 Role Permissions

| Feature | Worker | Pen Mgr | Farm Mgr | Owner |
|---------|--------|---------|----------|-------|
| View own tasks | ✓ | ✓ | ✓ | ✓ |
| Complete tasks | ✓ | ✓ | ✓ | ✓ |
| Record mortality | ✓ | ✓ | ✓ | ✓ |
| Record eggs/feed | ✓ | ✓ | ✓ | ✓ |
| View dashboard | — | ✓ | ✓ | ✓ |
| Create flocks | — | — | ✓ | ✓ |
| Schedule vaccinations | — | ✓ | ✓ | ✓ |
| Create tasks | — | ✓ | ✓ | ✓ |
| View analytics | — | — | ✓ | ✓ |
| Manage staff | — | — | ✓ | ✓ |
| Billing / plans | — | — | — | ✓ |

---

## 🌍 Production Deployment

### Deploy to Vercel (Recommended)

1. Push the project to a GitHub repository
2. Go to [vercel.com](https://vercel.com) → **New Project** → Import your repo
3. Add all environment variables from `.env.example` in the Vercel dashboard
4. Deploy — Vercel auto-detects Next.js

```bash
# Or deploy via CLI
npm install -g vercel
vercel --prod
```

### Environment variables needed in production

```env
DATABASE_URL=           # Your production PostgreSQL URL
NEXTAUTH_SECRET=        # Strong random string (generate with: openssl rand -base64 32)
NEXTAUTH_URL=           # Your production URL e.g. https://yourfarm.poultryfarm.pro
JWT_SECRET=             # Strong random string
STRIPE_SECRET_KEY=      # Live Stripe key (sk_live_...)
STRIPE_WEBHOOK_SECRET=  # From Stripe Dashboard → Webhooks
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=  # Live publishable key
NEXT_PUBLIC_APP_URL=    # Your production URL
```

### Run database migrations in production

```bash
npm run db:migrate
npm run db:seed   # Only run once on first deploy
```

---

## 🛠 Useful Commands

```bash
npm run dev          # Start dev server at localhost:3000
npm run build        # Build for production
npm run start        # Start production server
npm run db:generate  # Regenerate Prisma client after schema changes
npm run db:push      # Push schema changes to DB (dev only)
npm run db:migrate   # Create and run a migration (production-safe)
npm run db:seed      # Seed database with demo data
npm run db:studio    # Open Prisma Studio (visual DB browser)
```

---

## 📱 Mobile Workers

The `/worker` view is optimised for mobile use. Workers log in and see only their assigned section tasks. The guided check-in flow walks through:

1. **Feed recording** — quantity given
2. **Mortality** — count + cause code
3. **Egg collection** — total + grade A/B/cracked
4. **Observations** — free-text notes

---

## 🤝 Founding Farm

Green Acres Poultry Farm is the platform's founding customer:
- **40,000 birds** across 4 pens (2 layer, 2 broiler)
- **15 staff** across all roles
- **Unlimited plan** at no charge in exchange for product feedback
- Demo data seeded across 30 days of realistic production records

---

Built with ❤ for African poultry farmers.
