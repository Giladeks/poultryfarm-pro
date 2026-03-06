// lib/services/notifications.js — Alert generation & email notifications

import nodemailer from 'nodemailer';

// ── Email Transport ────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Sends an email using the configured SMTP transport.
 */
export async function sendEmail({ to, subject, html, text }) {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[EMAIL] To: ${to} | Subject: ${subject}`);
    return { messageId: 'dev-mock' };
  }

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
  });
}

/**
 * Sends a vaccination reminder email to the farm manager.
 */
export async function sendVaccinationReminder({ managerEmail, farmName, flockName, vaccineName, scheduledDate, daysUntilDue }) {
  const html = `
    <div style="font-family: monospace; max-width: 600px; margin: 0 auto; background: #060a06; color: #9ca3af; padding: 32px; border-radius: 8px;">
      <h1 style="color: #4ade80; font-size: 20px;">🐔 PoultryFarm Pro — Health Alert</h1>
      <div style="background: #0d160d; border: 1px solid #fbbf2440; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h2 style="color: #fbbf24; margin: 0 0 12px 0; font-size: 16px;">⚕ Vaccination Due in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}</h2>
        <p><strong style="color: #e8f5e2;">Farm:</strong> ${farmName}</p>
        <p><strong style="color: #e8f5e2;">Flock:</strong> ${flockName}</p>
        <p><strong style="color: #e8f5e2;">Vaccine:</strong> ${vaccineName}</p>
        <p><strong style="color: #e8f5e2;">Scheduled Date:</strong> ${new Date(scheduledDate).toLocaleDateString('en-NG', { dateStyle: 'full' })}</p>
      </div>
      <p style="color: #6b7280; font-size: 12px;">Log in to PoultryFarm Pro to schedule tasks and manage this vaccination event.</p>
    </div>
  `;

  return sendEmail({
    to: managerEmail,
    subject: `⚕ Vaccination Due in ${daysUntilDue}d — ${vaccineName} for ${flockName}`,
    html,
    text: `Vaccination Reminder: ${vaccineName} for ${flockName} is due in ${daysUntilDue} days on ${scheduledDate}.`,
  });
}

/**
 * Sends a low feed stock alert.
 */
export async function sendFeedAlert({ managerEmail, farmName, feedType, currentStockKg, daysRemaining }) {
  const html = `
    <div style="font-family: monospace; max-width: 600px; margin: 0 auto; background: #060a06; color: #9ca3af; padding: 32px; border-radius: 8px;">
      <h1 style="color: #4ade80; font-size: 20px;">🐔 PoultryFarm Pro — Feed Alert</h1>
      <div style="background: #0d160d; border: 1px solid #f8717140; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h2 style="color: #f87171; margin: 0 0 12px 0; font-size: 16px;">📦 Low Feed Stock Warning</h2>
        <p><strong style="color: #e8f5e2;">Feed Type:</strong> ${feedType}</p>
        <p><strong style="color: #e8f5e2;">Current Stock:</strong> ${currentStockKg} kg</p>
        <p><strong style="color: #e8f5e2;">Estimated Days Remaining:</strong> ${daysRemaining}</p>
      </div>
      <p style="color: #6b7280; font-size: 12px;">Place an order now to avoid disruption to your feeding schedule.</p>
    </div>
  `;

  return sendEmail({
    to: managerEmail,
    subject: `📦 Low Feed Alert — ${feedType} has ${daysRemaining} days remaining`,
    html,
    text: `Feed Alert: ${feedType} is running low with ${daysRemaining} days remaining (${currentStockKg}kg).`,
  });
}

/**
 * Sends a mortality spike alert.
 */
export async function sendMortalityAlert({ managerEmail, farmName, penName, todayCount, avgCount }) {
  const increase = Math.round(((todayCount - avgCount) / avgCount) * 100);
  const html = `
    <div style="font-family: monospace; max-width: 600px; margin: 0 auto; background: #060a06; color: #9ca3af; padding: 32px; border-radius: 8px;">
      <h1 style="color: #4ade80; font-size: 20px;">🐔 PoultryFarm Pro — Mortality Alert</h1>
      <div style="background: #0d160d; border: 1px solid #f8717140; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h2 style="color: #f87171; margin: 0 0 12px 0; font-size: 16px;">⚠ Mortality Spike Detected — ${penName}</h2>
        <p><strong style="color: #e8f5e2;">Today's Deaths:</strong> ${todayCount}</p>
        <p><strong style="color: #e8f5e2;">7-day Average:</strong> ${avgCount.toFixed(1)}</p>
        <p><strong style="color: #e8f5e2;">Increase:</strong> <span style="color: #f87171;">+${increase}%</span></p>
      </div>
      <p style="color: #6b7280; font-size: 12px;">Log in to investigate and schedule a veterinary inspection if required.</p>
    </div>
  `;

  return sendEmail({
    to: managerEmail,
    subject: `⚠ Mortality Spike Alert — ${penName}: ${todayCount} deaths (+${increase}%)`,
    html,
    text: `Mortality Alert: ${penName} had ${todayCount} deaths today, ${increase}% above the 7-day average.`,
  });
}

/**
 * Generates in-app alerts by scanning farm data for threshold breaches.
 * Returns array of alert objects to display in the dashboard.
 */
export function generateSystemAlerts({ flocks, feedInventory, vaccinations, tasks, mortalityData }) {
  const alerts = [];

  // Feed stock alerts
  for (const feed of feedInventory) {
    const dailyUsage = 100; // simplified — should be calculated from consumption data
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

  // Vaccination overdue alerts
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

  // Overdue tasks
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
