// app/api/finance/reconciliation/csv/route.js
// POST — parse a CSV bank statement and bulk-insert BankTransaction rows
// Expected CSV columns (flexible order, header row required):
//   date | description | reference | amount | currency | bank_account
//   Aliases accepted: txDate/tx_date, debit/credit (split columns), account/bankaccount

import { NextResponse } from 'next/server';
import { prisma }       from '@/lib/db/prisma';
import { verifyToken }  from '@/lib/middleware/auth';

const RECONCILIATION_ROLES = ['SUPER_ADMIN','FARM_ADMIN','ACCOUNTANT'];
const VALID_CURRENCIES     = new Set(['NGN','USD','EUR','GBP','GHS','KES','ZAR']);

// ── CSV parser (no external dep) ─────────────────────────────────────────────
function parseCSV(text) {
  const lines   = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');

  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim().toLowerCase());

  return lines.slice(1).map((line, idx) => {
    // Handle quoted fields containing commas
    const cols = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cols.push(cur.trim());

    const row = {};
    headers.forEach((h, i) => { row[h] = (cols[i] || '').replace(/^"|"$/g, '').trim(); });
    row._line = idx + 2;
    return row;
  });
}

function col(row, ...names) {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== '') return row[n];
  }
  return null;
}

function resolveAmount(row) {
  // Single amount column (positive=credit, negative=debit)
  const amt = col(row, 'amount', 'amt');
  if (amt !== null) {
    const n = parseFloat(amt.replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }
  // Split credit/debit columns
  const credit = parseFloat((col(row, 'credit', 'credits', 'money_in') || '0').replace(/,/g, ''));
  const debit  = parseFloat((col(row, 'debit',  'debits',  'money_out') || '0').replace(/,/g, ''));
  if (!isNaN(credit) || !isNaN(debit)) {
    return (isNaN(credit) ? 0 : credit) - (isNaN(debit) ? 0 : debit);
  }
  return null;
}

// POST /api/finance/reconciliation/csv
export async function POST(request) {
  const user = await verifyToken(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!RECONCILIATION_ROLES.includes(user.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const formData = await request.formData();
    const file     = formData.get('file');
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const text = await file.text();
    let rows;
    try {
      rows = parseCSV(text);
    } catch (e) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }

    const errors   = [];
    const toInsert = [];

    for (const row of rows) {
      const dateStr = col(row, 'date', 'txdate', 'tx_date', 'transaction_date', 'value_date', 'posting_date');
      const desc    = col(row, 'description', 'narration', 'particulars', 'remarks', 'details');
      const ref     = col(row, 'reference', 'ref', 'cheque_no', 'transaction_id', 'id');
      const curr    = (col(row, 'currency', 'ccy') || 'NGN').toUpperCase();
      const account = col(row, 'bank_account', 'bankaccount', 'account', 'account_name', 'account_no');
      const amount  = resolveAmount(row);

      if (!dateStr) { errors.push(`Line ${row._line}: missing date`);        continue; }
      if (!desc)    { errors.push(`Line ${row._line}: missing description`); continue; }
      if (amount === null) { errors.push(`Line ${row._line}: missing/invalid amount`); continue; }

      const txDate = new Date(dateStr);
      if (isNaN(txDate.getTime())) { errors.push(`Line ${row._line}: invalid date "${dateStr}"`); continue; }

      const currency = VALID_CURRENCIES.has(curr) ? curr : 'NGN';

      toInsert.push({
        tenantId:    user.tenantId,
        txDate,
        description: desc,
        reference:   ref   || null,
        amount,
        currency,
        bankAccount: account || null,
        source:      'CSV',
        createdById: user.id,
      });
    }

    if (toInsert.length === 0) {
      return NextResponse.json({
        imported: 0,
        skipped: rows.length,
        errors,
        message: 'No valid rows to import',
      }, { status: 400 });
    }

    // Deduplicate: skip rows where (tenantId + txDate + reference + amount) already exist
    let imported = 0;
    let dupes    = 0;
    for (const row of toInsert) {
      if (row.reference) {
        const exists = await prisma.bankTransaction.findFirst({
          where: {
            tenantId:  row.tenantId,
            reference: row.reference,
            amount:    row.amount,
            txDate:    row.txDate,
          },
        });
        if (exists) { dupes++; continue; }
      }
      await prisma.bankTransaction.create({ data: row });
      imported++;
    }

    await prisma.auditLog.create({
      data: {
        tenantId:   user.tenantId,
        userId:     user.id,
        action:     'CREATE',
        entityType: 'BankTransaction',
        entityId:   'csv-import',
        changes:    { imported, dupes, skippedErrors: errors.length, filename: file.name || 'unknown' },
      },
    });

    return NextResponse.json({
      imported,
      dupes,
      skipped: errors.length,
      errors: errors.slice(0, 20),   // cap at 20 to keep response small
      message: `Imported ${imported} transaction${imported !== 1 ? 's' : ''}${dupes ? `, skipped ${dupes} duplicate${dupes !== 1 ? 's' : ''}` : ''}${errors.length ? `, ${errors.length} row${errors.length !== 1 ? 's' : ''} had errors` : ''}.`,
    });
  } catch (err) {
    console.error('[RECON CSV]', err);
    return NextResponse.json({ error: 'Failed to import CSV' }, { status: 500 });
  }
}
