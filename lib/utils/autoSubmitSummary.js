// lib/utils/autoSubmitSummary.js
// Fire-and-forget utility called after any production record save
// (egg, feed, mortality). Checks if it's past the farm's autoSummaryTime
// and if so submits any PENDING summaries for that section.
//
// Usage (in any API route POST handler):
//   autoSubmitSummary(tenantId, penSectionId, farmId, autoSummaryTime)
//     .catch(err => console.error('[autoSubmit]', err));
//
// This runs asynchronously and never throws to the caller.

import { prisma } from '@/lib/db/prisma';
import { computeAggregates } from '@/app/api/daily-summary/route';

/**
 * @param {string} tenantId
 * @param {string} penSectionId
 * @param {string} farmId
 * @param {string} autoSummaryTime  — "HH:MM" e.g. "19:00"
 */
export async function autoSubmitSummary(tenantId, penSectionId, farmId, autoSummaryTime = '19:00') {
  // Parse autoSummaryTime
  const [autoHour, autoMin] = autoSummaryTime.split(':').map(Number);
  const now = new Date();
  const currentMins = now.getHours() * 60 + now.getMinutes();
  const thresholdMins = autoHour * 60 + (autoMin || 0);

  // Only auto-submit if we're past the configured time
  if (currentMins < thresholdMins) return;

  const _now = new Date();
  const today = new Date(Date.UTC(_now.getFullYear(), _now.getMonth(), _now.getDate()));

  // Only submit if summary is still PENDING
  const existing = await prisma.dailySummary.findUnique({
    where: { penSectionId_summaryDate: { penSectionId, summaryDate: today } },
    select: { id: true, status: true },
  });

  if (existing && existing.status !== 'PENDING') return; // already submitted

  const { dbFields } = await computeAggregates(penSectionId, today);

  const hasPending = dbFields.pendingEggVerifications > 0
    || dbFields.pendingFeedVerifications > 0
    || dbFields.pendingMortalityVerifications > 0;

  const newStatus = hasPending ? 'FLAGGED' : 'SUBMITTED';

  await prisma.dailySummary.upsert({
    where:  { penSectionId_summaryDate: { penSectionId, summaryDate: today } },
    update: { ...dbFields, status: newStatus, submittedAt: new Date() },
    create: {
      tenantId,
      farmId,
      penSectionId,
      summaryDate: today,
      status:      newStatus,
      submittedAt: new Date(),
      ...dbFields,
    },
  });

  // Notify PM(s) assigned to this section that the summary is ready for review
  const pmAssignments = await prisma.penWorkerAssignment.findMany({
    where:  { penSectionId, user: { role: 'PEN_MANAGER', isActive: true } },
    select: { userId: true },
  });

  if (pmAssignments.length > 0) {
    await prisma.notification.createMany({
      data: pmAssignments.map(a => ({
        tenantId,
        recipientId: a.userId,
        type:        'REPORT_SUBMITTED',
        title:       hasPending ? '⚠️ Daily Summary Ready — Pending Verifications' : '✅ Daily Summary Auto-Submitted',
        message:     hasPending
          ? `Today's section summary has been auto-submitted but has ${dbFields.pendingEggVerifications + dbFields.pendingFeedVerifications + dbFields.pendingMortalityVerifications} pending verification(s). Please review.`
          : `Today's section summary has been auto-submitted. Eggs: ${dbFields.totalEggsCollected}, Feed: ${Number(dbFields.totalFeedKg).toFixed(1)} kg, Mortality: ${dbFields.totalMortality}.`,
        data: {
          entityType:    'DailySummary',
          penSectionId,
          summaryStatus: newStatus,
        },
        channel: 'IN_APP',
      })),
      skipDuplicates: true,
    });
  }
}
