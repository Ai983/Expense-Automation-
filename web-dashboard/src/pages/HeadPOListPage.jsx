import { useState, useEffect } from 'react';
import api from '../services/api';
import AgingPill from '../components/head/AgingPill';

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

const STATUS_STYLES = {
  pending_procurement: 'bg-orange-100 text-orange-800',
  pending_payment:     'bg-yellow-100 text-yellow-800',
  paid:                'bg-green-100 text-green-800',
  procurement_rejected:'bg-red-100 text-red-800',
  payment_rejected:    'bg-red-100 text-red-800',
};

const STATUS_LABELS = {
  pending_procurement: 'Pending Procurement',
  pending_payment:     'Pending Payment',
  paid:                'Paid',
  procurement_rejected:'Procurement Rejected',
  payment_rejected:    'Payment Rejected',
};

export default function HeadPOListPage() {
  const [pos, setPos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    api.get('/api/po-payments/all')
      .then((res) => setPos(res.data?.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = statusFilter ? pos.filter((p) => p.status === statusFilter) : pos;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">All PO Payments <span className="text-sm font-normal text-gray-400">(read-only)</span></h1>

      <div className="flex gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700">
          <option value="">All Statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <p className="text-sm text-gray-500">{filtered.length} records</p>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['PO Ref','Project','Site','Supplier','Amount','Status','Due Date','Age'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-brand-600">{p.cps_po_ref}</td>
                  <td className="px-4 py-3 text-gray-800 text-xs">{p.project_name}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{p.site}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{p.supplier_name}</td>
                  <td className="px-4 py-3 font-semibold">{fmt(p.total_amount)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_STYLES[p.status] || 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABELS[p.status] || p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {p.payment_due_date ? new Date(p.payment_due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {['pending_procurement','pending_payment'].includes(p.status) && (
                      <AgingPill submittedAt={p.created_at} stageAt={p.status === 'pending_payment' ? p.procurement_approved_at : null} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="text-center py-8 text-gray-400">No PO payments found</p>}
        </div>
      )}
    </div>
  );
}
