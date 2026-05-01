// app/api/push/subscribe/route.js
// POST — save or update a Web Push subscription for the current user.
// The subscription is stored in push_subscriptions table (see SQL migration below).
//
// ── SQL migration (run once in pgAdmin) ──────────────────────────────────────
// CREATE TABLE IF NOT EXISTS push_subscriptions (
//   id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
//   "userId"      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
//   "tenantId"    TEXT NOT NULL,
//   endpoint      TEXT NOT NULL,
//   p256dh        TEXT NOT NULL,
//   auth          TEXT NOT NULL,
//   "userAgent"   TEXT,
//   "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
//   "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
//   UNIQUE("userId", endpoint)
// );
// CREATE INDEX IF NOT EXISTS idx_push_subs_tenant ON push_subscriptions("tenantId");
// CREATE INDEX IF NOT EXISTS idx_push_subs_user   ON push_subscriptions("userId");
//
// ── Prisma schema addition (prisma/schema.prisma) ────────────────────────────
// model PushSubscription {
//   id        String   @id @default(uuid())
//   userId    String
//   tenantId  String
//   endpoint  String
//   p256dh    String
//   auth      String
//   userAgent String?
//   createdAt DateTime @default(now())
//   updatedAt DateTime @updatedAt
//   user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
//   @@unique([userId, endpoint])
//   @@index([tenantId])
//   @@map("push_subscriptions")
// }
// Also add to User model:
//   pushSubscriptions PushSubscription[]

import { NextResponse } from 'next/server';
import { verifyToken }  from '@/lib/middleware/auth';
import { prisma }       from '@/lib/db/prisma';
import { z }            from 'zod';

const bodySchema = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string(),
      auth:   z.string(),
    }),
  }),
});

export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { subscription } = bodySchema.parse(body);
    const userAgent = request.headers.get('user-agent') || null;

    // Upsert — same user+endpoint combo updates keys (they rotate occasionally)
    await prisma.$executeRaw`
      INSERT INTO push_subscriptions (id, "userId", "tenantId", endpoint, p256dh, auth, "userAgent", "updatedAt")
      VALUES (
        gen_random_uuid()::text,
        ${user.sub},
        ${user.tenantId},
        ${subscription.endpoint},
        ${subscription.keys.p256dh},
        ${subscription.keys.auth},
        ${userAgent},
        now()
      )
      ON CONFLICT ("userId", endpoint)
      DO UPDATE SET
        p256dh      = EXCLUDED.p256dh,
        auth        = EXCLUDED.auth,
        "userAgent" = EXCLUDED."userAgent",
        "updatedAt" = now()
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err?.name === 'ZodError')
      return NextResponse.json({ error: 'Invalid subscription payload' }, { status: 422 });
    console.error('[push/subscribe]', err);
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 });
  }
}
