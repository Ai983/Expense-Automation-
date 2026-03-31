export const SITES = [
  'Head Office',
  'Andritz',
  'Theon Lifescience',
  'Consern Pharma',
  'Bhuj',
  'Kotputli Project',
  'Bansal Tower Gurugram',
  'VinFast',
  'Minebea Mitsumi',
  'Chattargarh',
  'Valorium',
  'Jasrasar',
  'Hanumangarh',
  'Himalaya',
  'Microsave',
  'Bangalore Branch Office',
  'Vinfast-Ghaziabad',
  'AU Space Office Ludhiana',
  'Vinfast - Patparganj',
  'Auma India Bengaluru',
  'Vaneet Infra',
  'MAX Hospital, Saket Delhi',
  'Dee Foundation Omaxe, Faridabad',
  'Hero Homes Ludhiana',
  'Delhi NCR',
];

export const CATEGORIES = [
  'Food Expense',
  'Site Room',
  'Travelling',
  'Software',
  'Labour Expense',
  'Material Expense',
  'Site Expense',
  'Office Expense',
  'Employee Welfare',
  'DA- Expense',
  'BT- Expense',
  'Porter Expenses',
];

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export const IMPREST_SITES = [
  'MAX Hospital, Saket Delhi',
  'Bhuj',
  'Vaneet Infra',
  'Dee Foundation Omaxe, Faridabad',
  'Auma India Bengaluru',
  'Minebea Mitsumi',
  'Hero Homes Ludhiana',
];

export const IMPREST_REQUESTED_TO = [
  'Dhruv Sir',
  'Bhaskar Sir',
];

export const IMPREST_CATEGORIES = [
  'Food Expense',
  'Site Room',
  'Travelling',
  'Labour Expense',
  'Material Expense',
  'Other',
];

export const IMPREST_STATUS_LABELS = {
  pending: 'Awaiting Approval',
  approved: 'Approved ✓',
  rejected: 'Rejected',
  partially_approved: 'Partially Approved',
};

export const IMPREST_STATUS_COLOURS = {
  pending: '#f59e0b',
  approved: '#10b981',
  rejected: '#ef4444',
  partially_approved: '#3b82f6',
};

export const STATUS_LABELS = {
  pending: 'Pending Review',
  verified: 'Auto-Verified',
  manual_review: 'Under Review',
  approved: 'Approved ✓',
  rejected: 'Rejected',
  blocked: 'Blocked',
};

export const STATUS_COLOURS = {
  pending: '#f59e0b',
  verified: '#3b82f6',
  manual_review: '#f97316',
  approved: '#10b981',
  rejected: '#ef4444',
  blocked: '#6b7280',
};
