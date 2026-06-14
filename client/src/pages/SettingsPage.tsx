import { useState, useEffect } from 'react';
import { Settings, Lock, Monitor, Sun, Moon, Download, DatabaseBackup, Clock, HardDrive, CheckCircle, AlertTriangle } from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { formatDate } from '../lib/dates';

interface SavedBackup { filename: string; size: number; created_at: string; }
interface BackupSchedule { frequency: 'daily' | 'weekly' | 'monthly'; day: number; hour: number; minute: number; }
interface StorageInfo {
  db_path: string;
  db_path_from_env: boolean;
  db_file_exists: boolean;
  db_file_size: number;
  db_file_modified: string | null;
  uploads_path: string;
  uploads_path_from_env: boolean;
  backups_path: string;
  backups_path_from_env: boolean;
  looks_ephemeral: boolean;
  row_counts: Record<string, number | null>;
  uploads_file_count: number;
  uploads_total_bytes: number;
}

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function SettingsPage() {
  const { addToast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const [downloading, setDownloading] = useState(false);
  const [savedBackups, setSavedBackups] = useState<SavedBackup[]>([]);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

  // Backup schedule
  const [schedule, setSchedule] = useState<BackupSchedule>({ frequency: 'weekly', day: 0, hour: 2, minute: 0 });
  const [savingSchedule, setSavingSchedule] = useState(false);

  // Storage / persistence diagnostic
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    if (user?.role === 'admin') {
      api.get('/backup/list').then(r => setSavedBackups(r.data)).catch(() => {});
      api.get('/backup/schedule').then(r => setSchedule(r.data)).catch(() => {});
      api.get('/health/storage').then(r => setStorage(r.data)).catch(() => setStorageError(true));
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

  const handleSaveSchedule = async () => {
    setSavingSchedule(true);
    try {
      await api.put('/backup/schedule', schedule);
      addToast('Backup schedule updated', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Failed to update schedule', 'error');
    } finally {
      setSavingSchedule(false);
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

      {/* Storage & Persistence — admin only */}
      {user?.role === 'admin' && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <HardDrive size={16} className="text-gray-500" />
              Storage &amp; Persistence
            </h2>
          </div>
          <div className="px-6 py-5">
            {storageError ? (
              <p className="text-sm text-gray-500">Storage status is unavailable.</p>
            ) : !storage ? (
              <p className="text-sm text-gray-400">Loading storage status…</p>
            ) : (
              <div className="space-y-4">
                {/* Persistence verdict */}
                {storage.looks_ephemeral ? (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                    <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-amber-800">Ephemeral storage — data is at risk</p>
                      <p className="text-xs text-amber-700 mt-0.5">
                        The database is being written inside the app directory, which is wiped on every redeploy.
                        Mount a persistent volume and set <code>DB_PATH</code>, <code>UPLOADS_PATH</code> and <code>BACKUPS_PATH</code> to it.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3">
                    <CheckCircle size={18} className="text-green-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-green-800">Persistent storage — data survives redeploys</p>
                      <p className="text-xs text-green-700 mt-0.5">
                        The database and uploaded files are stored on a persistent volume.
                      </p>
                    </div>
                  </div>
                )}

                {/* Paths */}
                <div className="grid grid-cols-1 gap-2 text-sm">
                  {([
                    ['Database', storage.db_path, storage.db_path_from_env],
                    ['Uploads', storage.uploads_path, storage.uploads_path_from_env],
                    ['Backups', storage.backups_path, storage.backups_path_from_env],
                  ] as [string, string, boolean][]).map(([label, p, fromEnv]) => (
                    <div key={label} className="flex items-center justify-between gap-3">
                      <span className="text-gray-500 shrink-0 w-20">{label}</span>
                      <code className="text-xs text-gray-700 truncate flex-1 text-right">{p}</code>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${fromEnv ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {fromEnv ? 'from env' : 'default'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* DB + uploads stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-gray-100 pt-4">
                  <div>
                    <p className="text-xs text-gray-500">DB size</p>
                    <p className="text-sm font-semibold text-gray-900">{fmtSize(storage.db_file_size)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">DB updated</p>
                    <p className="text-sm font-semibold text-gray-900">{storage.db_file_modified ? formatDate(storage.db_file_modified) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Uploaded files</p>
                    <p className="text-sm font-semibold text-gray-900">{storage.uploads_file_count.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Uploads size</p>
                    <p className="text-sm font-semibold text-gray-900">{fmtSize(storage.uploads_total_bytes)}</p>
                  </div>
                </div>

                {/* Row counts */}
                <div className="border-t border-gray-100 pt-4">
                  <p className="text-xs font-medium text-gray-500 mb-2">Records</p>
                  <div className="flex flex-wrap gap-2">
                    {(['operations', 'invoices', 'orders', 'customers', 'suppliers', 'wire_transfers'] as const).map(t => (
                      <span key={t} className="text-xs bg-gray-100 text-gray-700 rounded-md px-2 py-1">
                        {t.replace('_', ' ')}: <span className="font-semibold">{storage.row_counts[t] ?? '—'}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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

            {/* Schedule configuration */}
            <div className="border-t border-gray-100 pt-4">
              <p className="text-sm font-medium text-gray-900 mb-0.5 flex items-center gap-1.5">
                <Clock size={14} className="text-gray-400" />
                Automatic backup schedule
              </p>
              <p className="text-sm text-gray-500 mb-3">Last 4 backups are kept automatically.</p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Frequency</label>
                  <select
                    value={schedule.frequency}
                    onChange={e => setSchedule(s => ({ ...s, frequency: e.target.value as any, day: e.target.value === 'monthly' ? 1 : 0 }))}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                {schedule.frequency === 'weekly' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Day of week</label>
                    <select
                      value={schedule.day}
                      onChange={e => setSchedule(s => ({ ...s, day: Number(e.target.value) }))}
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      {DAYS_OF_WEEK.map((d, i) => <option key={i} value={i}>{d}</option>)}
                    </select>
                  </div>
                )}
                {schedule.frequency === 'monthly' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Day of month</label>
                    <input
                      type="number"
                      min={1}
                      max={28}
                      value={schedule.day}
                      onChange={e => setSchedule(s => ({ ...s, day: Math.min(28, Math.max(1, Number(e.target.value))) }))}
                      className="w-20 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Time (UTC)</label>
                  <div className="flex items-center gap-1">
                    <select
                      value={schedule.hour}
                      onChange={e => setSchedule(s => ({ ...s, hour: Number(e.target.value) }))}
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  onClick={handleSaveSchedule}
                  disabled={savingSchedule}
                  className="px-4 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  {savingSchedule ? 'Saving...' : 'Save Schedule'}
                </button>
              </div>
            </div>

            {/* Saved auto-backups */}
            <div className="border-t border-gray-100 pt-4">
              <p className="text-sm font-medium text-gray-900 mb-0.5">Saved backups</p>
              <p className="text-sm text-gray-500 mb-3">
                Automatically saved according to your schedule above.
              </p>
              {savedBackups.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No automatic backups saved yet — the first one will run according to your schedule above.</p>
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
