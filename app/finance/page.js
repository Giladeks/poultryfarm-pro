'use client';
export const dynamic = 'force-dynamic';
// app/finance/page.js — Finance module: AP | AR | P&L | Reconciliation
import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/components/layout/AuthProvider';

// ─── Role constants ───────────────────────────────────────────────────────────
const FINANCE_VIEW_ROLES     = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT','INTERNAL_CONTROL'];
const FINANCE_ROLES          = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','ACCOUNTANT'];
const INVOICE_APPROVAL_ROLES = ['SUPER_ADMIN','CHAIRPERSON','FARM_ADMIN','FARM_MANAGER'];

// ─── Shared helpers ───────────────────────────────────────────────────────────
const fmt = (n, currency = 'NGN') =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n) || 0);

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const CURRENCIES = ['NGN','USD','EUR','GBP','GHS','KES','ZAR'];

// ─── AP status meta ───────────────────────────────────────────────────────────
const AP_STATUS_META = {
  PENDING:        { label: 'Pending',     cls: 'status-amber'  },
  APPROVED:       { label: 'Approved',    cls: 'status-blue'   },
  PARTIALLY_PAID: { label: 'Part. Paid',  cls: 'status-purple' },
  PAID:           { label: 'Paid',        cls: 'status-green'  },
  OVERDUE:        { label: 'Overdue',     cls: 'status-red'    },
  DISPUTED:       { label: 'Disputed',    cls: 'status-red'    },
  VOID:           { label: 'Void',        cls: 'status-grey'   },
};

// ─── AR status meta ───────────────────────────────────────────────────────────
const AR_STATUS_META = {
  DRAFT:          { label: 'Draft',           cls: 'status-grey'   },
  SENT:           { label: 'Sent',            cls: 'status-blue'   },
  PARTIALLY_PAID: { label: 'Part. Received',  cls: 'status-purple' },
  PAID:           { label: 'Received',        cls: 'status-green'  },
  OVERDUE:        { label: 'Overdue',         cls: 'status-red'    },
  VOID:           { label: 'Void',            cls: 'status-grey'   },
};

function StatusBadge({ status, meta }) {
  const m = meta[status] || { label: status, cls: 'status-grey' };
  return <span className={`status-badge ${m.cls}`}>{m.label}</span>;
}

// ─── Shared: Line Items editor ────────────────────────────────────────────────
function LineItemsEditor({ items, onChange, readOnly }) {
  const add    = () => onChange([...items, { description: '', quantity: 1, unit: '', unitPrice: 0, totalPrice: 0 }]);
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i));
  const update = (i, field, val) => {
    const next = items.map((row, idx) => {
      if (idx !== i) return row;
      const updated = { ...row, [field]: val };
      if (field === 'quantity' || field === 'unitPrice')
        updated.totalPrice = (Number(updated.quantity) || 0) * (Number(updated.unitPrice) || 0);
      return updated;
    });
    onChange(next);
  };

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: 540 }}>
          <thead>
            <tr>
              <th>Description</th>
              <th style={{ width: 70 }}>Qty</th>
              <th style={{ width: 80 }}>Unit</th>
              <th style={{ width: 120 }}>Unit Price</th>
              <th style={{ width: 120 }}>Total</th>
              {!readOnly && <th style={{ width: 36 }}></th>}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={readOnly ? 5 : 6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '18px 0', fontStyle: 'italic', fontSize: 13 }}>No line items</td></tr>
            )}
            {items.map((row, i) => (
              <tr key={i}>
                <td>{readOnly ? row.description : <input className="input" value={row.description} onChange={e => update(i, 'description', e.target.value)} placeholder="e.g. Grade A Eggs" style={{ padding: '5px 8px', fontSize: 13 }} />}</td>
                <td>{readOnly ? row.quantity : <input className="input" type="number" min="0" step="any" value={row.quantity} onChange={e => update(i, 'quantity', parseFloat(e.target.value) || 0)} style={{ padding: '5px 8px', fontSize: 13 }} />}</td>
                <td>{readOnly ? row.unit : <input className="input" value={row.unit} onChange={e => update(i, 'unit', e.target.value)} placeholder="crates…" style={{ padding: '5px 8px', fontSize: 13 }} />}</td>
                <td>{readOnly ? fmt(row.unitPrice) : <input className="input" type="number" min="0" step="any" value={row.unitPrice} onChange={e => update(i, 'unitPrice', parseFloat(e.target.value) || 0)} style={{ padding: '5px 8px', fontSize: 13 }} />}</td>
                <td style={{ fontWeight: 700 }}>{fmt(row.totalPrice)}</td>
                {!readOnly && <td><button onClick={() => remove(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 18, padding: '0 6px' }}>×</button></td>}
              </tr>
            ))}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={readOnly ? 4 : 5} style={{ textAlign: 'right', fontWeight: 700, fontSize: 13, color: 'var(--text-secondary)', paddingRight: 12, borderTop: '2px solid var(--border)' }}>Subtotal</td>
                <td style={{ fontWeight: 700, color: 'var(--purple)', fontSize: 14, borderTop: '2px solid var(--border)' }}>{fmt(items.reduce((s, r) => s + (Number(r.totalPrice) || 0), 0))}</td>
                {!readOnly && <td style={{ borderTop: '2px solid var(--border)' }}></td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {!readOnly && (
        <button onClick={add} style={{ marginTop: 10, background: 'none', border: '1.5px dashed var(--border)', borderRadius: 8, padding: '6px 16px', fontSize: 13, color: 'var(--purple)', cursor: 'pointer', fontFamily: 'Nunito, sans-serif', fontWeight: 700 }}>
          + Add Line Item
        </button>
      )}
    </div>
  );
}

// ─── Shared: Totals row ───────────────────────────────────────────────────────
function TotalsRow({ subtotal, taxAmount, totalAmount, currency, onTaxChange, readOnly }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, background: 'var(--bg-elevated)', borderRadius: 10, padding: '14px 16px', border: '1px solid var(--border)' }}>
      <div>
        <label className="label">Subtotal</label>
        <p style={{ fontFamily: 'Poppins, sans-serif', fontSize: 16, fontWeight: 700, marginTop: 4 }}>{fmt(subtotal, currency)}</p>
      </div>
      <div>
        <label className="label">Tax / VAT</label>
        {readOnly
          ? <p style={{ fontFamily: 'Poppins, sans-serif', fontSize: 16, fontWeight: 700, marginTop: 4 }}>{fmt(taxAmount, currency)}</p>
          : <input className="input" type="number" min="0" step="any" value={taxAmount} onChange={e => onTaxChange(parseFloat(e.target.value) || 0)} style={{ marginTop: 4 }} />
        }
      </div>
      <div>
        <label className="label">Total Amount</label>
        <p style={{ fontFamily: 'Poppins, sans-serif', fontSize: 18, fontWeight: 700, color: 'var(--purple)', marginTop: 4 }}>{fmt(totalAmount, currency)}</p>
      </div>
    </div>
  );
}

