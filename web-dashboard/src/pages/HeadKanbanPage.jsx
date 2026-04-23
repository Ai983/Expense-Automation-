import { useState, useEffect, useMemo } from 'react';
import { getKanban } from '../services/headService';
import KanbanColumn from '../components/head/KanbanColumn';
import { getAgingLevel } from '../components/head/AgingPill';

const SITES = [
  'All', 'Head Office', 'Bhuj', 'Bansal Tower', 'MAX Hospital, Saket Delhi',
  'Vaneet Infra', 'Dee Foundation Omaxe, Faridabad', 'Auma India Bengaluru',
  'Minebea Mitsumi', 'Hero Homes Ludhiana', 'KOKO Town, Chandigarh', 'Bangalore Office',
];

function stageTimestamp(item, stream) {
  if (stream === 'imprest') {
    const s = item.current_stage;
    if (s === 's2_pending') return item.s1_approved_at || item.submitted_at;
    if (s === 's3_pending') return item.s2_approved_at || item.submitted_at;
    if (s === 's3_approved') return item.approved_at || item.submitted_at;
    return item.submitted_at;
  }
  if (stream === 'po' && item.status === 'pending_payment') {
    return item.procurement_approved_at || item.created_at;
  }
  return item.submitted_at || item.created_at;
}

function agingOf(item, stream) {
  return getAgingLevel(item.submitted_at || item.created_at, stageTimestamp(item, stream));
}

export default function HeadKanbanPage() {
  const [data, setData] = useState({ imprests: [], expenses: [], pos: [] });
  const [loading, setLoading] = useState(true);
  const [stream, setStream] = useState('all');
  const [site, setSite] = useState('All');
  const [ageFilter, setAgeFilter] = useState('all');

  useEffect(() => {
    getKanban()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filter = (items, streamKey) => {
    let out = items;
    if (site !== 'All') out = out.filter((i) => (i.site || i.project_name) === site);
    if (ageFilter === 'aging') out = out.filter((i) => ['yellow', 'amber', 'red'].includes(agingOf(i, streamKey)));
    if (ageFilter === 'red') out = out.filter((i) => agingOf(i, streamKey) === 'red');
    return out;
  };

  const imprests = useMemo(() => filter(data.imprests, 'imprest'), [data, site, ageFilter]);
  const expenses = useMemo(() => filter(data.expenses, 'expense'), [data, site, ageFilter]);
  const pos = useMemo(() => filter(data.pos, 'po'), [data, site, ageFilter]);

  const imprestColumns = [
    { key: 's1_pending',   title: 'S1 Pending', color: 'bg-yellow-100', items: imprests.filter((i) => i.current_stage === 's1_pending') },
    { key: 's2_ritu',      title: 'S2 – Ritu', color: 'bg-blue-100',   items: imprests.filter((i) => i.current_stage === 's2_pending' && i.approval_route !== 'avisha_director_finance') },
    { key: 's2_director',  title: 'Director WA', color: 'bg-purple-100', items: imprests.filter((i) => i.current_stage === 's2_pending' && i.approval_route === 'avisha_director_finance') },
    { key: 's3_pending',   title: 'Finance Pending', color: 'bg-orange-100', items: imprests.filter((i) => i.current_stage === 's3_pending') },
    { key: 's3_approved',  title: 'Approved – Unpaid', color: 'bg-teal-100', items: imprests.filter((i) => i.current_stage === 's3_approved') },
  ];

  const expenseColumns = [
    { key: 'pending', title: 'Pending Review', color: 'bg-yellow-100', items: expenses.filter((i) => ['pending', 'manual_review'].includes(i.status)) },
    { key: 'verified', title: 'Auto-Verified', color: 'bg-blue-100', items: expenses.filter((i) => i.status === 'verified') },
  ];

  const poColumns = [
    { key: 'pending_procurement', title: 'Pending Procurement', color: 'bg-orange-100', items: pos.filter((i) => i.status === 'pending_procurement') },
    { key: 'pending_payment',     title: 'Pending Payment',     color: 'bg-yellow-100', items: pos.filter((i) => i.status === 'pending_payment') },
  ];

  const showImprest = stream === 'all' || stream === 'imprest';
  const showExpense = stream === 'all' || stream === 'expense';
  const showPO      = stream === 'all' || stream === 'po';

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Loading Kanban…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900 mr-2">Workflow Board</h1>

        {/* Stream filter */}
        {['all', 'imprest', 'expense', 'po'].map((s) => (
          <button
            key={s}
            onClick={() => setStream(s)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition ${stream === s ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-gray-600 border-gray-300 hover:border-brand-400'}`}
          >
            {s === 'all' ? 'All' : s === 'imprest' ? 'Imprest' : s === 'expense' ? 'Expense' : 'PO'}
          </button>
        ))}

        {/* Site filter */}
        <select
          value={site}
          onChange={(e) => setSite(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700"
        >
          {SITES.map((s) => <option key={s}>{s}</option>)}
        </select>

        {/* Age filter */}
        <select
          value={ageFilter}
          onChange={(e) => setAgeFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-700"
        >
          <option value="all">All ages</option>
          <option value="aging">Aging (yellow+)</option>
          <option value="red">Bottlenecks (red only)</option>
        </select>
      </div>

      {showImprest && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Imprest</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {imprestColumns.map((col) => (
              <KanbanColumn key={col.key} title={col.title} items={col.items} stream="imprest" colorClass={col.color} />
            ))}
          </div>
        </section>
      )}

      {showExpense && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Expenses</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {expenseColumns.map((col) => (
              <KanbanColumn key={col.key} title={col.title} items={col.items} stream="expense" colorClass={col.color} />
            ))}
          </div>
        </section>
      )}

      {showPO && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">PO Payments</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {poColumns.map((col) => (
              <KanbanColumn key={col.key} title={col.title} items={col.items} stream="po" colorClass={col.color} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
