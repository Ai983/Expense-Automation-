import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';
import { showToast } from '../components/layout/Toast';

const IMPREST_SITES = [
  'MAX Hospital, Saket Delhi',
  'DEE Development Engineer - Canteen', 'DEE Development Engineer - Admin',
  'Vaneet Infra', 'Dee Foundation Omaxe, Faridabad', 'Auma India Bengaluru',
  'Minebea Mitsumi', 'Hero Homes Ludhiana', 'Hero Homes Greater Noida',
  'Bansal Tower', 'KOKO Town, Chandigarh', 'Vinfast Jaipur', 'M3M', 'Head Office', 'Bangalore Office', 'Others',
];

function fmt(n) { return `₹${Number(n || 0).toLocaleString('en-IN')}`; }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
function fmtTime(d) { return d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''; }

function timeAgo(d) {
  if (!d) return '';
  const ms = Date.now() - new Date(d).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDate(d);
}

// Determine which kanban column a request belongs in
function columnOf(req) {
  const s = req.current_stage;
  if (s === 's1_pending') return 's1';
  if (s === 's2_pending') {
    // Legacy: director/dhruv WhatsApp routes waited at s2_pending
    if (req.approval_route === 'avisha_director_finance' || req.approval_route === 'avisha_dhruv_finance') return 'director';
    return 's2'; // new s2_finance_founder AND legacy avisha_ritu_finance
  }
  if (s === 'director_pending') return 'director';        // new: ≥₹10K director gate
  if (s === 's3_pending') return 'finance';
  if (s === 'founder_review_pending') return 'founder';   // new: founder approval gate
  if (s === 'paid' || req.status === 'approved') return 'done';
  if (['s1_rejected', 's2_rejected', 's3_rejected', 'director_rejected', 'founder_rejected'].includes(s)) return 'done';
  return 'done';
}

function routeLabel(route) {
  // Legacy WhatsApp routes
  if (route === 'avisha_director_finance') return 'Director';
  if (route === 'avisha_dhruv_finance') return 'Dhruv Sir';
  return 'S2 · Ritu';
}

