'use client';
/**
 * components/ui/Modal.js
 * Portal-rendered modal — never clipped by scrolled parents.
 *
 * Usage (simple):
 *   <Modal onClose={handleClose} width={480}>…body…</Modal>
 *
 * Usage (with header + footer):
 *   <Modal title="Log Eggs" onClose={handleClose} width={460}
 *     footer={<><button onClick={handleClose}>Cancel</button><button onClick={save}>Save</button></>}>
 *     …body…
 *   </Modal>
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function Modal({
  children,
  onClose,
  width     = 480,
  title,
  subtitle,
  footer,
  noPadding = false,
}) {
  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="modal-overlay"
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{ zIndex: 500 }}
    >
      <div
        className="modal"
        style={{
          width:         '100%',
          maxWidth:      width,
          maxHeight:     '92vh',
          display:       'flex',
          flexDirection: 'column',
          padding:       0,
          animation:     'fadeInUp 0.2s ease',
          overflow:      'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Fixed header */}
        {title && (
          <div style={{
            display:        'flex',
            justifyContent: 'space-between',
            alignItems:     'center',
            padding:        '18px 20px 16px',
            borderBottom:   '1px solid var(--border)',
            flexShrink:     0,
          }}>
            <div>
              <h2 style={{
                fontFamily: "'Poppins',sans-serif",
                fontSize:   17,
                fontWeight: 700,
                margin:     0,
                color:      'var(--text-primary)',
              }}>
                {title}
              </h2>
              {subtitle && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, margin: 0 }}>
                  {subtitle}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              style={{
                background:     'none',
                border:         'none',
                fontSize:       20,
                cursor:         'pointer',
                color:          'var(--text-muted)',
                lineHeight:     1,
                padding:        '4px 6px',
                borderRadius:   6,
                flexShrink:     0,
                minWidth:       44,
                minHeight:      44,
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Scrollable body */}
        <div style={{
          flex:                    1,
          overflowY:               'auto',
          padding:                 noPadding ? 0 : '20px 20px',
          WebkitOverflowScrolling: 'touch',
        }}>
          {children}
        </div>

        {/* Sticky footer — always visible */}
        {footer && (
          <div style={{
            display:        'flex',
            justifyContent: 'flex-end',
            alignItems:     'center',
            gap:            10,
            padding:        '14px 20px',
            borderTop:      '1px solid var(--border)',
            flexShrink:     0,
            background:     'var(--bg-surface)',
            flexWrap:       'wrap',
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
