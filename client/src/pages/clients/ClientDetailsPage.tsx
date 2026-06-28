import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ArrowLeft, Building2, Mail, Phone, MapPin, Globe, Hash, User,
  TrendingUp, TrendingDown, Minus, DollarSign, Layers, CalendarClock, Percent,
  Truck, Shield, Landmark, Wallet, Activity, Trophy, FileText, ExternalLink,
} from 'lucide-react';
import { clientsApi, type CurrencyFinancials, type PerformanceItem } from '../../lib/api';

const STATUS_META: Record<string, { label: string; cls: string }> = {
  draft:            { label: 'Draft',            cls: 'bg-slate-100 text-slate-700' },
  active:           { label: 'Active',           cls: 'bg-blue-100 text-blue-700' },
  advance_received: { label: 'Advance Received', cls: 'bg-indigo-100 text-indigo-700' },
  shipped:          { label: 'Shipped',          cls: 'bg-amber-100 text-amber-700' },
  balance_received: { label: 'Balance Received', cls: 'bg-teal-100 text-teal-700' },
  overdue:          { label: 'Overdue',          cls: 'bg-red-100 text-red-700' },
  completed:        { label: 'Completed',        cls: 'bg-green-100 text-green-700' },
};

function fmtMoney(v: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number.isFinite(v) ? v : 0);
  } catch {
    return `${currency} ${(v ?? 0).toFixed(2)}`;
  }
}

