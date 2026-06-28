import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DollarSign, Loader2, Calculator } from 'lucide-react';
import { tradesApi, type Trade, type TradeFinancialInput } from '../../lib/api';
import { showToast } from '../../lib/toast';

interface FinancialSummaryProps {
  trade: Trade;
}

// Editable input fields (totals are derived + persisted server-side, not here).
const FIELDS: { key: keyof TradeFinancialInput; label: string }[] = [
  { key: 'frigo_purchase_price', label: 'Frigo Purchase Price' },
  { key: 'sale_unit_price', label: 'Sale Unit Price' },
  { key: 'sale_total', label: 'Sale Total' },
  { key: 'shipping_cost', label: 'Shipping Cost' },
  { key: 'insurance_cost', label: 'Insurance Cost' },
  { key: 'bank_fees', label: 'Bank Fees' },
];

function toFormValue(v: number | null | undefined): string {
  return v === null || v === undefined ? '' : String(v);
}

export function FinancialSummary({ trade }: FinancialSummaryProps) {
  const queryClient = useQueryClient();
  const currency = trade.currency || 'USD';

  const [form, setForm] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of FIELDS) init[f.key] = toFormValue(trade[f.key as keyof Trade] as number | null);
    return init;
  });

  const money = (val?: number | null) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(
      val != null && Number.isFinite(Number(val)) ? Number(val) : 0
    );

  const mutation = useMutation({
    mutationFn: () => {
      const payload: TradeFinancialInput = {};
      for (const f of FIELDS) {
        const raw = form[f.key];
        payload[f.key] = raw === '' ? null : (Number(raw) as any);
      }
      return tradesApi.updateTrade(trade.id, payload);
    },
    onSuccess: () => {
      showToast('Financials saved.', 'success');
      // Server recomputed total_costs + net_profit — refetch trade + any client views.
      queryClient.invalidateQueries({ queryKey: ['trade', trade.id] });
      if (trade.client_id) {
        // Refresh the client BI dashboard (and legacy analytics queries) so every
        // metric reflects the new financials immediately.
        queryClient.invalidateQueries({ queryKey: ['client-dashboard', trade.client_id] });
        queryClient.invalidateQueries({ queryKey: ['client-financial', trade.client_id] });
        queryClient.invalidateQueries({ queryKey: ['client-profit', trade.client_id] });
        queryClient.invalidateQueries({ queryKey: ['client-trades', trade.client_id] });
      }
    },
    onError: () => showToast('Failed to save financials.', 'error'),
  });

  const invalid = FIELDS.some((f) => form[f.key] !== '' && !Number.isFinite(Number(form[f.key])));
  const netProfit = trade.net_profit ?? null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2 bg-slate-50">
        <DollarSign className="w-5 h-5 text-slate-400" />
        <h3 className="text-lg font-semibold text-slate-900">Financial Summary</h3>
        <span className="ml-auto text-xs text-slate-400">Currency: {currency}</span>
      </div>

      <div className="p-6 space-y-6">
        {/* Editable inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="block text-sm font-medium text-slate-600">{f.label}</label>
              <div className="mt-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={form[f.key]}
                  onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  placeholder="0.00"
                  className="w-full pl-7 pr-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Derived totals — calculated and stored by the server on save */}
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-slate-500 flex items-center gap-1">
              <Calculator className="w-3.5 h-3.5" /> Total Costs
            </p>
            <p className="mt-1 text-xl font-bold text-slate-900">{money(trade.total_costs)}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">Net Profit</p>
            <p className={`mt-1 text-2xl font-bold ${
              netProfit == null ? 'text-slate-400'
                : netProfit > 0 ? 'text-green-600'
                : netProfit < 0 ? 'text-red-600'
                : 'text-slate-900'
            }`}>
              {money(netProfit)}
            </p>
          </div>
          <p className="col-span-2 text-xs text-slate-400">
            Total Costs = Frigo + Shipping + Insurance + Bank Fees &nbsp;·&nbsp; Net Profit = Sale Total − Total Costs.
            Calculated and persisted by the server.
          </p>
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || invalid}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
            {mutation.isPending ? 'Saving…' : 'Save & Recalculate'}
          </button>
        </div>
      </div>
    </div>
  );
}
