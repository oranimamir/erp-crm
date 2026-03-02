import { useState, useEffect } from 'react';
import { Settings, Lock, Monitor, Sun, Moon, Download, DatabaseBackup } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { formatDate } from '../lib/dates';

interface SavedBackup { filename: string; size: number; created_at: string; }

export default function SettingsPage() {
  const { addToast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const [downloading, setDownloading] = useState(false);
  const [savedBackups, setSavedBackups] = useState<SavedBackup[]>([]);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role === 'admin') {
      api.get('/backup/list').then(r => setSavedBackups(r.data)).catch(() => {});
    }
  }, [user]);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const handleDownloadBackup = async () => {
    setDownloading(true);
    try {
      const res = await api.get('/backup', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `erp-backup-${timestamp}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      addToast('Backup downloaded successfully', 'success');
    } catch {
      addToast('Failed to download backup', 'error');
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadSaved = async (filename: string) => {
    setDownloadingFile(filename);
    try {
      const res = await api.get(`/backup/download/${filename}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      addToast('Failed to download backup file', 'error');
    } finally {
      setDownloadingFile(null);
    }
  };

  const fmtSize = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      addToast('New passwords do not match', 'error');
      return;
    }
    if (newPassword.length < 8) {
      addToast('New password must be at least 8 characters', 'error');
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
              minLength={8}
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

      {/* Backup — admin only */}
      {user?.role === 'admin' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <DatabaseBackup size={16} className="text-gray-500" />
              Backup
            </h2>
          </div>
          <div className="px-6 py-5 space-y-5">
            {/* On-demand download */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Download backup now</p>
                <p className="text-sm text-gray-500 mt-0.5">
                  Full ZIP containing the database and all uploaded files (invoices, wire transfers, documents)
                </p>
              </div>
              <button
                onClick={handleDownloadBackup}
                disabled={downloading}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0 ml-4"
              >
                <Download size={15} />
                {downloading ? 'Preparing...' : 'Download Backup'}
              </button>
            </div>

            {/* Weekly auto-backups */}
            <div className="border-t border-gray-100 pt-4">
              <p className="text-sm font-medium text-gray-900 mb-0.5">Weekly automatic backups</p>
              <p className="text-sm text-gray-500 mb-3">
                Saved automatically every Sunday at 02:00 UTC. Last 4 weeks are kept.
              </p>
              {savedBackups.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No automatic backups saved yet — first one runs next Sunday.</p>
              ) : (
                <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 overflow-hidden">
                  {savedBackups.map(b => (
                    <div key={b.filename} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{formatDate(b.created_at)}</p>
                        <p className="text-xs text-gray-400">{fmtSize(b.size)}</p>
                      </div>
                      <button
                        onClick={() => handleDownloadSaved(b.filename)}
                        disabled={downloadingFile === b.filename}
                        className="flex items-center gap-1.5 text-xs text-primary-600 hover:text-primary-800 font-medium disabled:opacity-50"
                      >
                        <Download size={13} />
                        {downloadingFile === b.filename ? 'Downloading...' : 'Download'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
