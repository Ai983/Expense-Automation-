import { Router } from 'express';
import crypto from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { ok, fail } from '../utils/responseHelper.js';
import { sendWhatsApp } from '../services/whatsappService.js';

const router = Router();
const N8N_SECRET = process.env.N8N_INTERNAL_SECRET || '';
const FOUNDER_PHONE = process.env.FOUNDER_PHONE || '';
const REPORT_SIGNING_SECRET = process.env.REPORT_SIGNING_SECRET || N8N_SECRET || 'change-me';

function publicBaseUrl(req) {
  return process.env.BACKEND_PUBLIC_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null)
    || `${req.protocol}://${req.get('host')}`;
}

function signReport(period, endDate) {
  return crypto.createHmac('sha256', REPORT_SIGNING_SECRET).update(`${period}|${endDate}`).digest('hex').slice(0, 24);
}

function verifySig(period, endDate, t) {
  if (!t) return false;
  const expected = signReport(period, endDate);
  if (t.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(expected));
}

function fmtRs(n) { return `Rs.${Math.round(Number(n) || 0).toLocaleString('en-IN')}`; }
function fmtRsHtml(n) { return `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`; }

// ── Core data aggregation — shared by JSON + HTML + send endpoints ─────────────
async function buildReport(period) {
  const days = period === 'weekly' ? 7 : 30;
  const now = new Date();
  const endDate = now.toISOString().split('T')[0];
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - days);
  const start = startDate.toISOString().split('T')[0];

  // Imprest requests in window
  const { data: imprests } = await supabaseAdmin
    .from('imprest_requests')
    .select('id, ref_id, status, current_stage, approval_route, amount_requested, approved_amount, site, category, employee_id, submitted_at, rejection_reason')
    .gte('submitted_at', start)
    .lte('submitted_at', endDate + 'T23:59:59Z')
    .order('submitted_at', { ascending: false });
  const impRows = imprests || [];

  // Expenses in window
  const { data: expenses } = await supabaseAdmin
    .from('expenses').select('id, status, amount, submitted_at')
    .gte('submitted_at', start).lte('submitted_at', endDate + 'T23:59:59Z');
  const expRows = expenses || [];

  // Current pending pipeline snapshot
  const { data: pipeline } = await supabaseAdmin
    .from('imprest_requests')
    .select('id, current_stage, approval_route, amount_requested')
    .in('current_stage', ['s1_pending', 's2_pending', 's3_pending']);
  const pipelineRows = pipeline || [];

  // PO payments in window
  const { data: poPays } = await supabaseAdmin
    .from('po_payments').select('id, total_amount, paid_amount, status, paid_at')
    .gte('updated_at', start + 'T00:00:00Z');
  const poRows = poPays || [];

  // Employee name map
  const empIds = [...new Set(impRows.map(r => r.employee_id).filter(Boolean))];
  let empMap = {};
  if (empIds.length > 0) {
    const { data: emps } = await supabaseAdmin.from('employees').select('id, name').in('id', empIds);
    empMap = Object.fromEntries((emps || []).map(e => [e.id, e.name]));
  }

  // ── Aggregations ────────────────────────────────────────────────────────────
  const totalRequested = impRows.reduce((s, r) => s + parseFloat(r.amount_requested || 0), 0);
  const totalApproved = impRows
    .filter(r => ['approved', 'partially_approved'].includes(r.status))
    .reduce((s, r) => s + parseFloat(r.approved_amount || r.amount_requested || 0), 0);
  const impApproved = impRows.filter(r => ['approved', 'partially_approved'].includes(r.status)).length;
  const impRejected = impRows.filter(r => r.status === 'rejected').length;
  const impPending = impRows.filter(r => r.status === 'pending').length;

  // By site
  const siteMap = {};
  for (const r of impRows) {
    if (!siteMap[r.site]) siteMap[r.site] = { site: r.site, count: 0, amount: 0 };
    siteMap[r.site].count++;
    siteMap[r.site].amount += parseFloat(r.amount_requested || 0);
  }
  const bySite = Object.values(siteMap).sort((a, b) => b.amount - a.amount);

  // By category
  const catMap = {};
  for (const r of impRows) {
    if (!catMap[r.category]) catMap[r.category] = { category: r.category, count: 0, amount: 0 };
    catMap[r.category].count++;
    catMap[r.category].amount += parseFloat(r.amount_requested || 0);
  }
  const byCategory = Object.values(catMap).sort((a, b) => b.amount - a.amount);

  // By employee
  const empAggMap = {};
  for (const r of impRows) {
    const key = r.employee_id || 'unknown';
    if (!empAggMap[key]) empAggMap[key] = { name: empMap[key] || 'Unknown', count: 0, amount: 0 };
    empAggMap[key].count++;
    empAggMap[key].amount += parseFloat(r.amount_requested || 0);
  }
  const byEmployee = Object.values(empAggMap).sort((a, b) => b.amount - a.amount);

  // Pipeline counts
  const pendingPipeline = {
    s1: pipelineRows.filter(r => r.current_stage === 's1_pending').length,
    s1Amount: pipelineRows.filter(r => r.current_stage === 's1_pending').reduce((s, r) => s + parseFloat(r.amount_requested || 0), 0),
    s2_ritu: pipelineRows.filter(r => r.current_stage === 's2_pending' && r.approval_route === 'avisha_ritu_finance').length,
    s2_director: pipelineRows.filter(r => r.current_stage === 's2_pending' && r.approval_route === 'avisha_director_finance').length,
    finance: pipelineRows.filter(r => r.current_stage === 's3_pending').length,
    financeAmount: pipelineRows.filter(r => r.current_stage === 's3_pending').reduce((s, r) => s + parseFloat(r.amount_requested || 0), 0),
  };

  // Recent rejections (top 5)
  const recentRejections = impRows
    .filter(r => r.status === 'rejected')
    .slice(0, 5)
    .map(r => ({
      ref_id: r.ref_id,
      employee: empMap[r.employee_id] || '—',
      site: r.site,
      amount: parseFloat(r.amount_requested || 0),
      reason: r.rejection_reason || '—',
      stage: r.current_stage,
    }));

  // PO payment summary
  const poStats = {
    awaiting: poRows.filter(p => ['pending_payment', 'partially_paid'].includes(p.status)).length,
    awaitingAmount: poRows.filter(p => ['pending_payment', 'partially_paid'].includes(p.status))
      .reduce((s, p) => s + Math.max(0, parseFloat(p.total_amount || 0) - parseFloat(p.paid_amount || 0)), 0),
    paidCount: poRows.filter(p => p.status === 'paid').length,
    paidAmount: poRows.filter(p => p.status === 'paid').reduce((s, p) => s + parseFloat(p.paid_amount || 0), 0),
  };

  // Expenses
  const expStats = {
    total: expRows.length,
    amount: expRows.reduce((s, e) => s + parseFloat(e.amount || 0), 0),
    approved: expRows.filter(e => e.status === 'approved').length,
    pending: expRows.filter(e => ['pending', 'verified', 'manual_review'].includes(e.status)).length,
    rejected: expRows.filter(e => e.status === 'rejected').length,
  };

  return {
    period, start, endDate, days,
    imprest: { total: impRows.length, totalRequested, totalApproved, impApproved, impRejected, impPending },
    bySite, byCategory, byEmployee,
    pendingPipeline,
    recentRejections,
    poStats,
    expStats,
  };
}

