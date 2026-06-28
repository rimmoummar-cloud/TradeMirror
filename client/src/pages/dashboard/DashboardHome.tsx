import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FileUp, TrendingUp, Activity, FileText } from 'lucide-react';
import { tradesApi } from '../../lib/api';

export function DashboardHome() {
  const { data: trades, isLoading } = useQuery({
    queryKey: ['trades'],
    queryFn: tradesApi.getTrades,
  });

  const stats = [
    { name: 'Total Trades', value: trades?.length || 0, icon: FileText, change: '+12%' },
    { name: 'Active Trades', value: trades?.filter(t => t.status === 'active').length || 0, icon: Activity, change: '+4%' },
    { name: 'Completed', value: trades?.filter(t => t.status === 'completed').length || 0, icon: TrendingUp, change: '+23%' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <Link
          to="/app/upload"
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-sm"
        >
          <FileUp className="w-4 h-4" />
          Upload Trade
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat) => (
          <div key={stat.name} className="bg-white rounded-xl p-6 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">{stat.name}</p>
                <p className="text-3xl font-bold text-slate-900 mt-2">
                  {isLoading ? '...' : stat.value}
                </p>
              </div>
              <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
                <stat.icon className="w-6 h-6" />
              </div>
            </div>
            <div className="mt-4 flex items-center text-sm">
              <span className="text-green-600 font-medium">{stat.change}</span>
              <span className="text-slate-500 ml-2">from last month</span>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mt-8">
        <div className="px-6 py-5 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900">Recent Trades</h3>
        </div>
        <div className="divide-y divide-slate-200">
          {isLoading ? (
            <div className="p-6 text-center text-slate-500">Loading trades...</div>
          ) : !trades?.length ? (
            <div className="p-6 text-center text-slate-500">No trades found. Create one to get started.</div>
          ) : (
            trades.slice(0, 5).map((trade) => (
              <div key={trade.id} className="p-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                <div>
                  <Link to={`/app/trades/${trade.id}`} className="text-blue-600 font-medium hover:underline">
                    {trade.trade_reference || trade.id}
                  </Link>
                  <p className="text-sm text-slate-500 mt-1">
                    Client: {trade.client_id || trade.edited_data?.clientName || 'N/A'}
                  </p>
                </div>
                <div className="text-right">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                    trade.status === 'completed' ? 'bg-green-100 text-green-800' :
                    trade.status === 'active' ? 'bg-blue-100 text-blue-800' :
                    'bg-slate-100 text-slate-800'
                  }`}>
                    {trade.status}
                  </span>
                  <p className="text-sm text-slate-500 mt-1">
                    {new Date(trade.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