function StageBadge({ stage, route }) {
  const pendingLabel = stage === 's2_pending' ? routeLabel(route) : null;
  const map = {
    s1_pending: { label: 'S1 · Avisha', bg: 'bg-blue-100', text: 'text-blue-700' },
    s2_pending: { label: pendingLabel, bg: 'bg-purple-100', text: 'text-purple-700' },
    director_pending: { label: 'Director', bg: 'bg-indigo-100', text: 'text-indigo-700' },
    s3_pending: { label: 'Finance', bg: 'bg-amber-100', text: 'text-amber-700' },
    founder_review_pending: { label: 'Founder', bg: 'bg-pink-100', text: 'text-pink-700' },
    founder_approved: { label: '✓ Founder OK', bg: 'bg-green-100', text: 'text-green-700' },
    paid: { label: '✓ Paid', bg: 'bg-green-100', text: 'text-green-700' },
    s1_rejected: { label: '✗ S1 Rejected', bg: 'bg-red-100', text: 'text-red-700' },
    s2_rejected: { label: '✗ S2 Rejected', bg: 'bg-red-100', text: 'text-red-700' },
    s3_rejected: { label: '✗ Finance Rejected', bg: 'bg-red-100', text: 'text-red-700' },
    director_rejected: { label: '✗ Director Rejected', bg: 'bg-red-100', text: 'text-red-700' },
    founder_rejected: { label: '✗ Founder Rejected', bg: 'bg-red-100', text: 'text-red-700' },
  };
  const m = map[stage] || { label: stage, bg: 'bg-gray-100', text: 'text-gray-600' };
  return <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${m.bg} ${m.text}`}>{m.label}</span>;
}

function RouteIndicator({ route, stage }) {
  const steps =
    // New three-tier routes
    route === 'avisha_director_finance_founder'
      ? [{ k: 's1', label: 'Avisha' }, { k: 'dir', label: 'Director' }, { k: 's3', label: 'Finance' }, { k: 'founder', label: 'Founder' }]
    : route === 's2_finance_founder'
      ? [{ k: 's2', label: 'Ritu' }, { k: 's3', label: 'Finance' }, { k: 'founder', label: 'Founder' }]
    : route === 'avisha_finance_founder'
      ? [{ k: 's1', label: 'Avisha' }, { k: 's3', label: 'Finance' }, { k: 'founder', label: 'Founder' }]
    // Legacy routes
    : route === 'avisha_director_finance'
      ? [{ k: 's1', label: 'Avisha' }, { k: 'dir', label: 'Director' }, { k: 's3', label: 'Finance' }]
    : route === 'avisha_dhruv_finance'
      ? [{ k: 's1', label: 'Avisha' }, { k: 'dhruv', label: 'Dhruv Sir' }, { k: 's3', label: 'Finance' }]
      : [{ k: 's1', label: 'Avisha' }, { k: 's2', label: 'Ritu' }, { k: 's3', label: 'Finance' }];

  const stagePosition = (() => {
    if (stage?.includes('rejected')) return -1;
    if (stage === 'paid' || stage === 'founder_approved') return steps.length;
    const stageKey = {
      s1_pending: 's1', s2_pending: 's2', director_pending: 'dir',
      s3_pending: 's3', founder_review_pending: 'founder',
    }[stage];
    const idx = steps.findIndex((s) => s.k === stageKey);
    return idx >= 0 ? idx : steps.length;
  })();

  return (
    <div className="flex items-center gap-1 text-[9px]">
      {steps.map((s, i) => (
        <span key={s.k} className="flex items-center gap-1">
          <span className={`px-1 py-0.5 rounded ${
            stagePosition === i ? 'bg-amber-500 text-white font-bold' :
            i < stagePosition ? 'bg-green-100 text-green-700' :
            'bg-gray-100 text-gray-400'
          }`}>{s.label}</span>
          {i < steps.length - 1 && <span className="text-gray-300">›</span>}
        </span>
      ))}
    </div>
  );
}

function KanbanCard({ req, onView, onForward, onReject, actionable }) {
  const isRejected = req.current_stage?.includes('rejected');
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-2.5 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer"
      onClick={() => onView(req)}>
      <RouteIndicator route={req.approval_route} stage={req.current_stage} />
      <div className="flex items-start justify-between gap-2 mt-1.5 mb-1">
        <span className="font-mono text-[11px] font-semibold text-amber-600">{req.ref_id}</span>
        <span className="text-[10px] text-gray-400 whitespace-nowrap">{timeAgo(req.submitted_at)}</span>
      </div>
      <p className="font-semibold text-[15px] text-gray-900 truncate">{req.employee?.name || '—'}</p>
      <div className="flex items-baseline justify-between mt-0.5">
        <p className="text-lg font-bold text-gray-900">{fmt(req.amount_requested)}</p>
        {req.approved_amount && req.approved_amount !== req.amount_requested && (
          <span className="text-[11px] text-green-600">→ {fmt(req.approved_amount)}</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1 mt-1.5">
        <span className="text-[11px] px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded font-medium">{req.category}</span>
        <span className="text-[11px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">{req.site}</span>
      </div>
      {req.purpose && <p className="text-[11px] text-gray-500 mt-1.5 line-clamp-2">{req.purpose}</p>}
      {req.s1_notes && (
        <p className="text-[11px] text-blue-600 mt-1 italic line-clamp-1" title={req.s1_notes}>S1: "{req.s1_notes}"</p>
      )}
      {req.s2_notes && (
        <p className="text-[11px] text-purple-600 mt-1 italic line-clamp-1" title={req.s2_notes}>S2: "{req.s2_notes}"</p>
      )}
      {isRejected && req.rejection_reason && (
        <p className="text-[11px] text-red-600 mt-1 italic line-clamp-1" title={req.rejection_reason}>✗ "{req.rejection_reason}"</p>
      )}
      {req.employee_total_balance > 0 && (
        <p className="text-[10px] text-red-600 font-bold mt-1">⚠ Prev balance: {fmt(req.employee_total_balance)}</p>
      )}
      {actionable && (
        <div className="flex gap-1.5 mt-2">
          <button onClick={(e) => { e.stopPropagation(); onForward(req); }}
            className={`flex-1 text-[11px] active:scale-95 text-white py-1.5 rounded font-semibold transition-all duration-150 shadow-sm hover:shadow-md ${
              req.current_stage === 's1_pending'
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-green-600 hover:bg-green-700'
            }`}>
            {req.current_stage === 's1_pending' ? '⚡ Fast-fwd' : '✓ Forward'}
          </button>
          <button onClick={(e) => { e.stopPropagation(); onReject(req); }}
            className="flex-1 text-[11px] bg-red-600 hover:bg-red-700 active:scale-95 text-white py-1.5 rounded font-semibold transition-all duration-150 shadow-sm hover:shadow-md">
            ✗ Reject
          </button>
        </div>
      )}
    </div>
  );
}

function HistoryItem({ entry, onClick }) {
  const isRejected = entry.current_stage === 's2_rejected' || entry.status === 'rejected';
  return (
    <div onClick={() => onClick(entry)}
      className="history-item bg-white border border-gray-100 rounded-md p-2 hover:bg-gray-50 hover:shadow-sm cursor-pointer transition-all duration-150">
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold text-amber-600">{entry.ref_id}</span>
        <span className="text-[10px] text-gray-400">{fmtTime(entry.s2_approved_at)}</span>
      </div>
      <p className="text-xs text-gray-700 truncate mt-0.5">{entry.employee_name || '—'}</p>
      <div className="flex items-center justify-between mt-1">
        <span className="text-sm font-semibold text-gray-900">{fmt(entry.amount_requested)}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
          isRejected ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
        }`}>
          {isRejected ? '✗ Rejected' : '✓ Forwarded'}
        </span>
      </div>
    </div>
  );
}