// ─── Shared: Pay Modal ────────────────────────────────────────────────────────
function PayModal({ invoice, onClose, onSave, saving, context = 'payment' }) {
  const isReceipt = context === 'receipt';
  const balance = parseFloat(invoice.totalAmount) - parseFloat(invoice.amountPaid);
  const [form, setForm] = useState({ amountPaid: balance, paymentMethod: 'BANK_TRANSFER', paymentRef: '', paidAt: new Date().toISOString().split('T')[0] });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal animate-in" style={{ width: '100%', maxWidth: 460 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontFamily: 'Poppins, sans-serif', fontSize: 17 }}>{isReceipt ? 'Record Receipt' : 'Record Payment'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>
        <div className="alert alert-blue" style={{ marginBottom: 18 }}>
          <div><strong>{invoice.invoiceNumber}</strong> — {invoice.customer?.name || invoice.supplier?.name}<br />
            <span style={{ fontSize: 12 }}>Balance: <strong>{fmt(balance, invoice.currency)}</strong></span>
          </div>
        </div>
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <label className="label">{isReceipt ? 'Amount Received' : 'Amount Paid'} ({invoice.currency}) *</label>
            <input className="input" type="number" min="0.01" max={balance} step="any" value={form.amountPaid} onChange={e => set('amountPaid', parseFloat(e.target.value) || 0)} />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>Max: {fmt(balance, invoice.currency)}</p>
          </div>
          <div>
            <label className="label">Payment Method *</label>
            <select className="input" value={form.paymentMethod} onChange={e => set('paymentMethod', e.target.value)}>
              <option value="BANK_TRANSFER">Bank Transfer</option>
              <option value="CASH">Cash</option>
              <option value="CHEQUE">Cheque</option>
              <option value="MOBILE_MONEY">Mobile Money</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div>
            <label className="label">Payment Reference</label>
            <input className="input" value={form.paymentRef} onChange={e => set('paymentRef', e.target.value)} placeholder="Transaction ID, cheque no." />
          </div>
          <div>
            <label className="label">Payment Date</label>
            <input className="input" type="date" value={form.paidAt} onChange={e => set('paidAt', e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave({ ...form, action: 'pay' })} disabled={!form.amountPaid || saving}>
            {saving ? 'Saving…' : isReceipt ? 'Record Receipt' : 'Record Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// AP TAB
// ══════════════════════════════════════════════════════════════════════════════

function ApKpiStrip({ summary }) {
  const tiles = [
    { label: 'Total Owed',    value: fmt(summary.totalOwed),    color: 'var(--text-primary)' },
    { label: 'Overdue',       value: fmt(summary.overdueAmount), color: 'var(--red)'          },
    { label: 'Pending',       value: summary.pending,           color: 'var(--amber)'         },
    { label: 'Overdue Count', value: summary.overdue,           color: 'var(--red)'           },
  ];
  return (
    <div className="grid-kpi" style={{ marginBottom: 20 }}>
      {tiles.map(t => (
        <div key={t.label} className="card" style={{ padding: '16px 20px' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{t.label}</p>
          <p className="kpi-value" style={{ fontSize: 22, color: t.color }}>{t.value}</p>
        </div>
      ))}
    </div>
  );
}

function ApCreateModal({ suppliers, receipts, onClose, onSave, saving, apiFetch }) {
  const today = new Date().toISOString().split('T')[0];
  const in30  = new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0];
  const [form, setForm] = useState({ invoiceNumber: '', supplierId: '', linkedReceiptId: '', invoiceDate: today, dueDate: in30, currency: 'NGN', exchangeRate: 1, subtotal: 0, taxAmount: 0, totalAmount: 0, lineItems: [], notes: '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Fetch preview invoice number on mount
  useEffect(() => {
    apiFetch('/api/finance/supplier-invoices?action=next-number')
      .then(r => r.json())
      .then(d => { if (d.invoiceNumber) set('invoiceNumber', d.invoiceNumber); })
      .catch(() => {});
  }, []);

  const onLineItemsChange = (items) => {
    const sub = items.reduce((s, r) => s + (Number(r.totalPrice) || 0), 0);
    setForm(f => ({ ...f, lineItems: items, subtotal: sub, totalAmount: sub + (Number(f.taxAmount) || 0) }));
  };
  const onTaxChange = (tax) => setForm(f => ({ ...f, taxAmount: tax, totalAmount: f.subtotal + tax }));

  const filteredReceipts = form.supplierId ? receipts.filter(r => r.supplierId === form.supplierId) : receipts;
  const canSave = form.invoiceNumber && form.supplierId && form.invoiceDate && form.dueDate && form.totalAmount > 0;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal animate-in" style={{ width: '100%', maxWidth: 700 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h2 style={{ fontFamily: 'Poppins, sans-serif', fontSize: 18 }}>New Supplier Invoice</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div><label className="label">Invoice Number</label><div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 13, fontWeight: 700, color: 'var(--purple)', letterSpacing: '0.03em' }}>{form.invoiceNumber || 'Generating…'}</div></div>
          <div><label className="label">Supplier *</label>
            <select className="input" value={form.supplierId} onChange={e => set('supplierId', e.target.value)}>
              <option value="">— Select supplier —</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div><label className="label">Invoice Date *</label><input className="input" type="date" value={form.invoiceDate} onChange={e => set('invoiceDate', e.target.value)} /></div>
          <div><label className="label">Due Date *</label><input className="input" type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} /></div>
          <div><label className="label">Currency</label>
            <select className="input" value={form.currency} onChange={e => set('currency', e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {form.currency !== 'NGN' && <div><label className="label">Exchange Rate (to NGN)</label><input className="input" type="number" min="0.01" step="any" value={form.exchangeRate} onChange={e => set('exchangeRate', parseFloat(e.target.value) || 1)} /></div>}
          <div><label className="label">Linked GRN (optional)</label>
            <select className="input" value={form.linkedReceiptId} onChange={e => set('linkedReceiptId', e.target.value)}>
              <option value="">— None —</option>
              {filteredReceipts.map(r => <option key={r.id} value={r.id}>{r.batchNumber || r.referenceNumber || r.id.slice(0, 8)} — {fmtDate(r.receiptDate)}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 16 }}><label className="label" style={{ marginBottom: 10 }}>Line Items</label><LineItemsEditor items={form.lineItems} onChange={onLineItemsChange} /></div>
        <div style={{ marginBottom: 16 }}><TotalsRow subtotal={form.subtotal} taxAmount={form.taxAmount} totalAmount={form.totalAmount} currency={form.currency} onTaxChange={onTaxChange} /></div>
        <div><label className="label">Notes</label><textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} style={{ resize: 'vertical' }} /></div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!canSave || saving}>{saving ? 'Saving…' : 'Create Invoice'}</button>
        </div>
      </div>
    </div>
  );
}

function ApDetailModal({ invoice, onClose, onApprove, onPay, onDispute, onVoid, onReminder, onDownloadPdf, role, actionLoading }) {
  const balance    = parseFloat(invoice.totalAmount) - parseFloat(invoice.amountPaid);
  const canApprove = INVOICE_APPROVAL_ROLES.includes(role) && invoice.status === 'PENDING';
  const canPay     = FINANCE_ROLES.includes(role) && ['APPROVED','OVERDUE','PARTIALLY_PAID'].includes(invoice.status);
  const canDispute = FINANCE_ROLES.includes(role) && !['PAID','VOID','DISPUTED'].includes(invoice.status);
  const canVoid    = FINANCE_ROLES.includes(role) && invoice.status !== 'PAID';
  const canReminder= FINANCE_ROLES.includes(role) && ['APPROVED','OVERDUE','PARTIALLY_PAID'].includes(invoice.status);
  const isReadOnly = !FINANCE_ROLES.includes(role);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal animate-in" style={{ width: '100%', maxWidth: 740 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontFamily: 'Poppins, sans-serif', fontSize: 18, marginBottom: 6 }}>{invoice.invoiceNumber}</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <StatusBadge status={invoice.status} meta={AP_STATUS_META} />
              {invoice.daysOverdue > 0 && <span style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700, background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 20, padding: '2px 8px' }}>{invoice.daysOverdue}d overdue</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, background: 'var(--bg-elevated)', borderRadius: 10, padding: '14px 16px', border: '1px solid var(--border)', marginBottom: 18 }}>
          {[['Supplier', invoice.supplier?.name], ['Invoice Date', fmtDate(invoice.invoiceDate)], ['Due Date', fmtDate(invoice.dueDate)], ['Currency', invoice.currency], ['Linked GRN', invoice.linkedReceipt?.batchNumber || '—'], ['Created By', invoice.createdBy ? `${invoice.createdBy.firstName} ${invoice.createdBy.lastName}` : '—'], ['Approved By', invoice.approvedBy ? `${invoice.approvedBy.firstName} ${invoice.approvedBy.lastName}` : '—'], ['Approved At', fmtDate(invoice.approvedAt)], ['Payment Ref', invoice.paymentRef || '—']].map(([k, v]) => (
            <div key={k}><p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{k}</p><p style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{v}</p></div>
          ))}
        </div>
        {invoice.notes && <div style={{ background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>{invoice.notes}</div>}
        <div style={{ marginBottom: 18 }}><p className="section-header">Line Items</p><LineItemsEditor items={Array.isArray(invoice.lineItems) ? invoice.lineItems : []} onChange={() => {}} readOnly /></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
          {[['Subtotal', fmt(invoice.subtotal, invoice.currency), 'var(--text-primary)'], ['Tax', fmt(invoice.taxAmount, invoice.currency), 'var(--text-secondary)'], ['Total', fmt(invoice.totalAmount, invoice.currency), 'var(--purple)'], ['Balance', fmt(balance, invoice.currency), invoice.status === 'PAID' ? 'var(--green)' : 'var(--red)']].map(([k, v, c]) => (
            <div key={k} style={{ textAlign: 'center', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 8px' }}>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}>{k}</p>
              <p style={{ fontFamily: 'Poppins, sans-serif', fontSize: 15, fontWeight: 700, color: c }}>{v}</p>
            </div>
          ))}
        </div>
        {invoice.currency !== 'NGN' && parseFloat(invoice.exchangeRate) > 1 && <div className="alert alert-purple" style={{ marginBottom: 14, fontSize: 12 }}>NGN equivalent at ×{invoice.exchangeRate}: <strong>{fmt(parseFloat(invoice.totalAmount) * parseFloat(invoice.exchangeRate))}</strong></div>}
        {!isReadOnly && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canApprove  && <button className="btn btn-primary"  onClick={onApprove}  disabled={actionLoading} style={{ fontSize: 13 }}>✓ Approve</button>}
            {canPay      && <button className="btn btn-outline"  onClick={onPay}      disabled={actionLoading} style={{ fontSize: 13 }}>💳 Record Payment</button>}
            {canReminder && <button className="btn btn-ghost"    onClick={onReminder} disabled={actionLoading} style={{ fontSize: 13 }}>🔔 Send Reminder</button>}
            {canDispute  && <button className="btn btn-ghost"    onClick={onDispute}  disabled={actionLoading} style={{ fontSize: 13, color: 'var(--amber)' }}>⚠ Dispute</button>}
            {canVoid     && <button className="btn btn-danger"   onClick={onVoid}     disabled={actionLoading} style={{ fontSize: 13 }}>✕ Void</button>}
          </div>
        )}
        {isReadOnly && <p style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Read-only access.</p>}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <button onClick={onDownloadPdf} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            ⬇ Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}

function ApTab({ apiFetch, role }) {
  const [invoices, setInvoices] = useState([]);
  const [summary,  setSummary]  = useState({});
  const [suppliers,setSuppliers]= useState([]);
  const [receipts, setReceipts] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [toast,    setToast]    = useState('');
  const [filterStatus,   setFilterStatus]   = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [search,         setSearch]         = useState('');
  const [showCreate,     setShowCreate]     = useState(false);
  const [detailInv,      setDetailInv]      = useState(null);
  const [payInv,         setPayInv]         = useState(null);
  const [saving,         setSaving]         = useState(false);
  const [actionLoading,  setActionLoading]  = useState(false);

  const canCreate = FINANCE_ROLES.includes(role);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const downloadPdf = async (inv) => {
    try {
      const res = await apiFetch(`/api/finance/supplier-invoices/${inv.id}/pdf`, { responseType: 'blob' });
      const blob = res instanceof Blob ? res : new Blob([res], { type: 'application/pdf' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${inv.invoiceNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast(`PDF error: ${e?.message || 'Failed to generate'}`);
    }
  };

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams();
      if (filterStatus)   p.set('status',    filterStatus);
      if (filterSupplier) p.set('supplierId', filterSupplier);
      if (search)         p.set('search',     search);
      const [invRes, supRes, recRes] = await Promise.all([
        apiFetch(`/api/finance/supplier-invoices?${p}`),
        apiFetch('/api/finance/suppliers'),
        apiFetch('/api/feed/receipts?limit=200'),
      ]);
      if (!invRes.ok) throw new Error('Failed to load invoices');
      const d = await invRes.json();
      setInvoices(d.invoices || []); setSummary(d.summary || {});
      if (supRes.ok) { const s = await supRes.json(); setSuppliers(s.suppliers || []); }
      if (recRes.ok) { const r = await recRes.json(); setReceipts(r.receipts || []); }
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [apiFetch, filterStatus, filterSupplier, search]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (form) => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        linkedReceiptId: form.linkedReceiptId || null,
        linkedPOId:      form.linkedPOId      || null,
        notes:           form.notes           || null,
      };
      const res = await apiFetch('/api/finance/supplier-invoices', { method: 'POST', body: JSON.stringify(payload) });
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      setShowCreate(false); showToast(`Invoice ${d.invoice.invoiceNumber} created`); load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const patch = async (id, body, msg) => {
    setActionLoading(true);
    try {
      const res = await apiFetch(`/api/finance/supplier-invoices/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      showToast(msg || 'Done'); setDetailInv(null); setPayInv(null); load();
    } catch (e) { setError(e.message); } finally { setActionLoading(false); }
  };

  return (
    <div>
      {!loading && Object.keys(summary).length > 0 && <ApKpiStrip summary={summary} />}
      {toast && <div className="alert alert-green animate-in" style={{ marginBottom: 16 }}>✓ {toast}</div>}
      {error && <div className="alert alert-red animate-in" style={{ marginBottom: 16 }}>⚠ {error} <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: 8, fontWeight: 700 }}>×</button></div>}

      <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input" placeholder="Search invoice # or supplier…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 240, padding: '7px 12px', fontSize: 13 }} />
          <select className="input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ maxWidth: 180, padding: '7px 12px', fontSize: 13 }}>
            <option value="">All Statuses</option>
            {Object.entries(AP_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select className="input" value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)} style={{ maxWidth: 200, padding: '7px 12px', fontSize: 13 }}>
            <option value="">All Suppliers</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <div style={{ marginLeft: 'auto' }}>
            {canCreate && <button className="btn btn-primary" onClick={() => setShowCreate(true)} style={{ fontSize: 13 }}>+ New Invoice</button>}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}><div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>Loading…</div>
        ) : invoices.length === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📄</div>
            <p style={{ fontWeight: 700, marginBottom: 4 }}>No invoices found</p>
            <p style={{ fontSize: 13 }}>{canCreate ? 'Create your first supplier invoice.' : 'No results match your filters.'}</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Invoice #</th><th>Supplier</th><th>GRN</th><th>Date</th><th>Due</th><th>CCY</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Balance</th><th>Status</th><th style={{ textAlign: 'right' }}>Aging</th><th></th></tr></thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => setDetailInv(inv)}>
                    <td style={{ fontWeight: 700, color: 'var(--purple)' }}>{inv.invoiceNumber}</td>
                    <td style={{ fontWeight: 600 }}>{inv.supplier?.name}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{inv.linkedReceipt?.batchNumber || '—'}</td>
                    <td>{fmtDate(inv.invoiceDate)}</td>
                    <td>{fmtDate(inv.dueDate)}</td>
                    <td><span style={{ fontSize: 11, fontWeight: 700, background: 'var(--purple-light)', color: 'var(--purple)', border: '1px solid #d4d8ff', borderRadius: 12, padding: '2px 8px' }}>{inv.currency}</span></td>
                    <td style={{ textAlign: 'right', fontFamily: 'Poppins, sans-serif', fontSize: 13, fontWeight: 700 }}>
                      {fmt(inv.totalAmount, inv.currency)}
                      {inv.currency !== 'NGN' && parseFloat(inv.exchangeRate) > 1 && <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Nunito, sans-serif', fontWeight: 400 }}>≈ {fmt(parseFloat(inv.totalAmount) * parseFloat(inv.exchangeRate))}</div>}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'Poppins, sans-serif', fontSize: 13, fontWeight: 700, color: inv.status === 'PAID' ? 'var(--green)' : 'var(--text-primary)' }}>{fmt(inv.balance, inv.currency)}</td>
                    <td onClick={e => e.stopPropagation()}><StatusBadge status={inv.status} meta={AP_STATUS_META} /></td>
                    <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                      {inv.daysOverdue > 0 ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)', background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 20, padding: '2px 8px' }}>{inv.daysOverdue}d</span> : <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>—</span>}
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {INVOICE_APPROVAL_ROLES.includes(role) && inv.status === 'PENDING' && <button className="btn btn-outline" onClick={() => patch(inv.id, { action: 'approve' }, `${inv.invoiceNumber} approved`)} style={{ fontSize: 11, padding: '4px 10px' }}>Approve</button>}
                        {FINANCE_ROLES.includes(role) && ['APPROVED','OVERDUE','PARTIALLY_PAID'].includes(inv.status) && <button className="btn btn-primary" onClick={() => setPayInv(inv)} style={{ fontSize: 11, padding: '4px 10px' }}>Pay</button>}
                        <button onClick={() => downloadPdf(inv)} title="Download PDF" style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>⬇</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && <ApCreateModal suppliers={suppliers} receipts={receipts} apiFetch={apiFetch} onClose={() => setShowCreate(false)} onSave={handleCreate} saving={saving} />}
      {detailInv && <ApDetailModal invoice={detailInv} role={role} actionLoading={actionLoading} onClose={() => setDetailInv(null)} onApprove={() => patch(detailInv.id, { action: 'approve' }, `${detailInv.invoiceNumber} approved`)} onPay={() => { setPayInv(detailInv); setDetailInv(null); }} onDispute={() => { const r = window.prompt('Reason for dispute:'); if (r) patch(detailInv.id, { action: 'dispute', reason: r }, 'Marked as disputed'); }} onVoid={() => { const r = window.prompt('Reason for voiding:'); if (r) patch(detailInv.id, { action: 'void', reason: r }, 'Invoice voided'); }} onReminder={() => patch(detailInv.id, { action: 'reminder', channel: 'EMAIL' }, 'Reminder sent')} onDownloadPdf={() => downloadPdf(detailInv)} />}
      {payInv && <PayModal invoice={payInv} onClose={() => setPayInv(null)} onSave={form => patch(payInv.id, form, `Payment recorded for ${payInv.invoiceNumber}`)} saving={saving} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// AR TAB
// ══════════════════════════════════════════════════════════════════════════════

function ArKpiStrip({ summary }) {
  const tiles = [
    { label: 'Total Billed',     value: fmt(summary.totalBilled),      color: 'var(--text-primary)' },
    { label: 'Outstanding',      value: fmt(summary.totalOutstanding),  color: 'var(--purple)'       },
    { label: 'Overdue Amount',   value: fmt(summary.overdueAmount),     color: 'var(--red)'          },
    { label: 'Overdue Count',    value: summary.overdue,                color: 'var(--red)'          },
  ];
  return (
    <div className="grid-kpi" style={{ marginBottom: 20 }}>
      {tiles.map(t => (
        <div key={t.label} className="card" style={{ padding: '16px 20px' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{t.label}</p>
          <p className="kpi-value" style={{ fontSize: 22, color: t.color }}>{t.value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Customer modal ─────────────────────────────────────────────────────────────
function CustomerModal({ customer, onClose, onSave, saving }) {
  const isEdit = !!customer;
  const [form, setForm] = useState({
    customerType: customer?.customerType || 'B2C',
    name:         customer?.name         || '',
    contactName:  customer?.contactName  || '',
    phone:        customer?.phone        || '',
    email:        customer?.email        || '',
    address:      customer?.address      || '',
    taxId:        customer?.taxId        || '',
    companyName:  customer?.companyName  || '',
    creditLimit:  customer?.creditLimit  || '',
    paymentTerms: customer?.paymentTerms || '',
    currency:     customer?.currency     || 'NGN',
    notes:        customer?.notes        || '',
    isActive:     customer?.isActive !== undefined ? customer.isActive : true,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const canSave = form.name.length >= 2;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal animate-in" style={{ width: '100%', maxWidth: 600 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h2 style={{ fontFamily: 'Poppins, sans-serif', fontSize: 18 }}>{isEdit ? 'Edit Customer' : 'New Customer'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <label className="label">Customer Type</label>
            <select className="input" value={form.customerType} onChange={e => set('customerType', e.target.value)}>
              <option value="B2C">B2C — Direct Consumer</option>
              <option value="B2B">B2B — Business Buyer</option>
              <option value="OFFTAKER">Offtaker — Contracted Bulk Buyer</option>
            </select>
          </div>
          <div>
            <label className="label">Name *</label>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Customer or business name" />
          </div>
          <div>
            <label className="label">Contact Name</label>
            <input className="input" value={form.contactName} onChange={e => set('contactName', e.target.value)} placeholder="Primary contact" />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+234…" />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
          </div>
          <div>
            <label className="label">Company Name</label>
            <input className="input" value={form.companyName} onChange={e => set('companyName', e.target.value)} />
          </div>
          <div>
            <label className="label">Tax ID</label>
            <input className="input" value={form.taxId} onChange={e => set('taxId', e.target.value)} />
          </div>
          <div>
            <label className="label">Payment Terms</label>
            <select className="input" value={form.paymentTerms} onChange={e => set('paymentTerms', e.target.value)}>
              <option value="">— Select —</option>
              <option value="Cash">Cash</option>
              <option value="Net 7">Net 7</option>
              <option value="Net 14">Net 14</option>
              <option value="Net 30">Net 30</option>
              <option value="Net 60">Net 60</option>
            </select>
          </div>
          <div>
            <label className="label">Credit Limit (₦)</label>
            <input className="input" type="number" min="0" value={form.creditLimit} onChange={e => set('creditLimit', parseFloat(e.target.value) || '')} placeholder="Leave blank for unlimited" />
          </div>
          <div>
            <label className="label">Currency</label>
            <select className="input" value={form.currency} onChange={e => set('currency', e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label className="label">Address</label>
            <input className="input" value={form.address} onChange={e => set('address', e.target.value)} />
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label className="label">Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} style={{ resize: 'vertical' }} />
          </div>
          {isEdit && (
            <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" id="custActive" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} />
              <label htmlFor="custActive" style={{ fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Active customer</label>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave({
            ...form,
            creditLimit:  form.creditLimit !== '' ? parseFloat(form.creditLimit) : null,
            taxId:        form.taxId        || null,
            contactName:  form.contactName  || null,
            phone:        form.phone        || null,
            email:        form.email        || null,
            address:      form.address      || null,
            companyName:  form.companyName  || null,
            paymentTerms: form.paymentTerms || null,
            notes:        form.notes        || null,
          })} disabled={!canSave || saving}>{saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Customer'}</button>
        </div>
      </div>
    </div>
  );
}

// ── AR Create Invoice modal ────────────────────────────────────────────────────
function ArCreateModal({ customers, flocks, onClose, onSave, saving, apiFetch }) {
  const today = new Date().toISOString().split('T')[0];
  const in30  = new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0];
  const [form, setForm] = useState({ invoiceNumber: '', customerId: '', flockId: '', invoiceDate: today, dueDate: in30, currency: 'NGN', exchangeRate: 1, subtotal: 0, taxAmount: 0, totalAmount: 0, lineItems: [], notes: '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Fetch preview invoice number on mount
  useEffect(() => {
    apiFetch('/api/finance/sales-invoices?action=next-number')
      .then(r => r.json())
      .then(d => { if (d.invoiceNumber) set('invoiceNumber', d.invoiceNumber); })
      .catch(() => {});
  }, []);

  const onLineItemsChange = (items) => {
    const sub = items.reduce((s, r) => s + (Number(r.totalPrice) || 0), 0);
    setForm(f => ({ ...f, lineItems: items, subtotal: sub, totalAmount: sub + (Number(f.taxAmount) || 0) }));
  };
  const onTaxChange = (tax) => setForm(f => ({ ...f, taxAmount: tax, totalAmount: f.subtotal + tax }));
  const canSave = form.invoiceNumber && form.customerId && form.invoiceDate && form.dueDate && form.totalAmount > 0;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal animate-in" style={{ width: '100%', maxWidth: 700 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h2 style={{ fontFamily: 'Poppins, sans-serif', fontSize: 18 }}>New Sales Invoice</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div><label className="label">Invoice Number</label><div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 13, fontWeight: 700, color: 'var(--purple)', letterSpacing: '0.03em' }}>{form.invoiceNumber || 'Generating…'}</div></div>
          <div><label className="label">Customer *</label>
            <select className="input" value={form.customerId} onChange={e => set('customerId', e.target.value)}>
              <option value="">— Select customer —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.companyName ? ` (${c.companyName})` : ''}</option>)}
            </select>
          </div>
          <div><label className="label">Invoice Date *</label><input className="input" type="date" value={form.invoiceDate} onChange={e => set('invoiceDate', e.target.value)} /></div>
          <div><label className="label">Due Date *</label><input className="input" type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} /></div>
          <div><label className="label">Currency</label>
            <select className="input" value={form.currency} onChange={e => set('currency', e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {form.currency !== 'NGN' && <div><label className="label">Exchange Rate (to NGN)</label><input className="input" type="number" min="0.01" step="any" value={form.exchangeRate} onChange={e => set('exchangeRate', parseFloat(e.target.value) || 1)} /></div>}
          <div><label className="label">Linked Flock (optional)</label>
            <select className="input" value={form.flockId} onChange={e => set('flockId', e.target.value)}>
              <option value="">— None —</option>
              {flocks.map(f => <option key={f.id} value={f.id}>{f.batchCode} — {f.operationType}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 16 }}><label className="label" style={{ marginBottom: 10 }}>Line Items</label><LineItemsEditor items={form.lineItems} onChange={onLineItemsChange} /></div>
        <div style={{ marginBottom: 16 }}><TotalsRow subtotal={form.subtotal} taxAmount={form.taxAmount} totalAmount={form.totalAmount} currency={form.currency} onTaxChange={onTaxChange} /></div>
        <div><label className="label">Notes</label><textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} style={{ resize: 'vertical' }} /></div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(form)} disabled={!canSave || saving}>{saving ? 'Saving…' : 'Create Invoice'}</button>
        </div>
      </div>
    </div>
  );
}

// ── AR Invoice detail modal ────────────────────────────────────────────────────
function ArDetailModal({ invoice, onClose, onSend, onPay, onVoid, onReminder, onDownloadPdf, role, actionLoading }) {
  const balance     = parseFloat(invoice.totalAmount) - parseFloat(invoice.amountPaid);
  const canSend     = FINANCE_ROLES.includes(role) && invoice.status === 'DRAFT';
  const canPay      = FINANCE_ROLES.includes(role) && ['SENT','OVERDUE','PARTIALLY_PAID'].includes(invoice.status);
  const canVoid     = FINANCE_ROLES.includes(role) && invoice.status !== 'PAID';
  const canReminder = FINANCE_ROLES.includes(role) && ['SENT','OVERDUE','PARTIALLY_PAID'].includes(invoice.status);
  const isReadOnly  = !FINANCE_ROLES.includes(role);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal animate-in" style={{ width: '100%', maxWidth: 740 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h2 style={{ fontFamily: 'Poppins, sans-serif', fontSize: 18, marginBottom: 6 }}>{invoice.invoiceNumber}</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <StatusBadge status={invoice.status} meta={AR_STATUS_META} />
              {invoice.daysOverdue > 0 && <span style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700, background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 20, padding: '2px 8px' }}>{invoice.daysOverdue}d overdue</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, background: 'var(--bg-elevated)', borderRadius: 10, padding: '14px 16px', border: '1px solid var(--border)', marginBottom: 18 }}>
          {[['Customer', invoice.customer?.name], ['Contact', invoice.customer?.contactName || '—'], ['Email', invoice.customer?.email || '—'], ['Invoice Date', fmtDate(invoice.invoiceDate)], ['Due Date', fmtDate(invoice.dueDate)], ['Payment Terms', invoice.customer?.paymentTerms || '—'], ['Currency', invoice.currency], ['Created By', invoice.createdBy ? `${invoice.createdBy.firstName} ${invoice.createdBy.lastName}` : '—'], ['Payment Ref', invoice.paymentRef || '—']].map(([k, v]) => (
            <div key={k}><p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{k}</p><p style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{v}</p></div>
          ))}
        </div>
        {invoice.notes && <div style={{ background: 'var(--amber-bg)', border: '1px solid var(--amber-border)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>{invoice.notes}</div>}
        <div style={{ marginBottom: 18 }}><p className="section-header">Line Items</p><LineItemsEditor items={Array.isArray(invoice.lineItems) ? invoice.lineItems : []} onChange={() => {}} readOnly /></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
          {[['Subtotal', fmt(invoice.subtotal, invoice.currency), 'var(--text-primary)'], ['Tax', fmt(invoice.taxAmount, invoice.currency), 'var(--text-secondary)'], ['Total', fmt(invoice.totalAmount, invoice.currency), 'var(--purple)'], ['Balance', fmt(balance, invoice.currency), invoice.status === 'PAID' ? 'var(--green)' : 'var(--red)']].map(([k, v, c]) => (
            <div key={k} style={{ textAlign: 'center', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 8px' }}>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}>{k}</p>
              <p style={{ fontFamily: 'Poppins, sans-serif', fontSize: 15, fontWeight: 700, color: c }}>{v}</p>
            </div>
          ))}
        </div>
        {invoice.currency !== 'NGN' && parseFloat(invoice.exchangeRate) > 1 && <div className="alert alert-purple" style={{ marginBottom: 14, fontSize: 12 }}>NGN equivalent at ×{invoice.exchangeRate}: <strong>{fmt(parseFloat(invoice.totalAmount) * parseFloat(invoice.exchangeRate))}</strong></div>}
        {!isReadOnly && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canSend     && <button className="btn btn-primary"  onClick={onSend}     disabled={actionLoading} style={{ fontSize: 13 }}>📤 Mark as Sent</button>}
            {canPay      && <button className="btn btn-outline"  onClick={onPay}      disabled={actionLoading} style={{ fontSize: 13 }}>💳 Record Receipt</button>}
            {canReminder && <button className="btn btn-ghost"    onClick={onReminder} disabled={actionLoading} style={{ fontSize: 13 }}>🔔 Send Reminder</button>}
            {canVoid     && <button className="btn btn-danger"   onClick={onVoid}     disabled={actionLoading} style={{ fontSize: 13 }}>✕ Void</button>}
          </div>
        )}
        {isReadOnly && <p style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Read-only access.</p>}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <button onClick={onDownloadPdf} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            ⬇ Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Customer list view ─────────────────────────────────────────────────────────
function CustomersView({ apiFetch, role, onNewInvoiceForCustomer }) {
  const [customers,    setCustomers]    = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [toast,        setToast]        = useState('');
  const [search,       setSearch]       = useState('');
  const [showModal,    setShowModal]    = useState(false);
  const [editCustomer, setEditCustomer] = useState(null);
  const [saving,       setSaving]       = useState(false);

  const canManage = FINANCE_ROLES.includes(role);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ activeOnly: 'false' });
      if (search) params.set('search', search);
      const res = await apiFetch(`/api/finance/customers?${params}`);
      if (!res.ok) throw new Error('Failed to load customers');
      const d = await res.json();
      setCustomers(d.customers || []);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [apiFetch, search]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (form) => {
    setSaving(true);
    try {
      const url    = editCustomer ? `/api/finance/customers/${editCustomer.id}` : '/api/finance/customers';
      const method = editCustomer ? 'PATCH' : 'POST';
      const res    = await apiFetch(url, { method, body: JSON.stringify(form) });
      const d      = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      setShowModal(false); setEditCustomer(null);
      showToast(editCustomer ? 'Customer updated' : `Customer ${d.customer.name} created`);
      load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const TYPE_BADGE = { B2C: 'status-grey', B2B: 'status-blue', OFFTAKER: 'status-purple' };
  const TYPE_LABEL = { B2C: 'B2C', B2B: 'B2B', OFFTAKER: 'Offtaker' };

  return (
    <div>
      {toast && <div className="alert alert-green animate-in" style={{ marginBottom: 14 }}>✓ {toast}</div>}
      {error && <div className="alert alert-red animate-in" style={{ marginBottom: 14 }}>⚠ {error} <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: 8, fontWeight: 700 }}>×</button></div>}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <input className="input" placeholder="Search customers…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 260, padding: '7px 12px', fontSize: 13 }} />
        <div style={{ marginLeft: 'auto' }}>
          {canManage && <button className="btn btn-primary" onClick={() => { setEditCustomer(null); setShowModal(true); }} style={{ fontSize: 13 }}>+ New Customer</button>}
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '50px 0', textAlign: 'center', color: 'var(--text-muted)' }}>⏳ Loading…</div>
        ) : customers.length === 0 ? (
          <div style={{ padding: '50px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>👥</div>
            <p style={{ fontWeight: 700, marginBottom: 4 }}>No customers yet</p>
            <p style={{ fontSize: 13 }}>{canManage ? 'Add your first customer to start raising invoices.' : 'No customers found.'}</p>
          </div>
        ) : (
          <table className="table">
            <thead><tr><th>Name</th><th>Type</th><th>Contact</th><th>Phone / Email</th><th>Payment Terms</th><th style={{ textAlign: 'right' }}>Total Billed</th><th style={{ textAlign: 'right' }}>Invoices</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {customers.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 700 }}>{c.name}{c.companyName && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{c.companyName}</div>}</td>
                  <td><span className={`status-badge ${TYPE_BADGE[c.customerType] || 'status-grey'}`}>{TYPE_LABEL[c.customerType]}</span></td>
                  <td style={{ fontSize: 13 }}>{c.contactName || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.phone || c.email || '—'}</td>
                  <td style={{ fontSize: 13 }}>{c.paymentTerms || '—'}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'Poppins, sans-serif', fontSize: 13, fontWeight: 700 }}>{fmt(c.arSummary?.totalBilled || 0)}</td>
                  <td style={{ textAlign: 'right', fontSize: 13 }}>{c._count?.salesInvoices ?? 0}</td>
                  <td><span className={`status-badge ${c.isActive ? 'status-green' : 'status-grey'}`}>{c.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {canManage && <button className="btn btn-ghost" onClick={() => { setEditCustomer(c); setShowModal(true); }} style={{ fontSize: 11, padding: '4px 10px' }}>Edit</button>}
                      {canManage && <button className="btn btn-outline" onClick={() => onNewInvoiceForCustomer(c)} style={{ fontSize: 11, padding: '4px 10px' }}>+ Invoice</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && <CustomerModal customer={editCustomer} onClose={() => { setShowModal(false); setEditCustomer(null); }} onSave={handleSave} saving={saving} />}
    </div>
  );
}

// ── Full AR tab ────────────────────────────────────────────────────────────────
function ArTab({ apiFetch, role }) {
  const [arView,      setArView]      = useState('invoices'); // 'invoices' | 'customers'
  const [invoices,    setInvoices]    = useState([]);
  const [summary,     setSummary]     = useState({});
  const [customers,   setCustomers]   = useState([]);
  const [flocks,      setFlocks]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [toast,       setToast]       = useState('');
  const [filterStatus,   setFilterStatus]   = useState('');
  const [filterCustomer, setFilterCustomer] = useState('');
  const [search,         setSearch]         = useState('');
  const [showCreate,     setShowCreate]     = useState(false);
  const [preselectedCustomer, setPreselectedCustomer] = useState(null);
  const [detailInv,      setDetailInv]      = useState(null);
  const [payInv,         setPayInv]         = useState(null);
  const [saving,         setSaving]         = useState(false);
  const [actionLoading,  setActionLoading]  = useState(false);

  const canCreate = FINANCE_ROLES.includes(role);
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const downloadPdf = async (inv) => {
    try {
      const res = await apiFetch(`/api/finance/sales-invoices/${inv.id}/pdf`, { responseType: 'blob' });
      const blob = res instanceof Blob ? res : new Blob([res], { type: 'application/pdf' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${inv.invoiceNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast(`PDF error: ${e?.message || 'Failed to generate'}`);
    }
  };

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams();
      if (filterStatus)   p.set('status',     filterStatus);
      if (filterCustomer) p.set('customerId',  filterCustomer);
      if (search)         p.set('search',      search);
      const [invRes, custRes, flockRes] = await Promise.all([
        apiFetch(`/api/finance/sales-invoices?${p}`),
        apiFetch('/api/finance/customers'),
        apiFetch('/api/flocks'),
      ]);
      if (!invRes.ok) throw new Error('Failed to load sales invoices');
      const d = await invRes.json();
      setInvoices(d.invoices || []); setSummary(d.summary || {});
      if (custRes.ok)  { const c = await custRes.json();  setCustomers(c.customers || []); }
      if (flockRes.ok) { const f = await flockRes.json(); setFlocks(f.flocks || []); }
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [apiFetch, filterStatus, filterCustomer, search]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (form) => {
    setSaving(true);
    try {
      const payload = {
        ...form,
        flockId: form.flockId || null,
        farmId:  form.farmId  || null,
        notes:   form.notes   || null,
      };
      const res = await apiFetch('/api/finance/sales-invoices', { method: 'POST', body: JSON.stringify(payload) });
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      setShowCreate(false); setPreselectedCustomer(null);
      showToast(`Invoice ${d.invoice.invoiceNumber} created`); load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const patch = async (id, body, msg) => {
    setActionLoading(true);
    try {
      const res = await apiFetch(`/api/finance/sales-invoices/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      const d   = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      showToast(msg || 'Done'); setDetailInv(null); setPayInv(null); load();
    } catch (e) { setError(e.message); } finally { setActionLoading(false); }
  };

  const openCreateForCustomer = (customer) => {
    setPreselectedCustomer(customer);
    setArView('invoices');
    setShowCreate(true);
  };

  // Inject preselected customer into create modal
  const createModalCustomers = preselectedCustomer
    ? [preselectedCustomer, ...customers.filter(c => c.id !== preselectedCustomer.id)]
    : customers;

  return (
    <div>
      {/* Sub-nav: Invoices / Customers */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {[['invoices','📋 Sales Invoices'],['customers','👥 Customers']].map(([key, label]) => (
          <button key={key} onClick={() => setArView(key)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 16px', fontSize: 13, fontFamily: 'Nunito, sans-serif', fontWeight: 700,
              color: arView === key ? 'var(--purple)' : 'var(--text-muted)',
              borderBottom: arView === key ? '2px solid var(--purple)' : '2px solid transparent',
              marginBottom: -1 }}>
            {label}
          </button>
        ))}
      </div>

      {arView === 'customers' && (
        <CustomersView apiFetch={apiFetch} role={role} onNewInvoiceForCustomer={openCreateForCustomer} />
      )}

      {arView === 'invoices' && (
        <div>
          {!loading && Object.keys(summary).length > 0 && <ArKpiStrip summary={summary} />}
          {toast && <div className="alert alert-green animate-in" style={{ marginBottom: 16 }}>✓ {toast}</div>}
          {error && <div className="alert alert-red animate-in" style={{ marginBottom: 16 }}>⚠ {error} <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: 8, fontWeight: 700 }}>×</button></div>}

          <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="input" placeholder="Search invoice # or customer…" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 240, padding: '7px 12px', fontSize: 13 }} />
              <select className="input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ maxWidth: 180, padding: '7px 12px', fontSize: 13 }}>
                <option value="">All Statuses</option>
                {Object.entries(AR_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <select className="input" value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)} style={{ maxWidth: 200, padding: '7px 12px', fontSize: 13 }}>
                <option value="">All Customers</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div style={{ marginLeft: 'auto' }}>
                {canCreate && <button className="btn btn-primary" onClick={() => { setPreselectedCustomer(null); setShowCreate(true); }} style={{ fontSize: 13 }}>+ New Invoice</button>}
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {loading ? (
              <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}><div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>Loading…</div>
            ) : invoices.length === 0 ? (
              <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>📤</div>
                <p style={{ fontWeight: 700, marginBottom: 4 }}>No sales invoices found</p>
                <p style={{ fontSize: 13 }}>{canCreate ? 'Create your first sales invoice.' : 'No results.'}</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead><tr><th>Invoice #</th><th>Customer</th><th>Date</th><th>Due</th><th>CCY</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Balance</th><th>Status</th><th style={{ textAlign: 'right' }}>Aging</th><th></th></tr></thead>
                  <tbody>
                    {invoices.map(inv => (
                      <tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => setDetailInv(inv)}>
                        <td style={{ fontWeight: 700, color: 'var(--purple)' }}>{inv.invoiceNumber}</td>
                        <td style={{ fontWeight: 600 }}>{inv.customer?.name}<div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{inv.customer?.customerType}</div></td>
                        <td>{fmtDate(inv.invoiceDate)}</td>
                        <td>{fmtDate(inv.dueDate)}</td>
                        <td><span style={{ fontSize: 11, fontWeight: 700, background: 'var(--purple-light)', color: 'var(--purple)', border: '1px solid #d4d8ff', borderRadius: 12, padding: '2px 8px' }}>{inv.currency}</span></td>
                        <td style={{ textAlign: 'right', fontFamily: 'Poppins, sans-serif', fontSize: 13, fontWeight: 700 }}>
                          {fmt(inv.totalAmount, inv.currency)}
                          {inv.currency !== 'NGN' && parseFloat(inv.exchangeRate) > 1 && <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Nunito, sans-serif', fontWeight: 400 }}>≈ {fmt(parseFloat(inv.totalAmount) * parseFloat(inv.exchangeRate))}</div>}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: 'Poppins, sans-serif', fontSize: 13, fontWeight: 700, color: inv.status === 'PAID' ? 'var(--green)' : 'var(--text-primary)' }}>{fmt(inv.balance, inv.currency)}</td>
                        <td onClick={e => e.stopPropagation()}><StatusBadge status={inv.status} meta={AR_STATUS_META} /></td>
                        <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                          {inv.daysOverdue > 0 ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)', background: 'var(--red-bg)', border: '1px solid var(--red-border)', borderRadius: 20, padding: '2px 8px' }}>{inv.daysOverdue}d</span> : <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>—</span>}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            {FINANCE_ROLES.includes(role) && inv.status === 'DRAFT' && <button className="btn btn-outline" onClick={() => patch(inv.id, { action: 'send' }, `${inv.invoiceNumber} marked as sent`)} style={{ fontSize: 11, padding: '4px 10px' }}>Send</button>}
                            {FINANCE_ROLES.includes(role) && ['SENT','OVERDUE','PARTIALLY_PAID'].includes(inv.status) && <button className="btn btn-primary" onClick={() => setPayInv(inv)} style={{ fontSize: 11, padding: '4px 10px' }}>Received</button>}
                            <button onClick={() => downloadPdf(inv)} title="Download PDF" style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>⬇</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {showCreate && <ArCreateModal customers={createModalCustomers} flocks={flocks} apiFetch={apiFetch} onClose={() => { setShowCreate(false); setPreselectedCustomer(null); }} onSave={handleCreate} saving={saving} />}
      {detailInv && <ArDetailModal invoice={detailInv} role={role} actionLoading={actionLoading} onClose={() => setDetailInv(null)} onSend={() => patch(detailInv.id, { action: 'send' }, `${detailInv.invoiceNumber} marked as sent`)} onPay={() => { setPayInv(detailInv); setDetailInv(null); }} onVoid={() => { const r = window.prompt('Reason for voiding:'); if (r) patch(detailInv.id, { action: 'void', reason: r }, 'Invoice voided'); }} onReminder={() => patch(detailInv.id, { action: 'reminder', channel: 'EMAIL' }, 'Reminder sent')} onDownloadPdf={() => downloadPdf(detailInv)} />}
      {payInv && <PayModal invoice={payInv} onClose={() => setPayInv(null)} onSave={form => patch(payInv.id, form, `Payment received for ${payInv.invoiceNumber}`)} saving={saving} context="receipt" />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// BANK RECONCILIATION TAB
// ══════════════════════════════════════════════════════════════════════════════

const RECONCILIATION_ROLES = ['SUPER_ADMIN','FARM_ADMIN','ACCOUNTANT'];

// ── Recon KPI card ────────────────────────────────────────────────────────────
function ReconKpi({ label, value, color, icon }) {
  return (
    <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 22px', flex: '1 1 180px', minWidth: 150 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'Poppins,sans-serif', color: color || 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

// ── Manual transaction modal ──────────────────────────────────────────────────
function AddTxModal({ onClose, onSave, saving }) {
  const [form, setForm] = useState({
    txDate: new Date().toISOString().slice(0,10),
    description: '',
    reference: '',
    amount: '',
    type: 'credit',   // credit | debit
    currency: 'NGN',
    bankAccount: '',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    if (!form.txDate || !form.description || !form.amount) return;
    const rawAmount = parseFloat(form.amount);
    if (isNaN(rawAmount) || rawAmount <= 0) return;
    onSave({
      txDate:      form.txDate,
      description: form.description,
      reference:   form.reference || null,
      amount:      form.type === 'debit' ? -rawAmount : rawAmount,
      currency:    form.currency,
      bankAccount: form.bankAccount || null,
    });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ fontFamily: 'Poppins,sans-serif', fontSize: 16, fontWeight: 700, margin: 0 }}>Add Bank Transaction</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Date *</label>
              <input className="input" type="date" value={form.txDate} onChange={e => set('txDate', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Type *</label>
              <select className="input" value={form.type} onChange={e => set('type', e.target.value)}>
                <option value="credit">Credit (Money In)</option>
                <option value="debit">Debit (Money Out)</option>
              </select>
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Description *</label>
            <input className="input" value={form.description} onChange={e => set('description', e.target.value)} placeholder="e.g. Customer payment - Invoice #1042" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Amount *</label>
              <input className="input" type="number" min="0" step="any" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Currency</label>
              <select className="input" value={form.currency} onChange={e => set('currency', e.target.value)}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Reference / Ref No.</label>
              <input className="input" value={form.reference} onChange={e => set('reference', e.target.value)} placeholder="CHQ-001, TRF-2024..." />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Bank Account</label>
              <input className="input" value={form.bankAccount} onChange={e => set('bankAccount', e.target.value)} placeholder="e.g. GTBank 0123..." />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22 }}>
          <button onClick={onClose} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 20px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !form.txDate || !form.description || !form.amount}
            style={{ background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 22px', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : 'Add Transaction'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Match invoice modal ───────────────────────────────────────────────────────
function MatchModal({ tx, apiFetch, onClose, onSave, saving }) {
  const [invoiceType, setInvoiceType] = useState('sales');
  const [invoices, setInvoices]       = useState([]);
  const [loading, setLoading]         = useState(false);
  const [selected, setSelected]       = useState(null);
  const [search, setSearch]           = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelected(null);
    const endpoint = invoiceType === 'sales'
      ? '/api/finance/sales-invoices?limit=200'
      : '/api/finance/supplier-invoices?limit=200';
    apiFetch(endpoint)
      .then(d => { if (!cancelled) setInvoices(d.invoices || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [invoiceType]);

  const filtered = invoices.filter(inv => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (inv.invoiceNumber || '').toLowerCase().includes(q) ||
           (inv.customer?.name || inv.supplier?.name || '').toLowerCase().includes(q);
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontFamily: 'Poppins,sans-serif', fontSize: 16, fontWeight: 700, margin: 0 }}>Match to Invoice</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              Tx: {tx.description} &bull; {fmt(Math.abs(Number(tx.amount)), tx.currency)} {tx.currency}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {['sales','supplier'].map(t => (
            <button key={t} onClick={() => setInvoiceType(t)}
              style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: invoiceType === t ? '2px solid var(--purple)' : '1px solid var(--border)', background: invoiceType === t ? 'var(--purple-light)' : '#fff', color: invoiceType === t ? 'var(--purple)' : 'var(--text-secondary)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              {t === 'sales' ? '📤 Sales Invoice' : '📥 Supplier Invoice'}
            </button>
          ))}
        </div>

        <input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by invoice # or name…" style={{ marginBottom: 12 }} />

        {loading ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 13 }}>Loading invoices…</div>
        ) : (
          <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
            {filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 13 }}>No invoices found</div>
            ) : filtered.map(inv => {
              const name   = inv.customer?.name || inv.supplier?.name || '—';
              const isSelected = selected === inv.id;
              const balance = Number(inv.totalAmount) - Number(inv.amountPaid || 0);
              return (
                <div key={inv.id} onClick={() => setSelected(isSelected ? null : inv.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', background: isSelected ? 'var(--purple-light)' : 'transparent', transition: 'background 0.1s' }}>
                  <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${isSelected ? 'var(--purple)' : 'var(--border)'}`, background: isSelected ? 'var(--purple)' : '#fff', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {isSelected && <span style={{ color: '#fff', fontSize: 11, fontWeight: 900 }}>✓</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{inv.invoiceNumber}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{name} &bull; {fmtDate(inv.invoiceDate)}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{fmt(balance, inv.currency)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>balance</div>
                  </div>
                  <span className={`status-badge ${invoiceType === 'sales' ? AR_STATUS_META[inv.status]?.cls : AP_STATUS_META[inv.status]?.cls}`} style={{ fontSize: 10 }}>
                    {invoiceType === 'sales' ? AR_STATUS_META[inv.status]?.label : AP_STATUS_META[inv.status]?.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 20px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => selected && onSave({ invoiceType, invoiceId: selected })} disabled={saving || !selected}
            style={{ background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 22px', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: (!selected || saving) ? 0.5 : 1 }}>
            {saving ? 'Matching…' : 'Confirm Match'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── CSV import modal ──────────────────────────────────────────────────────────
function CsvImportModal({ apiFetch, onClose, onImported }) {
  const [file,    setFile]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState('');

  const handleImport = async () => {
    if (!file) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiFetch('/api/finance/reconciliation/csv', {
        method: 'POST',
        body:   fd,
      });
      setResult(res);
      if (res.imported > 0) onImported();
    } catch (e) {
      setError(e?.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.18)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ fontFamily: 'Poppins,sans-serif', fontSize: 16, fontWeight: 700, margin: 0 }}>Import Bank Statement (CSV)</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ background: '#f8f9ff', border: '1px dashed #c7d2fe', borderRadius: 10, padding: '16px 20px', marginBottom: 18, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Expected CSV columns (header row required):</strong>
          <code style={{ fontSize: 12, color: 'var(--purple)' }}>date, description, amount, reference, currency, bank_account</code>
          <br />
          Or split debit/credit: <code style={{ fontSize: 12, color: 'var(--purple)' }}>debit, credit</code>
          <br />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Duplicates (same date + reference + amount) are skipped automatically.</span>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 18, textAlign: 'center' }}>
          <input type="file" accept=".csv,text/csv" onChange={e => { setFile(e.target.files[0]); setResult(null); setError(''); }}
            style={{ display: 'block', margin: '0 auto', fontSize: 13 }} />
          {file && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>📄 {file.name} ({(file.size / 1024).toFixed(1)} KB)</div>}
        </div>

        {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#dc2626', fontSize: 13, marginBottom: 14 }}>{error}</div>}

        {result && (
          <div style={{ background: result.imported > 0 ? '#f0fdf4' : '#fffbeb', border: `1px solid ${result.imported > 0 ? '#bbf7d0' : '#fde68a'}`, borderRadius: 8, padding: '12px 16px', marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: result.imported > 0 ? '#15803d' : '#92400e', marginBottom: 6 }}>{result.message}</div>
            {result.errors?.length > 0 && (
              <div style={{ fontSize: 12, color: '#dc2626', marginTop: 6 }}>
                <strong>Row errors:</strong>
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 20px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            {result?.imported > 0 ? 'Close' : 'Cancel'}
          </button>
          {!result?.imported && (
            <button onClick={handleImport} disabled={!file || loading}
              style={{ background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 22px', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: (!file || loading) ? 0.6 : 1 }}>
              {loading ? 'Importing…' : 'Import CSV'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main ReconTab ─────────────────────────────────────────────────────────────
function ReconTab({ apiFetch, role }) {
  const canEdit = RECONCILIATION_ROLES.includes(role);

  const [data,       setData]       = useState({ transactions: [], total: 0, pages: 1, summary: {} });
  const safeSetData = (d) => setData({ transactions: d.transactions || [], total: d.total || 0, pages: d.pages || 1, summary: d.summary || {} });
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [saving,     setSaving]     = useState(false);
  const [toast,      setToast]      = useState('');

  // Filters
  const [page,         setPage]         = useState(1);
  const [search,       setSearch]       = useState('');
  const [from,         setFrom]         = useState('');
  const [to,           setTo]           = useState('');
  const [unmatchedOnly, setUnmatchedOnly] = useState(false);

  // Modals
  const [showAdd,    setShowAdd]    = useState(false);
  const [showCsv,    setShowCsv]    = useState(false);
  const [matchTx,    setMatchTx]    = useState(null);

  const notify = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ page, limit: 50 });
      if (search)       params.set('search', search);
      if (from)         params.set('from', from);
      if (to)           params.set('to', to);
      if (unmatchedOnly) params.set('unmatched', 'true');
      const d = await apiFetch(`/api/finance/reconciliation?${params}`);
      safeSetData(d);
    } catch (e) {
      setError(e?.message || 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [page, search, from, to, unmatchedOnly]);

  useEffect(() => { load(); }, [load]);

  const patch = async (id, body, successMsg) => {
    setSaving(true);
    try {
      await apiFetch(`/api/finance/reconciliation/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      notify(successMsg);
      load();
    } catch (e) {
      notify(`Error: ${e?.message || 'Failed'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleAddSave = async (form) => {
    setSaving(true);
    try {
      await apiFetch('/api/finance/reconciliation', { method: 'POST', body: JSON.stringify(form) });
      notify('Transaction added');
      setShowAdd(false);
      load();
    } catch (e) {
      notify(`Error: ${e?.message || 'Failed'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (tx) => {
    if (!window.confirm(`Delete transaction "${tx.description}"? This cannot be undone.`)) return;
    patch(tx.id, { action: 'delete' }, 'Transaction deleted');
  };

  const { summary = {} } = data;

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 28, right: 28, background: '#1f2937', color: '#fff', borderRadius: 10, padding: '12px 22px', fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', maxWidth: 380 }}>
          {toast}
        </div>
      )}

      {/* Role gate for read-only */}
      {!canEdit && (
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 16px' }}>
          <span style={{ fontSize: 18 }}>👁</span>
          <span style={{ fontSize: 13, color: '#92400e', fontWeight: 600 }}>View-only — Reconciliation actions require Accountant or Farm Admin access.</span>
        </div>
      )}

      {/* KPI Strip */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 22 }}>
        <ReconKpi icon="💳" label="Total Credits"   value={fmt(summary.totalCredit  || 0)} color="var(--green)" />
        <ReconKpi icon="🏦" label="Total Debits"    value={fmt(summary.totalDebit   || 0)} color="var(--red)"   />
        <ReconKpi icon="⚠️"  label="Unmatched"       value={summary.unmatchedCount  ?? '—'} color={summary.unmatchedCount > 0 ? '#d97706' : 'var(--text-primary)'} />
        <ReconKpi icon="✅"  label="Matched"         value={summary.matchedCount    ?? '—'} color="var(--green)" />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <input className="input" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search description / reference…" style={{ flex: '1 1 200px', minWidth: 180 }} />
        <input className="input" type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} style={{ width: 148 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>to</span>
        <input className="input" type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} style={{ width: 148 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={unmatchedOnly} onChange={e => { setUnmatchedOnly(e.target.checked); setPage(1); }} />
          Unmatched only
        </label>
        {canEdit && (
          <>
            <button onClick={() => setShowCsv(true)}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              📂 Import CSV
            </button>
            <button onClick={() => setShowAdd(true)}
              style={{ background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              + Add Transaction
            </button>
          </>
        )}
      </div>

      {/* Error */}
      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#dc2626', fontSize: 13, marginBottom: 14 }}>{error}</div>}

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)', fontSize: 14 }}>Loading transactions…</div>
      ) : data.transactions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏦</div>
          <div style={{ fontSize: 14, marginBottom: 8 }}>No bank transactions found</div>
          {canEdit && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Add a transaction manually or import a CSV bank statement to get started.</div>}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Reference</th>
                <th>Bank Account</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Source</th>
                <th>Status</th>
                <th>Matched Invoice</th>
                {canEdit && <th style={{ width: 120 }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.transactions.map(tx => {
                const amount   = Number(tx.amount);
                const isCredit = amount >= 0;
                const matched  = !!tx.matchedAt;
                const matchedInv = tx.matchedSalesInvoice || tx.matchedSupplierInvoice;
                const matchedName = tx.matchedSalesInvoice
                  ? `${tx.matchedSalesInvoice.invoiceNumber} — ${tx.matchedSalesInvoice.customer?.name || ''}`
                  : tx.matchedSupplierInvoice
                  ? `${tx.matchedSupplierInvoice.invoiceNumber} — ${tx.matchedSupplierInvoice.supplier?.name || ''}`
                  : null;

                return (
                  <tr key={tx.id} style={{ opacity: matched ? 0.85 : 1 }}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{fmtDate(tx.txDate)}</td>
                    <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }} title={tx.description}>{tx.description}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tx.reference || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tx.bankAccount || '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 13, color: isCredit ? 'var(--green)' : '#dc2626', whiteSpace: 'nowrap' }}>
                      {isCredit ? '+' : '−'}{fmt(Math.abs(amount), tx.currency)}
                    </td>
                    <td>
                      <span style={{ fontSize: 11, background: tx.source === 'CSV' ? '#eff6ff' : '#f9fafb', color: tx.source === 'CSV' ? '#2563eb' : '#6b7280', border: `1px solid ${tx.source === 'CSV' ? '#bfdbfe' : '#e5e7eb'}`, borderRadius: 12, padding: '2px 8px', fontWeight: 600 }}>
                        {tx.source}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: 11, background: matched ? '#f0fdf4' : '#fffbeb', color: matched ? '#15803d' : '#d97706', border: `1px solid ${matched ? '#bbf7d0' : '#fde68a'}`, borderRadius: 12, padding: '2px 8px', fontWeight: 700 }}>
                        {matched ? '✅ Matched' : '⚠️ Unmatched'}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={matchedName || ''}>
                      {matchedName || '—'}
                    </td>
                    {canEdit && (
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {!matched ? (
                            <button onClick={() => setMatchTx(tx)} disabled={saving}
                              style={{ fontSize: 11, background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700 }}>
                              Match
                            </button>
                          ) : (
                            <button onClick={() => patch(tx.id, { action: 'unmatch' }, 'Match cleared')} disabled={saving}
                              style={{ fontSize: 11, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontWeight: 700 }}>
                              Unmatch
                            </button>
                          )}
                          {tx.source === 'MANUAL' && !matched && (
                            <button onClick={() => handleDelete(tx)} disabled={saving}
                              style={{ fontSize: 11, background: 'none', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>
                              🗑
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {data.pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 20 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: page === 1 ? 0.4 : 1 }}>
            ‹ Prev
          </button>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Page {page} of {data.pages} ({data.total} records)</span>
          <button onClick={() => setPage(p => Math.min(data.pages, p + 1))} disabled={page === data.pages}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: page === data.pages ? 0.4 : 1 }}>
            Next ›
          </button>
        </div>
      )}

      {/* Modals */}
      {showAdd  && <AddTxModal onClose={() => setShowAdd(false)} onSave={handleAddSave} saving={saving} />}
      {showCsv  && <CsvImportModal apiFetch={apiFetch} onClose={() => setShowCsv(false)} onImported={load} />}
      {matchTx  && (
        <MatchModal
          tx={matchTx}
          apiFetch={apiFetch}
          onClose={() => setMatchTx(null)}
          saving={saving}
          onSave={async ({ invoiceType, invoiceId }) => {
            await patch(matchTx.id, { action: 'match', invoiceType, invoiceId }, `Matched to invoice`);
            setMatchTx(null);
          }}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// P&L TAB
// ══════════════════════════════════════════════════════════════════════════════

function PlKpiCard({ label, value, sub, color, bg }) {
  return (
    <div className="card" style={{ padding: '18px 20px', borderLeft: `4px solid ${color}`, background: bg || undefined }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>{label}</p>
      <p style={{ fontFamily: 'Poppins, sans-serif', fontSize: 22, fontWeight: 700, color }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{sub}</p>}
    </div>
  );
}

// SVG bar chart
function BarChart({ data }) {
  if (!data || data.length === 0) return (
    <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
      No data for this period
    </div>
  );

  const allZero = data.every(d => d.revenue === 0 && d.costs === 0);
  if (allZero) return (
    <div style={{ height: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>No paid invoices in this period</p>
      <div style={{ display: 'flex', gap: 12 }}>
        {data.map((d, i) => (
          <span key={i} style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.label}</span>
        ))}
      </div>
    </div>
  );

  const W       = 440;
  const H       = 140;
  const PAD_B   = 32; // space for labels below axis
  const PAD_T   = 8;
  const chartH  = H - PAD_T - PAD_B;
  const chartW  = W;
  const maxVal  = Math.max(...data.flatMap(d => [d.revenue, d.costs]), 1);
  const groupW  = chartW / data.length;
  const barW    = Math.max(6, Math.min(20, groupW * 0.32));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      {/* Gridlines */}
      {[0.25, 0.5, 0.75, 1].map((pct, i) => (
        <line key={i} x1={0} x2={W} y1={PAD_T + (1 - pct) * chartH} y2={PAD_T + (1 - pct) * chartH}
          stroke="#e2e8f0" strokeWidth={0.5} strokeDasharray="3,3" />
      ))}
      {/* X axis */}
      <line x1={0} x2={W} y1={PAD_T + chartH} y2={PAD_T + chartH} stroke="#e2e8f0" strokeWidth={1} />

      {data.map((d, i) => {
        const cx    = i * groupW + groupW / 2;
        const revH  = Math.max(3, (d.revenue / maxVal) * chartH);
        const costH = Math.max(3, (d.costs   / maxVal) * chartH);
        const revX  = cx - barW - 1;
        const costX = cx + 1;

        return (
          <g key={i}>
            <rect x={revX}  y={PAD_T + chartH - revH}  width={barW} height={revH}  fill="#6c63ff" rx={2} opacity={0.85}>
              <title>Revenue: {d.revenue.toLocaleString('en-NG', { style:'currency', currency:'NGN', maximumFractionDigits:0 })}</title>
            </rect>
            <rect x={costX} y={PAD_T + chartH - costH} width={barW} height={costH} fill="#f87171" rx={2} opacity={0.85}>
              <title>Costs: {d.costs.toLocaleString('en-NG', { style:'currency', currency:'NGN', maximumFractionDigits:0 })}</title>
            </rect>
            <text x={cx} y={PAD_T + chartH + 16} textAnchor="middle" fontSize={9} fill="#94a3b8" fontFamily="Nunito,sans-serif">
              {d.label}
            </text>
          </g>
        );
      })}

      {/* Legend */}
      <rect x={W - 100} y={H - 10} width={8} height={8} fill="#6c63ff" rx={1} />
      <text x={W - 89} y={H - 3} fontSize={8} fill="#94a3b8" fontFamily="Nunito,sans-serif">Revenue</text>
      <rect x={W - 42} y={H - 10} width={8} height={8} fill="#f87171" rx={1} />
      <text x={W - 31} y={H - 3} fontSize={8} fill="#94a3b8" fontFamily="Nunito,sans-serif">Costs</text>
    </svg>
  );
}

const CURRENT_YEAR = new Date().getFullYear();
const PRESET_PERIODS = [
  { label: 'This Month',   from: () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }, to: () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(new Date(d.getFullYear(), d.getMonth()+1, 0).getDate()).padStart(2,'0')}`; } },
  { label: 'Last Month',   from: () => { const d = new Date(); d.setMonth(d.getMonth()-1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }, to: () => { const d = new Date(); d.setDate(0); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; } },
  { label: 'Q1',           from: () => `${CURRENT_YEAR}-01-01`, to: () => `${CURRENT_YEAR}-03-31` },
  { label: 'Q2',           from: () => `${CURRENT_YEAR}-04-01`, to: () => `${CURRENT_YEAR}-06-30` },
  { label: 'Q3',           from: () => `${CURRENT_YEAR}-07-01`, to: () => `${CURRENT_YEAR}-09-30` },
  { label: 'Q4',           from: () => `${CURRENT_YEAR}-10-01`, to: () => `${CURRENT_YEAR}-12-31` },
  { label: 'Full Year',    from: () => `${CURRENT_YEAR}-01-01`, to: () => `${CURRENT_YEAR}-12-31` },
];

function PlTab({ apiFetch, role }) {
  const thisMonth = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; })();
  const today     = new Date().toISOString().split('T')[0];

  const [from,     setFrom]    = useState(thisMonth);
  const [to,       setTo]      = useState(today);
  const [data,     setData]    = useState(null);
  const [loading,  setLoading] = useState(false);
  const [error,    setError]   = useState('');
  const [exporting,setExporting]=useState(false);
  const [view,     setView]    = useState('summary'); // summary | revenue | costs

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true); setError('');
    try {
      const res = await apiFetch(`/api/finance/pl?from=${from}&to=${to}`);
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed to load P&L'); }
      const d = await res.json();
      setData(d);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [apiFetch, from, to]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await apiFetch(`/api/finance/pl/pdf?from=${from}&to=${to}`);
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Export failed'); }
      const isCsv = res.headers.get('X-Pdf-Fallback') === 'true' || (res.headers.get('content-type')||'').includes('text/csv');
      const blob  = await res.blob();
      const url   = URL.createObjectURL(blob);
      const a     = document.createElement('a');
      a.href      = url;
      a.download  = isCsv ? `pl_${from}_to_${to}.csv` : `pl_${from}_to_${to}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      if (isCsv) setError('PDF requires pdfmake v0.2.x — exported as CSV instead. Fix: npm install pdfmake@0.2.x --legacy-peer-deps');
    } catch (e) { setError(e.message); } finally { setExporting(false); }
  };

  const s = data?.summary;
  const fmtN = (n) => `₦${Number(n||0).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const fmtP = (n) => `${Number(n||0).toFixed(1)}%`;
  const profitColor = (n) => n >= 0 ? 'var(--green)' : 'var(--red)';

  return (
    <div>
      {/* Period selector */}
      <div className="card" style={{ marginBottom: 20, padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="label">From</label>
            <input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ padding: '7px 12px', fontSize: 13 }} />
          </div>
          <div>
            <label className="label">To</label>
            <input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} style={{ padding: '7px 12px', fontSize: 13 }} />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PRESET_PERIODS.map(p => (
              <button key={p.label} className="btn btn-ghost"
                onClick={() => { setFrom(p.from()); setTo(p.to()); }}
                style={{ fontSize: 12, padding: '6px 12px' }}>
                {p.label}
              </button>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn btn-outline" onClick={load} disabled={loading} style={{ fontSize: 13 }}>
              {loading ? '⏳ Loading…' : '↻ Refresh'}
            </button>
            <button className="btn btn-primary" onClick={handleExport} disabled={exporting || !data} style={{ fontSize: 13 }}>
              {exporting ? 'Exporting…' : '⬇ Export PDF'}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-red animate-in" style={{ marginBottom: 16 }}>⚠ {error} <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: 8, fontWeight: 700 }}>×</button></div>}

      {loading && (
        <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>Computing P&L…
        </div>
      )}

      {!loading && data && (
        <>
          {/* KPI strip */}
          <div className="grid-kpi" style={{ marginBottom: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <PlKpiCard label="Revenue"      value={fmtN(s.totalRevenue)}   color="var(--purple)" />
            <PlKpiCard label="COGS"         value={fmtN(s.totalCOGS)}      color="var(--amber)"  />
            <PlKpiCard label="Operating Exp" value={fmtN(s.totalOpEx)}     color="#f97316"       />
            <PlKpiCard label="Gross Profit" value={fmtN(s.grossProfit)}    sub={`Margin: ${fmtP(s.grossMarginPct)}`} color={profitColor(s.grossProfit)} />
            <PlKpiCard label="Net Profit"   value={fmtN(s.netProfit)}      sub={`Margin: ${fmtP(s.netMarginPct)}`}  color={profitColor(s.netProfit)} />
          </div>

          {/* P&L Statement + Chart */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            {/* Income statement */}
            <div className="card" style={{ padding: '18px 20px' }}>
              <p style={{ fontFamily: 'Poppins, sans-serif', fontSize: 14, fontWeight: 700, marginBottom: 16, color: 'var(--text-primary)' }}>Income Statement</p>
              {[
                { label: 'Revenue',           value: fmtN(s.totalRevenue),  indent: 0, bold: false, color: 'var(--purple)' },
                { label: 'Cost of Goods Sold', value: `(${fmtN(s.totalCOGS)})`, indent: 0, bold: false, color: 'var(--amber)' },
                { label: 'Gross Profit',      value: fmtN(s.grossProfit),   indent: 0, bold: true,  color: profitColor(s.grossProfit), border: true },
                { label: `  Gross Margin`,    value: fmtP(s.grossMarginPct),indent: 1, bold: false, color: 'var(--text-muted)' },
                { label: 'Operating Expenses',value: `(${fmtN(s.totalOpEx)})`, indent: 0, bold: false, color: '#f97316' },
                { label: 'Net Profit / (Loss)',value: fmtN(s.netProfit),    indent: 0, bold: true,  color: profitColor(s.netProfit), border: true },
                { label: `  Net Margin`,      value: fmtP(s.netMarginPct),  indent: 1, bold: false, color: 'var(--text-muted)' },
              ].map((row, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: `${row.border ? '10px' : '6px'} 0`, borderTop: row.border ? '2px solid var(--border)' : undefined, marginTop: row.border ? 4 : 0 }}>
                  <span style={{ fontSize: row.bold ? 14 : 13, fontWeight: row.bold ? 700 : 400, paddingLeft: row.indent * 16, color: 'var(--text-secondary)' }}>{row.label}</span>
                  <span style={{ fontFamily: 'Poppins, sans-serif', fontSize: row.bold ? 15 : 13, fontWeight: row.bold ? 700 : 600, color: row.color }}>{row.value}</span>
                </div>
              ))}
            </div>

            {/* Monthly chart */}
            <div className="card" style={{ padding: '18px 20px' }}>
              <p style={{ fontFamily: 'Poppins, sans-serif', fontSize: 14, fontWeight: 700, marginBottom: 12, color: 'var(--text-primary)' }}>Revenue vs Costs</p>
              {data.timeline && data.timeline.length > 0
                ? <BarChart data={data.timeline} />
                : <p style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>No timeline data for this period.</p>
              }
            </div>
          </div>

          {/* Sub-nav */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
            {[['summary','📋 Cost Breakdown'],['revenue','📤 Revenue Detail'],['costs','📥 Cost Detail']].map(([key, label]) => (
              <button key={key} onClick={() => setView(key)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 16px', fontSize: 13, fontFamily: 'Nunito, sans-serif', fontWeight: 700,
                  color: view === key ? 'var(--purple)' : 'var(--text-muted)',
                  borderBottom: view === key ? '2px solid var(--purple)' : '2px solid transparent', marginBottom: -1 }}>
                {label}
              </button>
            ))}
          </div>

          {/* Cost breakdown table */}
          {view === 'summary' && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {data.costsByCategory.length === 0
                ? <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No costs recorded in this period.</div>
                : (
                  <table className="table">
                    <thead><tr><th>Category</th><th>Supplier Type</th><th>Type</th><th style={{ textAlign: 'right' }}>Invoices</th><th style={{ textAlign: 'right' }}>Total (NGN)</th><th style={{ textAlign: 'right' }}>% of Costs</th></tr></thead>
                    <tbody>
                      {data.costsByCategory.map((c, i) => {
                        const pct = s.totalCosts > 0 ? ((c.totalNGN / s.totalCosts) * 100).toFixed(1) : '0';
                        return (
                          <tr key={i}>
                            <td style={{ fontWeight: 700 }}>{c.category}</td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.supplierType}</td>
                            <td><span className={`status-badge ${c.isCOGS ? 'status-amber' : 'status-blue'}`}>{c.isCOGS ? 'COGS' : 'OpEx'}</span></td>
                            <td style={{ textAlign: 'right', fontSize: 13 }}>{c.count}</td>
                            <td style={{ textAlign: 'right', fontFamily: 'Poppins, sans-serif', fontSize: 13, fontWeight: 700 }}>{fmtN(c.totalNGN)}</td>
                            <td style={{ textAlign: 'right' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                                <div style={{ width: 60, height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                                  <div style={{ width: `${pct}%`, height: '100%', background: c.isCOGS ? 'var(--amber)' : 'var(--purple)', borderRadius: 3 }} />
                                </div>
                                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', minWidth: 36 }}>{pct}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--bg-elevated)' }}>
                        <td colSpan={4} style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-secondary)' }}>Total Costs</td>
                        <td style={{ textAlign: 'right', fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{fmtN(s.totalCosts)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 13 }}>100%</td>
                      </tr>
                    </tfoot>
                  </table>
                )
              }
            </div>
          )}

          {/* Revenue detail */}
          {view === 'revenue' && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {data.revenue.length === 0
                ? <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No paid sales invoices in this period.</div>
                : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="table">
                      <thead><tr><th>Invoice #</th><th>Customer</th><th>Type</th><th>Date</th><th>CCY</th><th style={{ textAlign: 'right' }}>Amount (NGN)</th><th>Status</th></tr></thead>
                      <tbody>
                        {data.revenue.map((inv, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 700, color: 'var(--purple)' }}>{inv.invoiceNumber}</td>
                            <td>{inv.customer}</td>
                            <td><span className="status-badge status-blue">{inv.customerType}</span></td>
                            <td>{new Date(inv.invoiceDate).toLocaleDateString('en-NG', { day:'2-digit', month:'short', year:'numeric' })}</td>
                            <td><span style={{ fontSize: 11, fontWeight: 700, background: 'var(--purple-light)', color: 'var(--purple)', border: '1px solid #d4d8ff', borderRadius: 12, padding: '2px 8px' }}>{inv.currency}</span></td>
                            <td style={{ textAlign: 'right', fontFamily: 'Poppins, sans-serif', fontWeight: 700, color: 'var(--green)' }}>{fmtN(inv.amountNGN)}</td>
                            <td><StatusBadge status={inv.status} meta={AR_STATUS_META} /></td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: 'var(--bg-elevated)' }}>
                          <td colSpan={5} style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-secondary)' }}>Total Revenue</td>
                          <td style={{ textAlign: 'right', fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 14, color: 'var(--purple)' }}>{fmtN(s.totalRevenue)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )
              }
            </div>
          )}

          {/* Cost detail */}
          {view === 'costs' && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {data.costs.length === 0
                ? <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No paid supplier invoices in this period.</div>
                : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="table">
                      <thead><tr><th>Invoice #</th><th>Supplier</th><th>Category</th><th>Type</th><th>Date</th><th>CCY</th><th style={{ textAlign: 'right' }}>Amount (NGN)</th></tr></thead>
                      <tbody>
                        {data.costs.map((inv, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 700, color: 'var(--purple)' }}>{inv.invoiceNumber}</td>
                            <td>{inv.supplier}</td>
                            <td style={{ fontSize: 12 }}>{inv.category}</td>
                            <td><span className={`status-badge ${inv.isCOGS ? 'status-amber' : 'status-blue'}`}>{inv.isCOGS ? 'COGS' : 'OpEx'}</span></td>
                            <td>{new Date(inv.invoiceDate).toLocaleDateString('en-NG', { day:'2-digit', month:'short', year:'numeric' })}</td>
                            <td><span style={{ fontSize: 11, fontWeight: 700, background: 'var(--purple-light)', color: 'var(--purple)', border: '1px solid #d4d8ff', borderRadius: 12, padding: '2px 8px' }}>{inv.currency}</span></td>
                            <td style={{ textAlign: 'right', fontFamily: 'Poppins, sans-serif', fontWeight: 700, color: 'var(--amber)' }}>{fmtN(inv.amountNGN)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: 'var(--bg-elevated)' }}>
                          <td colSpan={6} style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-secondary)' }}>Total Costs</td>
                          <td style={{ textAlign: 'right', fontFamily: 'Poppins, sans-serif', fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{fmtN(s.totalCosts)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )
              }
            </div>
          )}
        </>
      )}

      {!loading && !data && !error && (
        <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📊</div>
          <p style={{ fontWeight: 700, marginBottom: 4 }}>Select a period to generate P&L</p>
          <p style={{ fontSize: 13 }}>Choose a date range above and click Refresh.</p>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FINANCE PAGE
// ══════════════════════════════════════════════════════════════════════════════

const TABS = [
  { key: 'ap',    label: '📥 Accounts Payable'   },
  { key: 'ar',    label: '📤 Accounts Receivable' },
  { key: 'pl',    label: '📊 P&L Report'          },
  { key: 'recon', label: '🏦 Reconciliation'       },
];

export default function FinancePage() {
  const { user, apiFetch } = useAuth();
  const [activeTab, setActiveTab] = useState('ap');

  if (!user) return null;

  const role    = user.role;
  const canView = FINANCE_VIEW_ROLES.includes(role);

  if (!canView) {
    return (
      <AppShell>
        <div style={{ padding: '80px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <h3 style={{ fontFamily: 'Poppins, sans-serif', fontSize: 18, color: 'var(--text-primary)', marginBottom: 8 }}>Access Restricted</h3>
          <p>You don't have permission to access the Finance module.</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={{ padding: '24px 28px', maxWidth: 1300, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: 'Poppins, sans-serif', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Finance</h1>
          <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            Manage supplier invoices, sales invoices, P&L reporting and bank reconciliation.
            {!FINANCE_ROLES.includes(role) && <span style={{ marginLeft: 10, background: 'var(--amber-bg)', color: '#d97706', border: '1px solid var(--amber-border)', borderRadius: 12, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>READ ONLY</span>}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 2, borderBottom: '2px solid var(--border)', marginBottom: 24, overflowX: 'auto' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 20px', fontSize: 13, fontFamily: 'Nunito, sans-serif', fontWeight: 700, color: activeTab === t.key ? 'var(--purple)' : 'var(--text-muted)', borderBottom: activeTab === t.key ? '2px solid var(--purple)' : '2px solid transparent', marginBottom: -2, whiteSpace: 'nowrap', transition: 'color 0.15s' }}>
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'ap'    && <ApTab apiFetch={apiFetch} role={role} />}
        {activeTab === 'ar'    && <ArTab apiFetch={apiFetch} role={role} />}
        {activeTab === 'pl'    && <PlTab apiFetch={apiFetch} role={role} />}
        {activeTab === 'recon' && <ReconTab apiFetch={apiFetch} role={role} />}
      </div>
    </AppShell>
  );
}
