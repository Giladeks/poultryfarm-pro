// public/sw.js
// PoultryFarm Pro — Service Worker
// Responsibilities:
//   1. Cache-first for static assets (JS, CSS, fonts, images)
//   2. Network-first with cache fallback for API GET requests
//   3. IndexedDB queue for POST/PATCH requests made while offline
//   4. Background sync to replay queued requests when back online
//   5. Web Push notification display

const CACHE_NAME     = 'pfp-v1';
const QUEUE_DB_NAME  = 'pfp-queue';
const QUEUE_DB_VER   = 1;
const QUEUE_STORE    = 'requests';

// Static assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/worker',
  '/offline',
];

// API routes that are safe to cache for offline reads (GET only)
const CACHEABLE_API = [
  '/api/farm-structure',
  '/api/feed/inventory',
  '/api/tasks',
];

// ── Install — pre-cache shell ─────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(PRECACHE_URLS).catch(() => {}) // non-fatal if some fail
    ).then(() => self.skipWaiting())
  );
});

// ── Activate — clean stale caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── IndexedDB helpers ─────────────────────────────────────────────────────────
function openQueueDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(QUEUE_DB_NAME, QUEUE_DB_VER);
    req.onupgradeneeded = e => {
      const db    = e.target.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('ts', 'ts', { unique: false });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function enqueueRequest(db, entry) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(QUEUE_STORE, 'readwrite');
    const req = tx.objectStore(QUEUE_STORE).add(entry);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function getAllQueued(db) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(QUEUE_STORE, 'readonly');
    const req = tx.objectStore(QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function deleteQueued(db, id) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(QUEUE_STORE, 'readwrite');
    const req = tx.objectStore(QUEUE_STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

// ── Notify all clients that a queued request was replayed ────────────────────
async function notifyClients(msg) {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(c => c.postMessage(msg));
}

// ── Fetch handler ─────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url         = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  const isAPI      = url.pathname.startsWith('/api/');
  const isGetAPI   = isAPI && request.method === 'GET';
  const isMutating = isAPI && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method);

  // ── Mutable API calls: network first, queue if offline ───────────────────
  if (isMutating) {
    event.respondWith(
      fetch(request.clone()).catch(async () => {
        // Offline — serialize request and enqueue for later replay
        try {
          const body    = await request.clone().text();
          const headers = {};
          request.headers.forEach((v, k) => { headers[k] = v; });
          const db = await openQueueDB();
          const id = await enqueueRequest(db, {
            url:     request.url,
            method:  request.method,
            headers,
            body,
            ts:      Date.now(),
          });
          // Return a synthetic queued response so the UI knows it was accepted
          return new Response(
            JSON.stringify({ queued: true, queueId: id, message: 'Saved offline — will sync when connected' }),
            { status: 202, headers: { 'Content-Type': 'application/json', 'X-PFP-Queued': '1' } }
          );
        } catch {
          return new Response(
            JSON.stringify({ error: 'Offline and unable to queue request' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        }
      })
    );
    return;
  }

  // ── Cacheable GET API: network first, fall back to cache ─────────────────
  if (isGetAPI && CACHEABLE_API.some(p => url.pathname.startsWith(p))) {
    event.respondWith(
      fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return res;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // ── Static assets: cache first, network fallback ─────────────────────────
  if (!isAPI) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(res => {
          if (res.ok && request.method === 'GET') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return res;
        }).catch(() => caches.match('/offline') || new Response('Offline', { status: 503 }));
      })
    );
    return;
  }
});

// ── Background sync — replay queued mutations ─────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'pfp-sync') {
    event.waitUntil(replayQueue());
  }
});

async function replayQueue() {
  let db;
  try { db = await openQueueDB(); } catch { return; }

  const items = await getAllQueued(db);
  if (items.length === 0) return;

  let replayed = 0;
  for (const item of items) {
    try {
      const res = await fetch(item.url, {
        method:  item.method,
        headers: item.headers,
        body:    item.body || undefined,
      });
      if (res.ok || res.status < 500) {
        // Success or client error (don't retry 4xx) — remove from queue
        await deleteQueued(db, item.id);
        replayed++;
      }
    } catch {
      // Network still down — leave in queue
    }
  }

  if (replayed > 0) {
    await notifyClients({ type: 'PFP_SYNC_COMPLETE', replayed });
  }
}

// ── Push notification handler ─────────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try   { payload = event.data.json(); }
  catch { payload = { title: 'PoultryFarm Pro', body: event.data.text() }; }

  const options = {
    body:    payload.body    || 'You have pending tasks.',
    icon:    payload.icon    || '/icons/icon-192.png',
    badge:   payload.badge   || '/icons/badge-72.png',
    tag:     payload.tag     || 'pfp-shift',
    data:    payload.data    || { url: '/worker' },
    actions: payload.actions || [
      { action: 'open',    title: '📋 View Tasks' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
    requireInteraction: payload.requireInteraction ?? false,
    vibrate: [200, 100, 200],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'PoultryFarm Pro', options)
  );
});

// ── Notification click handler ────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/worker';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus existing window if open
      const existing = clients.find(c => c.url.includes(targetUrl) || c.url.includes('/worker'));
      if (existing) return existing.focus();
      // Otherwise open a new window
      return self.clients.openWindow(targetUrl);
    })
  );
});
