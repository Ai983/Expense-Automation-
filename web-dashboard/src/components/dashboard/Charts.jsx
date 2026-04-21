import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

const PIE_COLOURS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export function SiteChart({ data, onBarClick }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Expenses by Site</h3>
      {onBarClick && <p className="text-xs text-gray-400 mb-3">Click a bar to see employee breakdown</p>}
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <XAxis dataKey="site" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(value) => [`₹${Number(value).toLocaleString('en-IN')}`, 'Total Amount']}
          />
          <Bar dataKey="totalAmount" fill="#e8a24a" radius={[4, 4, 0, 0]}
            cursor={onBarClick ? 'pointer' : undefined}
            onClick={onBarClick ? (d) => onBarClick(d.site) : undefined} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryChart({ data, onSliceClick }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-700 mb-1">Expenses by Category</h3>
      {onSliceClick && <p className="text-xs text-gray-400 mb-3">Click a slice to see employee breakdown</p>}
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} dataKey="count" nameKey="category" cx="50%" cy="50%" outerRadius={75}
            cursor={onSliceClick ? 'pointer' : undefined}
            onClick={onSliceClick ? (d) => onSliceClick(d.category) : undefined}
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
            {data.map((_, i) => (
              <Cell key={i} fill={PIE_COLOURS[i % PIE_COLOURS.length]} />
            ))}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StatusChart({ data }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Expenses by Status</h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 60 }}>
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <YAxis dataKey="status" type="category" tick={{ fontSize: 11 }} width={80} />
          <Tooltip />
          <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DrillDownTable({ title, data, type, onClose }) {
  if (!data) return null;
  const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

  return (
    <div className="card mb-6">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        <button onClick={onClose}
          className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded border">Close</button>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400">No data found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Employee</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Site</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Claims</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Total Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((emp, i) => (
                <tr key={i} className="hover:bg-amber-50/40 transition-colors">
                  <td className="px-4 py-2">
                    <div className="font-medium text-gray-900">{emp.name}</div>
                    <div className="text-xs text-gray-500">{emp.email}</div>
                  </td>
                  <td className="px-4 py-2 text-gray-600">{emp.site}</td>
                  <td className="px-4 py-2 text-right text-gray-700">{emp.count}</td>
                  <td className="px-4 py-2 text-right font-semibold text-gray-900">{fmt(emp.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
