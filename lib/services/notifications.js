// lib/services/notifications.js — Alert generation & email notifications
// Phase 5.2: Full email triggers for all four alert types

import nodemailer from 'nodemailer';

// ── Email Transport ────────────────────────────────────────────────────────────
let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;
  _transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return _transporter;
}

// ── Shared email helpers ───────────────────────────────────────────────────────

const BASE_STYLE = `font-family:'Poppins',sans-serif;max-width:600px;margin:0 auto;background:#ffffff;color:#374151;padding:0;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb`;
const HEADER_STYLE = `background:linear-gradient(135deg,#6c63ff 0%,#4f46e5 100%);padding:28px 32px;`;
const BODY_STYLE = `padding:28px 32px;`;
const FOOTER_STYLE = `padding:16px 32px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;`;

function emailBase({ title, body, ctaUrl, ctaLabel }) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.poultryfarm.pro';
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f3f4f6;">
<div style="${BASE_STYLE}">
  <div style="${HEADER_STYLE}">
    <p style="margin:0;color:#c7d2fe;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase">PoultryFarm Pro</p>
    <h1 style="margin:6px 0 0;color:#ffffff;font-size:22px;font-weight:700;line-height:1.3">${title}</h1>
  </div>
  <div style="${BODY_STYLE}">${body}</div>
  <div style="${FOOTER_STYLE}">
    ${ctaUrl ? `<a href="${ctaUrl.startsWith('http') ? ctaUrl : appUrl + ctaUrl}" style="display:inline-block;background:#6c63ff;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-bottom:16px">${ctaLabel || 'View in App'}</a><br>` : ''}
    <p style="margin:0;color:#9ca3af;font-size:12px">You're receiving this because you manage a farm on PoultryFarm Pro.<br>Log in to <a href="${appUrl}" style="color:#6c63ff">${appUrl}</a></p>
  </div>
</div>
</body>
</html>`;
}

function infoRow(label, value, highlight = false) {
  return `<tr>
    <td style="padding:8px 0;color:#6b7280;font-size:13px;width:45%;vertical-align:top">${label}</td>
    <td style="padding:8px 0;font-size:13px;font-weight:600;color:${highlight ? '#dc2626' : '#111827'};vertical-align:top">${value}</td>
  </tr>`;
}

/**
 * Sends an email using the configured SMTP transport.
 * Returns { success: boolean, messageId?: string, error?: string }
 */
export async function sendEmail({ to, subject, html, text }) {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[EMAIL] To: ${to} | Subject: ${subject}`);
    return { success: true, messageId: 'dev-mock' };
  }

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.warn('[EMAIL] SMTP not configured — skipping email');
    return { success: false, error: 'SMTP not configured' };
  }

  try {
    const info = await getTransporter().sendMail({
      from: process.env.EMAIL_FROM || `PoultryFarm Pro <noreply@poultryfarm.pro>`,
      to,
      subject,
      html,
      text,
    });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[EMAIL] Send error:', err.message);
    return { success: false, error: err.message };
  }
}

// ── Tenant email settings helper ───────────────────────────────────────────────

/**
 * Returns the email settings object for a tenant, merged with defaults.
 * Checks `tenant.settings.email` (persisted) and falls back to env-based defaults.
 */
