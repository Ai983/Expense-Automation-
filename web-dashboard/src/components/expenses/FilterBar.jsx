import { useEffect, useState } from 'react';
import { getEmployees } from '../../services/employeeService';

const STATUSES = ['all', 'pending', 'verified', 'manual_review', 'approved', 'rejected', 'blocked'];
const SITES = ['all', 'Mumbai', 'Delhi', 'Bangalore', 'Pune', 'Hyderabad'];

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
          onClick={() => onChange({ status: 'all', site: 'all', employeeId: 'all', dateFrom: '', dateTo: '' })}
        >
          Clear filters
        </button>
      </div>
    </div>
  );
}
