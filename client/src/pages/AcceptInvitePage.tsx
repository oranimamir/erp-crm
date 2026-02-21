import { useState, useEffect, FormEvent } from 'react';
import { useSearchParams, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import { UserPlus } from 'lucide-react';

export default function AcceptInvitePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [inviteInfo, setInviteInfo] = useState<{ email: string; display_name: string; role: string } | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError('No invitation token provided');
      setLoadingInfo(false);
      return;
    }
    api.get(`/auth/invite-info?token=${token}`)
      .then(res => {
        setInviteInfo(res.data);
        setDisplayName(res.data.display_name || '');
      })
      .catch(err => {
        setLoadError(err.response?.data?.error || 'Invalid or expired invitation');
      })
      .finally(() => setLoadingInfo(false));
  }, [token]);

  if (user) return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim()) { setError('Username is required'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }

    setLoading(true);
    try {
      const res = await api.post('/auth/accept-invite', {
        token,
        username: username.trim(),
        password,
        display_name: displayName.trim() || undefined,
      });
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      window.location.href = '/dashboard';
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-primary-600 rounded-xl mb-4">
            <span className="text-white font-bold text-lg">E</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Accept Invitation</h1>
          <p className="text-sm text-gray-500 mt-1">Set up your account</p>
        </div>

        {loadingInfo ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : loadError ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
              {loadError}
            </div>
            <a href="/login" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
              Go to Login
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm">
              <p className="text-gray-500">Invitation for:</p>
              <p className="font-medium text-gray-900">{inviteInfo?.email}</p>
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Username *</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                placeholder="Choose a username"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                placeholder="Your name"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Password *</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                placeholder="Create a password"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Confirm Password *</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                placeholder="Confirm password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              ) : (
                <>
                  <UserPlus size={16} />
                  Create Account
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
