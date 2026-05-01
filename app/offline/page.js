'use client';
// app/offline/page.js — shown when the PWA can't reach a page while offline

export default function OfflinePage() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#f8fafc', fontFamily: "'Nunito', sans-serif",
      padding: 24, textAlign: 'center',
    }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>📵</div>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', marginBottom: 8 }}>
        You're offline
      </h1>
      <p style={{ fontSize: 14, color: '#64748b', maxWidth: 320, lineHeight: 1.6, marginBottom: 28 }}>
        This page isn't available offline. Any tasks you complete will be queued
        and synced automatically when your connection returns.
      </p>
      <button
        onClick={() => window.location.href = '/worker'}
        style={{
          padding: '10px 24px', borderRadius: 10,
          background: '#6c63ff', color: '#fff',
          border: 'none', fontSize: 14, fontWeight: 700,
          cursor: 'pointer',
        }}>
        Go to My Tasks
      </button>
    </div>
  );
}
