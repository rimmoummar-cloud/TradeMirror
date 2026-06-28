import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Activity } from 'lucide-react';
import { auditApi, type AuditLog } from '../../lib/api';

/** Last 10 audit events for a single trade — a compact activity timeline. */
export function TradeActivity({ tradeId }: { tradeId: string }) {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['trade-activity', tradeId],
    queryFn: () => auditApi.entity('trade', tradeId, 10),
    enabled: !!tradeId,
    staleTime: 0,
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2 bg-slate-50">
        <Activity className="w-5 h-5 text-slate-400" />
        <h3 className="text-lg font-semibold text-slate-900">Activity</h3>
        <span className="ml-auto text-sm text-slate-500">Last {logs.length}</span>
      </div>
      <div className="p-6">
        {isLoading ? (
          <p className="text-sm text-slate-500">Loading activity…</p>
        ) : logs.length === 0 ? (
          <p className="text-sm text-slate-500">No activity recorded yet.</p>
        ) : (
          <ol className="relative border-l border-slate-200 ml-2 space-y-5">
            {logs.map((log: AuditLog) => (
              <li key={log.id} className="ml-4">
                <span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-blue-500" />
                <p className="text-sm text-slate-800">{log.message || log.action}</p>
                <p className="text-xs text-slate-400">
                  {format(new Date(log.created_at), 'MMM dd, yyyy HH:mm')}
                  {log.user_email ? ` · ${log.user_email}` : ''}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