export function resolveEmailSettings(tenantSettings) {
  const defaults = {
    enabled:              !!process.env.SMTP_HOST,
    lowFeedAlert:         { enabled: true, daysRemainingThreshold: 14 },
    overdueVaccination:   { enabled: true },
    mortalitySpike:       { enabled: true },
    verificationRejected: { enabled: true },
  };
  const saved = tenantSettings?.email || {};
  return {
    ...defaults,
    ...saved,
    lowFeedAlert:         { ...defaults.lowFeedAlert,         ...(saved.lowFeedAlert         || {}) },
    overdueVaccination:   { ...defaults.overdueVaccination,   ...(saved.overdueVaccination   || {}) },
    mortalitySpike:       { ...defaults.mortalitySpike,       ...(saved.mortalitySpike       || {}) },
    verificationRejected: { ...defaults.verificationRejected, ...(saved.verificationRejected || {}) },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. LOW FEED STOCK ALERT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends a low feed stock alert email to farm managers.
 *
 * @param {object} opts
 * @param {string|string[]} opts.to         - Recipient email(s)
 * @param {string}  opts.farmName
 * @param {string}  opts.feedType
 * @param {number}  opts.currentStockKg
 * @param {number}  opts.reorderLevelKg
 * @param {number|null} opts.daysRemaining  - Estimated days of stock left (null if no consumption data)
 * @param {number}  opts.dailyUsageKg
 */
export async function sendFeedLowStockEmail({
  to,
  farmName,
  feedType,
  currentStockKg,
  reorderLevelKg,
  daysRemaining,
  dailyUsageKg,
}) {
  const isCritical = daysRemaining !== null && daysRemaining < 7;
  const severityColour = isCritical ? '#dc2626' : '#d97706';
  const severityLabel  = isCritical ? '🔴 Critical' : '🟡 Warning';
  const daysLabel      = daysRemaining !== null
    ? `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`
    : 'Unknown (no recent consumption data)';

  const html = emailBase({
    title: `${isCritical ? 'Critical' : 'Low'} Feed Stock — ${feedType}`,
    body: `
      <p style="margin:0 0 20px;color:#374151">
        Feed stock for <strong>${feedType}</strong> at <strong>${farmName}</strong> has dropped below the reorder level.
        ${isCritical ? 'Immediate action is required.' : 'Please arrange restocking soon.'}
      </p>
      <div style="background:#fef9f0;border:1px solid ${severityColour}40;border-left:4px solid ${severityColour};border-radius:8px;padding:16px 20px;margin-bottom:20px">
        <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:${severityColour};text-transform:uppercase;letter-spacing:0.5px">${severityLabel}</p>
        <p style="margin:0;font-size:24px;font-weight:700;color:${severityColour}">${daysLabel} remaining</p>
      </div>
      <table style="width:100%;border-collapse:collapse">
        ${infoRow('Feed Type', feedType)}
        ${infoRow('Current Stock', `${Number(currentStockKg).toLocaleString('en-NG')} kg`, isCritical)}
        ${infoRow('Reorder Level', `${Number(reorderLevelKg).toLocaleString('en-NG')} kg`)}
        ${infoRow('Daily Usage (7d avg)', dailyUsageKg > 0 ? `${Number(dailyUsageKg).toFixed(1)} kg/day` : 'N/A')}
        ${infoRow('Farm', farmName)}
      </table>`,
    ctaUrl:   '/feed',
    ctaLabel: 'Manage Feed Inventory',
  });

  return sendEmail({
    to,
    subject: `${isCritical ? '🔴' : '🟡'} Feed Stock ${isCritical ? 'Critical' : 'Low'} — ${feedType} (${daysLabel})`,
    html,
    text: `Feed Alert: ${feedType} at ${farmName} is running low. Current stock: ${currentStockKg}kg. Estimated ${daysLabel} remaining. Daily usage: ${dailyUsageKg.toFixed(1)}kg/day.`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. OVERDUE VACCINATION ALERT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends an overdue vaccination alert email.
 *
 * @param {object} opts
 * @param {string|string[]} opts.to
 * @param {string}  opts.farmName
 * @param {string}  opts.flockBatchCode
 * @param {string}  opts.vaccineName
 * @param {Date|string} opts.scheduledDate
 * @param {number}  opts.daysOverdue        - Positive = overdue, negative = upcoming
 * @param {string}  opts.penName
 */
export async function sendOverdueVaccinationEmail({
  to,
  farmName,
  flockBatchCode,
  vaccineName,
  scheduledDate,
  daysOverdue,
  penName,
}) {
  const isOverdue  = daysOverdue > 0;
  const label      = isOverdue
    ? `${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue`
    : `Due in ${Math.abs(daysOverdue)} day${Math.abs(daysOverdue) !== 1 ? 's' : ''}`;
  const colour     = isOverdue ? '#dc2626' : '#d97706';
  const formattedDate = new Date(scheduledDate).toLocaleDateString('en-NG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const html = emailBase({
    title: isOverdue ? `Vaccination Overdue — ${vaccineName}` : `Vaccination Due Soon — ${vaccineName}`,
    body: `
      <p style="margin:0 0 20px;color:#374151">
        ${isOverdue
          ? `A scheduled vaccination for flock <strong>${flockBatchCode}</strong> is <strong style="color:${colour}">${label}</strong> and has not been administered.`
          : `A vaccination for flock <strong>${flockBatchCode}</strong> is <strong style="color:${colour}">${label}</strong>. Please prepare and schedule the administration.`
        }
      </p>
      <div style="background:#fef2f2;border:1px solid ${colour}40;border-left:4px solid ${colour};border-radius:8px;padding:16px 20px;margin-bottom:20px">
        <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:${colour};text-transform:uppercase;letter-spacing:0.5px">
          ${isOverdue ? '⚠ Action Required' : '📅 Reminder'}
        </p>
        <p style="margin:0;font-size:20px;font-weight:700;color:${colour}">${label}</p>
      </div>
      <table style="width:100%;border-collapse:collapse">
        ${infoRow('Vaccine', vaccineName)}
        ${infoRow('Flock', flockBatchCode)}
        ${infoRow('Pen / Section', penName)}
        ${infoRow('Scheduled Date', formattedDate, isOverdue)}
        ${infoRow('Farm', farmName)}
      </table>`,
    ctaUrl:   '/health',
    ctaLabel: 'Go to Health Schedule',
  });

  return sendEmail({
    to,
    subject: `${isOverdue ? '⚠' : '📅'} Vaccination ${isOverdue ? 'OVERDUE' : 'Due Soon'} — ${vaccineName} for ${flockBatchCode} (${label})`,
    html,
    text: `Vaccination Alert: ${vaccineName} for flock ${flockBatchCode} at ${farmName} is ${label}. Scheduled: ${scheduledDate}.`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. MORTALITY SPIKE ALERT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends a mortality spike alert email.
 *
 * @param {object} opts
 * @param {string|string[]} opts.to
 * @param {string}  opts.farmName
 * @param {string}  opts.penName
 * @param {string}  opts.flockBatchCode
 * @param {number}  opts.todayCount
 * @param {number}  opts.sevenDayAvg
 * @param {string|null} opts.causeCode
 */
export async function sendMortaltySpikeEmail({
  to,
  farmName,
  penName,
  flockBatchCode,
  todayCount,
  sevenDayAvg,
  causeCode,
}) {
  const pctIncrease = sevenDayAvg > 0
    ? Math.round(((todayCount - sevenDayAvg) / sevenDayAvg) * 100)
    : null;

  const causeLabel = causeCode
    ? causeCode.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    : 'Unknown / Under Investigation';

  const html = emailBase({
    title: `Mortality Spike Detected — ${penName}`,
    body: `
      <p style="margin:0 0 20px;color:#374151">
        An abnormal spike in mortality has been detected in <strong>${penName}</strong>. Immediate investigation is recommended.
      </p>
      <div style="background:#fef2f2;border:1px solid #dc262640;border-left:4px solid #dc2626;border-radius:8px;padding:16px 20px;margin-bottom:20px">
        <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.5px">🚨 Spike Alert</p>
        <p style="margin:0;font-size:28px;font-weight:700;color:#dc2626">${todayCount} deaths recorded
          ${pctIncrease !== null ? `<span style="font-size:14px;font-weight:600;color:#dc2626"> (+${pctIncrease}% above avg)</span>` : ''}
        </p>
      </div>
      <table style="width:100%;border-collapse:collapse">
        ${infoRow('Deaths Today', todayCount.toString(), true)}
        ${infoRow('7-Day Average', sevenDayAvg > 0 ? sevenDayAvg.toFixed(1) : 'Insufficient data')}
        ${pctIncrease !== null ? infoRow('Increase vs Average', `+${pctIncrease}%`, true) : ''}
        ${infoRow('Probable Cause', causeLabel)}
        ${infoRow('Flock', flockBatchCode)}
        ${infoRow('Pen / Section', penName)}
        ${infoRow('Farm', farmName)}
      </table>
      <p style="margin:20px 0 0;font-size:13px;color:#6b7280">Schedule a veterinary inspection if cause is disease-related. Ensure biosecurity protocols are followed.</p>`,
    ctaUrl:   '/mortality',
    ctaLabel: 'View Mortality Records',
  });

  return sendEmail({
    to,
    subject: `🚨 Mortality Spike — ${penName}: ${todayCount} deaths${pctIncrease !== null ? ` (+${pctIncrease}%)` : ''}`,
    html,
    text: `Mortality Spike at ${farmName}. Pen: ${penName}. Flock: ${flockBatchCode}. Today: ${todayCount} deaths. 7-day avg: ${sevenDayAvg.toFixed(1)}. Cause: ${causeLabel}.`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. VERIFICATION REJECTED ALERT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends a verification-rejected email to the original record submitter.
 *
 * @param {object} opts
 * @param {string}  opts.to                - Worker's email
 * @param {string}  opts.workerName
 * @param {string}  opts.farmName
 * @param {string}  opts.recordType        - e.g. "EggProduction"
 * @param {string|null} opts.penName
 * @param {string|null} opts.rejectorName  - Name of manager who rejected
 * @param {string|null} opts.reason
 */
export async function sendVerificationRejectedEmail({
  to,
  workerName,
  farmName,
  recordType,
  penName,
  rejectorName,
  reason,
}) {
  const recordLabel = recordType
    .replace(/([A-Z])/g, ' $1')
    .trim();

  const html = emailBase({
    title: `Record Returned for Correction`,
    body: `
      <p style="margin:0 0 20px;color:#374151">
        Hi <strong>${workerName}</strong>, a record you submitted has been returned for correction by your supervisor.
      </p>
      <div style="background:#fef2f2;border:1px solid #dc262640;border-left:4px solid #dc2626;border-radius:8px;padding:16px 20px;margin-bottom:20px">
        <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.5px">❌ Returned for Resubmission</p>
        <p style="margin:0;font-size:18px;font-weight:700;color:#111827">${recordLabel}</p>
      </div>
      <table style="width:100%;border-collapse:collapse">
        ${infoRow('Record Type', recordLabel)}
        ${penName ? infoRow('Pen / Section', penName) : ''}
        ${rejectorName ? infoRow('Reviewed by', rejectorName) : ''}
        ${infoRow('Farm', farmName)}
      </table>
      ${reason ? `
      <div style="margin-top:20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.5px">Reason / Feedback</p>
        <p style="margin:0;font-size:14px;color:#374151;line-height:1.6">${reason}</p>
      </div>` : ''}
      <p style="margin:20px 0 0;font-size:13px;color:#6b7280">Please review the feedback, correct the record, and resubmit it through your dashboard.</p>`,
    ctaUrl:   '/dashboard',
    ctaLabel: 'Go to My Dashboard',
  });

  return sendEmail({
    to,
    subject: `❌ Record Returned — ${recordLabel} requires correction`,
    html,
    text: `Hi ${workerName}, your ${recordLabel} submission at ${farmName} has been returned for correction.${reason ? ` Reason: ${reason}` : ''} Please log in and resubmit.`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy helpers (kept for backward compat — still callable from anywhere)
// ─────────────────────────────────────────────────────────────────────────────

export async function sendVaccinationReminder({ managerEmail, farmName, flockName, vaccineName, scheduledDate, daysUntilDue }) {
  return sendOverdueVaccinationEmail({
    to:             managerEmail,
    farmName,
    flockBatchCode: flockName,
    vaccineName,
    scheduledDate,
    daysOverdue:    -daysUntilDue,
    penName:        '—',
  });
}

export async function sendFeedAlert({ managerEmail, farmName, feedType, currentStockKg, daysRemaining }) {
  return sendFeedLowStockEmail({
    to:             managerEmail,
    farmName,
    feedType,
    currentStockKg,
    reorderLevelKg: 0,
    daysRemaining,
    dailyUsageKg:   0,
  });
}

export async function sendMortalityAlert({ managerEmail, farmName, penName, todayCount, avgCount }) {
  return sendMortaltySpikeEmail({
    to:             managerEmail,
    farmName,
    penName,
    flockBatchCode: '—',
    todayCount,
    sevenDayAvg:    avgCount,
    causeCode:      null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// In-app alert generation (unchanged from Phase 1–4)
// ─────────────────────────────────────────────────────────────────────────────

export function generateSystemAlerts({ flocks, feedInventory, vaccinations, tasks, mortalityData }) {
  const alerts = [];

  for (const feed of feedInventory) {
    const dailyUsage = 100;
    const daysLeft = Math.floor(Number(feed.currentStockKg) / dailyUsage);
    if (daysLeft < 14) {
      alerts.push({
        id: `feed-${feed.id}`,
        severity: daysLeft < 7 ? 'red' : 'amber',
        category: 'feed',
        message: `${feed.feedType}: ${daysLeft} days of stock remaining`,
        actionUrl: '/feed',
        createdAt: new Date(),
      });
    }
  }

  const today = new Date();
  for (const vax of vaccinations) {
    const scheduled = new Date(vax.scheduledDate);
    const daysOverdue = Math.floor((today - scheduled) / 86400000);
    if (vax.status === 'OVERDUE' || (vax.status === 'SCHEDULED' && daysOverdue > 0)) {
      alerts.push({
        id: `vax-${vax.id}`,
        severity: 'red',
        category: 'health',
        message: `Vaccination overdue: ${vax.vaccineName} for flock ${vax.flockId} (${daysOverdue}d)`,
        actionUrl: '/health',
        createdAt: new Date(),
      });
    } else if (vax.status === 'SCHEDULED' && daysOverdue > -3) {
      alerts.push({
        id: `vax-due-${vax.id}`,
        severity: 'amber',
        category: 'health',
        message: `Vaccination due in ${Math.abs(daysOverdue)} day(s): ${vax.vaccineName}`,
        actionUrl: '/health',
        createdAt: new Date(),
      });
    }
  }

  const overdueTasks = tasks.filter(t => t.status === 'OVERDUE');
  if (overdueTasks.length > 0) {
    alerts.push({
      id: 'tasks-overdue',
      severity: 'amber',
      category: 'tasks',
      message: `${overdueTasks.length} task${overdueTasks.length > 1 ? 's' : ''} overdue today`,
      actionUrl: '/dashboard',
      createdAt: new Date(),
    });
  }

  return alerts.sort((a, b) => (a.severity === 'red' ? -1 : 1));
}
