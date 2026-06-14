import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { showToast } from '../components/layout/Toast';

function fmtDate(d) {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function WeeklyOverridesPage() {
  const [weekStart, setWeekStart] = useState(null);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/api/imprest/weekly-overrides/at-limit-sites');
      setSites(data.data?.sites || []);
      setWeekStart(data.data?.weekStart || null);
    } catch {
      showToast('Failed to load weekly limits', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const grant = async (site) => {
    const reason = window.prompt(`Allow another emergency advance (>₹10,000) for "${site}" this week?\n\nOptional reason:`, '');
    if (reason === null) return; // cancelled
    setBusy((b) => ({ ...b, [site]: true }));
    try {
      await api.post('/api/imprest/weekly-overrides', { site, reason: reason.trim() || undefined });
      showToast(`✓ Override granted for ${site}`, 'success');
      fetchData();
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to grant override', 'error');
    } finally {
      setBusy((b) => ({ ...b, [site]: false }));
    }
  };

  const revoke = async (site, overrideId) => {
    setBusy((b) => ({ ...b, [site]: true }));
    try {
      await api.delete(`/api/imprest/weekly-overrides/${overrideId}`);
      showToast(`Override revoked for ${site}`, 'info');
      fetchData();
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to revoke', 'error');
    } finally {
      setBusy((b) => ({ ...b, [site]: false }));
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Weekly Emergency Overrides</h1>
        <p className="text-sm text-gray-500 mt-1">
          Each site may raise only one emergency advance (&gt;₹10,000) per week. Sites that have already used
          their slot this week are listed below — grant an override to let them raise another. Overrides apply
          only to the current week (Mon–Sun) and expire automatically.
        </p>
        {weekStart && (
          <p className="text-xs text-gray-400 mt-1">Current week starting <span className="font-semibold">{fmtDate(weekStart)}</span></p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center">
          <h2 className="text-sm font-semibold text-gray-700">Sites at their weekly limit</h2>
          <button
            onClick={fetchData}
            className="ml-auto text-xs font-medium text-amber-600 hover:text-amber-700"
          >
            ↻ Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Site</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">&gt;₹10k this week</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Granted By</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
              ) : sites.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                    <div className="text-3xl mb-2">✅</div>
                    No site has hit its weekly emergency limit yet this week
                  </td>
                </tr>
              ) : (
                sites.map((s) => (
                  <tr key={s.site} className="hover:bg-amber-50/40 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{s.site}</td>
                    <td className="px-4 py-3 text-center text-gray-700">{s.bigCount}</td>
                    <td className="px-4 py-3">
                      {s.override ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                          Override active
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 border border-orange-200">
                          At limit
                        </span>
                      )}
                      {s.override?.reason && (
                        <div className="text-xs text-gray-400 mt-1">{s.override.reason}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{s.override?.creator?.name || '--'}</td>
                    <td className="px-4 py-3 text-right">
                      {s.override ? (
                        <button
                          onClick={() => revoke(s.site, s.override.id)}
                          disabled={busy[s.site]}
                          className="text-xs font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                          {busy[s.site] ? '…' : 'Revoke'}
                        </button>
                      ) : (
                        <button
                          onClick={() => grant(s.site)}
                          disabled={busy[s.site]}
                          className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                        >
                          {busy[s.site] ? '…' : 'Allow another'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
