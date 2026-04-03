import ExpenseQueue from '../components/expenses/ExpenseQueue';

export default function ExpenseQueuePage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Expense Queue</h1>
        <p className="text-sm text-gray-500 mt-1">Review, verify, and approve employee expense submissions</p>
      </div>
      <ExpenseQueue />
    </div>
  );
}
