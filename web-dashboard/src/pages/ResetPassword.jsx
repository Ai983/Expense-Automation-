import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    // Supabase sends tokens in the URL hash after clicking the reset link.
    // The JS client automatically picks them up and sets the session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === 'PASSWORD_RECOVERY') {
          setSessionReady(true);
        }
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  async function handleReset(e) {
    e.preventDefault();
    setError('');
    setMessage('');

    if (password.length < 6) {
      return setError('Password must be at least 6 characters.');
    }
    if (password !== confirm) {
      return setError('Passwords do not match.');
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setMessage('Password updated successfully! You can now log in with your new password in the mobile app.');
    } catch (err) {
      setError(err.message || 'Failed to reset password. The link may have expired — request a new one from the app.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">HagerStone</h1>
          <p className="text-sm text-gray-500 mt-1">Reset Your Password</p>
        </div>

        <div className="card">
          {message ? (
            <div className="text-center space-y-4">
              <div className="text-green-600 bg-green-50 rounded-lg px-4 py-3 text-sm">
                {message}
              </div>
              <p className="text-xs text-gray-500">You can close this page now.</p>
            </div>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                <input
                  type="password"
                  className="input"
                  placeholder="Enter new password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                <input
                  type="password"
                  className="input"
                  placeholder="Confirm new password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              {!sessionReady && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                  Verifying your reset link... If this stays, the link may have expired.
                </p>
              )}
              <button
                type="submit"
                className="btn-primary w-full"
                disabled={loading || !sessionReady}
              >
                {loading ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
