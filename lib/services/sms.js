// lib/services/sms.js — Termii SMS client for PoultryFarm Pro
// Requires: TERMII_API_KEY in environment variables
// Termii docs: https://developers.termii.com/messaging

const TERMII_API    = 'https://api.ng.termii.com/api/sms/send';
const SENDER_ID     = process.env.TERMII_SENDER_ID || 'PltryFarm';  // Max 11 chars
const TERMII_API_KEY = process.env.TERMII_API_KEY;

/**
 * Send a single SMS via Termii
 * @param {string} to   - Phone number in international format e.g. +2348012345678
 * @param {string} body - Message text (max 160 chars per segment)
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
export async function sendSms(to, body) {
  if (!TERMII_API_KEY) {
    console.warn('[SMS] TERMII_API_KEY not set — skipping SMS');
    return { success: false, error: 'TERMII_API_KEY not configured' };
  }

  // Normalise Nigerian numbers: +234, 234, or 0xxx → 234xxx
  const normalised = normalisePhone(to);
  if (!normalised) {
    console.warn(`[SMS] Invalid phone number: ${to}`);
    return { success: false, error: 'Invalid phone number' };
  }

  try {
    const res = await fetch(TERMII_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to:       normalised,
        from:     SENDER_ID,
        sms:      body.slice(0, 459),   // Termii max ~3 segments
        type:     'plain',
        channel:  'generic',
        api_key:  TERMII_API_KEY,
      }),
    });

    const data = await res.json();

    if (!res.ok || data.code === 'error') {
      console.error('[SMS] Termii error:', data);
      return { success: false, error: data.message || 'Termii API error' };
    }

    console.log(`[SMS] Sent to ${normalised}: ${data.message_id || 'ok'}`);
    return { success: true, messageId: data.message_id };
  } catch (err) {
    console.error('[SMS] Network error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send SMS to multiple recipients (fire-and-forget friendly)
 * Skips numbers that are null/empty
 */
export async function sendSmsMany(recipients, body) {
  const results = await Promise.allSettled(
    recipients
      .filter(r => r?.phone)
      .map(r => sendSms(r.phone, body))
  );
  return results;
}

/**
 * Normalise phone to Termii-expected format (no + prefix, starts with country code)
 * Supports: +2348012345678, 2348012345678, 08012345678, 8012345678
 */
function normalisePhone(raw) {
  if (!raw) return null;
  let digits = raw.replace(/[\s\-().+]/g, '');
  if (digits.startsWith('234'))  return digits;          // already international
  if (digits.startsWith('0') && digits.length === 11) return '234' + digits.slice(1);
  if (digits.length === 10)      return '234' + digits;  // local without leading 0
  if (digits.length >= 10)       return digits;           // assume already correct
  return null;
}

// ── Named alert helpers ────────────────────────────────────────────────────────

/**
 * High mortality alert → Farm Manager + Pen Manager
 */
export async function sendMortalityAlert({ count, flockBatchCode, penName, sectionName, causeCode, recipients }) {
  const cause = causeCode?.replace(/_/g, ' ').toLowerCase() || 'unknown cause';
  const msg   = `PoultryFarm Alert: High mortality recorded — ${count} birds (${cause}) in ${penName} › ${sectionName}, Flock ${flockBatchCode}. Please investigate immediately.`;
  return sendSmsMany(recipients, msg);
}

/**
 * Low feed stock alert → Store Manager + Farm Manager
 */
export async function sendLowFeedAlert({ feedType, currentStockKg, reorderLevelKg, storeName, recipients }) {
  const msg = `PoultryFarm Alert: Low feed stock — ${feedType} at ${Number(currentStockKg).toFixed(1)}kg (reorder level: ${reorderLevelKg}kg) in ${storeName}. Please reorder.`;
  return sendSmsMany(recipients, msg);
}

/**
 * Verification rejected — notify submitting worker
 */
export async function sendRejectionAlert({ workerName, recordType, penName, reason, recipients }) {
  const type = recordType.replace(/([A-Z])/g, ' $1').trim();
  const msg  = `PoultryFarm: Your ${type} record for ${penName} was returned for correction. Reason: ${reason || 'Please review and resubmit.'}`;
  return sendSmsMany(recipients, msg);
}
