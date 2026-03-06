'use client';
/**
 * components/ui/Modal.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared portal-rendered modal used across all pages.
 * Always renders into document.body via createPortal, so it's never clipped
 * by a scrolled parent — fixes the scroll-position bug on all pages.
 *
 * Usage — simple wrapper (you supply the full content):
 *   import Modal from '@/components/ui/Modal';
 *
 *   <Modal onClose={handleClose} width={480}>
 *     <h2>Title</h2>
 *     <p>Body content…</p>
 *   </Modal>
 *
 * Usage — with built-in header + footer:
 *   <Modal
 *     title="Schedule Vaccination"
 *     onClose={handleClose}
 *     width={460}
 *     footer={
 *       <>
 *         <button className="btn btn-ghost" onClick={handleClose}>Cancel</button>
 *         <button className="btn btn-primary" onClick={handleSave}>Save</button>
 *       </>
 *     }
 *   >
 *     <p>Body content…</p>
 *   </Modal>
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function Modal({
  children,
  onClose,
  width      = 480,
  title,
  subtitle,
  footer,
  noPadding  = false,
}) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Prevent body scroll while modal is open
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
        {/* Auto header — only rendered when title is provided */}
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
                background: 'none',
                border:     'none',
                fontSize:   20,
                cursor:     'pointer',
                color:      'var(--text-muted)',
                lineHeight: 1,
                padding:    '4px 6px',
                borderRadius: 6,
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Body */}
        {children}

        {/* Auto footer — only rendered when footer is provided */}
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
