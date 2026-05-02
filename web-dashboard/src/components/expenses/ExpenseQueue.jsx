import { useState, useCallback, useEffect } from 'react';
import { getExpenseQueue, bulkApprove } from '../../services/expenseService';
import { useWebSocket } from '../../hooks/useWebSocket';
import FilterBar from './FilterBar';
import StatusBadge from './StatusBadge';
import ExpenseDetailModal from './ExpenseDetailModal';
import { showToast } from '../layout/Toast';
import api from '../../services/api';

// ── Imprest Reminders Panel ───────────────────────────────────────────────────
function ImprestRemindersPanel() {
  const [reminders, setReminders] = useState([]);
  const [unblocking, setUnblocking] = useState(null);

  const fetchReminders = useCallback(async () => {
    try {
      const { data } = await api.get('/api/imprest/finance/reminders');
      setReminders(data.data.reminders || []);
    } catch { /* silently fail */ }
  }, []);

  useEffect(() => { fetchReminders(); }, [fetchReminders]);

  const handleUnblock = async (employeeId) => {
    setUnblocking(employeeId);
    try {
      await api.post(`/api/imprest/finance/unblock/${employeeId}`);
      showToast('Employee unblocked successfully', 'success');
      fetchReminders();
    } catch {
      showToast('Failed to unblock employee', 'error');
    } finally {
      setUnblocking(null);
    }
  };

  if (reminders.length === 0) return null;

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">
        ⏰ Imprest Expense Reminders
        <span className="ml-2 text-xs font-normal text-gray-500">
          Employees must submit expense within 3 days of imprest approval
        </span>
      </h3>
      <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-amber-50 border-b border-amber-100">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-amber-800">Imprest Ref</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-amber-800">Employee</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-amber-800">Site</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-amber-800">Approved ₹</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-amber-800">Spent / Balance</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-amber-800">Deadline</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-amber-800">Status</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-amber-800">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-50">
            {reminders.map((r) => {
              const deadline = new Date(r.deadline);
              const msLeft = deadline - Date.now();
              const hoursLeft = Math.floor(msLeft / (1000 * 60 * 60));
              const isExpired = r.status === 'expired' || msLeft <= 0;

              return (
                <tr key={r.id} className={isExpired ? 'bg-red-50' : 'hover:bg-amber-50 transition-colors'}>
                  <td className="px-4 py-2 font-mono text-xs font-semibold text-amber-700">{r.imprest_ref_id}</td>
                  <td className="px-4 py-2">
                    <div className="font-medium text-gray-900">{r.employee?.name || '—'}</div>
                    <div className="text-xs text-gray-500">{r.employee?.site}</div>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600">{r.imprest?.site}</td>
                  <td className="px-4 py-2 text-right font-semibold text-gray-900">
                    ₹{Number(r.imprest?.approved_amount || r.imprest?.amount_requested || 0).toLocaleString('en-IN')}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {(() => {
                      const approved = Number(r.imprest?.approved_amount || r.imprest?.amount_requested || 0);
                      const fulfilled = Number(r.fulfilled_amount || 0);
                      const remaining = Math.max(0, approved - fulfilled);
                      if (fulfilled > 0) return (
                        <div>
                          <div className="text-xs text-green-600 font-semibold">Spent: ₹{fulfilled.toLocaleString('en-IN')}</div>
                          <div className={`text-xs font-bold ${remaining > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {remaining > 0 ? `Bal: ₹${remaining.toLocaleString('en-IN')}` : 'Settled'}
                          </div>
                        </div>
                      );
                      return <span className="text-xs text-gray-400">No expenses yet</span>;
                    })()}
                  </td>
                  <td className="px-4 py-2">
                    <div className="text-xs text-gray-700">
                      {deadline.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </div>
                    {!isExpired && (
                      <div className={`text-xs font-semibold ${hoursLeft < 24 ? 'text-red-600' : 'text-orange-600'}`}>
                        {hoursLeft > 0 ? `${hoursLeft}h remaining` : 'Due very soon'}
                      </div>
                    )}
                    {isExpired && (
                      <div className="text-xs text-red-600 font-semibold">Overdue</div>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {isExpired ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-700">
                        Blocked
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-yellow-100 text-yellow-800">
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {isExpired && r.employee?.imprest_blocked && (
                      <button
                        onClick={() => handleUnblock(r.employee.id)}
                        disabled={unblocking === r.employee.id}
                        className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
                      >
                        {unblocking === r.employee.id ? 'Unblocking…' : 'Unblock'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VerificationBadge({ expense }) {
  const conf = expense.screenshot_metadata?.confidence;
  const status = expense.status;

  if (status === 'verified') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
        ✓ Genuine
      </span>
    );
  }
  if (status === 'blocked') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
        ✗ Blocked
      </span>
    );
  }
  if (status === 'manual_review') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">
        ⚠ Needs Review
      </span>
    );
  }
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
        ✓ Approved
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
        — Rejected
      </span>
    );
  }
  // pending with confidence
  if (conf != null) {
    if (conf >= 94) return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-600">
        ✓ High ({conf}%)
      </span>
    );
    if (conf >= 70) return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-50 text-orange-600">
        ⚠ Medium ({conf}%)
      </span>
    );
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-600">
        ✗ Low ({conf}%)
      </span>
    );
  }
  return <span className="text-xs text-gray-400">—</span>;
}

function downloadCSV(expenses) {
  const headers = ['Ref ID', 'Employee', 'Site', 'Amount', 'Category', 'Status', 'OCR Confidence', 'Duplicate', 'Description', 'Submitted'];
  const rows = expenses.map((e) => [
    e.ref_id,
    e.employee?.name || '',
    e.site,
    e.amount,
    e.category,
    e.status,
    e.screenshot_metadata?.confidence ?? '',
    e.duplicate_flag ? 'Yes' : 'No',
    (e.description || '').replace(/"/g, '""'),
    new Date(e.submitted_at).toLocaleDateString('en-IN'),
  ]);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `expenses_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExpenseQueue() {
  const [expenses, setExpenses] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: 'all', site: 'all', employeeId: 'all', dateFrom: '', dateTo: '', search: '' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());
  const [detailId, setDetailId] = useState(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [liveCount, setLiveCount] = useState(0);

  const LIMIT = 50;

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getExpenseQueue({ ...filters, page, limit: LIMIT });
      setExpenses(result.expenses || []);
      setTotal(result.total || 0);
    } catch {
      showToast('Failed to load expenses', 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    fetchQueue();
    setSelected(new Set());
  }, [fetchQueue]);

  const handleNewExpense = useCallback(() => {
    setLiveCount((c) => c + 1);
  }, []);
  useWebSocket(handleNewExpense);

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const approvable = expenses.filter((e) => ['pending', 'verified', 'manual_review', 'blocked'].includes(e.status));
    if (selected.size === approvable.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(approvable.map((e) => e.id)));
    }
  }

  async function handleBulkApprove() {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      const result = await bulkApprove([...selected]);
      showToast(`${result.approved} expenses approved`, 'success');
      setSelected(new Set());
      fetchQueue();
    } catch (err) {
      showToast(err.response?.data?.error || 'Bulk approval failed', 'error');
    } finally {
      setBulkLoading(false);
    }
  }

  // Client-side search filter
  const searchQuery = (filters.search || '').toLowerCase().trim();
  const displayedExpenses = searchQuery
    ? expenses.filter((e) =>
        (e.ref_id || '').toLowerCase().includes(searchQuery) ||
        (e.employee?.name || '').toLowerCase().includes(searchQuery) ||
        (e.category || '').toLowerCase().includes(searchQuery) ||
        (e.site || '').toLowerCase().includes(searchQuery)
      )
    : expenses;

  const totalPages = Math.ceil(total / LIMIT);
  const approvableExpenses = displayedExpenses.filter((e) => ['pending', 'verified', 'manual_review', 'blocked'].includes(e.status));

  return (
    <div>
      <ImprestRemindersPanel />

      {/* Live update banner */}
      {liveCount > 0 && (
        <button
          className="w-full mb-4 bg-blue-50 border border-blue-200 text-blue-700 text-sm py-2 rounded-lg hover:bg-blue-100 transition"
          onClick={() => { fetchQueue(); setLiveCount(0); }}
        >
          {liveCount} new expense{liveCount > 1 ? 's' : ''} submitted — click to refresh
        </button>
      )}

      <FilterBar filters={filters} onChange={(f) => { setFilters(f); setPage(1); }} />

      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-gray-400">
          {searchQuery ? `${displayedExpenses.length} of ${total}` : total} expense{total !== 1 ? 's' : ''} found
        </p>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-500 flex items-center gap-1.5">
            <span className="text-red-500 font-bold">🚩</span>
            No Imprest Request
          </span>
          <span className="text-xs text-gray-500 flex items-center gap-1.5">
            <span className="text-purple-600 font-bold">💸</span>
            Overspend flagged
          </span>
          <button
            onClick={() => downloadCSV(displayedExpenses)}
            className="btn-secondary text-sm"
            title="Download filtered data as CSV"
          >
            Download CSV
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-4 bg-brand-50 border border-brand-500 rounded-lg px-4 py-3 mb-4">
          <span className="text-sm font-medium text-brand-700">{selected.size} selected</span>
          <button className="btn-primary text-sm" disabled={bulkLoading} onClick={handleBulkApprove}>
            {bulkLoading ? 'Approving...' : `✓ Approve ${selected.size}`}
          </button>
          <button className="text-sm text-gray-500 hover:text-gray-700" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={approvableExpenses.length > 0 && selected.size === approvableExpenses.length}
                    onChange={toggleSelectAll}
                    className="rounded"
                  />
                </th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Ref ID</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Employee</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Site</th>
                <th className="text-right px-4 py-3 text-gray-600 font-medium">Amount</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Category</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">OCR Verification</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Status</th>
                <th className="text-left px-4 py-3 text-gray-600 font-medium">Submitted</th>
                <th className="w-16 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={10} className="text-center py-12 text-gray-400">Loading expenses...</td></tr>
              ) : displayedExpenses.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-12 text-gray-400">No expenses found</td></tr>
              ) : (
                displayedExpenses.map((exp) => {
                  const canSelect = ['pending', 'verified', 'manual_review'].includes(exp.status);
                  return (
                    <tr key={exp.id} className={`transition-colors ${!exp.imprest_id ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'}`}>
                      <td className="px-4 py-3">
                        {canSelect && (
                          <input
                            type="checkbox"
                            checked={selected.has(exp.id)}
                            onChange={() => toggleSelect(exp.id)}
                            className="rounded"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">
                        {exp.ref_id}
                        {exp.duplicate_flag && <span className="ml-1 text-orange-500" title="Duplicate warning">⚠</span>}
                        {!exp.imprest_id && (
                          <span
                            className="ml-1 text-red-500"
                            title="No Imprest Request found — this expense was submitted without a prior imprest approval. Verify manually."
                          >🚩</span>
                        )}
                        {exp.overspend_amount > 0 && (
                          <span
                            className="ml-1 text-purple-600"
                            title={`Overspend: ₹${Number(exp.overspend_amount).toLocaleString('en-IN')} above imprest balance`}
                          >💸</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-800">{exp.employee?.name}</td>
                      <td className="px-4 py-3 text-gray-600">{exp.site}</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        ₹{Number(exp.amount).toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{exp.category}</td>
                      <td className="px-4 py-3">
                        <VerificationBadge expense={exp} />
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={exp.status} /></td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {new Date(exp.submitted_at).toLocaleDateString('en-IN')}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setDetailId(exp.id)}
                          className="text-brand-600 hover:text-brand-700 text-xs font-medium"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-gray-600">
            <span>{total} total</span>
            <div className="flex gap-2">
              <button className="btn-secondary py-1 px-3 text-xs" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span className="py-1 px-3 text-xs">Page {page} of {totalPages}</span>
              <button className="btn-secondary py-1 px-3 text-xs" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {detailId && (
        <ExpenseDetailModal
          expenseId={detailId}
          onClose={() => setDetailId(null)}
          onAction={() => fetchQueue()}
        />
      )}
    </div>
  );
}