function Card({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2 bg-slate-50">
        {icon}<h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function Stat({ icon, label, value, accent, sub }: { icon: React.ReactNode; label: string; value: string; accent?: string; sub?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center gap-2 text-slate-400">{icon}<span className="text-xs font-medium uppercase tracking-wide">{label}</span></div>
      <p className={`mt-2 text-2xl font-bold ${accent ?? 'text-slate-900'}`}>{value}</p>
      {sub && <div className="mt-1 text-xs">{sub}</div>}
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-500 flex items-center gap-1.5">{icon}{label}</p>
      <p className="mt-1 text-slate-900">{value || 'Not specified'}</p>
    </div>
  );
}

function TrendBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-slate-400">— no prior month</span>;
  const up = pct > 0, flat = pct === 0;
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown;
  const cls = flat ? 'text-slate-500' : up ? 'text-green-600' : 'text-red-600';
  return (
    <span className={`inline-flex items-center gap-1 font-medium ${cls}`}>
      <Icon className="w-3.5 h-3.5" />{up ? '+' : ''}{pct}% vs prev. month
    </span>
  );
}

export function ClientDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: client, isLoading: clientLoading, error: clientErr } = useQuery({
    queryKey: ['client', id],
    queryFn: () => clientsApi.get(id!),
    enabled: !!id,
    staleTime: 0,
  });

  // ONE call returns the whole analytics payload, computed in SQL.
  const { data: dash, isLoading: dashLoading } = useQuery({
    queryKey: ['client-dashboard', id],
    queryFn: () => clientsApi.dashboard(id!),
    enabled: !!id,
    staleTime: 0,
  });

  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);

  if (clientLoading) {
    return <div className="flex items-center justify-center h-64 text-slate-500">Loading client…</div>;
  }
  if (clientErr || !client) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500">
        <p className="mb-4 text-red-500">Failed to load client.</p>
        <button onClick={() => navigate('/app/clients')} className="text-blue-600 hover:underline">Back to clients</button>
      </div>
    );
  }

  const currency = selectedCurrency ?? dash?.primaryCurrency ?? 'USD';
  const money = (v: number) => fmtMoney(v, currency);
  const fin: CurrencyFinancials | undefined =
    dash?.financialByCurrency.find((f) => f.currency === currency) ?? dash?.financialByCurrency[0];
  const monthly = (dash?.monthly ?? []).filter((m) => m.currency === currency);
  const statusTotal = dash ? Object.values(dash.statusCounts).reduce((s, n) => s + n, 0) : 0;

  const perfLink = (label: string, icon: React.ReactNode, item: PerformanceItem | null, isPct = false) => (
    <button
      onClick={() => item && navigate(`/app/trades/${item.tradeId}`)}
      disabled={!item}
      className="flex items-center justify-between w-full p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:hover:bg-white disabled:hover:border-slate-200"
    >
      <span className="flex items-center gap-2 text-sm text-slate-600">{icon}{label}</span>
      <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        {item ? (isPct ? `${item.value}%` : fmtMoney(item.value, item.currency)) : '—'}
        {item && <ExternalLink className="w-3.5 h-3.5 text-blue-500" />}
      </span>
    </button>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <button onClick={() => navigate('/app/clients')} className="flex items-center text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Clients
      </button>

      {/* Client info */}
      <Card title={client.name} icon={<Building2 className="w-5 h-5 text-slate-400" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <InfoRow icon={<Mail className="w-3.5 h-3.5" />} label="Email" value={client.email} />
          <InfoRow icon={<Phone className="w-3.5 h-3.5" />} label="Phone" value={client.phone} />
          <InfoRow icon={<Hash className="w-3.5 h-3.5" />} label="Tax ID" value={client.tax_id} />
          <InfoRow icon={<MapPin className="w-3.5 h-3.5" />} label="Address" value={[client.address, client.city].filter(Boolean).join(', ')} />
          <InfoRow icon={<Globe className="w-3.5 h-3.5" />} label="Country" value={client.country} />
          <InfoRow icon={<User className="w-3.5 h-3.5" />} label="Contact Person" value={client.contact_person} />
        </div>
      </Card>

      {/* Empty state */}
      {dashLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />)}
        </div>
      ) : !dash || dash.tradeCount === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center text-slate-500">
          <Layers className="w-10 h-10 mx-auto mb-3 text-slate-300" />
          <p className="font-medium text-slate-700">No trades for this client yet</p>
          <p className="text-sm mt-1">Analytics will appear here as soon as trades are linked to this client.</p>
        </div>
      ) : (
        <>
          {/* Currency selector (only when the client trades in >1 currency) */}
          {dash.multiCurrency && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">Currency:</span>
              {dash.currencies.map((c) => (
                <button
                  key={c}
                  onClick={() => setSelectedCurrency(c)}
                  className={`px-3 py-1 rounded-full text-sm font-medium border ${
                    c === currency ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {c}
                </button>
              ))}
              <span className="text-xs text-slate-400 ml-2">Figures are never summed across currencies.</span>
            </div>
          )}

          {/* Financial summary + trend */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat icon={<Layers className="w-4 h-4" />} label="Trades" value={String(fin?.tradeCount ?? 0)}
              sub={dash.trend && <TrendBadge pct={dash.trend.volumeChangePct} />} />
            <Stat icon={<DollarSign className="w-4 h-4" />} label="Revenue" value={money(fin?.revenue ?? 0)}
              sub={dash.trend && <TrendBadge pct={dash.trend.revenueChangePct} />} />
            <Stat icon={<DollarSign className="w-4 h-4" />} label="Total Costs" value={money(fin?.costs ?? 0)} />
            <Stat icon={<TrendingUp className="w-4 h-4" />} label="Net Profit" value={money(fin?.netProfit ?? 0)}
              accent={(fin?.netProfit ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}
              sub={dash.trend && <TrendBadge pct={dash.trend.profitChangePct} />} />
            <Stat icon={<TrendingUp className="w-4 h-4" />} label="Avg Profit / Trade" value={money(fin?.avgProfit ?? 0)} />
            <Stat icon={<Percent className="w-4 h-4" />} label="Profit Margin" value={`${(fin?.marginPct ?? 0).toFixed(1)}%`}
              accent={(fin?.marginPct ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'} />
            <Stat icon={<Wallet className="w-4 h-4" />} label="Collection" value={`${dash.payments.collectionPct}%`} />
            <Stat icon={<CalendarClock className="w-4 h-4" />} label="Days Since Last" value={dash.activity.daysSinceLastTrade != null ? `${dash.activity.daysSinceLastTrade}d` : '—'} />
          </div>

          {/* Cost breakdown with % of total costs */}
          {/* <Card title={`Cost Breakdown (${currency})`} icon={<DollarSign className="w-5 h-5 text-slate-400" />}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
              {([
                { label: 'Frigo Purchase', icon: <Snowflake className="w-3.5 h-3.5" />, val: fin?.frigo ?? 0 },
                { label: 'Shipping', icon: <Truck className="w-3.5 h-3.5" />, val: fin?.shipping ?? 0 },
                { label: 'Insurance', icon: <Shield className="w-3.5 h-3.5" />, val: fin?.insurance ?? 0 },
                { label: 'Bank Fees', icon: <Landmark className="w-3.5 h-3.5" />, val: fin?.bankFees ?? 0 },
              ]).map((c) => {
                const pct = fin && fin.costs ? Math.round((c.val / fin.costs) * 100) : 0;
                return (
                  <div key={c.label}>
                    <p className="text-sm font-medium text-slate-500 flex items-center gap-1.5">{c.icon}{c.label}</p>
                    <p className="mt-1 text-lg font-semibold text-slate-900">{money(c.val)}</p>
                    <p className="text-xs text-slate-400">{pct}% of total costs</p>
                  </div>
                );
              })}
            </div>
          </Card> */}

          {/* Monthly profit analysis */}
          <Card title={`Monthly Profit Analysis (${currency})`} icon={<TrendingUp className="w-5 h-5 text-slate-400" />}>
            {monthly.length === 0 ? (
              <p className="text-sm text-slate-500">No monthly activity in this currency.</p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 font-medium">Month</th>
                    <th className="py-2 font-medium text-right">Trades</th>
                    <th className="py-2 font-medium text-right">Revenue</th>
                    <th className="py-2 font-medium text-right">Costs</th>
                    <th className="py-2 font-medium text-right">Net Profit</th>
                    <th className="py-2 font-medium text-right">Avg Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {monthly.map((m) => (
                    <tr key={m.month}>
                      <td className="py-2 text-slate-900">{format(new Date(m.month), 'MMM yyyy')}</td>
                      <td className="py-2 text-right text-slate-600">{m.tradeCount}</td>
                      <td className="py-2 text-right text-slate-600">{money(m.revenue)}</td>
                      <td className="py-2 text-right text-slate-600">{money(m.costs)}</td>
                      <td className={`py-2 text-right font-medium ${m.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{money(m.netProfit)}</td>
                      <td className="py-2 text-right text-slate-600">{money(m.avgProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Status analysis */}
            <Card title="Trade Status Analysis" icon={<Layers className="w-5 h-5 text-slate-400" />}>
              <div className="space-y-2">
                {Object.entries(dash.statusCounts).sort((a, b) => b[1] - a[1]).map(([status, count]) => {
                  const meta = STATUS_META[status] ?? { label: status, cls: 'bg-slate-100 text-slate-700' };
                  const pct = statusTotal ? Math.round((count / statusTotal) * 100) : 0;
                  return (
                    <div key={status} className="flex items-center gap-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium w-36 justify-center ${meta.cls}`}>{meta.label}</span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-sm text-slate-600 w-16 text-right">{count} · {pct}%</span>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Payment analysis */}
            {/* <Card title="Payment Analysis" icon={<Wallet className="w-5 h-5 text-slate-400" />}>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-slate-500">Pending</p><p className="font-semibold text-slate-900">{dash.payments.pending}</p></div>
                <div><p className="text-slate-500">Received</p><p className="font-semibold text-green-600">{dash.payments.received}</p></div>
                <div><p className="text-slate-500">Overdue</p><p className="font-semibold text-red-600">{dash.payments.overdue}</p></div>
                <div><p className="text-slate-500">Advance Received</p><p className="font-semibold text-slate-900">{dash.payments.advanceReceived}</p></div>
                <div><p className="text-slate-500">Balance Received</p><p className="font-semibold text-slate-900">{dash.payments.balanceReceived}</p></div>
                <div><p className="text-slate-500">Collection %</p><p className="font-semibold text-slate-900">{dash.payments.collectionPct}%</p></div>
                <div><p className="text-slate-500">Received Amount</p><p className="font-semibold text-slate-900">{money(dash.payments.receivedAmount)}</p></div>
                <div><p className="text-slate-500">Outstanding</p><p className="font-semibold text-amber-600">{money(dash.payments.outstandingAmount)}</p></div>
                <div><p className="text-slate-500">Avg Payment Delay</p><p className="font-semibold text-slate-900">{dash.payments.avgPaymentDelayDays} days</p></div>
              </div>
              {dash.payments.totalAmount === 0 && (
                <p className="mt-3 text-xs text-slate-400">No payment milestones recorded yet.</p>
              )}
            </Card> */}

            {/* Client activity */}
            <Card title="Client Activity" icon={<Activity className="w-5 h-5 text-slate-400" />}>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><p className="text-slate-500">First Trade</p><p className="font-semibold text-slate-900">{dash.activity.firstTradeDate ? format(new Date(dash.activity.firstTradeDate), 'PP') : '—'}</p></div>
                <div><p className="text-slate-500">Latest Trade</p><p className="font-semibold text-slate-900">{dash.activity.lastTradeDate ? format(new Date(dash.activity.lastTradeDate), 'PP') : '—'}</p></div>
                <div><p className="text-slate-500">Days Since Last</p><p className="font-semibold text-slate-900">{dash.activity.daysSinceLastTrade ?? '—'}</p></div>
                <div><p className="text-slate-500">Avg Trades / Month</p><p className="font-semibold text-slate-900">{dash.activity.avgTradesPerMonth}</p></div>
                <div><p className="text-slate-500">Avg Days Between</p><p className="font-semibold text-slate-900">{dash.activity.avgDaysBetweenTrades ?? '—'}</p></div>
                <div><p className="text-slate-500">Documents</p><p className="font-semibold text-slate-900">{dash.documents.total}</p></div>
              </div>
            </Card>

            {/* Trade performance */}
            <Card title="Trade Performance" icon={<Trophy className="w-5 h-5 text-slate-400" />}>
              <div className="space-y-2">
                {perfLink('Largest Sale', <DollarSign className="w-4 h-4 text-slate-400" />, dash.performance.largestSale)}
                {perfLink('Largest Profit', <TrendingUp className="w-4 h-4 text-slate-400" />, dash.performance.largestProfit)}
                {perfLink('Highest Shipping', <Truck className="w-4 h-4 text-slate-400" />, dash.performance.highestShipping)}
                {perfLink('Highest Bank Fees', <Landmark className="w-4 h-4 text-slate-400" />, dash.performance.highestBankFees)}
                {perfLink('Highest Insurance', <Shield className="w-4 h-4 text-slate-400" />, dash.performance.highestInsurance)}
                {perfLink('Highest Margin', <Percent className="w-4 h-4 text-slate-400" />, dash.performance.highestMargin, true)}
                {perfLink('Lowest Margin', <Percent className="w-4 h-4 text-slate-400" />, dash.performance.lowestMargin, true)}
              </div>
            </Card>
          </div>

          {/* Recent activity */}
          <Card title="Recent Activity" icon={<FileText className="w-5 h-5 text-slate-400" />} action={<span className="text-sm text-slate-500">Last {dash.recent.length}</span>}>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 font-medium">Created</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium text-right">Revenue</th>
                  <th className="py-2 font-medium text-right">Profit</th>
                  <th className="py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dash.recent.map((r) => {
                  const meta = STATUS_META[r.status] ?? { label: r.status, cls: 'bg-slate-100 text-slate-700' };
                  return (
                    <tr key={r.id}>
                      <td className="py-2 text-slate-600">{format(new Date(r.createdAt), 'PP')}</td>
                      <td className="py-2"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${meta.cls}`}>{meta.label}</span></td>
                      <td className="py-2 text-right text-slate-600">{fmtMoney(r.revenue, r.currency)}</td>
                      <td className={`py-2 text-right font-medium ${r.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtMoney(r.profit, r.currency)}</td>
                      <td className="py-2 text-right">
                        <button onClick={() => navigate(`/app/trades/${r.id}`)} className="text-blue-600 hover:underline font-medium">Open</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