const COLUMNS = [
  { key: 's1', title: 'S1 — Avisha', tint: 'bg-blue-50 border-blue-200', heading: 'text-blue-700', dot: '🔵' },
  { key: 's2', title: 'S2 — Ritu', tint: 'bg-purple-50 border-purple-200', heading: 'text-purple-700', dot: '🟣' },
  { key: 'director', title: 'Director', tint: 'bg-indigo-50 border-indigo-200', heading: 'text-indigo-700', dot: '🟦' },
  { key: 'finance', title: 'Finance', tint: 'bg-amber-50 border-amber-200', heading: 'text-amber-700', dot: '🟡' },
  { key: 'founder', title: 'Founder — Dhruv', tint: 'bg-pink-50 border-pink-200', heading: 'text-pink-700', dot: '🩷' },
  { key: 'done', title: 'Recently Done', tint: 'bg-gray-50 border-gray-200', heading: 'text-gray-700', dot: '⚫' },
];

export default function S2QueuePage() {
  const [board, setBoard] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterSite, setFilterSite] = useState('all');
  const [filterName, setFilterName] = useState('');
  const [selected, setSelected] = useState(null);
  const [modalMode, setModalMode] = useState(null);
  const [notes, setNotes] = useState('');
  const [approveAmount, setApproveAmount] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState('');

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/imprest/board', { params: { days: 14 } });
      setBoard(data.data.requests || []);
    } catch { showToast('Failed to load board', 'error'); }
    finally { setLoading(false); }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const { data } = await api.get('/api/imprest/s2/history', { params: { limit: 50 } });
      setHistory(data.data.history || []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchBoard(); }, [fetchBoard]);
  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // Apply filters then bucket
  const filteredBoard = useMemo(() => {
    return board.filter(r => {
      if (filterSite !== 'all' && r.site !== filterSite) return false;
      if (filterName.trim()) {
        const n = r.employee?.name?.toLowerCase() || '';
        if (!n.includes(filterName.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [board, filterSite, filterName]);

  const buckets = useMemo(() => {
    const out = { s1: [], s2: [], director: [], finance: [], founder: [], done: [] };
    for (const r of filteredBoard) {
      const col = columnOf(r);
      if (out[col]) out[col].push(r);
    }
    // Sort each active column by oldest first (urgency), done by most recent first
    ['s1', 's2', 'director', 'finance', 'founder'].forEach(k => {
      out[k].sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));
    });
    out.done.sort((a, b) => new Date(b.updated_at || b.submitted_at) - new Date(a.updated_at || a.submitted_at));
    return out;
  }, [filteredBoard]);

  const historyBuckets = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
    const out = { today: [], yesterday: [], week: [], older: [] };
    for (const r of history) {
      if (!r.s2_approved_at) continue;
      const d = new Date(r.s2_approved_at); d.setHours(0, 0, 0, 0);
      if (d.getTime() === today.getTime()) out.today.push(r);
      else if (d.getTime() === yesterday.getTime()) out.yesterday.push(r);
      else if (d >= weekAgo) out.week.push(r);
      else out.older.push(r);
    }
    return out;
  }, [history]);

  const openView = (req) => { setSelected(req); setModalMode('view'); };
  const openForward = (req) => {
    setSelected(req); setApproveAmount(String(req.amount_requested));
    setNotes(req.current_stage === 's1_pending' ? 'Approved and forwarded by S2 (Ritu)' : 'Approved by S2 approval');
    setActionError(''); setModalMode('forward');
  };
  const openReject = (req) => { setSelected(req); setRejectReason(''); setActionError(''); setModalMode('reject'); };
  const closeModal = () => { setSelected(null); setModalMode(null); };

  const handleForward = async () => {
    setActing(true); setActionError('');
    try {
      const endpoint = selected.current_stage === 's1_pending'
        ? `/api/imprest/${selected.id}/s2-override`
        : `/api/imprest/${selected.id}/s2-approve`;
      await api.post(endpoint, {
        notes: notes.trim() || undefined,
        approvedAmount: parseFloat(approveAmount) || undefined,
      });
      showToast(selected.current_stage === 's1_pending' ? 'Fast-forwarded to Finance team' : 'Forwarded to Finance team', 'success');
      closeModal(); fetchBoard(); fetchHistory();
    } catch (e) { setActionError(e.response?.data?.error || 'Failed'); }
    finally { setActing(false); }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) { setActionError('Reason is required'); return; }
    setActing(true); setActionError('');
    try {
      const endpoint = selected.current_stage === 's1_pending'
        ? `/api/imprest/${selected.id}/s2-reject-s1`
        : `/api/imprest/${selected.id}/s2-reject`;
      await api.post(endpoint, { reason: rejectReason.trim() });
      showToast('Request rejected', 'info');
      closeModal(); fetchBoard(); fetchHistory();
    } catch (e) { setActionError(e.response?.data?.error || 'Failed'); }
    finally { setActing(false); }
  };

  const totalCount = filteredBoard.length;
  const myActionable = buckets.s2.length + buckets.s1.length;

  return (
    <div className="flex gap-4 h-[calc(100vh-7rem)]">
      {/* Main kanban area */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Imprest Pipeline Board</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {totalCount} request{totalCount !== 1 ? 's' : ''} · <span className="font-semibold text-purple-700">{myActionable} awaiting your action</span>
            </p>
          </div>
          <div className="flex gap-2">
            <input type="text" placeholder="Search employee..." value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-44 focus:outline-none focus:ring-2 focus:ring-amber-400" />
            <select value={filterSite} onChange={(e) => setFilterSite(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
              <option value="all">All Sites</option>
              {IMPREST_SITES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center flex-1 text-gray-400">Loading...</div>
        ) : (
          <div className="flex gap-3 flex-1 overflow-x-auto overflow-y-hidden pb-2">
            {COLUMNS.map(col => {
              const items = buckets[col.key] || [];
              const isActionable = col.key === 's2' || col.key === 's1';
              return (
                <div key={col.key} className={`${col.tint} border rounded-xl p-2.5 flex flex-col overflow-hidden flex-1 min-w-[240px]`}>
                  <div className="flex items-center justify-between mb-2 px-1">
                    <h2 className={`text-sm font-bold ${col.heading} truncate`}>{col.title}</h2>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${col.heading} bg-white border`}>{items.length}</span>
                  </div>
                  <div className="space-y-2 overflow-y-auto flex-1 pr-1">
                    {items.length === 0 ? (
                      <p className="text-[10px] text-gray-400 text-center mt-4">Empty</p>
                    ) : items.map(r => (
                      <div key={r.id} className="card-stagger">
                        <KanbanCard
                          req={r}
                          onView={openView}
                          onForward={openForward}
                          onReject={openReject}
                          actionable={isActionable && (r.current_stage === 's2_pending' || r.current_stage === 's1_pending')}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right sidebar — My approval history */}
      <aside className="w-64 bg-gray-50 border border-gray-200 rounded-xl flex flex-col overflow-hidden shrink-0">
        <div className="px-3 py-3 border-b border-gray-200 bg-white">
          <h2 className="text-sm font-bold text-gray-900">My Approval History</h2>
          <p className="text-[11px] text-gray-500">Your last {history.length} actions</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          {history.length === 0 ? (
            <p className="text-xs text-gray-400 text-center mt-4">No history yet</p>
          ) : (
            <>
              {historyBuckets.today.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5 px-1">Today</p>
                  <div className="space-y-1.5">
                    {historyBuckets.today.map(e => <HistoryItem key={e.id} entry={e} onClick={openView} />)}
                  </div>
                </div>
              )}
              {historyBuckets.yesterday.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5 px-1">Yesterday</p>
                  <div className="space-y-1.5">
                    {historyBuckets.yesterday.map(e => <HistoryItem key={e.id} entry={e} onClick={openView} />)}
                  </div>
                </div>
              )}
              {historyBuckets.week.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5 px-1">This Week</p>
                  <div className="space-y-1.5">
                    {historyBuckets.week.map(e => <HistoryItem key={e.id} entry={e} onClick={openView} />)}
                  </div>
                </div>
              )}
              {historyBuckets.older.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5 px-1">Older</p>
                  <div className="space-y-1.5">
                    {historyBuckets.older.map(e => <HistoryItem key={e.id} entry={e} onClick={openView} />)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      {/* Detail / Action Modal */}
      {selected && modalMode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 modal-overlay">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto modal-content">
            <div className="p-6 border-b">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">
                    {modalMode === 'forward'
                      ? (selected.current_stage === 's1_pending' ? 'Fast-forward to Finance (Skip S1)' : 'Forward to Finance')
                      : modalMode === 'reject' ? 'Reject Request' : 'Request Details'}
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">{selected.ref_id} — {selected.employee?.name || selected.employee_name}</p>
                </div>
                <StageBadge stage={selected.current_stage} route={selected.approval_route} />
              </div>
              <div className="mt-3">
                <RouteIndicator route={selected.approval_route} stage={selected.current_stage} />
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Amount Requested</span><span className="font-bold">{fmt(selected.amount_requested)}</span></div>
                {selected.approved_amount && selected.approved_amount !== selected.amount_requested && (
                  <div className="flex justify-between"><span className="text-gray-500">Approved Amount</span><span className="font-bold text-green-700">{fmt(selected.approved_amount)}</span></div>
                )}
                <div className="flex justify-between"><span className="text-gray-500">Category</span><span>{selected.category}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Site</span><span>{selected.site}</span></div>
                {selected.purpose && <div className="flex justify-between"><span className="text-gray-500">Purpose</span><span className="text-right max-w-[280px]">{selected.purpose}</span></div>}
                <div className="flex justify-between"><span className="text-gray-500">Submitted</span><span>{fmtDate(selected.submitted_at)} {fmtTime(selected.submitted_at)}</span></div>
              </div>

              {/* Timeline of stage actions */}
              <div className="border rounded-xl p-4 space-y-2 text-sm">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Approval Trail</p>
                {selected.s1_approved_at && (
                  <div className="flex items-start gap-2">
                    <span className="text-blue-600 mt-0.5">●</span>
                    <div className="flex-1">
                      <div className="flex justify-between"><span className="font-semibold">S1 — Avisha</span><span className="text-xs text-gray-500">{fmtDate(selected.s1_approved_at)} {fmtTime(selected.s1_approved_at)}</span></div>
                      {selected.s1_notes && <p className="text-xs italic text-gray-600">"{selected.s1_notes}"</p>}
                    </div>
                  </div>
                )}
                {selected.s2_approved_at && (
                  <div className="flex items-start gap-2">
                    <span className={selected.current_stage === 's2_rejected' ? 'text-red-600 mt-0.5' : 'text-purple-600 mt-0.5'}>●</span>
                    <div className="flex-1">
                      <div className="flex justify-between">
                        <span className="font-semibold">{(selected.approval_route === 'avisha_director_finance_founder' || selected.approval_route === 'avisha_director_finance') ? 'Director' : 'S2 — Ritu'}</span>
                        <span className="text-xs text-gray-500">{fmtDate(selected.s2_approved_at)} {fmtTime(selected.s2_approved_at)}</span>
                      </div>
                      {selected.s2_notes && <p className="text-xs italic text-gray-600">"{selected.s2_notes}"</p>}
                      {selected.founder_review_comment && <p className="text-xs italic text-gray-600">Founder: "{selected.founder_review_comment}"</p>}
                    </div>
                  </div>
                )}
                {selected.paid_at && (
                  <div className="flex items-start gap-2">
                    <span className="text-green-600 mt-0.5">●</span>
                    <div className="flex-1">
                      <div className="flex justify-between"><span className="font-semibold">Finance — Paid</span><span className="text-xs text-gray-500">{fmtDate(selected.paid_at)} {fmtTime(selected.paid_at)}</span></div>
                      {selected.paid_amount && <p className="text-xs text-gray-600">Paid: {fmt(selected.paid_amount)}</p>}
                    </div>
                  </div>
                )}
                {selected.rejection_reason && (
                  <div className="flex items-start gap-2">
                    <span className="text-red-600 mt-0.5">✗</span>
                    <div className="flex-1">
                      <p className="font-semibold text-red-700">Rejection Reason</p>
                      <p className="text-xs italic text-red-600">"{selected.rejection_reason}"</p>
                    </div>
                  </div>
                )}
              </div>

              {modalMode === 'forward' && (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Approved Amount (₹) — you can reduce</label>
                    <input type="number" value={approveAmount} onChange={(e) => setApproveAmount(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
                    {parseFloat(approveAmount) < parseFloat(selected.amount_requested) && approveAmount && (
                      <p className="text-xs text-blue-600 mt-1">Amount reduced from {fmt(selected.amount_requested)} to {fmt(approveAmount)}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">S2 Approval Remark</label>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                      className="w-full border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-400" rows={2} />
                    <p className="text-xs text-gray-400 mt-1">This remark will be saved on the approval trail and visible to Finance.</p>
                  </div>
                </>
              )}

              {modalMode === 'reject' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Rejection Reason *</label>
                  <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm resize-none" rows={3} placeholder="Reason..." />
                </div>
              )}

              {actionError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{actionError}</p>}
            </div>
            <div className="p-6 border-t flex justify-end gap-3">
              <button onClick={closeModal} className="px-4 py-2 text-sm text-gray-600 border rounded-lg">Close</button>
              {modalMode === 'forward' && (
                <button onClick={handleForward} disabled={acting}
                  className="px-5 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60 active:scale-95 transition-all duration-150">
                  {acting ? 'Forwarding...' : selected?.current_stage === 's1_pending' ? 'Fast-forward to Finance' : 'Forward to Finance'}
                </button>
              )}
              {modalMode === 'reject' && (
                <button onClick={handleReject} disabled={acting}
                  className="px-5 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60">
                  {acting ? 'Rejecting...' : 'Reject'}
                </button>
              )}
              {modalMode === 'view' && (selected.current_stage === 's2_pending' || selected.current_stage === 's1_pending') && (
                <>
                  <button onClick={() => openReject(selected)} className="px-4 py-2 text-sm text-red-700 border border-red-300 rounded-lg hover:bg-red-50 active:scale-95 transition-all duration-150">Reject</button>
                  <button onClick={() => openForward(selected)} className="px-5 py-2 text-sm font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 active:scale-95 transition-all duration-150">
                    {selected.current_stage === 's1_pending' ? 'Fast-forward →' : 'Forward'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
