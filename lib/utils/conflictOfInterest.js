// lib/utils/conflictOfInterest.js
// Conflict-of-interest guard for verification actions.
//
// Rule 1 (all roles): Cannot verify a record you submitted yourself.
//
// Rule 2a (Pen Manager — pen-scoped roles):
//   Cannot verify any record from a section where you also submitted data
//   on the same production date.
//
// Rule 2b (Store Manager / Store Clerk — store-scoped roles):
//   Cannot verify any StoreReceipt or FeedConsumption record from a store
//   where you also received goods or logged feed on the same date.
//
// EXEMPTIONS:
//   FARM_MANAGER, FARM_ADMIN, CHAIRPERSON, SUPER_ADMIN are always exempt.

import { prisma } from '@/lib/db/prisma';

const COI_EXEMPT_ROLES  = ['FARM_MANAGER', 'FARM_ADMIN', 'CHAIRPERSON', 'SUPER_ADMIN'];
const STORE_SCOPED_ROLES = ['STORE_MANAGER', 'STORE_CLERK'];

/**
 * @param {object} prismaClient   — Prisma client instance
 * @param {object} user           — JWT payload { sub, role, tenantId }
 * @param {string} referenceType  — 'EggProduction' | 'MortalityRecord' | 'FeedConsumption' | 'StoreReceipt' | ...
 * @param {string} referenceId    — UUID of the source record
 * @returns {{ blocked: boolean, reason?: string, coiType?: string }}
 */
