/**
 * lib/utils/format.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralised formatting helpers for PoultryFarm Pro.
 * Import from any page or component — never re-declare these inline.
 *
 * Usage:
 *   import { fmt, fmtCur, fmtDate, fmtDateShort, timeAgo, fmtPct, fmtKg } from '@/lib/utils/format';
 */

/**
 * Generic number formatter.
 * fmt(1234.567)      → "1,234.6"
 * fmt(1234.567, 0)   → "1,235"
 * fmt(null)          → "—"
 */
export function fmt(n, decimals = 1) {
  if (n == null || n === '' || isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-NG', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Integer number — no decimal places, with thousands separator.
 * fmtN(12500) → "12,500"
 */
export function fmtN(n) {
  return fmt(n, 0);
}

/**
 * Nigerian Naira currency formatter.
 * fmtCur(2500000)  → "₦2,500,000"
 * fmtCur(null)     → "—"
 */
export function fmtCur(n) {
  if (n == null || isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(n));
}

/**
 * Dollar / generic USD formatter (used in analytics page).
 * fmtUSD(2500) → "$2,500"
 */
export function fmtUSD(n) {
  if (n == null || isNaN(Number(n))) return '—';
  return `$${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * Full date: "12 Mar 2026"
 * fmtDate(new Date()) → "06 Mar 2026"
 * fmtDate(null)       → "—"
 */
export function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Short date — no year: "06 Mar"
 */
export function fmtDateShort(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-NG', {
    day: '2-digit',
    month: 'short',
  });
}

/**
 * ISO date string for <input type="date"> default values.
 * todayISO() → "2026-03-06"
 */
export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Percentage string with configurable decimals.
 * fmtPct(87.333)    → "87.3%"
 * fmtPct(87.333, 0) → "87%"
 */
export function fmtPct(n, decimals = 1) {
  if (n == null || isNaN(Number(n))) return '—';
  return `${Number(n).toFixed(decimals)}%`;
}

/**
 * Kilograms with unit label.
 * fmtKg(1250)    → "1,250 kg"
 * fmtKg(1250, 2) → "1,250.00 kg"
 */
export function fmtKg(n, decimals = 0) {
  if (n == null || isNaN(Number(n))) return '—';
  return `${fmt(n, decimals)} kg`;
}

/**
 * Human-readable "time ago" from a date.
 * timeAgo(someDate) → "3m ago" | "2h ago" | "4d ago"
 */
export function timeAgo(d) {
  if (!d) return '—';
  const mins = Math.floor((Date.now() - new Date(d)) / 60_000);
  if (mins < 1)    return 'just now';
  if (mins < 60)   return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

/**
 * Truncate a string to a max length with ellipsis.
 * truncate("Hello World", 8) → "Hello Wo…"
 */
export function truncate(str, max = 30) {
  if (!str) return '—';
  return str.length > max ? `${str.slice(0, max)}…` : str;
}
