// app/api/notifications/route.js
// GET  — returns unread count + recent notifications for the current user
// PATCH — marks one or all notifications as read

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

// ── GET /api/notifications ────────────────────────────────────────────────────
// Query params:
//   ?limit=20        — how many to return (default 20, max 50)
//   ?unreadOnly=true — only return unread notifications
export async function GET(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limit      = Math.min(parseInt(searchParams.get('limit') || '20'), 50);
  const unreadOnly = searchParams.get('unreadOnly') === 'true';

  try {
    const where = {
      recipientId: user.sub,
      tenantId:    user.tenantId,
      channel:     'IN_APP',
      ...(unreadOnly && { isRead: false }),
    };

    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id:        true,
          type:      true,
          title:     true,
          message:   true,
          data:      true,
          isRead:    true,
          createdAt: true,
        },
      }),
      prisma.notification.count({
        where: {
          recipientId: user.sub,
          tenantId:    user.tenantId,
          channel:     'IN_APP',
          isRead:      false,
        },
      }),
    ]);

    return NextResponse.json({ notifications, unreadCount });
  } catch (err) {
    console.error('[notifications GET]', err);
    return NextResponse.json({ error: 'Failed to load notifications' }, { status: 500 });
  }
}

// ── PATCH /api/notifications ──────────────────────────────────────────────────
// Body: { id: 'notif-id' }   — mark one notification as read
// Body: { markAllRead: true } — mark ALL notifications as read
export async function PATCH(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();

    if (body.markAllRead) {
      await prisma.notification.updateMany({
        where: {
          recipientId: user.sub,
          tenantId:    user.tenantId,
          isRead:      false,
        },
        data: { isRead: true, readAt: new Date() },
      });
      return NextResponse.json({ success: true, updated: 'all' });
    }

    if (!body.id) {
      return NextResponse.json({ error: 'Provide id or markAllRead' }, { status: 400 });
    }

    // Verify the notification belongs to this user before updating
    const notif = await prisma.notification.findFirst({
      where: { id: body.id, recipientId: user.sub, tenantId: user.tenantId },
    });
    if (!notif) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    await prisma.notification.update({
      where: { id: body.id },
      data:  { isRead: true, readAt: new Date() },
    });

    return NextResponse.json({ success: true, updated: body.id });
  } catch (err) {
    console.error('[notifications PATCH]', err);
    return NextResponse.json({ error: 'Failed to update notification' }, { status: 500 });
  }
}
