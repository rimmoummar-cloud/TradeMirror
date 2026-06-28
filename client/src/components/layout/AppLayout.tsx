import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { useAuthStore } from '../../store/authStore';
import { DebugPanel } from '../DebugPanel';

export function AppLayout() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const displayName = (user as any)?.email?.split('@')[0] || 'Enterprise User';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Content is offset by the sidebar only on lg+; full width on mobile. */}
      <div className="lg:ml-64 flex flex-col min-h-screen">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center gap-3 px-4 sm:px-6 lg:px-8 shadow-sm">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-slate-500 hover:text-slate-900 transition-colors -ml-1"
            aria-label="Open menu"
          >
            <Menu className="w-6 h-6" />
          </button>

          <div className="flex items-center gap-3 ml-auto min-w-0">
            <span className="text-sm font-medium text-slate-600 truncate max-w-[45vw] sm:max-w-none">
              {(user as any)?.email || 'Enterprise User'}
            </span>
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold shrink-0">
              {initial}
            </div>
            <button
              onClick={logout}
              className="text-xs text-slate-400 hover:text-slate-700 transition-colors shrink-0"
              title="Sign out"
            >
              Sign out
            </button>
          </div>
        </header>

        {/* overflow-x-hidden keeps the page from scrolling sideways; wide tables
            scroll inside their own containers instead. */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-hidden">
          <Outlet />
        </main>
      </div>

      {/* Global Debug Panel — visible when DEBUG_MODE is toggled */}
      <DebugPanel />
    </div>
  );
}
