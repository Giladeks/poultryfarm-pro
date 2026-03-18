# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run start        # Start production server
npm run db:generate  # Regenerate Prisma client after schema changes
npm run db:push      # Push schema to DB (dev only)
npm run db:migrate   # Create/run migrations (production-safe)
npm run db:seed      # Seed demo data
npm run db:studio    # Open Prisma Studio
```

## Architecture Overview

**Stack:** Next.js 16 App Router, Prisma 5.22 + PostgreSQL, JWT auth (jose), Stripe billing, Tailwind CSS

**Multi-tenant SaaS** for poultry farm management with 13 user roles and operation mode gating (LAYER_ONLY, BROILER_ONLY, BOTH).

### Authentication & Authorization

- JWT stored in `localStorage` + `httpOnly` cookie (`pfp_token`)
- Middleware (`middleware.js`) enforces route protection and RBAC via `ROLE_ROUTES` mapping
- API helpers in `lib/middleware/auth.js`: `verifyToken()`, `withAuth()`, `assertTenant()`
- Role constants defined in `lib/constants/roles.js` — use `MANAGER_ROLES`, `LEADERSHIP_ROLES`, etc.

### Database Patterns

- All queries scoped by `tenantId` for multi-tenant isolation
- Prisma schema in `prisma/schema.prisma` (40+ models including Finance, Store, Feed Mill, Processing)
- Seed data creates "Green Acres Poultry Farm" demo tenant

### Operation Mode Architecture

Tenant-level `settings.operationMode` controls:
- Navigation visibility
- Dashboard panels rendered
- Task template generation
- Module licensing

Modules: Brooding (shared phase), Layer Production, Broiler Production, Feed Mill, Processing Plant

### API Structure

- Base: `/api/`
- Bearer token auth: `Authorization: Bearer <token>`
- Zod validation on POST/PATCH
- Tenant scoping enforced on all queries
- Response format: `{ data, pagination, summary }`

## Key Technical Constraints

| Constraint | Details |
|------------|---------|
| Prisma | Locked at 5.22.0 — do not upgrade to 7.x |
| pdfmake | Locked at v0.2.x — use `src/printer.js`, Helvetica only |
| Next.js 16 | Use `serverExternalPackages`, `turbopack: {}` |
| Seed IDs | Use slugs, not UUIDs — `z.string().min(1)` not `.uuid()` |
| `.btn` CSS | Global `display:block; width:100%` — never use inside flex rows |
| Prisma workflow | SQL → pgAdmin → `prisma db pull` → `prisma generate` |
| Next.js `params` | Always `const params = await rawParams` in dynamic routes |
| Empty strings | Sanitise to null: `field: form.field || null` before POST/PATCH |
| bcrypt | Top-level import only — `import bcrypt from 'bcryptjs'` |

## Role System

13 roles: SUPER_ADMIN, CHAIRPERSON, FARM_ADMIN, FARM_MANAGER, INTERNAL_CONTROL, ACCOUNTANT, STORE_MANAGER, FEED_MILL_MANAGER, PEN_MANAGER, STORE_CLERK, QC_TECHNICIAN, PRODUCTION_STAFF, PEN_WORKER

Permission groups in `lib/constants/roles.js`:
- `MANAGER_ROLES` — full management access
- `LEADERSHIP_ROLES` — billing, analytics, final approvals
- `OPERATIONS_ROLES` — farm operations (no billing/user admin)
- `FINANCE_ROLES` — invoice/payment management
- `VERIFIER_ROLES` — record verification
- `AUDIT_ROLES` — audit log view, investigation flagging

## Module Status

**Completed:** Core operations, Finance (AP/AR/P&L/Reconciliation), Billing, Verification, Audit, Worker portal

**Next:** Phase 8 — Operation Mode selector + production cycle architecture (Brooding, Layer, Broiler modules)

## Environment Variables Required

```env
DATABASE_URL
JWT_SECRET
NEXTAUTH_SECRET
NEXTAUTH_URL
NEXT_PUBLIC_APP_URL
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
```
