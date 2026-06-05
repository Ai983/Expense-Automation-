// web-dashboard/src/components/POPaymentsTab.jsx
// Finance Dashboard: PO Payments tab — full PO detail, partial payments, balance tracking, comparison sheet
import { useState, useEffect } from 'react';
import api from '../services/api';

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StatusBadge({ status }) {
  const map = {
    pending_payment: 'bg-amber-100 text-amber-700',
    partially_paid: 'bg-blue-100 text-blue-700',
    paid: 'bg-green-100 text-green-700',
    payment_rejected: 'bg-red-100 text-red-700',
  };
  const labels = {
    pending_payment: 'Awaiting Payment',
    partially_paid: 'Partially Paid',
    paid: 'Paid',
    payment_rejected: 'Rejected',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {labels[status] || status}
    </span>
  );
}

export default function POPaymentsTab() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [payModal, setPayModal] = useState(null);
  const [adjustModal, setAdjustModal] = useState(null);
  const [comparisonData, setComparisonData] = useState({});
  // SPEC-PAY-01 Gate-2: authorized installment payables (paid against a CPS authorization)
  const [payables, setPayables] = useState([]);
  const [payAuthModal, setPayAuthModal] = useState(null);

  useEffect(() => { loadQueue(); loadPayables(); }, []);

  async function loadPayables() {
    try {
      const { data } = await api.get('/api/po-payments/authorized-payables');
      setPayables(data?.data || []);
    } catch {
      setPayables([]);
    }
  }

  async function handlePayAuth(payable, paidAmount, notes, receiptFile) {
    const form = new FormData();
    form.append('auth_number', payable.auth_number);
    form.append('paid_amount', paidAmount);
    if (notes) form.append('notes', notes);
    if (receiptFile) form.append('receipt', receiptFile);
    await api.post('/api/po-payments/pay-authorization', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    await Promise.all([loadPayables(), loadQueue()]);
    setPayAuthModal(null);
  }

  async function loadQueue() {
    setLoading(true);
    try {
      const { data } = await api.get('/api/po-payments/finance-queue');
      setQueue(data?.data || []);
    } catch {
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadComparison(poId) {
    if (comparisonData[poId]) return; // already loaded
    try {
      const { data } = await api.get(`/api/po-payments/${poId}/comparison`);
      const payload = data?.data || {};
      setComparisonData(prev => ({ ...prev, [poId]: payload }));
    } catch {
      setComparisonData(prev => ({ ...prev, [poId]: { has_comparison: false } }));
    }
  }

  function toggleExpand(poId) {
    if (expandedId === poId) {
      setExpandedId(null);
    } else {
      setExpandedId(poId);
      loadComparison(poId);
    }
  }

  async function handlePay(po, paidAmount, notes, receiptFile) {
    const form = new FormData();
    form.append('paid_amount', paidAmount);
    if (notes) form.append('notes', notes);
    if (receiptFile) form.append('receipt', receiptFile);

    await api.post(`/api/po-payments/${po.id}/pay`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    await loadQueue();
    setPayModal(null);
  }

  async function handleAdjust(po, adjustedAmount, notes) {
    await api.patch(`/api/po-payments/${po.id}/adjust-amount`, { adjusted_amount: adjustedAmount, notes });
    await loadQueue();
    setAdjustModal(null);
  }

  function downloadComparisonSheet(po, compData) {
    const { comparison, quotes, line_comparison: lc } = compData;
    const ai = comparison?.ai || null;
    const sortedQuotes = [...(quotes || [])].sort((a, b) => Number(a.landed_total || 0) - Number(b.landed_total || 0));
    const selectedQuote = quotes?.find(q => q.is_selected);
    const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const fmtN = n => n != null && n !== '' ? `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—';
    const esc = s => (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // ── SECTION 1: Supplier bid totals table ──────────────────────────────
    const totalsSource = lc?.supplier_totals?.length > 0 ? lc.supplier_totals : null;
    const bidRowsHtml = totalsSource
      ? totalsSource.map((t, idx) => `
          <tr style="${t.is_winner ? 'background:#e8f5e9;font-weight:600;' : idx === 0 ? 'background:#e3f2fd;' : ''}">
            <td>${esc(t.supplier_name)}${t.is_winner ? ' <span style="color:#2e7d32">✓ PO Issued</span>' : t.rank === 1 ? ' <span style="color:#1565c0">L1</span>' : ''}</td>
            <td style="text-align:right">${fmtN(t.subtotal)}</td>
            <td style="text-align:right">${fmtN(t.gst_amount)}</td>
            <td style="text-align:right">${fmtN(t.freight_amount)}</td>
            <td style="text-align:right;font-weight:700">${fmtN(t.landed_total)}</td>
            <td>${esc(t.payment_terms) || '—'}</td>
            <td>${esc(t.delivery_terms) || '—'}</td>
            <td style="text-align:center">${t.compliance_status === 'compliant' ? '<span style="color:#2e7d32">✓</span>' : '—'}</td>
          </tr>`)
          .join('')
      : sortedQuotes.map((q, idx) => `
          <tr style="${q.is_selected ? 'background:#e8f5e9;font-weight:600;' : idx === 0 && !q.is_selected ? 'background:#e3f2fd;' : ''}">
            <td>${esc(q.supplier?.name || '—')}${q.is_selected ? ' <span style="color:#2e7d32">✓ PO Issued</span>' : !q.is_selected && idx === 0 ? ' <span style="color:#1565c0">L1</span>' : ''}</td>
            <td style="text-align:right">—</td>
            <td style="text-align:right">—</td>
            <td style="text-align:right">—</td>
            <td style="text-align:right;font-weight:700">${fmtN(q.landed_total)}</td>
            <td>${esc(q.payment_terms) || '—'}</td>
            <td>${esc(q.delivery_terms) || '—'}</td>
            <td style="text-align:center">${q.compliance === 'compliant' ? '<span style="color:#2e7d32">✓</span>' : '—'}</td>
          </tr>`)
          .join('');

    // ── SECTION 2: Cross-vendor line comparison table (snapshot-based) ───
    let crossVendorHtml = '';
    if (lc?.rows?.length > 0) {
      const suppliers = lc.suppliers || [];
      const supHeaders = suppliers.map(s => `<th style="text-align:right">${esc(s)}</th>`).join('');

      const dataRows = lc.rows.map(row => {
        const supCells = suppliers.map(s => {
          const sr = row.supplier_rates?.[s];
          if (!sr) return `<td style="text-align:right;color:#aaa">—</td>`;
          const style = sr.is_winner ? 'background:#e8f5e9;font-weight:700;' : sr.is_lowest ? 'background:#e3f2fd;font-weight:700;' : '';
          const badge = sr.is_winner ? ' ✓' : sr.is_lowest ? ' L1' : '';
          return `<td style="text-align:right;${style}">${fmtN(sr.landed_rate)}${badge}${sr.brand ? `<br><span style="font-size:7pt;color:#666">${esc(sr.brand)}</span>` : ''}</td>`;
        }).join('');

        const lastPurchCell = row.last_purchase_rate
          ? `${fmtN(row.last_purchase_rate)}/${esc(row.last_purchase_unit || '')}${row.last_purchase_supplier ? `<br><span style="font-size:7pt;color:#666">${esc(row.last_purchase_supplier)}</span>` : ''}${row.last_purchase_date ? `<br><span style="font-size:7pt;color:#888">${row.last_purchase_date}</span>` : ''}`
          : '—';

        const mkt1 = row.market_1;
        const mkt2 = row.market_2;
        const mkt1Cell = mkt1 ? `${fmtN(mkt1.rate_numeric)}/${esc(mkt1.unit || '')}<br><span style="font-size:7pt;color:#666">${esc(mkt1.name || '')}</span>` : '—';
        const mkt2Cell = mkt2 ? `${fmtN(mkt2.rate_numeric)}/${esc(mkt2.unit || '')}<br><span style="font-size:7pt;color:#666">${esc(mkt2.name || '')}</span>` : '—';

        return `
          <tr>
            <td>${esc(row.description)}</td>
            <td style="text-align:center">${esc(row.unit)}</td>
            <td style="text-align:right">${row.qty ?? '—'}</td>
            <td style="text-align:right;color:#795548">${lastPurchCell}</td>
            ${supCells}
            <td style="text-align:right;background:#e3f2fd">${mkt1Cell}</td>
            <td style="text-align:right;background:#e8f5e9">${mkt2Cell}</td>
          </tr>`;
      }).join('');

      // Totals row
      const totalCells = suppliers.map(s => {
        const t = lc.supplier_totals?.find(st => st.supplier_name === s);
        const style = t?.is_winner ? 'background:#e8f5e9;font-weight:700;' : t?.rank === 1 ? 'background:#e3f2fd;font-weight:700;' : 'font-weight:700;';
        return `<td style="text-align:right;${style}">${t ? fmtN(t.landed_total) : '—'}</td>`;
      }).join('');

      crossVendorHtml = `
        <div style="margin-top:16px">
          <p style="font-size:11pt;font-weight:700;border-bottom:2px solid #1a237e;padding-bottom:4px;color:#1a237e">Item-Level Rate Comparison</p>
          <p style="font-size:7.5pt;color:#666;margin:2px 0 6px">Rates shown are Landed/Unit (base rate + GST + freight). L1 = Lowest quote. ✓ = PO awarded.</p>
          <div style="overflow-x:auto">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th style="text-align:center">Unit</th>
                <th style="text-align:right">Qty</th>
                <th style="text-align:right;background:#fff3e0">Last Purch Rate</th>
                ${supHeaders}
                <th style="text-align:right;background:#e3f2fd">Market 1 (Lowest)</th>
                <th style="text-align:right;background:#e8f5e9">Market 2</th>
              </tr>
            </thead>
            <tbody>${dataRows}</tbody>
            <tfoot>
              <tr style="background:#f5f5f5">
                <td colspan="3" style="font-weight:700;text-align:right">Grand Total (Landed)</td>
                <td>—</td>
                ${totalCells}
                <td>—</td><td>—</td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>`;
    }

    // ── SECTION 3: Fallback line items per vendor (for older POs without snapshots) ──
    let lineItemSections = '';
    if (!lc && sortedQuotes.some(q => q.line_items?.length > 0)) {
      lineItemSections = sortedQuotes.filter(q => q.line_items?.length > 0).map(q => {
        const hasListRate = q.line_items.some(li => li.list_rate != null);
        const hasDiscount = q.line_items.some(li => li.discount_pct != null);
        const rows = q.line_items.map(li => `
          <tr>
            <td>${esc(li.description)}</td>
            <td>${esc(li.brand) || '—'}</td>
            <td style="text-align:right">${li.qty ?? '—'}</td>
            <td style="text-align:center">${esc(li.unit) || '—'}</td>
            <td style="text-align:right">${li.rate != null ? fmtN(li.rate) : '—'}</td>
            ${hasListRate ? `<td style="text-align:right">${li.list_rate != null ? fmtN(li.list_rate) : '—'}</td>` : ''}
            ${hasDiscount ? `<td style="text-align:right">${li.discount_pct != null ? `${li.discount_pct}%` : '—'}</td>` : ''}
            <td style="text-align:right">${li.gst != null ? `${li.gst}%` : '—'}</td>
            <td style="text-align:right">${fmtN(li.landed_rate)}</td>
            <td style="text-align:right">${li.line_total != null ? fmtN(li.line_total) : '—'}</td>
          </tr>`).join('');
        return `
          <div style="margin-top:12px">
            <p style="font-size:10pt;font-weight:700;margin:0 0 4px;color:#1a237e">${esc(q.supplier?.name || 'Vendor')} ${q.is_selected ? '<span style="color:#2e7d32">(Selected ✓)</span>' : ''}</p>
            <table>
              <thead><tr>
                <th>Description</th><th>Brand</th><th style="text-align:right">Qty</th><th>Unit</th>
                <th style="text-align:right">Rate</th>
                ${hasListRate ? '<th style="text-align:right">List Rate</th>' : ''}
                ${hasDiscount ? '<th style="text-align:right">Disc%</th>' : ''}
                <th style="text-align:right">GST%</th>
                <th style="text-align:right">Landed/Unit</th>
                <th style="text-align:right">Line Total</th>
              </tr></thead>
              <tbody>${rows}</tbody>
              <tfoot><tr style="background:#f5f5f5;font-weight:700">
                <td colspan="${5 + (hasListRate ? 1 : 0) + (hasDiscount ? 1 : 0) + 2}" style="text-align:right">Total Landed</td>
                <td style="text-align:right">${fmtN(q.landed_total)}</td>
              </tr></tfoot>
            </table>
          </div>`;
      }).join('');
      lineItemSections = `<div style="margin-top:16px"><p style="font-size:11pt;font-weight:700;border-bottom:2px solid #1a237e;padding-bottom:4px;color:#1a237e">Detailed Line Items by Vendor</p>${lineItemSections}</div>`;
    }

    // ── SECTION 4: AI warnings + next steps ──────────────────────────────
    const warningsHtml = ai?.warnings?.length > 0 ? `
      <div style="margin-top:14px;background:#fff8e1;border:1px solid #ffc107;border-radius:4px;padding:10px">
        <p style="font-size:10pt;font-weight:700;color:#e65100;margin:0 0 6px">Warnings</p>
        ${ai.warnings.map(w => `<p style="font-size:8pt;margin:2px 0;color:#bf360c">• ${esc(w)}</p>`).join('')}
      </div>` : '';

    const nextStepsHtml = ai?.next_steps_for_procurement?.length > 0 ? `
      <div style="margin-top:14px;background:#e8eaf6;border:1px solid #9fa8da;border-radius:4px;padding:10px">
        <p style="font-size:10pt;font-weight:700;color:#1a237e;margin:0 0 6px">Recommended Next Steps</p>
        ${ai.next_steps_for_procurement.map(s => `<p style="font-size:8pt;margin:2px 0;color:#283593">• ${esc(s)}</p>`).join('')}
      </div>` : '';

    // ── Full document ─────────────────────────────────────────────────────
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <title>Comparison Sheet — ${esc(po.cps_po_ref)}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:9pt;margin:0;color:#212121}
        .page{padding:12mm 10mm}
        .hdr{background:#1a237e;color:#fff;padding:10px 14px}
        .hdr h1{margin:0;font-size:13pt;letter-spacing:.5px}
        .hdr p{margin:2px 0;font-size:8.5pt;opacity:.9}
        table{width:100%;border-collapse:collapse;margin:4px 0;font-size:7.5pt}
        th{background:#e8eaf6;padding:4px 5px;text-align:left;border:1px solid #c5cae9;font-weight:700}
        td{padding:3px 5px;border:1px solid #e0e0e0;vertical-align:top}
        .rec-box{background:#e8f5e9;border:1px solid #66bb6a;border-radius:4px;padding:8px;margin-top:12px}
        .rec-box h3{margin:0 0 4px;color:#1b5e20;font-size:9.5pt}
        .rec-box p{margin:3px 0;font-size:8pt;color:#2e7d32}
        .footer{margin-top:16px;border-top:1px solid #e0e0e0;padding-top:6px;font-size:7pt;color:#9e9e9e;text-align:center}
        @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{margin:8mm;size:A4 landscape}}
      </style>
    </head><body><div class="page">
      <div class="hdr">
        <h1>VENDOR COMPARISON SHEET</h1>
        <p><strong>PO:</strong> ${esc(po.cps_po_ref)} &nbsp;|&nbsp; <strong>Project:</strong> ${esc(po.project_name || po.site)} &nbsp;|&nbsp; <strong>Site:</strong> ${esc(po.site)} &nbsp;|&nbsp; <strong>Date:</strong> ${dateStr}</p>
        <p><strong>Selected Supplier:</strong> ${esc(selectedQuote?.supplier?.name || po.supplier_name)} &nbsp;|&nbsp; <strong>PO Value:</strong> ${fmtN(po.total_amount)} &nbsp;|&nbsp; <strong>Quotes:</strong> ${comparison.total_quotes} received, ${comparison.compliant_quotes} compliant</p>
      </div>

      <div style="margin-top:12px">
        <p style="font-size:10pt;font-weight:700;border-bottom:2px solid #1a237e;padding-bottom:3px;color:#1a237e;margin:0 0 5px">Supplier Bid Summary</p>
        <table>
          <thead><tr>
            <th>Vendor</th>
            <th style="text-align:right">Subtotal</th>
            <th style="text-align:right">GST</th>
            <th style="text-align:right">Freight</th>
            <th style="text-align:right">Landed Total</th>
            <th>Payment Terms</th>
            <th>Delivery</th>
            <th style="text-align:center">Compliant</th>
          </tr></thead>
          <tbody>${bidRowsHtml}</tbody>
        </table>
        ${comparison.potential_savings > 0 ? `<p style="font-size:7.5pt;color:#2e7d32;margin:3px 0">Savings vs next best: ${fmtN(comparison.potential_savings)}</p>` : ''}
      </div>

      ${ai?.recommended_supplier ? `
      <div class="rec-box">
        <h3>AI Recommendation: ${esc(ai.recommended_supplier)}</h3>
        <p>${esc(ai.reason || '')}</p>
        ${ai.executive_summary ? `<p style="margin-top:5px;color:#37474f;border-top:1px solid #a5d6a7;padding-top:5px;font-size:7.5pt">${esc(ai.executive_summary)}</p>` : ''}
      </div>` : ''}

      ${warningsHtml}

      ${crossVendorHtml}

      ${lineItemSections}

      ${nextStepsHtml}

      ${comparison.manual_notes ? `
      <div style="margin-top:12px;background:#e3f2fd;border:1px solid #90caf9;border-radius:4px;padding:8px">
        <p style="font-size:9.5pt;font-weight:700;color:#0d47a1;margin:0 0 3px">Procurement Head Notes</p>
        <p style="font-size:8pt;color:#1565c0">${esc(comparison.manual_notes)}</p>
      </div>` : ''}

      <div class="footer">
        Generated by Hagerstone Finance System &nbsp;|&nbsp; ${dateStr} &nbsp;|&nbsp; ${esc(po.cps_po_ref)}
        ${ai?.disclaimer ? `<br>${esc(ai.disclaimer)}` : ''}
      </div>
    </div></body></html>`;

    const win = window.open('', '_blank');
    if (!win) { alert('Pop-up blocked — please allow pop-ups for this site.'); return; }
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 600);
  }

  // Authoritative amount for a PO: finance_adjusted > procurement_approved > total
  function getAuthoritativeAmount(po) {
    return parseFloat(po.finance_adjusted_amount || po.procurement_approved_amount || po.total_amount || 0);
  }

  function getRemainingBalance(po) {
    return Math.max(0, getAuthoritativeAmount(po) - parseFloat(po.paid_amount || 0));
  }

  const pending = queue.filter(p => ['pending_payment', 'partially_paid'].includes(p.status));
  const paid = queue.filter(p => p.status === 'paid');
  const superseded = queue.filter(p => p.status === 'superseded');
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Awaiting / Partial</p>
          <p className="text-2xl font-semibold mt-1">{pending.length}</p>
          <p className="text-sm text-gray-500">
            {fmt(pending.reduce((s, p) => s + getRemainingBalance(p), 0))} remaining
          </p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Paid This Month</p>
          <p className="text-2xl font-semibold mt-1">
            {paid.filter(p => new Date(p.paid_at) > thirtyDaysAgo).length}
          </p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total Paid (all time)</p>
          <p className="text-2xl font-semibold mt-1">
            {fmt(paid.reduce((s, p) => s + Number(p.paid_amount || 0), 0))}
          </p>
        </div>
      </div>

      {/* SPEC-PAY-01 — Authorized Payables (Gate-2 approved installments) */}
      {payables.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3">
            🔓 Authorized Payables ({payables.length}) <span className="font-normal text-gray-400">— founder ne release approve kiya</span>
          </h3>
          <div className="space-y-3">
            {payables.map(p => {
              const remaining = Number(p.authorized_amount) - Number(p.already_paid || 0);
              return (
                <div key={p.auth_number} className="bg-white rounded-xl border border-green-200 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium">{p.po_number}</span>
                        <span className="text-xs px-2 py-0.5 bg-green-100 text-green-800 rounded-full">{p.auth_number}</span>
                      </div>
                      <p className="text-sm font-medium text-gray-800 mt-1">{p.installment_name}{p.project_name ? ` · ${p.project_name}` : ''}</p>
                      <p className="text-sm text-gray-500">{p.supplier_name}</p>
                      {(p.bank_name || p.bank_account_number) && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {p.bank_name} {p.bank_account_number ? `••${String(p.bank_account_number).slice(-4)}` : ''} {p.bank_account_holder_name ? `(${p.bank_account_holder_name})` : ''}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-gray-400">Authorized</p>
                      <p className="text-lg font-semibold">{fmt(p.authorized_amount)}</p>
                      {Number(p.already_paid) > 0 && <p className="text-xs text-gray-500">Paid {fmt(p.already_paid)} · Bal {fmt(remaining)}</p>}
                      <div className="flex gap-2 mt-2 justify-end items-center">
                        {p.po_pdf_url && <a href={p.po_pdf_url} target="_blank" rel="noreferrer" className="text-xs text-gray-500 underline">PO PDF</a>}
                        <button onClick={() => setPayAuthModal({ payable: p, remaining })}
                          className="px-3 py-1.5 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700">
                          Pay
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pending / Partial section */}
      {pending.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3">Pending Payment ({pending.length})</h3>
          <div className="space-y-3">
            {pending.map(po => {
              const authAmt = getAuthoritativeAmount(po);
              const alreadyPaid = parseFloat(po.paid_amount || 0);
              const remaining = getRemainingBalance(po);
              const isExpanded = expandedId === po.id;
              const comp = comparisonData[po.id];

              return (
                <div key={po.id} className="bg-white rounded-xl border border-amber-100 overflow-hidden">
                  {/* Header row */}
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-medium">{po.cps_po_ref}</span>
                          <StatusBadge status={po.status} />
                          <span className="text-xs px-2 py-0.5 bg-gray-100 rounded-full text-gray-600">{po.site}</span>
                        </div>
                        <p className="text-sm font-medium text-gray-800 mt-1">{po.project_name}</p>
                        <p className="text-sm text-gray-500">{po.supplier_name}</p>
                        {po.supplier_gstin && (
                          <p className="text-xs text-gray-400 mt-0.5">GSTIN: {po.supplier_gstin}</p>
                        )}
                        {po.payment_terms_type && (
                          <p className="text-sm text-gray-500 mt-1">
                            Terms: <span className="font-medium">{po.payment_terms_type}</span>
                            {po.payment_due_date && ` · Due ${fmtDate(po.payment_due_date)}`}
                          </p>
                        )}
                        {po.procurement_notes && (
                          <p className="text-xs text-blue-600 mt-1 italic">
                            Procurement: "{po.procurement_notes}"
                          </p>
                        )}
                      </div>

                      {/* Amounts + actions */}
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        {/* Balance tracker */}
                        <div className="text-right space-y-0.5">
                          <div className="flex items-center gap-2 justify-end">
                            <span className="text-xs text-gray-400">PO Total:</span>
                            <span className="text-sm text-gray-600">{fmt(po.total_amount)}</span>
                          </div>
                          {po.finance_adjusted_amount && (
                            <div className="flex items-center gap-2 justify-end">
                              <span className="text-xs text-purple-500">Finance Adjusted:</span>
                              <span className="text-sm font-semibold text-purple-700">{fmt(po.finance_adjusted_amount)}</span>
                            </div>
                          )}
                          {alreadyPaid > 0 && (
                            <div className="flex items-center gap-2 justify-end">
                              <span className="text-xs text-green-500">Paid:</span>
                              <span className="text-sm text-green-700 font-medium">{fmt(alreadyPaid)}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2 justify-end border-t pt-1 mt-1">
                            <span className="text-xs text-gray-500">Balance Due:</span>
                            <span className="text-lg font-bold text-amber-700">{fmt(remaining)}</span>
                          </div>
                        </div>

                        {/* Progress bar */}
                        {alreadyPaid > 0 && authAmt > 0 && (
                          <div className="w-32">
                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-green-500 rounded-full"
                                style={{ width: `${Math.min(100, (alreadyPaid / authAmt) * 100).toFixed(1)}%` }}
                              />
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5 text-right">
                              {((alreadyPaid / authAmt) * 100).toFixed(0)}% settled
                            </p>
                          </div>
                        )}

                        <div className="flex gap-2">
                          <button
                            onClick={() => setAdjustModal({ po })}
                            className="px-3 py-1.5 border border-purple-300 text-purple-700 hover:bg-purple-50 text-xs rounded-lg font-medium"
                          >
                            Adjust Amount
                          </button>
                          <button
                            onClick={() => setPayModal({ po })}
                            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium"
                          >
                            {alreadyPaid > 0 ? 'Pay More' : 'Mark as Paid'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Expand toggle + PDF downloads */}
                    <div className="mt-3 flex items-center gap-3 flex-wrap">
                      <button
                        onClick={() => toggleExpand(po.id)}
                        className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                      >
                        {isExpanded ? '▲ Hide PO Details' : '▼ View Full PO Details'}
                      </button>
                      {comp?.po_pdf_url && (
                        <a
                          href={comp.po_pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          download
                          className="text-xs flex items-center gap-1 px-3 py-1 bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 rounded-lg font-medium"
                        >
                          📄 {comp.po_pdf_is_revision === false ? 'Download Original PO PDF' : 'Download PO PDF'}
                        </a>
                      )}
                      {comp?.has_comparison && (
                        <button
                          onClick={() => downloadComparisonSheet(po, comp)}
                          className="text-xs flex items-center gap-1 px-3 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 rounded-lg font-medium"
                        >
                          📊 Download Comparison Sheet
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded PO detail */}
                  {isExpanded && (
                    <div className="border-t bg-gray-50 p-5 space-y-5">

                      {/* Payment history log */}
                      {Array.isArray(po.payment_logs) && po.payment_logs.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Payment History</p>
                          <div className="space-y-2">
                            {po.payment_logs.map((log, idx) => (
                              <div key={idx} className="flex items-center justify-between bg-white border border-green-100 rounded-lg px-3 py-2">
                                <div className="flex items-center gap-3">
                                  <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                                  <div>
                                    <p className="text-xs text-gray-500">{log.paid_at ? fmtDate(log.paid_at) : '—'}</p>
                                    {log.notes && <p className="text-xs text-gray-400 italic">"{log.notes}"</p>}
                                    {log.paid_by_name && <p className="text-xs text-gray-400">by {log.paid_by_name}</p>}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="text-sm font-semibold text-green-700">{fmt(log.amount)}</p>
                                  {log.receipt_path && (
                                    <a href={log.receipt_path} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">Receipt</a>
                                  )}
                                </div>
                              </div>
                            ))}
                            <div className="flex justify-between text-xs text-gray-500 px-3 pt-1 border-t">
                              <span>Total Paid</span>
                              <span className="font-semibold text-green-700">{fmt(po.payment_logs.reduce((s, l) => s + (l.amount || 0), 0))}</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Payment terms raw */}
                      {po.payment_terms_raw && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Payment Terms</p>
                          <p className="text-sm text-gray-700 bg-white border rounded p-2">{po.payment_terms_raw}</p>
                        </div>
                      )}

                      {/* Line items */}
                      {Array.isArray(po.line_items) && po.line_items.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">PO Line Items</p>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm border-collapse bg-white rounded border">
                              <thead>
                                <tr className="bg-gray-100 text-left">
                                  <th className="px-3 py-2 text-xs font-medium text-gray-600">Description</th>
                                  <th className="px-3 py-2 text-xs font-medium text-gray-600 text-right">Qty</th>
                                  <th className="px-3 py-2 text-xs font-medium text-gray-600">Unit</th>
                                  <th className="px-3 py-2 text-xs font-medium text-gray-600 text-right">Rate</th>
                                  <th className="px-3 py-2 text-xs font-medium text-gray-600 text-right">GST%</th>
                                  <th className="px-3 py-2 text-xs font-medium text-gray-600 text-right">Total (incl GST)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {po.line_items.map((item, idx) => (
                                  <tr key={item.id || idx} className="border-t">
                                    <td className="px-3 py-2 text-gray-700 text-xs">{item.description || item.original_description || '—'}</td>
                                    <td className="px-3 py-2 text-right text-gray-600">{item.quantity ?? '—'}</td>
                                    <td className="px-3 py-2 text-gray-500 text-xs">{item.unit || '—'}</td>
                                    <td className="px-3 py-2 text-right text-gray-700">{item.rate != null ? `₹${Number(item.rate).toLocaleString('en-IN')}` : (item.unit_price != null ? fmt(item.unit_price) : '—')}</td>
                                    <td className="px-3 py-2 text-right text-gray-500">{item.gst_percent != null ? `${item.gst_percent}%` : '—'}</td>
                                    <td className="px-3 py-2 text-right font-medium text-gray-800">{item.total_value != null ? fmt(item.total_value) : (item.total_price != null ? fmt(item.total_price) : (item.amount != null ? fmt(item.amount) : '—'))}</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="border-t bg-gray-50">
                                  <td colSpan={5} className="px-3 py-2 text-xs font-semibold text-gray-500 text-right">PO Total (incl GST)</td>
                                  <td className="px-3 py-2 text-right font-bold text-gray-800">{fmt(po.total_amount)}</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Vendor Comparison Sheet from CPS */}
                      {!comp && <p className="text-xs text-gray-400 italic">Loading comparison sheet…</p>}
                      {comp && !comp.has_comparison && (
                        <p className="text-xs text-gray-400 italic">No vendor comparison sheet in CPS for this PO.</p>
                      )}
                      {comp && comp.has_comparison && (
                        <ComparisonSheetPanel comparison={comp.comparison} quotes={comp.quotes} fmt={fmt} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pending.length === 0 && (
        <div className="text-center py-10 text-gray-400 bg-white rounded-xl border">
          <p>No POs awaiting payment</p>
          <p className="text-sm mt-1">Procurement-approved POs will appear here</p>
        </div>
      )}

      {/* Paid history */}
      {paid.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-3">Paid ({paid.length})</h3>
          <div className="space-y-2">
            {paid.slice(0, 20).map(po => (
              <div key={po.id} className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between py-3 px-4">
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                    <div>
                      <p className="font-mono text-sm text-gray-600">{po.cps_po_ref}</p>
                      <p className="text-sm text-gray-600">{po.project_name}</p>
                      <p className="text-xs text-gray-400">{po.supplier_name}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">PO Total: {fmt(po.total_amount)}</p>
                    <p className="text-sm font-semibold text-green-700">Paid: {fmt(po.paid_amount)}</p>
                    <p className="text-xs text-gray-400">{fmtDate(po.paid_at)}</p>
                  </div>
                </div>
                {Array.isArray(po.payment_logs) && po.payment_logs.length > 0 && (
                  <div className="border-t px-4 py-2 space-y-1">
                    <p className="text-xs text-gray-400 font-medium uppercase">Payment History</p>
                    {po.payment_logs.map((log, idx) => (
                      <div key={idx} className="flex justify-between text-xs text-gray-500">
                        <span>{log.paid_at ? fmtDate(log.paid_at) : '—'}{log.notes ? ` — ${log.notes}` : ''}</span>
                        <span className="font-medium text-green-700">{fmt(log.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Superseded / Revised POs */}
      {superseded.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-400 mb-3">Revised / Archived ({superseded.length})</h3>
          <div className="space-y-2">
            {superseded.map(po => (
              <div key={po.id} className="flex items-center justify-between py-3 px-4 bg-gray-50 rounded-lg border border-gray-200 opacity-70">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="w-2 h-2 rounded-full bg-gray-400 shrink-0" />
                  <span className="font-mono text-sm text-gray-500 line-through">{po.cps_po_ref}</span>
                  {po.superseded_by && (
                    <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">
                      Revised → {po.superseded_by}
                    </span>
                  )}
                  <span className="text-sm text-gray-500">{po.project_name}</span>
                  <span className="text-xs text-gray-400">{po.supplier_name}</span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-400">{fmt(po.total_amount)}</p>
                  <p className="text-xs text-gray-400">{fmtDate(po.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {payModal && (
        <PayModal
          po={payModal.po}
          authoritativeAmount={getAuthoritativeAmount(payModal.po)}
          alreadyPaid={parseFloat(payModal.po.paid_amount || 0)}
          remaining={getRemainingBalance(payModal.po)}
          onConfirm={handlePay}
          onClose={() => setPayModal(null)}
          fmt={fmt}
        />
      )}

      {adjustModal && (
        <AdjustAmountModal
          po={adjustModal.po}
          onConfirm={handleAdjust}
          onClose={() => setAdjustModal(null)}
          fmt={fmt}
        />
      )}

      {/* SPEC-PAY-01 Gate-2: pay an authorized installment (reuses PayModal) */}
      {payAuthModal && (
        <PayModal
          po={{ cps_po_ref: `${payAuthModal.payable.po_number} · ${payAuthModal.payable.installment_name}`, supplier_name: payAuthModal.payable.supplier_name }}
          authoritativeAmount={Number(payAuthModal.payable.authorized_amount)}
          alreadyPaid={Number(payAuthModal.payable.already_paid || 0)}
          remaining={payAuthModal.remaining}
          onConfirm={(_po, amount, notes, file) => handlePayAuth(payAuthModal.payable, amount, notes, file)}
          onClose={() => setPayAuthModal(null)}
          fmt={fmt}
        />
      )}
    </div>
  );
}

function PayModal({ po, authoritativeAmount, alreadyPaid, remaining, onConfirm, onClose, fmt }) {
  const [amount, setAmount] = useState(remaining > 0 ? remaining.toFixed(2) : '');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setLoading(true);
    setError('');
    try {
      await onConfirm(po, amount, notes, file);
    } catch (e) {
      setError(e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Payment failed');
    } finally {
      setLoading(false);
    }
  }

  const enteredAmt = parseFloat(amount || 0);
  const isFullSettlement = enteredAmt >= remaining - 0.01;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-1">Record Payment</h2>
        <p className="text-sm text-gray-500 mb-4">{po.cps_po_ref} — {po.supplier_name}</p>

        {/* Balance summary */}
        <div className="bg-gray-50 rounded-lg p-3 mb-5 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Approved Amount</span>
            <span className="font-medium">{fmt(authoritativeAmount)}</span>
          </div>
          {alreadyPaid > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-500">Already Paid</span>
              <span className="text-green-600 font-medium">{fmt(alreadyPaid)}</span>
            </div>
          )}
          <div className="flex justify-between border-t pt-1 mt-1">
            <span className="font-semibold text-gray-700">Balance Due</span>
            <span className="font-bold text-amber-700">{fmt(remaining)}</span>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Amount Paying Now <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-gray-400 text-sm">₹</span>
              <input
                type="number"
                step="0.01"
                max={remaining}
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full pl-7 pr-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <p className="text-xs mt-1">
              {isFullSettlement
                ? <span className="text-green-600 font-medium">Full settlement — PO will be marked Paid</span>
                : <span className="text-blue-600">Partial — PO will remain open with {fmt(remaining - enteredAmt)} balance</span>}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Receipt</label>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={e => setFile(e.target.files[0])}
              className="w-full text-sm border rounded-lg p-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="UTR number, bank, or any payment notes..."
              className="w-full px-3 py-2 border rounded-lg text-sm resize-none"
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={loading || !amount || parseFloat(amount) <= 0}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Saving...' : isFullSettlement ? 'Confirm Full Payment' : 'Record Partial Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdjustAmountModal({ po, onConfirm, onClose, fmt }) {
  const currentAmt = parseFloat(po.finance_adjusted_amount || po.procurement_approved_amount || po.total_amount || 0);
  const [amount, setAmount] = useState(currentAmt.toFixed(2));
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    try {
      await onConfirm(po, amount, notes);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl">
        <h2 className="text-lg font-semibold mb-1">Adjust Payable Amount</h2>
        <p className="text-sm text-gray-500 mb-2">{po.cps_po_ref} — {po.supplier_name}</p>
        <p className="text-xs text-gray-400 mb-5">
          PO Total: {fmt(po.total_amount)} · Procurement Approved: {fmt(po.procurement_approved_amount || po.total_amount)}
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Adjusted Amount <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-gray-400 text-sm">₹</span>
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full pl-7 pr-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">
              This overrides the procurement-approved amount for payment purposes
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason for Adjustment</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. GST correction, quantity change, discount applied..."
              className="w-full px-3 py-2 border rounded-lg text-sm resize-none"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2 border rounded-lg text-sm hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={loading || !amount || parseFloat(amount) <= 0}
            className="flex-1 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save Adjustment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Comparison Sheet Panel ────────────────────────────────────────────────────
function ComparisonSheetPanel({ comparison, quotes, fmt }) {
  const ai = comparison?.ai || null;
  const sortedQuotes = [...(quotes || [])].sort((a, b) => Number(a.landed_total || 0) - Number(b.landed_total || 0));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Vendor Comparison Sheet</p>
        <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">
          {comparison.total_quotes} quotes · {comparison.compliant_quotes} compliant
        </span>
        {comparison.potential_savings > 0 && (
          <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">
            Savings vs next: {fmt(comparison.potential_savings)}
          </span>
        )}
      </div>

      {/* AI Recommendation banner */}
      {ai?.recommended_supplier && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-xs font-semibold text-green-600 uppercase mb-1">AI Recommended</p>
          <p className="font-semibold text-green-800">{ai.recommended_supplier}</p>
          <p className="text-sm text-green-700 mt-1">{ai.reason}</p>
          {ai.executive_summary && (
            <p className="text-xs text-gray-600 mt-2 border-t border-green-200 pt-2">{ai.executive_summary}</p>
          )}
        </div>
      )}

      {/* Bid totals comparison table */}
      {sortedQuotes.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Bid Totals</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse bg-white rounded border">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="px-3 py-2 text-xs font-medium text-gray-600">Vendor</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-600 text-right">Landed Total</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-600">Payment Terms</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-600">Delivery</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-600 text-center">Compliant</th>
                  <th className="px-3 py-2 text-xs font-medium text-gray-600 text-center">Selected</th>
                </tr>
              </thead>
              <tbody>
                {sortedQuotes.map((q, idx) => (
                  <tr key={q.id} className={`border-t ${q.is_selected ? 'bg-green-50' : idx === 0 ? 'bg-blue-50' : ''}`}>
                    <td className="px-3 py-2 font-medium text-gray-800">
                      {q.supplier?.name || '—'}
                      {q.is_selected && <span className="ml-1.5 text-xs text-green-600 font-semibold">✓ PO Issued</span>}
                      {!q.is_selected && idx === 0 && <span className="ml-1.5 text-xs text-blue-500">L1</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-gray-900">{fmt(q.landed_total)}</td>
                    <td className="px-3 py-2 text-gray-600 text-xs max-w-[160px] truncate" title={q.payment_terms}>{q.payment_terms || '—'}</td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{q.delivery_terms || '—'}</td>
                    <td className="px-3 py-2 text-center text-xs">
                      {q.compliance === 'compliant'
                        ? <span className="text-green-600 font-semibold">✓</span>
                        : <span className="text-gray-400">pending</span>}
                    </td>
                    <td className="px-3 py-2 text-center">{q.is_selected ? '✅' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-supplier line item breakdown — collapsible */}
      {sortedQuotes.map(q => q.line_items?.length > 0 && (
        <details key={q.id} className="bg-white border rounded-lg">
          <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-700 flex items-center justify-between list-none">
            <span>
              {q.supplier?.name || 'Vendor'} — line items
              {q.is_selected && <span className="ml-2 text-xs text-green-600">✓ Selected</span>}
            </span>
            <span className="font-bold text-gray-900">{fmt(q.landed_total)}</span>
          </summary>
          <div className="overflow-x-auto border-t">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-3 py-2 font-medium text-gray-500">Item</th>
                  <th className="px-3 py-2 font-medium text-gray-500">Brand</th>
                  <th className="px-3 py-2 font-medium text-gray-500 text-right">Qty</th>
                  <th className="px-3 py-2 font-medium text-gray-500">Unit</th>
                  <th className="px-3 py-2 font-medium text-gray-500 text-right">Rate</th>
                  <th className="px-3 py-2 font-medium text-gray-500 text-right">GST%</th>
                  <th className="px-3 py-2 font-medium text-gray-500 text-right">Landed/Unit</th>
                </tr>
              </thead>
              <tbody>
                {q.line_items.map((li, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2 text-gray-700">{li.description || '—'}</td>
                    <td className="px-3 py-2 text-gray-500">{li.brand || '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{li.qty ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{li.unit || '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{li.rate != null ? `₹${Number(li.rate).toLocaleString('en-IN')}` : '—'}</td>
                    <td className="px-3 py-2 text-right text-gray-600">{li.gst != null ? `${li.gst}%` : '—'}</td>
                    <td className="px-3 py-2 text-right font-medium text-gray-800">{li.landed_rate != null ? `₹${Number(li.landed_rate).toLocaleString('en-IN')}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}

      {/* AI Supplier Profiles */}
      {ai?.supplier_profiles?.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Supplier Profiles</p>
          <div className="grid grid-cols-1 gap-3">
            {ai.supplier_profiles.map((sp, i) => (
              <div key={i} className="bg-white border rounded-lg p-4 text-sm">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-gray-800">{sp.supplier_name || sp.name}</p>
                  {sp.landed_total && <p className="font-bold text-gray-700">{fmt(sp.landed_total)}</p>}
                </div>
                {sp.strengths?.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-semibold text-green-600 mb-0.5">Strengths</p>
                    <ul className="space-y-0.5">{sp.strengths.map((s, j) => <li key={j} className="text-xs text-gray-600">• {s}</li>)}</ul>
                  </div>
                )}
                {sp.weaknesses?.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-semibold text-orange-500 mb-0.5">Weaknesses</p>
                    <ul className="space-y-0.5">{sp.weaknesses.map((s, j) => <li key={j} className="text-xs text-gray-600">• {s}</li>)}</ul>
                  </div>
                )}
                {sp.risks?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-red-500 mb-0.5">Risk Flags</p>
                    <ul className="space-y-0.5">{sp.risks.map((s, j) => <li key={j} className="text-xs text-red-600">• {s}</li>)}</ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {ai?.warnings?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-xs font-semibold text-amber-700 uppercase mb-2">Warnings</p>
          <ul className="space-y-1">
            {ai.warnings.map((w, i) => <li key={i} className="text-xs text-amber-800">• {w}</li>)}
          </ul>
        </div>
      )}

      {/* Procurement head notes */}
      {comparison.manual_notes && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-blue-600 mb-1">Procurement Head Notes</p>
          <p className="text-sm text-blue-800">{comparison.manual_notes}</p>
        </div>
      )}
    </div>
  );
}
