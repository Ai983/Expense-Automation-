import { useEffect, useState } from 'react';
import { getEmployees } from '../../services/employeeService';

const STATUSES = ['all', 'pending', 'verified', 'manual_review', 'approved', 'rejected', 'blocked'];
const SITES = [
  'all',
  'MAX Hospital, Saket Delhi',
  'Bhuj',
  'Vaneet Infra',
  'Dee Foundation Omaxe, Faridabad',
  'Auma India Bengaluru',
  'Minebea Mitsumi',
  'Hero Homes Ludhiana',
];

export default function FilterBar({ filters, onChange }) {
  const [employees, setEmployees] = useState([]);

  useEffect(() => {
    getEmployees().then(setEmployees).catch(() => {});
  }, []);

  function set(key, value) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="flex flex-wrap gap-3 mb-5">
      {/* Search */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">Search</label>
        <input
          type="text"
          className="input w-52 text-sm"
          placeholder="Ref ID, employee name..."
          value={filters.search || ''}
          onChange={(e) => set('search', e.target.value)}
        />
      </div>

      {/* Employee */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">Employee</label>
        <select className="select w-44" value={filters.employeeId || 'all'} onChange={(e) => set('employeeId', e.target.value)}>
          <option value="all">All Employees</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>{emp.name}</option>
          ))}
        </select>
      </div>

      {/* Status */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">Status</label>
        <select className="select w-44" value={filters.status} onChange={(e) => set('status', e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s === 'all' ? 'All Statuses' : s.replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      {/* Site */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">Site</label>
        <select className="select w-40" value={filters.site} onChange={(e) => set('site', e.target.value)}>
          {SITES.map((s) => (
            <option key={s} value={s}>{s === 'all' ? 'All Sites' : s}</option>
          ))}
        </select>
      </div>

      {/* Date From */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">From</label>
        <input
          type="date"
          className="input w-40"
          value={filters.dateFrom || ''}
          onChange={(e) => set('dateFrom', e.target.value)}
        />
      </div>

      {/* Date To */}
      <div>
        <label className="text-xs text-gray-500 block mb-1">To</label>
        <input
          type="date"
          className="input w-40"
          value={filters.dateTo || ''}
          onChange={(e) => set('dateTo', e.target.value)}
        />
      </div>

      {/* Clear */}
      <div className="flex items-end">
        <button
          className="btn-secondary text-sm"
          onClick={() => onChange({ status: 'all', site: 'all', employeeId: 'all', dateFrom: '', dateTo: '', search: '' })}
        >
          Clear filters
        </button>
      </div>
    </div>
  );
}
