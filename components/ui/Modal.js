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
          width:     '100%',
          maxWidth:  width,
          maxHeight: '90vh',
          overflowY: 'auto',
          padding:   noPadding ? 0 : 28,
          animation: 'fadeInUp 0.2s ease',
        }}
        onClick={e => e.stopPropagation()}
      >
        {title && (
          <div style={{
            display:        'flex',
            justifyContent: 'space-between',
            alignItems:     'center',
            marginBottom:   20,
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
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                  {subtitle}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              style={{
                background:   'none',
                border:       'none',
                fontSize:     20,
                cursor:       'pointer',
                color:        'var(--text-muted)',
                lineHeight:   1,
                padding:      '4px 6px',
                borderRadius: 6,
                flexShrink:   0,
              }}
            >
              ✕
            </button>
          </div>
        )}

        {children}

        {footer && (
          <div style={{
            display:        'flex',
            justifyContent: 'flex-end',
            gap:            10,
            marginTop:      24,
            paddingTop:     20,
            borderTop:      '1px solid var(--border)',
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
