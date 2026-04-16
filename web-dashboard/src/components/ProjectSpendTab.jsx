// web-dashboard/src/components/ProjectSpendTab.jsx
// SPEC-02 Part D3 — Finance Dashboard: Project Spend Analytics tab
import { useState, useEffect } from 'react';
import api from '../services/api';

function fmt(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

export default function ProjectSpendTab() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/po-payments/project-spend')
      .then(res => setData(res.data || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400 bg-white rounded-xl border">
        <p>No project spend data yet</p>
        <p className="text-sm mt-1">Data will appear once POs are paid through the system</p>
      </div>
    );
  }

  const totalPO = data.reduce((s, p) => s + p.po_spend, 0);
  const totalImprest = data.reduce((s, p) => s + p.imprest_spend, 0);
  const totalExpense = data.reduce((s, p) => s + p.expense_spend, 0);
  const grandTotal = data.reduce((s, p) => s + p.total_spend, 0);

  return (
    <div className="space-y-4">
      {/* Grand totals */}
      <div className="bg-white rounded-xl border p-5 flex flex-wrap gap-6">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total PO Spend</p>
          <p className="text-xl font-semibold mt-0.5">{fmt(totalPO)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total Imprest</p>
          <p className="text-xl font-semibold mt-0.5">{fmt(totalImprest)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total Expenses</p>
          <p className="text-xl font-semibold mt-0.5">{fmt(totalExpense)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide font-bold">Grand Total</p>
          <p className="text-xl font-bold mt-0.5">{fmt(grandTotal)}</p>
        </div>
      </div>

      {/* Per-project breakdown */}
      {data.map(project => {
        const total = project.total_spend || 1;
        const poPct = ((project.po_spend / total) * 100).toFixed(1);
        const imprestPct = ((project.imprest_spend / total) * 100).toFixed(1);
        const expensePct = ((project.expense_spend / total) * 100).toFixed(1);

        return (
          <div key={project.project_name} className="bg-white rounded-xl border p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-medium text-gray-900">{project.project_name}</p>
                {project.sites?.length > 0 && (
                  <p className="text-xs text-gray-400">{project.sites.join(', ')}</p>
                )}
              </div>
              <p className="text-lg font-semibold">{fmt(project.total_spend)}</p>
            </div>

            {/* Stacked bar */}
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden flex">
              <div className="bg-blue-500 h-full" style={{ width: `${poPct}%` }} />
              <div className="bg-amber-400 h-full" style={{ width: `${imprestPct}%` }} />
              <div className="bg-purple-400 h-full" style={{ width: `${expensePct}%` }} />
            </div>

            <div className="flex gap-5 mt-2 text-xs text-gray-500">
              <span>
                <span className="inline-block w-2 h-2 rounded-full bg-blue-500 mr-1" />
                PO: {fmt(project.po_spend)}
              </span>
              <span>
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />
                Imprest: {fmt(project.imprest_spend)}
              </span>
              <span>
                <span className="inline-block w-2 h-2 rounded-full bg-purple-400 mr-1" />
                Expenses: {fmt(project.expense_spend)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
