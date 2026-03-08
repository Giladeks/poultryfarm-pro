'use client';
// components/ui/GlobalSearch.js
// Command-palette style global search. Triggered by Ctrl+K / Cmd+K or the
// search button in the topbar. Keyboard-navigable, groups results by type.
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

const TYPE_LABEL = {
  pen:       'Pens',
  section:   'Sections',
  flock:     'Flocks',
  user:      'People',
  supplier:  'Suppliers',
  inventory: 'Feed Inventory',
};

const BADGE_COLOR = {
  ACTIVE:   { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
  INACTIVE: { bg: '#f9fafb', color: '#6b7280', border: '#e5e7eb' },
  SOLD:     { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  ARCHIVED: { bg: '#f9fafb', color: '#9ca3af', border: '#e5e7eb' },
};

function groupResults(results) {
  const groups = {};
  results.forEach(r => {
    if (!groups[r.type]) groups[r.type] = [];
    groups[r.type].push(r);
  });
  return groups;
}

export default function GlobalSearch({ onClose }) {
  const router  = useRouter();
  const inputRef   = useRef(null);
  const listRef    = useRef(null);

  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [error,    setError]    = useState(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search
  useEffect(() => {
    if (query.length < 2) { setResults([]); setError(null); return; }
    const t = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const d   = await res.json();
        if (!res.ok) throw new Error(d.error);
        setResults(d.results || []);
        setActiveIdx(0);
      } catch (e) {
        setError(e.message);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  // Flat list for keyboard nav
  const flat = results;

  const navigate = useCallback((item) => {
    router.push(item.href);
    onClose();
  }, [router, onClose]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(i + 1, flat.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter' && flat[activeIdx]) {
        navigate(flat[activeIdx]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [flat, activeIdx, navigate, onClose]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const groups = groupResults(results);
  let globalIdx = 0;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 2000,
          background: 'rgba(15,15,35,0.55)',
          backdropFilter: 'blur(3px)',
          animation: 'fadeIn 0.15s ease',
        }}
      />

      {/* Palette */}
      <div style={{
        position:  'fixed',
        top:       '12vh',
        left:      '50%',
        transform: 'translateX(-50%)',
        zIndex:    2001,
        width:     '100%',
        maxWidth:  580,
        padding:   '0 16px',
        animation: 'slideDown 0.18s ease',
      }}>
        <div style={{
          background:   '#fff',
          borderRadius: 16,
          boxShadow:    '0 24px 64px rgba(0,0,0,0.22)',
          overflow:     'hidden',
          border:       '1px solid var(--border-card)',
        }}>

          {/* Search input */}
          <div style={{
            display:      'flex',
            alignItems:   'center',
            gap:          10,
            padding:      '14px 18px',
            borderBottom: results.length || loading ? '1px solid var(--border)' : 'none',
          }}>
            <span style={{ fontSize: 18, flexShrink: 0, opacity: 0.5 }}>🔍</span>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search pens, flocks, people, feed…"
              style={{
                flex:       1,
                border:     'none',
                outline:    'none',
                fontSize:   15,
                fontFamily: "'Nunito', sans-serif",
                fontWeight: 600,
                color:      'var(--text-primary)',
                background: 'transparent',
              }}
            />
            {loading && (
              <div style={{ width: 16, height: 16, border: '2px solid var(--border)', borderTopColor: 'var(--purple)', borderRadius: '50%', animation: 'spin 0.6s linear infinite', flexShrink: 0 }} />
            )}
            {!loading && query && (
              <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)', lineHeight: 1, padding: 0 }}>×</button>
            )}
            <kbd style={{ fontSize: 10, fontFamily: 'inherit', fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 6px', flexShrink: 0 }}>ESC</kbd>
          </div>

          {/* Results */}
          {(results.length > 0 || error) && (
            <div ref={listRef} style={{ maxHeight: '55vh', overflowY: 'auto' }}>
              {error && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--red)', fontSize: 13 }}>
                  ⚠ {error}
                </div>
              )}
              {Object.entries(groups).map(([type, items]) => (
                <div key={type}>
                  {/* Group header */}
                  <div style={{
                    padding:         '8px 18px 4px',
                    fontSize:        10,
                    fontWeight:      700,
                    textTransform:   'uppercase',
                    letterSpacing:   '.07em',
                    color:           'var(--text-muted)',
                    background:      'var(--bg-elevated)',
                    borderBottom:    '1px solid var(--border)',
                    borderTop:       '1px solid var(--border)',
                  }}>
                    {TYPE_LABEL[type] || type}
                  </div>

                  {/* Items */}
                  {items.map(item => {
                    const idx    = globalIdx++;
                    const active = idx === activeIdx;
                    const badge  = item.badge ? (BADGE_COLOR[item.badge] || BADGE_COLOR.INACTIVE) : null;
                    return (
                      <div
                        key={item.id}
                        data-active={active}
                        onClick={() => navigate(item)}
                        onMouseEnter={() => setActiveIdx(idx)}
                        style={{
                          display:    'flex',
                          alignItems: 'center',
                          gap:        12,
                          padding:    '11px 18px',
                          cursor:     'pointer',
                          background: active ? 'var(--purple-light)' : '#fff',
                          borderBottom: '1px solid var(--border)',
                          transition: 'background 0.1s',
                        }}
                      >
                        {/* Icon */}
                        <div style={{
                          width:          36,
                          height:         36,
                          borderRadius:   9,
                          background:     active ? 'var(--purple)' : 'var(--bg-elevated)',
                          border:         `1px solid ${active ? 'var(--purple)' : 'var(--border)'}`,
                          display:        'flex',
                          alignItems:     'center',
                          justifyContent: 'center',
                          fontSize:       17,
                          flexShrink:     0,
                          transition:     'all 0.1s',
                        }}>
                          {item.icon}
                        </div>

                        {/* Text */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize:     13,
                            fontWeight:   700,
                            color:        active ? 'var(--purple)' : 'var(--text-primary)',
                            whiteSpace:   'nowrap',
                            overflow:     'hidden',
                            textOverflow: 'ellipsis',
                          }}>
                            {item.title}
                          </div>
                          <div style={{
                            fontSize:     11,
                            color:        'var(--text-muted)',
                            marginTop:    2,
                            whiteSpace:   'nowrap',
                            overflow:     'hidden',
                            textOverflow: 'ellipsis',
                          }}>
                            {item.sub}
                          </div>
                        </div>

                        {/* Badge */}
                        {badge && (
                          <span style={{
                            fontSize:     9,
                            fontWeight:   700,
                            padding:      '2px 8px',
                            borderRadius: 20,
                            background:   badge.bg,
                            color:        badge.color,
                            border:       `1px solid ${badge.border}`,
                            flexShrink:   0,
                            textTransform: 'uppercase',
                            letterSpacing: '.04em',
                          }}>
                            {item.badge}
                          </span>
                        )}

                        {/* Arrow hint */}
                        {active && (
                          <span style={{ color: 'var(--purple)', fontSize: 14, flexShrink: 0 }}>↵</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && query.length >= 2 && results.length === 0 && !error && (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4 }}>No results for "{query}"</div>
              <div style={{ fontSize: 12 }}>Try searching by pen name, flock code, person name, or feed type.</div>
            </div>
          )}

          {/* Hint bar */}
          <div style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            padding:        '8px 18px',
            borderTop:      '1px solid var(--border)',
            background:     'var(--bg-elevated)',
          }}>
            <div style={{ display: 'flex', gap: 14 }}>
              {[['↑↓', 'navigate'], ['↵', 'open'], ['esc', 'close']].map(([key, label]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <kbd style={{ fontSize: 10, fontFamily: 'inherit', fontWeight: 700, color: 'var(--text-secondary)', background: '#fff', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px' }}>{key}</kbd>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {results.length > 0 ? `${results.length} result${results.length !== 1 ? 's' : ''}` : 'Type to search'}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn    { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideDown { from { opacity: 0; transform: translateX(-50%) translateY(-12px) } to { opacity: 1; transform: translateX(-50%) translateY(0) } }
        @keyframes spin      { to { transform: rotate(360deg) } }
      `}</style>
    </>,
    document.body,
  );
}
