export const SITES = ['Mumbai', 'Delhi', 'Bangalore', 'Pune', 'Hyderabad'];

export const CATEGORIES = ['Vendor', 'Labour', 'Material', 'Transport', 'Other'];

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
