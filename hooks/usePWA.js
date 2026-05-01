'use client';
// hooks/usePWA.js
// Handles service worker registration and push notification subscription.
// Import and call usePWA() once in a top-level client component (e.g. AppShell).
//
// Environment variables required (add to .env.local):
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY=<your base64 VAPID public key>

import { useEffect } from 'react';

export function usePWA(apiFetch) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator))  return;

    const run = async () => {
      try {
        // ── 1. Register service worker ──────────────────────────────────────
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        console.log('[PWA] Service worker registered:', reg.scope);

        // ── 2. Subscribe to Web Push (if VAPID key is configured) ──────────
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidKey) {
          console.warn('[PWA] NEXT_PUBLIC_VAPID_PUBLIC_KEY not set — push notifications disabled');
          return;
        }

        // Check if push is supported
        if (!('PushManager' in window)) return;

        // Check permission — don't prompt immediately, wait for user gesture
        // Permission will be requested when user enables notifications in settings
        const permission = Notification.permission;
        if (permission === 'denied') return;

        // If already granted, ensure subscription is current
        if (permission === 'granted') {
          await ensurePushSubscription(reg, vapidKey, apiFetch);
        }
        // If 'default' — subscription is deferred to the enablePushNotifications() call
      } catch (err) {
        console.error('[PWA] SW registration failed:', err);
      }
    };

    run();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

// ── Called when the user explicitly enables push in the notification settings ─
export async function enablePushNotifications(apiFetch) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'Push notifications are not supported in this browser.' };
  }

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    return { ok: false, reason: 'Push notifications are not configured on this server.' };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { ok: false, reason: 'Permission denied. Enable notifications in your browser settings.' };
    }

    const reg = await navigator.serviceWorker.ready;
    await ensurePushSubscription(reg, vapidKey, apiFetch);
    return { ok: true };
  } catch (err) {
    console.error('[PWA] Push subscription failed:', err);
    return { ok: false, reason: err.message };
  }
}

// ── Subscribe and POST subscription to server ─────────────────────────────────
async function ensurePushSubscription(reg, vapidKey, apiFetch) {
  try {
    // Check for existing subscription
    let sub = await reg.pushManager.getSubscription();

    if (!sub) {
      // Create new subscription
      sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
    }

    // Always POST to server (idempotent upsert by endpoint)
    if (apiFetch) {
      await apiFetch('/api/push/subscribe', {
        method: 'POST',
        body:   JSON.stringify({ subscription: sub.toJSON() }),
      });
    }
    console.log('[PWA] Push subscription active:', sub.endpoint.slice(-20));
  } catch (err) {
    console.warn('[PWA] Push subscription error:', err);
  }
}

// ── Convert base64 VAPID key to Uint8Array ────────────────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding  = '='.repeat((4 - base64String.length % 4) % 4);
  const base64   = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData  = window.atob(base64);
  const output   = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}