// ── HTML Report Template ───────────────────────────────────────────────────────
function renderReportHtml(data) {
  const { period, start, endDate, imprest, bySite, byCategory, byEmployee, pendingPipeline, recentRejections, poStats, expStats } = data;
  const label = period === 'weekly' ? 'Weekly' : 'Monthly';
  const fmt = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const maxSiteAmount = Math.max(1, ...bySite.map(s => s.amount));
  const siteBars = bySite.slice(0, 8).map(s => {
    const pct = (s.amount / maxSiteAmount) * 100;
    return `
      <div style="margin:6px 0;">
        <div style="display:flex;justify-content:space-between;font-size:11pt;">
          <span style="color:#374151;">${escapeHtml(s.site)} <span style="color:#9ca3af;font-size:9pt;">(${s.count})</span></span>
          <span style="color:#111827;font-weight:600;">${fmtRsHtml(s.amount)}</span>
        </div>
        <div style="background:#f3f4f6;border-radius:4px;height:6px;overflow:hidden;margin-top:2px;">
          <div style="background:linear-gradient(90deg,#3b82f6,#60a5fa);height:100%;width:${pct.toFixed(1)}%;"></div>
        </div>
      </div>`;
  }).join('');

  const catRows = byCategory.slice(0, 8).map(c => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;">${escapeHtml(c.category)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right;color:#6b7280;">${c.count}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;">${fmtRsHtml(c.amount)}</td>
    </tr>`).join('');

  const empRows = byEmployee.slice(0, 10).map(e => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;">${escapeHtml(e.name)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right;color:#6b7280;">${e.count}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;">${fmtRsHtml(e.amount)}</td>
    </tr>`).join('');

  const rejectionRows = recentRejections.length === 0
    ? `<tr><td colspan="4" style="padding:12px;text-align:center;color:#9ca3af;font-style:italic;">No rejections this period</td></tr>`
    : recentRejections.map(r => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;font-family:monospace;font-size:9pt;color:#d97706;">${escapeHtml(r.ref_id)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;">${escapeHtml(r.employee)}<br><span style="font-size:9pt;color:#9ca3af;">${escapeHtml(r.site)}</span></td>
          <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:600;color:#dc2626;">${fmtRsHtml(r.amount)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:9pt;color:#6b7280;font-style:italic;">"${escapeHtml(r.reason)}"</td>
        </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hagerstone ${label} Report — ${fmt(start)} to ${fmt(endDate)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;background:#f9fafb;color:#111827;line-height:1.5;font-size:14px;}
  .container{max-width:900px;margin:0 auto;padding:16px;}
  .hero{background:linear-gradient(135deg,#1e3a8a,#3b82f6);color:white;border-radius:12px;padding:24px;margin-bottom:16px;box-shadow:0 4px 12px rgba(59,130,246,0.2);}
  .hero h1{font-size:22px;font-weight:800;letter-spacing:-0.5px;}
  .hero .subtitle{opacity:0.85;font-size:13px;margin-top:4px;}
  .hero .period{margin-top:8px;font-size:11pt;font-weight:500;background:rgba(255,255,255,0.15);display:inline-block;padding:4px 10px;border-radius:6px;}
  .grid-4{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px;}
  @media (min-width:600px){.grid-4{grid-template-columns:repeat(4,1fr);}}
  .stat-card{background:white;border-radius:10px;padding:14px;border:1px solid #e5e7eb;box-shadow:0 1px 2px rgba(0,0,0,0.04);}
  .stat-card .label{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;}
  .stat-card .value{font-size:20px;font-weight:800;color:#111827;margin-top:4px;}
  .stat-card .sub{font-size:11px;color:#9ca3af;margin-top:2px;}
  .stat-card.green{border-left:4px solid #10b981;}
  .stat-card.red{border-left:4px solid #ef4444;}
  .stat-card.amber{border-left:4px solid #f59e0b;}
  .stat-card.blue{border-left:4px solid #3b82f6;}
  .section{background:white;border-radius:10px;padding:18px;margin-bottom:16px;border:1px solid #e5e7eb;box-shadow:0 1px 2px rgba(0,0,0,0.04);}
  .section h2{font-size:15px;font-weight:700;color:#111827;margin-bottom:14px;padding-bottom:8px;border-bottom:2px solid #e5e7eb;display:flex;align-items:center;gap:6px;}
  .section h2 .badge{background:#f3f4f6;color:#6b7280;font-size:11px;font-weight:600;padding:2px 8px;border-radius:99px;}
  table{width:100%;border-collapse:collapse;font-size:13px;}
  th{text-align:left;font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;padding:6px 8px;background:#f9fafb;border-bottom:2px solid #e5e7eb;font-weight:700;}
  .pipeline{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;}
  @media (min-width:600px){.pipeline{grid-template-columns:repeat(4,1fr);}}
  .pipeline-card{padding:10px;border-radius:8px;text-align:center;}
  .pipeline-card.s1{background:#dbeafe;color:#1e40af;}
  .pipeline-card.s2{background:#ede9fe;color:#5b21b6;}
  .pipeline-card.director{background:#e0e7ff;color:#3730a3;}
  .pipeline-card.finance{background:#fef3c7;color:#92400e;}
  .pipeline-card .pcount{font-size:24px;font-weight:800;}
  .pipeline-card .plabel{font-size:10px;text-transform:uppercase;font-weight:700;margin-top:2px;}
  .pipeline-card .pamt{font-size:11px;margin-top:2px;opacity:0.8;}
  .footer{text-align:center;color:#9ca3af;font-size:11px;margin-top:24px;padding:12px;}
  .icon{font-size:18px;margin-right:4px;}
</style>
</head><body>
<div class="container">

  <div class="hero">
    <h1>🏢 Hagerstone ${label} Report</h1>
    <div class="subtitle">Automated finance summary for Dhruv sir</div>
    <div class="period">📅 ${fmt(start)} → ${fmt(endDate)}</div>
  </div>

  <!-- KPI Cards -->
  <div class="grid-4">
    <div class="stat-card blue">
      <div class="label">Total Imprests</div>
      <div class="value">${imprest.total}</div>
      <div class="sub">${fmtRsHtml(imprest.totalRequested)} requested</div>
    </div>
    <div class="stat-card green">
      <div class="label">Approved</div>
      <div class="value">${imprest.impApproved}</div>
      <div class="sub">${fmtRsHtml(imprest.totalApproved)} disbursed</div>
    </div>
    <div class="stat-card amber">
      <div class="label">Pending</div>
      <div class="value">${imprest.impPending}</div>
      <div class="sub">across all stages</div>
    </div>
    <div class="stat-card red">
      <div class="label">Rejected</div>
      <div class="value">${imprest.impRejected}</div>
      <div class="sub">this period</div>
    </div>
  </div>

  <!-- Live Pipeline -->
  <div class="section">
    <h2>📊 Live Approval Pipeline <span class="badge">right now</span></h2>
    <div class="pipeline">
      <div class="pipeline-card s1">
        <div class="pcount">${pendingPipeline.s1}</div>
        <div class="plabel">S1 · Avisha</div>
        <div class="pamt">${fmtRsHtml(pendingPipeline.s1Amount)}</div>
      </div>
      <div class="pipeline-card s2">
        <div class="pcount">${pendingPipeline.s2_ritu}</div>
        <div class="plabel">S2 · Ritu</div>
        <div class="pamt">awaiting review</div>
      </div>
      <div class="pipeline-card director">
        <div class="pcount">${pendingPipeline.s2_director}</div>
        <div class="plabel">Director</div>
        <div class="pamt">awaiting WhatsApp</div>
      </div>
      <div class="pipeline-card finance">
        <div class="pcount">${pendingPipeline.finance}</div>
        <div class="plabel">Finance</div>
        <div class="pamt">${fmtRsHtml(pendingPipeline.financeAmount)} to disburse</div>
      </div>
    </div>
  </div>

  <!-- Site breakdown -->
  <div class="section">
    <h2>🏗️ Imprest by Site <span class="badge">top 8</span></h2>
    ${siteBars || '<p style="color:#9ca3af;text-align:center;padding:12px;">No data</p>'}
  </div>

  <!-- Category + Employee side-by-side on desktop -->
  <div style="display:grid;grid-template-columns:1fr;gap:16px;margin-bottom:16px;">
    <div class="section" style="margin-bottom:0;">
      <h2>📂 By Category</h2>
      <table>
        <thead><tr><th>Category</th><th style="text-align:right">Count</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${catRows || '<tr><td colspan="3" style="padding:12px;text-align:center;color:#9ca3af;">No data</td></tr>'}</tbody>
      </table>
    </div>

    <div class="section" style="margin-bottom:0;">
      <h2>👥 Top Requesting Employees <span class="badge">top 10</span></h2>
      <table>
        <thead><tr><th>Employee</th><th style="text-align:right">Requests</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${empRows || '<tr><td colspan="3" style="padding:12px;text-align:center;color:#9ca3af;">No data</td></tr>'}</tbody>
      </table>
    </div>
  </div>

  <!-- Recent Rejections -->
  <div class="section">
    <h2>❌ Recent Rejections <span class="badge">latest 5</span></h2>
    <table>
      <thead><tr><th>Ref</th><th>Employee / Site</th><th style="text-align:right">Amount</th><th>Reason</th></tr></thead>
      <tbody>${rejectionRows}</tbody>
    </table>
  </div>

  <!-- PO Payments + Expenses -->
  <div class="grid-4">
    <div class="stat-card amber">
      <div class="label">POs Awaiting Payment</div>
      <div class="value">${poStats.awaiting}</div>
      <div class="sub">${fmtRsHtml(poStats.awaitingAmount)} pending</div>
    </div>
    <div class="stat-card green">
      <div class="label">POs Paid</div>
      <div class="value">${poStats.paidCount}</div>
      <div class="sub">${fmtRsHtml(poStats.paidAmount)} disbursed</div>
    </div>
    <div class="stat-card blue">
      <div class="label">Expense Receipts</div>
      <div class="value">${expStats.total}</div>
      <div class="sub">${fmtRsHtml(expStats.amount)} submitted</div>
    </div>
    <div class="stat-card amber">
      <div class="label">Expenses Pending</div>
      <div class="value">${expStats.pending}</div>
      <div class="sub">${expStats.approved} approved</div>
    </div>
  </div>

  <div class="footer">
    Generated by HagerStone Finance System · ${new Date().toLocaleString('en-IN')}<br>
    Built with care for Dhruv sir 🙏
  </div>

</div></body></html>`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── GET /api/reports/view — Public HTML report (signed URL) ────────────────────
router.get('/view', async (req, res, next) => {
  try {
    const { period = 'weekly', endDate, t } = req.query;
    if (!['weekly', 'monthly'].includes(period)) return res.status(400).send('Invalid period');
    if (!endDate) return res.status(400).send('Missing endDate');
    if (!verifySig(period, endDate, t)) return res.status(403).send('Invalid or expired link');

    const data = await buildReport(period);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(renderReportHtml(data));
  } catch (err) { next(err); }
});

// ── GET /api/reports/weekly — JSON (kept for backwards compatibility) ──────────
router.get('/weekly', async (req, res, next) => {
  try {
    const secret = req.headers['x-n8n-secret'];
    if (!N8N_SECRET || secret !== N8N_SECRET) return fail(res, 'Unauthorized', 401);
    const data = await buildReport('weekly');
    return ok(res, data);
  } catch (err) { next(err); }
});

// ── GET /api/reports/monthly — JSON ────────────────────────────────────────────
router.get('/monthly', async (req, res, next) => {
  try {
    const secret = req.headers['x-n8n-secret'];
    if (!N8N_SECRET || secret !== N8N_SECRET) return fail(res, 'Unauthorized', 401);
    const data = await buildReport('monthly');
    return ok(res, data);
  } catch (err) { next(err); }
});

// ── POST /api/reports/send — Generates report, sends WhatsApp w/ HTML link ─────
router.post('/send', async (req, res, next) => {
  try {
    const secret = req.headers['x-n8n-secret'];
    if (!N8N_SECRET || secret !== N8N_SECRET) return fail(res, 'Unauthorized', 401);

    const { period } = req.body;
    if (!period || !['weekly', 'monthly'].includes(period)) {
      return fail(res, 'period must be "weekly" or "monthly"');
    }
    if (!FOUNDER_PHONE) return fail(res, 'FOUNDER_PHONE not configured');

    const data = await buildReport(period);
    const label = period === 'weekly' ? 'WEEKLY' : 'MONTHLY';
    const baseUrl = publicBaseUrl(req);
    const token = signReport(period, data.endDate);
    const reportUrl = `${baseUrl}/api/reports/view?period=${period}&endDate=${data.endDate}&t=${token}`;

    const topSite = data.bySite[0];
    const fmtDateShort = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

    const message =
      `*HAGERSTONE ${label} REPORT*\n` +
      `${fmtDateShort(data.start)} – ${fmtDateShort(data.endDate)}\n\n` +
      `📋 *Imprests:* ${data.imprest.total} (${fmtRs(data.imprest.totalRequested)})\n` +
      `   ✓ Approved: ${data.imprest.impApproved}  ✗ Rejected: ${data.imprest.impRejected}  ⏳ Pending: ${data.imprest.impPending}\n\n` +
      `💰 *Pipeline now:* S1=${data.pendingPipeline.s1} · S2=${data.pendingPipeline.s2_ritu} · Director=${data.pendingPipeline.s2_director} · Finance=${data.pendingPipeline.finance}\n\n` +
      `🏗️ *Top Site:* ${topSite ? `${topSite.site} (${fmtRs(topSite.amount)})` : '—'}\n\n` +
      `🧾 *POs Pending:* ${data.poStats.awaiting} (${fmtRs(data.poStats.awaitingAmount)})\n\n` +
      `📊 *View Full Report:*\n${reportUrl}\n\n` +
      `— HagerStone Finance System`;

    await sendWhatsApp(FOUNDER_PHONE, message);

    return ok(res, { sent: true, to: FOUNDER_PHONE, period, reportUrl });
  } catch (err) { next(err); }
});

// ── Preview endpoint (dev only) — bypass signature for local testing ───────────
router.get('/preview', async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production') return res.status(404).send('Not found');
    const period = req.query.period === 'monthly' ? 'monthly' : 'weekly';
    const data = await buildReport(period);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(renderReportHtml(data));
  } catch (err) { next(err); }
});

export default router;
