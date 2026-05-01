'use client';
// components/feed/WorkerFeedModal.js
// Worker logs daily feed distribution for their pen section.
//
// Feed type is sourced from the most recent ISSUED/ACKNOWLEDGED requisition
// for this pen — not from the full inventory. This matches what the store
// physically delivered and prevents workers selecting the wrong feed type.
//
// Task-aware behaviour:
//   Mandatory sessions (Batch 1, Batch 2, Final, Morning, Evening):
//     → Normal bag log form, must enter bags used
//   Conditional sessions (Top-up, Supplemental, Midday):
//     → "No Feed Added" one-tap path shown prominently
//     → If feed was added, enter bags used as normal
//
// Props:
//   section  — section object from /api/dashboard
//   task     — task object (for session type detection)
//   apiFetch — from useAuth()
//   onClose  — close handler
//   onSave   — called after successful save

import { useState, useEffect } from 'react';
import Modal from '@/components/ui/Modal';

const fmt    = (n, d = 1) => Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: d });
const fmtCur = n => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(Number(n || 0));

function gpbStatus(gpb, opType) {
  if (gpb == null || gpb <= 0) return null;
  const [low, high] = opType === 'LAYER' ? [80, 160] : [60, 180];
  if (gpb < low)  return { label: 'Low',    color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' };
  if (gpb > high) return { label: 'High',   color: '#dc2626', bg: '#fef2f2', border: '#fecaca' };
  return             { label: 'Normal', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' };
}

// Determine if this is a conditional top-up task (no feed required if troughs still full)
function isTopUpTask(task) {
  const t = task?.title || '';
  // These are the exact conditional task titles from the generate route
  return t.includes('Supplemental Feed Top-up') || t.includes('Midday Feed Top-up');
}

// Derive a human-readable session label from the task title
function sessionLabel(task) {
  const t = task?.title || '';
  // Match exact titles from app/api/tasks/generate/route.js
  if (t.includes('Morning Feed Distribution') || t.includes('Batch 1')) return 'Morning (Batch 1)';
  if (t.includes('Final Feed Distribution')   || t.includes('Batch 2')) return 'Afternoon (Batch 2)';
  if (t.includes('Midday Feed Top-up'))                                  return 'Midday Top-up';
  if (t.includes('Supplemental Feed Top-up'))                            return 'Supplemental Top-up (Morning)';
  // Brooding/rearing feed tasks
  if (t.includes('Morning Feed') || t.includes('Morning Feed Round'))    return 'Morning Feed Round';
  if (t.includes('Evening Feed') || t.includes('Evening Feed Round'))    return 'Evening Feed Round';
  if (t.includes('Afternoon Feed') || t.includes('Midday Feed & Water')) return 'Afternoon / Midday';
  // Quick-log button (no task context) — show generic label
  return 'Feed Distribution';
}

export default function WorkerFeedModal({ section, task, apiFetch, onClose, onSave }) {
  const flock  = section.flock ?? section.activeFlock ?? null;
  const opType = section?.pen?.operationType || 'LAYER';
  const today  = new Date().toISOString().split('T')[0];

  const isTopUp = isTopUpTask(task);
  const label   = sessionLabel(task);

  // Feed inventory item auto-resolved from requisition
  const [feedItem,  setFeedItem]  = useState(null);  // { id, feedType, bagWeightKg, currentStockKg, costPerKg }
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [noFeed,    setNoFeed]    = useState(false); // conditional top-up: worker confirms no feed added

  const [prevRemainingKg, setPrevRemainingKg] = useState(0); // kg left in open bag from last session today
  const [issuedQtyKg,    setIssuedQtyKg]    = useState(null); // issued qty from today's requisition sectionBreakdown
  const [form, setForm] = useState({
    recordedDate: today,
    emptyBags:    '',   // total fully emptied bags this session (incl. carry-over bag if emptied)
    remainingKg:  '',   // kg left in the currently open bag (0 if all bags emptied this session)
    notes:        '',
  });

  const set = (k, v) => { setForm(p => ({ ...p, [k]: v })); setError(''); };

  // ── Fetch feed type from most recent requisition for this pen ───────────────
  // Falls back to most recent consumption record if no requisition found.
  // This ensures the worker always sees the correct, store-approved feed type.
  useEffect(() => {
    async function loadFeedItem() {
      setLoading(true);
      try {
        // Step 1: look for today's ISSUED or ACKNOWLEDGED requisition for this pen
        const reqRes = await apiFetch(
          `/api/feed/requisitions?penSectionId=${section.id}&status=ISSUED`
        );
        if (reqRes.ok) {
          const { requisitions } = await reqRes.json();
          // Find the most recent requisition that covers today's feed
          const todayStr = new Date().toISOString().slice(0, 10);
          const todayReq = (requisitions || []).find(r =>
            r.feedForDate?.slice(0, 10) === todayStr &&
            r.feedInventory
          ) || requisitions?.[0]; // fall back to most recent

          if (todayReq?.feedInventory) {
            setFeedItem({
              id:             todayReq.feedInventoryId,
              feedType:       todayReq.feedInventory.feedType,
              bagWeightKg:    Number(todayReq.feedInventory.bagWeightKg) || 25,
              currentStockKg: Number(todayReq.feedInventory.currentStockKg),
              costPerKg:      Number(todayReq.feedInventory.costPerKg || 0),
            });
            // Extract this section's issued qty from sectionBreakdown for the info banner
            if (todayReq.sectionBreakdown) {
              const entry = todayReq.sectionBreakdown.find(s => s.penSectionId === section.id);
              const issued = entry?.issuedQtyKg ?? entry?.calculatedQtyKg ?? null;
              if (issued != null && Number(issued) > 0)
                setIssuedQtyKg(parseFloat(Number(issued).toFixed(1)));
            }
            return;
          }
        }

        // Step 2: fall back — find the last feed consumption record for this section
        const consumRes = await apiFetch(
          `/api/feed/consumption?penSectionId=${section.id}&limit=1`
        );
        if (consumRes.ok) {
          const { consumption } = await consumRes.json();
          const last = consumption?.[0];
          if (last?.feedInventory) {
            setFeedItem({
              id:             last.feedInventoryId,
              feedType:       last.feedInventory.feedType,
              bagWeightKg:    Number(last.feedInventory.bagWeightKg) || 25,
              currentStockKg: null, // stock level not critical here
              costPerKg:      Number(last.feedInventory.costPerKg || 0),
            });
            return;
          }
        }

        // Step 3: couldn't determine feed type — show error
        setError('No feed type found for this section. Check that feed has been issued via requisition.');
      } catch {
        setError('Failed to load feed information. Please try again.');
      } finally {
        setLoading(false);
      }
    }

    // Fetch the most recent feed consumption record logged TODAY for this section.
    // Its remainingKg = kg left in the open bag at end of that session — becomes
    // the carry-over opening stock for this new session.
    async function loadPrevSession(feedInventoryId) {
      try {
        // Filter by feedInventoryId (when known) to scope carry-over to the correct
        // feed type. Called initially without feedInventoryId, then again once
        // feedItem resolves with the correct ID.
        const params = feedInventoryId
          ? `penSectionId=${section.id}&feedInventoryId=${feedInventoryId}&limit=1`
          : `penSectionId=${section.id}&limit=1`;
        const res = await apiFetch(`/api/feed/consumption?${params}`);
        if (res.ok) {
          const { consumption } = await res.json();
          const last = consumption?.[0];
          // Only use carry-over if same feed inventory (feed type hasn't changed)
          if (last?.remainingKg != null && Number(last.remainingKg) > 0) {
            setPrevRemainingKg(parseFloat(Number(last.remainingKg).toFixed(2)));
            return; // carry-over found — done
          }
        }

        // Step 2: no prior consumption record for this section (first issuance ever,
        // or feed type just changed). Fall back to today's acknowledged/issued
        // requisition's sectionBreakdown to get issuedQtyKg as opening stock.
        // This anchors the first-session calculation correctly.
        const todayStr = new Date().toISOString().slice(0, 10);
        const reqRes = await apiFetch(
          `/api/feed/requisitions?penSectionId=${section.id}&status=ACKNOWLEDGED`
        );
        if (reqRes.ok) {
          const { requisitions } = await reqRes.json();
          // Find the most recent acknowledged req for today (first issuance of day)
          const todayReq = (requisitions || []).find(r =>
            r.feedForDate?.slice(0, 10) === todayStr
          ) || requisitions?.[0];
          if (todayReq?.sectionBreakdown) {
            const sectionEntry = todayReq.sectionBreakdown.find(
              s => s.penSectionId === section.id
            );
            const issued = sectionEntry?.acknowledgedQtyKg ?? sectionEntry?.issuedQtyKg ?? 0;
            if (issued > 0) {
              setPrevRemainingKg(parseFloat(Number(issued).toFixed(2)));
              return;
            }
          }
        }
      } catch { /* non-fatal — modal still works without carry-over */ }
    }

    loadFeedItem();
    loadPrevSession(); // initial call without feedInventoryId — re-runs via watcher below
  }, [section.id]);

  // Re-run loadPrevSession with feedInventoryId once feedItem loads, ensuring
  // carry-over is scoped to the exact feed type (prevents cross-feed contamination).
  useEffect(() => {
    if (!feedItem?.id) return;
    const fn = async () => {
      try {
        const res = await apiFetch(
          `/api/feed/consumption?penSectionId=${section.id}&feedInventoryId=${feedItem.id}&limit=1`
        );
        if (!res.ok) return;
        const { consumption } = await res.json();
        const last = consumption?.[0];
        if (last?.remainingKg != null && Number(last.remainingKg) > 0)
          setPrevRemainingKg(parseFloat(Number(last.remainingKg).toFixed(2)));
        else
          setPrevRemainingKg(0);
      } catch { /* non-fatal */ }
    };
    fn();
  }, [feedItem?.id]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const bagWt      = feedItem?.bagWeightKg || 25;
  const emptyBags  = Math.max(0, parseInt(form.emptyBags)   || 0);
  const remainingKg= Math.max(0, parseFloat(form.remainingKg) || 0);

  // Empty-bags formula:
  // Worker reports total EMPTY bags this session — including the carry-over bag if it was emptied.
  // If prevRemainingKg > 0, one empty bag is the carry-over bag (not a full bag).
  //
  //   fullNewBagsEmptied = emptyBags - 1  (when carry-over exists)
  //   consumed = prevRemainingKg + (fullNewBagsEmptied × bagWt) + (bagWt - remainingKg)
  //
  // Day 1: prev=0, empty=8, rem=20 → 0 + 8×25 + (25-20) = 205 kg ✓
  // Day 2: prev=20, empty=8, rem=10 → 20 + 7×25 + (25-10) = 210 kg ✓
  // Empty bags = the bags the pen worker physically returns to the store.
  const fullNewBagsEmptied = prevRemainingKg > 0 ? Math.max(0, emptyBags - 1) : emptyBags;

  // fromNewPartialBag ONLY applies when a new bag was opened (emptyBags > 0).
  // When emptyBags = 0, the worker only used the carry-over bag — remainingKg is
  // what's left of that carry-over, not of a new bag. No partial-bag deduction.
  const fromNewPartialBag  = (emptyBags > 0 && remainingKg > 0)
    ? parseFloat((bagWt - remainingKg).toFixed(2))
    : 0;

  // hasActivity — four valid scenarios:
  //   A. bags were emptied (emptyBags > 0) — includes any remaining in a new bag
  //   B. carry-over fully used (prev > 0, bags = 0, remaining = 0)
  //   C. carry-over partially used (prev > 0, bags = 0, remaining > 0)
  //      e.g. prev=17, bags=0, rem=6 → consumed = 17-6 = 11 kg ✓
  //   D. first session, new partial bag only (prev = 0, bags = 0, remaining > 0)
  const hasActivity = emptyBags > 0
    || (prevRemainingKg > 0 && remainingKg === 0)
    || (prevRemainingKg > 0 && remainingKg > 0 && emptyBags === 0)
    || (prevRemainingKg === 0 && emptyBags === 0 && remainingKg > 0);

  // Two-branch formula:
  //   Branch A (emptyBags > 0): carry-over fully poured + new full bags + partial new bag
  //   Branch B (emptyBags = 0): only carry-over bag was used → consumed = prev - remaining
  const quantityKg = hasActivity
    ? emptyBags > 0
      ? Math.max(0, parseFloat((prevRemainingKg + (fullNewBagsEmptied * bagWt) + fromNewPartialBag).toFixed(2)))
      : prevRemainingKg > 0
        ? Math.max(0, parseFloat((prevRemainingKg - remainingKg).toFixed(2)))  // C/B: use carry-over
        : Math.max(0, parseFloat((bagWt - remainingKg).toFixed(2)))            // D: first partial bag
    : 0;
  const openBagConsumed = fromNewPartialBag;

  const birdCount = flock?.currentCount || 0;
  const gpb       = (quantityKg > 0 && birdCount > 0)
    ? parseFloat((quantityKg * 1000 / birdCount).toFixed(1))
    : null;
  const gpbSt = gpbStatus(gpb, opType);

  const stockAfter   = feedItem?.currentStockKg != null
    ? parseFloat((Number(feedItem.currentStockKg) - quantityKg).toFixed(2))
    : null;
  const willOverdraw = stockAfter !== null && stockAfter < 0;
  const costPreview  = feedItem && quantityKg > 0 ? quantityKg * feedItem.costPerKg : null;
  const bagsUsed     = fullNewBagsEmptied; // alias used in validation + preview display

  // ── Validation ─────────────────────────────────────────────────────────────
  function validate() {
    if (!flock)    return 'No active flock in this section';
    if (!feedItem) return 'Feed type not yet loaded';
    // Valid if: empty bags entered, OR carry-over bag just finished (prev>0, remaining=0),
    // OR new bag partially opened (emptyBags=0, remaining>0, no carry-over)
    if (!hasActivity)
      return 'Enter empty bags and/or remaining kg in open bag';
    if (remainingKg >= bagWt)
      return `Remaining kg (${remainingKg}) must be less than one bag weight (${bagWt} kg)`;
    if (willOverdraw)
      return `Insufficient stock — only ${fmt(feedItem.currentStockKg, 1)} kg available`;
    return null;
  }

  // ── Submit with feed ───────────────────────────────────────────────────────
  async function save() {
    const err = validate();
    if (err) { setError(err); return; }
    setSaving(true); setError('');
    try {
      const res = await apiFetch('/api/feed/consumption', {
        method: 'POST',
        body: JSON.stringify({
          feedInventoryId: feedItem.id,
          flockId:         flock.id,
          penSectionId:    section.id,
          recordedDate:    form.recordedDate,
          bagsUsed:    emptyBags,              // empty bags = fully emptied bags this session
          remainingKg,
          feedTime:    new Date().toISOString(), // exact timestamp for Batch 1/2 partitioning
          // Store the session label as a [Label] prefix in notes so LogEggModal
          // can determine which store run this record belongs to, regardless of time.
          notes:       `[${label}]${form.notes.trim() ? ' ' + form.notes.trim() : ''}`,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || 'Failed to save'); return; }
      onSave(d.consumption);
    } catch { setError('Network error — please try again'); }
    finally { setSaving(false); }
  }

  // ── Submit: no feed added (top-up only) ────────────────────────────────────
  // Does NOT create a feed consumption record — zero feed means nothing to log.
  // Just calls onSave() which triggers completeLinkedTask() in the parent,
  // marking the task complete with a 'No feed added' completion note.
  function saveNoFeed() {
    onSave(null); // null signals no consumption record was created
  }

  return (
    <Modal
      title="🍽️ Log Feed Distribution"
      width={480}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          {/* Top-up tasks: show "No Feed Added" as the prominent left button */}
          {isTopUp && feedItem && (
            <button
              onClick={saveNoFeed}
              disabled={saving}
              style={{
                padding: '9px 14px', borderRadius: 9,
                border: '1.5px solid #bbf7d0', background: '#f0fdf4',
                color: '#16a34a', fontSize: 13, fontWeight: 700,
                cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              }}
            >
              {saving ? '…' : '✓ No Feed Added'}
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={saving || loading || willOverdraw || !feedItem}
          >
            {saving ? 'Saving…' : 'Save Record'}
          </button>
        </>
      }
    >
      {/* Section context */}
      <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: 9, fontSize: 13, marginBottom: 16 }}>
        <strong>{section?.penName || section?.pen?.name} › {section?.name}</strong>
        {flock && (
          <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
            · {flock.batchCode} · {fmt(flock.currentCount, 0)} birds
          </span>
        )}
      </div>

      {error && <div className="alert alert-red" style={{ marginBottom: 14 }}>⚠ {error}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>
          Loading feed information…
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Session label — read only, derived from task */}
          <div className="feed-session-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="label">Session</label>
              <div style={{ padding: '9px 12px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border-card)', fontSize: 13, fontWeight: 600 }}>
                {label}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>From task schedule</div>
            </div>
            <div>
              <label className="label">Date *</label>
              <input
                type="date"
                className="input"
                value={form.recordedDate}
                max={today}
                onChange={e => set('recordedDate', e.target.value)}
              />
            </div>
          </div>

          {/* Feed type — auto-filled from requisition, read-only */}
          {feedItem && (
            <div>
              <label className="label">Feed Type</label>
              <div style={{ padding: '9px 12px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border-card)', fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{feedItem.feedType}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                  {feedItem.bagWeightKg} kg/bag
                  {feedItem.currentStockKg != null && ` · ${fmt(feedItem.currentStockKg, 1)} kg in stock`}
                </span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                Auto-filled from today's store issuance
              </div>
            </div>
          )}

          {/* Issued quantity banner — from today's store issuance sectionBreakdown */}
          {issuedQtyKg != null && feedItem && (
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 13px',
              background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8, fontSize:12 }}>
              <span style={{ fontSize:16 }}>📦</span>
              <div>
                <span style={{ fontWeight:700, color:'#15803d' }}>
                  {issuedQtyKg} kg issued today
                </span>
                {feedItem.bagWeightKg > 0 && (
                  <span style={{ color:'#15803d', marginLeft:6 }}>
                    ({Math.floor(issuedQtyKg / feedItem.bagWeightKg)} bag{Math.floor(issuedQtyKg / feedItem.bagWeightKg) !== 1 ? 's' : ''}
                    {(issuedQtyKg % feedItem.bagWeightKg) > 0.1 ? ` + ${(issuedQtyKg % feedItem.bagWeightKg).toFixed(1)} kg` : ''})
                  </span>
                )}
              </div>
              <span style={{ fontSize:10, color:'#15803d', marginLeft:'auto', fontWeight:600 }}>From store</span>
            </div>
          )}

          {/* Top-up hint */}
          {isTopUp && (
            <div style={{ padding: '9px 13px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, color: '#15803d' }}>
              Check the troughs first. If birds still have sufficient feed, tap <strong>No Feed Added</strong> below. Only fill this form if a top-up was actually distributed.
            </div>
          )}

          {/* Bag inputs */}
          <div className="feed-bag-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="label">Empty Bags *</label>
              <input
                type="number"
                inputMode="numeric"
                className="input"
                min="0"
                step="1"
                value={form.emptyBags}
                onChange={e => set('emptyBags', e.target.value)}
                placeholder="0"
                autoFocus={!isTopUp}
              />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                Total fully emptied bags (include carry-over bag if finished)
              </div>
            </div>
            <div>
              <label className="label">Remaining in Open Bag (kg)</label>
              <input
                type="number"
                inputMode="decimal"
                className="input"
                min="0"
                max={prevRemainingKg > 0 ? prevRemainingKg : bagWt}
                step="0.1"
                value={form.remainingKg}
                onChange={e => set('remainingKg', e.target.value)}
                placeholder="0"
              />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                Kg left in the currently open bag (not the full bags)
              </div>
            </div>
          </div>
          {/* Carry-over indicator — shown when a previous session exists today */}
          {prevRemainingKg > 0 && (
            <div style={{ padding:'8px 12px', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, fontSize:11, color:'#92400e', display:'flex', alignItems:'center', gap:6 }}>
              <span>📦</span>
              <span>
                Opening stock: <strong>{prevRemainingKg} kg</strong>
                {' '}(carry-over from last session or today's issuance). Enter kg remaining in the open bag after this session.
              </span>
            </div>
          )}

          {/* Live calculation preview */}
          {(bagsUsed > 0 || remainingKg > 0) && feedItem && (
            <div style={{
              padding: '12px 14px',
              background: willOverdraw ? 'var(--red-bg, #fef2f2)' : 'var(--purple-light, #f5f3ff)',
              border: `1px solid ${willOverdraw ? 'var(--red-border, #fecaca)' : '#d4d8ff'}`,
              borderRadius: 9,
            }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                {prevRemainingKg > 0 && `${prevRemainingKg} kg carry-over`}
                {prevRemainingKg > 0 && bagsUsed > 0 && ' + '}
                {bagsUsed > 0 && `${bagsUsed} bag${bagsUsed!==1?'s':''} (${bagsUsed * bagWt} kg)`}
                {bagsUsed > 0 && ` + (${bagWt} − ${remainingKg} kg left = ${openBagConsumed.toFixed(1)} kg from last bag)`}
                {' = '}
                <strong style={{ color: willOverdraw ? '#dc2626' : 'var(--purple, #6c63ff)' }}>
                  {quantityKg} kg distributed
                </strong>
              </div>
              {gpbSt && (
                <div style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 5, background: gpbSt.bg, border: `1px solid ${gpbSt.border}`, color: gpbSt.color }}>
                  <strong>{gpb} g/bird</strong>
                  <span>· {gpbSt.label}</span>
                </div>
              )}
              {costPreview != null && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Cost: <strong>{fmtCur(costPreview)}</strong>
                  {stockAfter != null && !willOverdraw && (
                    <> · Stock after: <strong>{fmt(stockAfter, 1)} kg</strong></>
                  )}
                  {willOverdraw && (
                    <span style={{ color: '#dc2626', marginLeft: 6 }}>⚠ Insufficient stock</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="label">Notes <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span></label>
            <input
              type="text"
              className="input"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Any observations about the feed round…"
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
