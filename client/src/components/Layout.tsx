import { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  LayoutDashboard, Users, Truck, FileText, ShoppingCart,
  LogOut, Menu, Shield, Warehouse, Briefcase, BarChart3,
  Settings, Sun, Moon, BellRing, Receipt,
} from 'lucide-react';
import api from '../lib/api';

interface ActivityItem {
  id: number;
  entity: string;
  action: string;
  label: string;
  performed_by: string;
  created_at: string;
}

const ACTION_COLORS: Record<string, string> = {
  created: 'bg-green-100 text-green-700',
  updated: 'bg-blue-100 text-blue-700',
  deleted: 'bg-red-100 text-red-700',
  'status changed': 'bg-amber-100 text-amber-700',
  'logged in': 'bg-cyan-100 text-cyan-700',
};

function timeAgo(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr + 'Z').getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/customers', icon: Users, label: 'Customers' },
  { to: '/suppliers', icon: Truck, label: 'Suppliers' },
  { to: '/invoices', icon: FileText, label: 'Customer Invoices' },
  { to: '/supplier-invoices', icon: Receipt, label: 'Supplier Invoices' },
  { to: '/orders', icon: ShoppingCart, label: 'Orders' },
  { to: '/operations', icon: Briefcase, label: 'Operations' },
  { to: '/inventory', icon: Warehouse, label: 'Inventory' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifItems, setNotifItems] = useState<ActivityItem[]>([]);
  const [notifUnread, setNotifUnread] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(() => {
    api.get('/notifications')
      .then(res => {
        setNotifItems(res.data.items);
        setNotifUnread(res.data.unread_count);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    if (notifOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [notifOpen]);

  const handleOpenNotif = () => {
    setNotifOpen(o => !o);
    if (!notifOpen && notifUnread > 0) {
      api.post('/notifications/read').then(() => setNotifUnread(0)).catch(() => {});
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-gray-900 text-white transform transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <Link to="/dashboard" className="flex items-center gap-3 px-6 py-5 border-b border-gray-800 hover:opacity-80 transition-opacity">
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center font-bold text-sm">C</div>
          <span className="text-lg font-bold">CirculERP</span>
        </Link>
        <nav className="px-3 py-4 flex flex-col h-[calc(100%-73px)]">
          <div className="flex-1 space-y-1">
            {navItems.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive ? 'bg-primary-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                <item.icon size={20} />
                {item.label}
              </NavLink>
            ))}
            {user?.role === 'admin' && (
              <NavLink
                to="/admin/users"
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive ? 'bg-primary-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                <Shield size={20} />
                User Management
              </NavLink>
            )}
            <NavLink
              to="/settings"
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-primary-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <Settings size={20} />
              Settings
            </NavLink>
          </div>
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-gray-200 px-4 lg:px-6 py-3 flex items-center justify-between">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-gray-600 hover:text-gray-900">
            <Menu size={24} />
          </button>
          <div className="lg:flex-1" />
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            {/* In-app activity notifications */}
            {notifItems.length > 0 || notifUnread > 0 ? (
              <div className="relative" ref={notifRef}>
                <button
                  onClick={handleOpenNotif}
                  title="Activity notifications"
                  className="relative p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <BellRing size={18} />
                  {notifUnread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-primary-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                      {notifUnread > 99 ? '99+' : notifUnread}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-900">Recent Activity</span>
                      {notifUnread === 0 && <span className="text-xs text-gray-400">All caught up</span>}
                    </div>
                    <div className="max-h-96 overflow-y-auto divide-y divide-gray-50">
                      {notifItems.map(item => (
                        <div key={item.id} className="px-4 py-3 hover:bg-gray-50">
                          <div className="flex items-start gap-2">
                            <span className={`shrink-0 mt-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full capitalize ${ACTION_COLORS[item.action] || 'bg-gray-100 text-gray-600'}`}>
                              {item.action}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-gray-900 truncate">
                                <span className="font-medium">{item.entity}</span>: {item.label}
                              </p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                by {item.performed_by} · {timeAgo(item.created_at)}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            <span className="text-xs sm:text-sm text-gray-600 hidden sm:inline">{user?.display_name}</span>
            <button onClick={logout} className="flex items-center gap-1 text-xs sm:text-sm text-gray-500 hover:text-gray-700">
              <LogOut size={16} />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
