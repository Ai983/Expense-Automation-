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
  'Site Expense',
  'Office Expense',
  'Employee Welfare',
  'DA- Expense',
  'BT- Expense',
  'Porter Expenses',
];

export const ROLES = ['employee', 'finance', 'manager', 'admin', 'approver_s1', 'approver_s2', 'procurement_finance', 'head'];

export const FINANCE_ROLES = ['finance', 'manager', 'admin'];

// Multi-stage approval roles
export const S1_ROLES = ['approver_s1', 'admin'];
export const S2_ROLES = ['approver_s2', 'admin'];
export const S3_ROLES = ['finance', 'manager', 'admin'];
export const ALL_DASHBOARD_ROLES = ['approver_s1', 'approver_s2', 'finance', 'manager', 'admin', 'head'];

// Head role — read-only across all modules
export const HEAD_ROLES = ['head', 'admin'];

// Finance roles + head (for read-only GET routes that finance views)
export const FINANCE_HEAD_ROLES = ['finance', 'manager', 'admin', 'head'];

// Sites that always go through Ritu (not Bhaskar) regardless of amount
export const RITU_ALWAYS_SITES = ['Head Office', 'Bangalore Office'];

// Amount threshold for director approval
export const DIRECTOR_APPROVAL_THRESHOLD = 10000;

export const EXPENSE_STATUSES = [
  'pending',
  'verified',
  'manual_review',
  'approved',
  'rejected',
  'blocked',
];

export const IMPREST_SITES = [
  'MAX Hospital, Saket Delhi',
  'Bhuj',
  'Vaneet Infra',
  'Dee Foundation Omaxe, Faridabad',
  'Auma India Bengaluru',
  'Minebea Mitsumi',
  'Hero Homes Ludhiana',
  'Bansal Tower',
  'KOKO Town, Chandigarh',
  'Head Office',
  'Bangalore Office',
  'Others',
];

export const IMPREST_CATEGORIES = [
  'Food Expense',
  'Site Room Rent',
  'Travelling',
  'Conveyance',
  'Labour Expense',
  'Porter',
  'Hotel Expense',
  'Site Expense',
  'Other',
];

export const STORAGE_BUCKET = 'expense-screenshots';

export const SIGNED_URL_EXPIRY_SECONDS = 3600; // 1 hour