export async function checkConflictOfInterest(prismaClient, user, referenceType, referenceId) {
  if (COI_EXEMPT_ROLES.includes(user.role)) return { blocked: false };

  try {
    // ── Fetch the source record ───────────────────────────────────────────────
    let sourceRecord = null;

    switch (referenceType) {
      case 'EggProduction':
        sourceRecord = await prismaClient.eggProduction.findUnique({
          where:  { id: referenceId },
          select: { recordedById: true, penSectionId: true, collectionDate: true },
        });
        break;

      case 'MortalityRecord':
        sourceRecord = await prismaClient.mortalityRecord.findUnique({
          where:  { id: referenceId },
          select: { recordedById: true, penSectionId: true, recordDate: true },
        });
        break;

      case 'FeedConsumption':
        sourceRecord = await prismaClient.feedConsumption.findUnique({
          where:  { id: referenceId },
          select: {
            recordedById: true, penSectionId: true, recordedDate: true,
            feedInventory: { select: { storeId: true } },
          },
        });
        break;

      case 'StoreReceipt':
        sourceRecord = await prismaClient.storeReceipt.findUnique({
          where:  { id: referenceId },
          select: { receivedById: true, storeId: true, receiptDate: true },
        });
        // Normalise to common shape
        if (sourceRecord) {
          sourceRecord = {
            recordedById: sourceRecord.receivedById,
            storeId:      sourceRecord.storeId,
            receiptDate:  sourceRecord.receiptDate,
          };
        }
        break;

      case 'DailyReport':
        sourceRecord = await prismaClient.dailyReport.findUnique({
          where:  { id: referenceId },
          select: { submittedById: true, penSectionId: true, reportDate: true },
        });
        if (sourceRecord) {
          sourceRecord = {
            recordedById:   sourceRecord.submittedById,
            penSectionId:   sourceRecord.penSectionId,
            collectionDate: sourceRecord.reportDate,
          };
        }
        break;

      default:
        return { blocked: false };
    }

    if (!sourceRecord) return { blocked: false };

    const submitterId = sourceRecord.recordedById;

    // ── Rule 1: Cannot verify your own submission ─────────────────────────────
    if (submitterId === user.sub) {
      return {
        blocked:  true,
        reason:   referenceType === 'StoreReceipt'
          ? 'You cannot verify a receipt you logged yourself. A different Store Manager must verify this receipt.'
          : 'You cannot verify a record you submitted yourself. A different manager must verify this record.',
        coiType:  'SELF_SUBMISSION',
        submitterId,
      };
    }

    // ── Rule 2b: Store-scoped same-day check (STORE_MANAGER / STORE_CLERK) ────
    if (STORE_SCOPED_ROLES.includes(user.role)) {
      const storeId    = sourceRecord.storeId
        || sourceRecord.feedInventory?.storeId;
      const recordDate = sourceRecord.receiptDate
        || sourceRecord.recordedDate
        || sourceRecord.collectionDate;

      if (storeId && recordDate) {
        const dateStart = new Date(recordDate);
        dateStart.setHours(0, 0, 0, 0);
        const dateEnd = new Date(dateStart);
        dateEnd.setDate(dateEnd.getDate() + 1);

        // Check if this store role user received or logged anything in this store on this date
        const [ownReceipt, ownFeed] = await Promise.all([
          prismaClient.storeReceipt.findFirst({
            where: {
              receivedById: user.sub,
              storeId,
              receiptDate: { gte: dateStart, lt: dateEnd },
            },
            select: { id: true },
          }),
          prismaClient.feedConsumption.findFirst({
            where: {
              recordedById: user.sub,
              feedInventory: { storeId },
              recordedDate:  { gte: dateStart, lt: dateEnd },
            },
            select: { id: true },
          }),
        ]);

        if (ownReceipt || ownFeed) {
          const dateLabel = new Date(recordDate)
            .toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
          return {
            blocked:  true,
            reason:   `You logged records in this store on ${dateLabel}. You cannot verify records from the same store on the same day. A different Store Manager must verify these records.`,
            coiType:  'SAME_STORE_SAME_DAY',
            submitterId,
            storeId,
            date:     dateLabel,
          };
        }
      }

      // Store roles — no pen-section Rule 2a check needed
      return { blocked: false };
    }

    // ── Rule 2a: Pen-scoped same-day check (PEN_MANAGER) ─────────────────────
    const penSectionId = sourceRecord.penSectionId;
    const productionDate = sourceRecord.collectionDate
      || sourceRecord.recordDate
      || sourceRecord.recordedDate;

    if (penSectionId && productionDate) {
      const dateStart = new Date(productionDate);
      dateStart.setHours(0, 0, 0, 0);
      const dateEnd = new Date(dateStart);
      dateEnd.setDate(dateEnd.getDate() + 1);

      const [ownEggs, ownMort, ownFeed] = await Promise.all([
        prismaClient.eggProduction.findFirst({
          where: {
            recordedById:   user.sub,
            penSectionId,
            collectionDate: { gte: dateStart, lt: dateEnd },
            // Exclude PM self-approved records (first egg collection via Advance to Production).
            // These are the only records where recordedById === approvedById.
            // All other COI rules remain fully intact.
            NOT: { AND: [{ submissionStatus: 'APPROVED' }, { approvedById: user.sub }] },
          },
          select: { id: true },
        }),
        prismaClient.mortalityRecord.findFirst({
          where: { recordedById: user.sub, penSectionId, recordDate: { gte: dateStart, lt: dateEnd } },
          select: { id: true },
        }),
        prismaClient.feedConsumption.findFirst({
          where: { recordedById: user.sub, penSectionId, recordedDate: { gte: dateStart, lt: dateEnd } },
          select: { id: true },
        }),
      ]);

      if (ownEggs || ownMort || ownFeed) {
        const dateLabel = new Date(productionDate)
          .toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
        return {
          blocked:     true,
          reason:      `You submitted records in this section on ${dateLabel}. You cannot verify records from the same section on the same day. A different Pen Manager or a Farm Manager must verify these records.`,
          coiType:     'SAME_SECTION_SAME_DAY',
          submitterId,
          penSectionId,
          date:        dateLabel,
        };
      }
    }

    return { blocked: false };

  } catch (err) {
    // Fail open — don't let a safety check create a denial-of-service
    console.error('[COI check error]', err);
    return { blocked: false };
  }
}
