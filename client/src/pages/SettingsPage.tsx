import { useState } from 'react';
import { Settings, Lock, Monitor, Sun, Moon } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { useTheme } from '../contexts/ThemeContext';

export default function SettingsPage() {
  const { addToast } = useToast();
  const { theme, toggleTheme } = useTheme();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      addToast('New passwords do not match', 'error');
      return;
    }
    if (newPassword.length < 4) {
      addToast('New password must be at least 4 characters', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      addToast('Password changed successfully', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to change password', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Settings size={24} className="text-primary-600" />
          Settings
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your account and preferences</p>
      </div>

      {/* Change Password */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Lock size={16} className="text-gray-500" />
            Change Password
          </h2>
        </div>
        <form onSubmit={handleChangePassword} className="px-6 py-5 space-y-4">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              required
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="Enter current password"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              minLength={4}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="Enter new password"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              placeholder="Confirm new password"
            />
          </div>
          <div className="pt-1">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving...' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>

      {/* Appearance */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Monitor size={16} className="text-gray-500" />
            Appearance
          </h2>
        </div>
        <div className="px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Theme</p>
              <p className="text-sm text-gray-500 mt-0.5">Choose between light and dark mode</p>
            </div>
            <button
              onClick={toggleTheme}
              className={`relative inline-flex items-center gap-3 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                theme === 'dark'
                  ? 'bg-gray-800 border-gray-600 text-gray-100 hover:bg-gray-700'
                  : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {theme === 'dark' ? (
                <>
                  <Moon size={16} className="text-primary-400" />
                  Dark mode
                </>
              ) : (
                <>
                  <Sun size={16} className="text-amber-500" />
                  Light mode
                </>
              )}
            </button>
          </div>

          {/* Mode cards */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              onClick={() => theme === 'dark' && toggleTheme()}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                theme === 'light'
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Sun size={16} className={theme === 'light' ? 'text-primary-600' : 'text-gray-400'} />
                <span className={`text-sm font-medium ${theme === 'light' ? 'text-primary-700' : 'text-gray-700'}`}>Light</span>
                {theme === 'light' && <span className="ml-auto text-xs text-primary-600 font-medium">Active</span>}
              </div>
              <div className="rounded border border-gray-200 bg-white h-12 flex items-center px-2 gap-1">
                <div className="w-2 h-2 rounded-full bg-gray-200" />
                <div className="flex-1 h-1.5 bg-gray-100 rounded" />
              </div>
            </button>
            <button
              onClick={() => theme === 'light' && toggleTheme()}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                theme === 'dark'
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Moon size={16} className={theme === 'dark' ? 'text-primary-600' : 'text-gray-400'} />
                <span className={`text-sm font-medium ${theme === 'dark' ? 'text-primary-700' : 'text-gray-700'}`}>Dark</span>
                {theme === 'dark' && <span className="ml-auto text-xs text-primary-600 font-medium">Active</span>}
              </div>
              <div className="rounded border border-gray-600 bg-gray-800 h-12 flex items-center px-2 gap-1">
                <div className="w-2 h-2 rounded-full bg-gray-600" />
                <div className="flex-1 h-1.5 bg-gray-700 rounded" />
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
