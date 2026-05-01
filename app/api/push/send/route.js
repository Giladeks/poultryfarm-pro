// app/api/push/send/route.js
// POST — send a Web Push notification to one or all workers on a tenant.
// Called by the Vercel cron job at 07:00 WAT (06:00 UTC) daily.
//
// ── Vercel cron config (vercel.json) ─────────────────────────────────────────
// {
//   "crons": [
//     {
//       "path": "/api/push/send",
//       "schedule": "0 6 * * *"
//     }
//   ]
// }
//
// ── Environment variables required ───────────────────────────────────────────
//   VAPID_PUBLIC_KEY   — base64url VAPID public key  (server-side, no NEXT_PUBLIC_)
//   VAPID_PRIVATE_KEY  — base64url VAPID private key
//   VAPID_SUBJECT      — mailto: or https: contact URI  e.g. mailto:admin@yourfarm.com
//   CRON_SECRET        — shared secret to verify the request is from Vercel cron
//
// ── Generating VAPID keys (run once) ─────────────────────────────────────────
//   npx web-push generate-vapid-keys --json
// Copy the output into your .env.local:
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY=<publicKey>   ← also needs NEXT_PUBLIC_ for client
//   VAPID_PUBLIC_KEY=<publicKey>               ← server copy (same value)
//   VAPID_PRIVATE_KEY=<privateKey>
//   VAPID_SUBJECT=mailto:admin@yourfarm.com
//   CRON_SECRET=<any long random string>
//
// ── Install web-push ─────────────────────────────────────────────────────────
//   npm install web-push

import { NextResponse } from 'next/server';
import webpush          from 'web-push';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

export const dynamic = 'force-dynamic';

// ── Shared helper — send push to a single subscription row ───────────────────
export async function sendPushToSubscription(sub, payload) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );

  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
    );
    return { ok: true };
  } catch (err) {
    // 410 Gone = subscription expired/revoked — clean it up
    if (err.statusCode === 410) {
      await prisma.$executeRaw`
        DELETE FROM push_subscriptions WHERE endpoint = ${sub.endpoint}
      `;
    }
    return { ok: false, error: err.message, status: err.statusCode };
  }
}

// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(request) {
  // Allow both cron secret (automated) and FM/FA JWT (manual trigger)
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization') || '';
  const isCron     = cronSecret && authHeader === `Bearer ${cronSecret}`;

  let tenantId = null;

  if (!isCron) {
    // Manual trigger — must be FM or above
    const user = await verifyToken(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const managerRoles = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
    if (!managerRoles.includes(user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    tenantId = user.tenantId;
  }

  try {
    const today    = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

    // Build the where clause for subscriptions
    // Cron: all tenants. Manual: just this tenant.
    const subWhere = tenantId
      ? `WHERE "tenantId" = '${tenantId}'`
      : '';

    // Fetch all subscriptions
    const subs = await prisma.$queryRawUnsafe(`
      SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth, ps."userId", ps."tenantId"
      FROM push_subscriptions ps
      ${subWhere}
    `);

    if (subs.length === 0) {
      return NextResponse.json({ sent: 0, message: 'No push subscriptions found' });
    }

    // For each subscription, count today's pending tasks for that user
    let sent = 0, failed = 0;

    await Promise.all(subs.map(async (sub) => {
      const taskCount = await prisma.task.count({
        where: {
          assignedToId: sub.userId,
          status:       { in: ['PENDING', 'IN_PROGRESS'] },
          dueDate:      { gte: today, lt: tomorrow },
        },
      });

      // Don't spam workers with 0 tasks
      if (taskCount === 0) return;

      const payload = {
        title:   '🌅 Good morning — shift starting',
        body:    `You have ${taskCount} task${taskCount !== 1 ? 's' : ''} to complete today. Tap to view.`,
        icon:    '/icons/icon-192.png',
        badge:   '/icons/badge-72.png',
        tag:     'pfp-shift-start',
        data:    { url: '/worker' },
        actions: [
          { action: 'open',    title: '📋 View Tasks' },
          { action: 'dismiss', title: 'Later' },
        ],
      };

      const result = await sendPushToSubscription(sub, payload);
      if (result.ok) sent++;
      else           failed++;
    }));

    return NextResponse.json({
      sent,
      failed,
      total: subs.length,
      message: `Sent shift-start notifications to ${sent} device${sent !== 1 ? 's' : ''}.`,
    });
  } catch (err) {
    console.error('[push/send]', err);
    return NextResponse.json({ error: 'Failed to send notifications' }, { status: 500 });
  }
}
