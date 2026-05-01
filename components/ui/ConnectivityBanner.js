'use client';
// components/ui/ConnectivityBanner.js
// Always-visible connectivity indicator for PWA workers.
// Shows a slim banner at the top of the page when offline, and a brief
// "Back online — syncing…" confirmation when reconnecting.
// Also listens for PFP_SYNC_COMPLETE messages from the service worker
// and shows a toast confirming how many queued actions were replayed.

import { useState, useEffect, useCallback } from 'react';

export default function ConnectivityBanner() {
  const [online,      setOnline]      = useState(true);
  const [syncing,     setSyncing]     = useState(false);
  const [syncToast,   setSyncToast]   = useState(null); // { replayed: N }
  const [queueCount,  setQueueCount]  = useState(0);    // items pending in IndexedDB

  // ── Count items in the offline queue ───────────────────────────────────────
  const refreshQueueCount = useCallback(async () => {
    if (!('indexedDB' in window)) return;
    try {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('pfp-queue', 1);
        r.onsuccess = e => res(e.target.result);
        r.onerror   = e => rej(e.target.error);
        r.onupgradeneeded = e => {
          const d = e.target.result;
          if (!d.objectStoreNames.contains('requests'))
            d.createObjectStore('requests', { keyPath: 'id', autoIncrement: true });
        };
      });
      const count = await new Promise((res, rej) => {
        const tx  = db.transaction('requests', 'readonly');
        const req = tx.objectStore('requests').count();
        req.onsuccess = () => res(req.result);
        req.onerror   = e => rej(e.target.error);
      });
      setQueueCount(count);
      db.close();
    } catch { setQueueCount(0); }
  }, []);

  useEffect(() => {
    // Initial state
    setOnline(navigator.onLine);
    refreshQueueCount();

    const goOnline = async () => {
      setOnline(true);
      setSyncing(true);

      // Trigger background sync if supported
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        try {
          const reg = await navigator.serviceWorker.ready;
          await reg.sync.register('pfp-sync');
        } catch { /* sync not available — sw will catch fetch events */ }
      }

      // Show syncing indicator for at least 1.5s
      setTimeout(() => setSyncing(false), 1500);
      refreshQueueCount();
    };

    const goOffline = () => {
      setOnline(false);
      setSyncing(false);
      refreshQueueCount();
    };

    window.addEventListener('online',  goOnline);
    window.addEventListener('offline', goOffline);

    // Listen for sync-complete message from service worker
    const swListener = (event) => {
      if (event.data?.type === 'PFP_SYNC_COMPLETE') {
        setSyncToast({ replayed: event.data.replayed });
        refreshQueueCount();
        setTimeout(() => setSyncToast(null), 4000);
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', swListener);
    }

    return () => {
      window.removeEventListener('online',  goOnline);
      window.removeEventListener('offline', goOffline);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', swListener);
      }
    };
  }, [refreshQueueCount]);

  // ── Render ─────────────────────────────────────────────────────────────────

  // Sync complete toast (temporary, top-right)
  const SyncToast = syncToast ? (
    <div style={{
      position: 'fixed', top: 16, right: 16, zIndex: 9999,
      background: '#166534', color: '#fff',
      padding: '10px 16px', borderRadius: 10,
      fontSize: 12, fontWeight: 700,
      boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', gap: 8,
      animation: 'pfpFadeIn 0.2s ease',
    }}>
      <span style={{ fontSize: 16 }}>✅</span>
      {syncToast.replayed} offline action{syncToast.replayed !== 1 ? 's' : ''} synced successfully
    </div>
  ) : null;

  // Online + syncing banner (brief)
  if (online && syncing) return (
    <>
      {SyncToast}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9998,
        background: '#1d4ed8', color: '#fff',
        padding: '6px 16px', fontSize: 12, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        animation: 'pfpFadeIn 0.2s ease',
      }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%',
          border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff',
          display: 'inline-block', animation: 'pfpSpin 0.7s linear infinite' }} />
        Back online — syncing offline actions…
      </div>
      <style>{`
        @keyframes pfpFadeIn { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pfpSpin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );

  // Offline banner (persistent)
  if (!online) return (
    <>
      {SyncToast}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9998,
        background: '#7f1d1d', color: '#fff',
        padding: '7px 16px', fontSize: 12, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      }}>
        <span>📵</span>
        <span>Offline — data will sync automatically when connected</span>
        {queueCount > 0 && (
          <span style={{
            background: 'rgba(255,255,255,0.2)', padding: '1px 8px',
            borderRadius: 10, fontSize: 11,
          }}>
            {queueCount} action{queueCount !== 1 ? 's' : ''} queued
          </span>
        )}
      </div>
      <style>{`
        @keyframes pfpFadeIn { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
      `}</style>
    </>
  );

  // Online + no queue — render nothing (don't clutter the UI when all is well)
  return SyncToast;
}
