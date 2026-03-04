import { useState, FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LogIn, Mail } from 'lucide-react';

export default function LoginPage() {
  const { user, login, verifyOtp, resendOtp, loading: authLoading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [otpUserId, setOtpUserId] = useState<number | null>(null);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (authLoading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;
  if (user) return <Navigate to="/dashboard" replace />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (step === 'credentials') {
        const result = await login(username, password);
        if (result.step === 'otp') {
          setOtpUserId(result.userId);
          setStep('otp');
        }
      } else {
        await verifyOtp(otpUserId!, otp);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const [resendLoading, setResendLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState('');

  const handleResend = async () => {
    if (!otpUserId) return;
    setError('');
    setResendMessage('');
    setResendLoading(true);
    try {
      await resendOtp(otpUserId);
      setOtp('');
      setResendMessage('A new code has been sent to your email.');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to resend code');
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-primary-600 rounded-xl mb-4">
            <span className="text-white font-bold text-lg">E</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">ERP/CRM System</h1>
          <p className="text-sm text-gray-500 mt-1">
            {step === 'otp' ? 'Enter the code sent to your email' : 'Sign in to your account'}
          </p>
        </div>

        {step === 'credentials' ? (
          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Username</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                placeholder="Enter username"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                placeholder="Enter password"
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
                  <LogIn size={16} />
                  Sign In
                </>
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4">
            <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
              <Mail size={18} className="text-blue-500 shrink-0" />
              <p className="text-sm text-blue-800">A 6-digit code was sent to your email. Enter it below to continue.</p>
            </div>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}
            {resendMessage && (
              <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3">
                {resendMessage}
              </div>
            )}
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Verification Code</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                required
                autoFocus
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-center font-mono tracking-widest text-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                placeholder="000000"
              />
            </div>
            <button
              type="submit"
              disabled={loading || otp.length !== 6}
              className="w-full bg-primary-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              ) : (
                <>
                  <LogIn size={16} />
                  Verify
                </>
              )}
            </button>
            <p className="text-center text-sm text-gray-500">
              Didn't receive a code?{' '}
              <button type="button" onClick={handleResend} disabled={resendLoading} className="text-primary-600 hover:underline font-medium disabled:opacity-50">
                {resendLoading ? 'Sending…' : 'Resend'}
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
