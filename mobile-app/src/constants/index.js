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
