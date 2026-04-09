import { useState, useEffect } from 'react';
import api from '../services/api';

function StarDisplay({ rating }) {
  return (
    <span className="text-lg tracking-wide">
      {[1, 2, 3, 4, 5].map((s) => (
        <span key={s} className={s <= rating ? 'text-amber-400' : 'text-gray-300'}>
          {s <= rating ? '\u2605' : '\u2606'}
        </span>
      ))}
    </span>
  );
}

export default function FeedbackPage() {
  const [feedback, setFeedback] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  useEffect(() => {
    fetchFeedback();
  }, [page]);

  async function fetchFeedback() {
    setLoading(true);
    try {
      const { data } = await api.get('/api/feedback', { params: { page, limit } });
      setFeedback(data.data.feedback);
      setTotal(data.data.total);
    } catch (err) {
      console.error('Failed to fetch feedback:', err);
    } finally {
      setLoading(false);
    }
  }

  const totalPages = Math.ceil(total / limit);
  const avgRating = feedback.length
    ? (feedback.reduce((sum, f) => sum + f.rating, 0) / feedback.length).toFixed(1)
    : '—';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Employee Feedback</h1>
          <p className="text-sm text-gray-500 mt-1">
            {total} response{total !== 1 ? 's' : ''} · Avg rating: {avgRating}/5
          </p>
        </div>
        <button onClick={fetchFeedback} className="btn-secondary text-sm">
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-16">Loading feedback...</div>
      ) : feedback.length === 0 ? (
        <div className="text-center text-gray-400 py-16">No feedback yet.</div>
      ) : (
        <>
          <div className="space-y-4">
            {feedback.map((item) => (
              <div key={item.id} className="card">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{item.employee?.name || 'Unknown'}</p>
                    <p className="text-xs text-gray-500">
                      {item.employee?.site} · {item.employee?.email}
                    </p>
                  </div>
                  <div className="text-right">
                    <StarDisplay rating={item.rating} />
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(item.created_at).toLocaleDateString('en-IN', {
                        day: 'numeric', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-sm text-gray-700 whitespace-pre-wrap">{item.comment}</p>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 mt-6">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-secondary text-sm disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-sm text-gray-500">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="btn-secondary text-sm disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
