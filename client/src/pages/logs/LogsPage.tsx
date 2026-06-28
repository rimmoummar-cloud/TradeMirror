import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { format } from 'date-fns';
import { History, Search, ChevronLeft, ChevronRight, User as UserIcon } from 'lucide-react';
import { auditApi, type AuditLog } from '../../lib/api';

const ACTION_OPTIONS = [
  'TRADE_CREATED', 'TRADE_UPDATED', 'TRADE_STATUS_CHANGED', 'TRADE_DELETED',
  'PDF_UPLOADED', 'CONTRACT_GENERATED', 'CONTRACT_REGENERATED', 'VERSION_CREATED',
  'UNIT_PRICE_UPDATED', 'SALE_PRICE_UPDATED', 'TRADE_RECALCULATED',
  'CLIENT_CREATED', 'CLIENT_UPDATED', 'CLIENT_DELETED',
  'DOCUMENT_UPLOADED', 'DOCUMENT_DELETED', 'LOGIN_SUCCESS', 'LOGOUT',
];
const ENTITY_OPTIONS = ['trade', 'client', 'document', 'auth'];
const PAGE_SIZE = 25;

// Colour families by action prefix so the trail is scannable.
function actionClass(action: string): string {
  if (action.includes('DELETED')) return 'bg-red-100 text-red-700';
  if (action.includes('CREATED') || action === 'LOGIN_SUCCESS') return 'bg-green-100 text-green-700';
  if (action.includes('PRICE') || action.includes('RECALC')) return 'bg-amber-100 text-amber-700';
  if (action.includes('CONTRACT') || action.includes('VERSION') || action.includes('PDF')) return 'bg-indigo-100 text-indigo-700';
  if (action.includes('STATUS')) return 'bg-teal-100 text-teal-700';
  return 'bg-slate-100 text-slate-700';
}

export function LogsPage() {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery({
    queryKey: ['audit-logs', { search, action, entityType, from, to, page }],
    queryFn: () =>
      auditApi.list({
        search: search || undefined,
        action: action || undefined,
        entity_type: entityType || undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to + 'T23:59:59').toISOString() : undefined,
        page,
        page_size: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Reset to page 1 whenever a filter changes.
  const onFilter = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1); };

  const selectCls = 'px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <History className="w-6 h-6 text-slate-400" />
        <h1 className="text-2xl font-bold text-slate-900">Audit Logs</h1>
        <span className="ml-2 text-sm text-slate-500">{total} events</span>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => onFilter(setSearch)(e.target.value)}
            placeholder="Search action, message or entity…"
            className="w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <select value={action} onChange={(e) => onFilter(setAction)(e.target.value)} className={selectCls}>
            <option value="">All actions</option>
            {ACTION_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={entityType} onChange={(e) => onFilter(setEntityType)(e.target.value)} className={selectCls}>
            <option value="">All entities</option>
            {ENTITY_OPTIONS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          <input type="date" value={from} onChange={(e) => onFilter(setFrom)(e.target.value)} className={selectCls} aria-label="From date" />
          <input type="date" value={to} onChange={(e) => onFilter(setTo)(e.target.value)} className={selectCls} aria-label="To date" />
        </div>
      </div>

      {/* Table (desktop) / cards (mobile) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {error ? (
          <div className="p-8 text-center text-red-500">Failed to load audit logs.</div>
        ) : isLoading && logs.length === 0 ? (
          <div className="p-6 space-y-3">{[...Array(6)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}</div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center text-slate-500">No audit events match your filters.</div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-4 py-3 font-medium">Entity</th>
                    <th className="px-4 py-3 font-medium">Message</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map((log: AuditLog) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${actionClass(log.action)}`}>{log.action}</span></td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{log.user_email || '—'}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {log.entity_type ? <span className="capitalize">{log.entity_type}</span> : '—'}
                        {log.entity_id && <span className="text-xs text-slate-400"> · {log.entity_id.slice(0, 8)}</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-700 max-w-md truncate" title={log.message ?? ''}>{log.message || '—'}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{format(new Date(log.created_at), 'MMM dd, yyyy HH:mm')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile stacked cards */}
            <ul className="md:hidden divide-y divide-slate-100">
              {logs.map((log: AuditLog) => (
                <li key={log.id} className="p-4 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${actionClass(log.action)}`}>{log.action}</span>
                    <span className="text-xs text-slate-400 whitespace-nowrap">{format(new Date(log.created_at), 'MMM dd HH:mm')}</span>
                  </div>
                  <p className="text-sm text-slate-700">{log.message || '—'}</p>
                  <p className="text-xs text-slate-400 flex items-center gap-1">
                    <UserIcon className="w-3 h-3" />{log.user_email || '—'}
                    {log.entity_type && <span className="capitalize"> · {log.entity_type}</span>}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* Pagination */}
        {logs.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 text-sm">
            <span className="text-slate-500">Page {page} of {totalPages}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-50 hover:bg-slate-50"
              >
                <ChevronLeft className="w-4 h-4" /> Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 disabled:opacity-50 hover:bg-slate-50"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
