import { NavLink, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { LayoutDashboard, FileUp, List, Users, UserCog, History, Settings, Landmark, LogOut, X } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import clsx from 'clsx';

// `roles` gates visibility; backend authorization is the real enforcement.
const navItems = [
  { name: 'Dashboard', path: '/app/dashboard', icon: LayoutDashboard, roles: ['super_admin', 'admin', 'employee', 'partner'] },
  { name: 'Upload Trade', path: '/app/upload', icon: FileUp, roles: ['super_admin', 'admin'] },
  { name: 'Trades List', path: '/app/trades', icon: List, roles: ['super_admin', 'admin', 'employee', 'partner'] },
  { name: 'Clients', path: '/app/clients', icon: Users, roles: ['super_admin', 'admin', 'employee'] },
  { name: 'Bank Profiles', path: '/app/bank-profiles', icon: Landmark, roles: ['super_admin', 'admin'] },
  { name: 'Users', path: '/app/users', icon: UserCog, roles: ['super_admin'] },
  { name: 'Audit Logs', path: '/app/logs', icon: History, roles: ['super_admin'] },
  { name: 'Settings', path: '/app/settings', icon: Settings, roles: ['super_admin'] },
];

interface SidebarProps {
  /** Drawer open state (mobile only; desktop sidebar is always visible). */
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const logout = useAuthStore((state) => state.logout);
  const role = useAuthStore((state) => state.profile?.role);
  const location = useLocation();

  // Show only the items this role may access (cosmetic — backend enforces).
  const visibleItems = navItems.filter((item) => !role || item.roles.includes(role));

  // On mobile the drawer must close after navigating to a new route.
  useEffect(() => {
    onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <>
      {/* Mobile overlay — taps outside the drawer close it. Hidden on lg+. */}
      <div
        className={clsx(
          'fixed inset-0 z-30 bg-slate-900/50 lg:hidden transition-opacity duration-200',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={clsx(
          'fixed top-0 left-0 z-40 h-screen w-64 bg-slate-900 text-slate-300 flex flex-col',
          'transition-transform duration-200 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="h-16 flex items-center px-6 bg-slate-950">
          <h1 className="text-white text-xl font-bold tracking-wider">TradeMirror</h1>
          <span className="ml-2 text-xs text-slate-500 font-semibold uppercase">OS</span>
          <button
            onClick={onClose}
            className="ml-auto lg:hidden text-slate-400 hover:text-white transition-colors"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 py-6 flex flex-col gap-1 px-3 overflow-y-auto">
          {visibleItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors font-medium text-sm',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'hover:bg-slate-800 hover:text-slate-100'
                )
              }
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {item.name}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button
            onClick={logout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors font-medium text-sm w-full hover:bg-slate-800 hover:text-slate-100"
          >
            <LogOut className="w-5 h-5" />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}
