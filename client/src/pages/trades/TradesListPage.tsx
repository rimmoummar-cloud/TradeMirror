import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { tradesApi } from '../../lib/api';
import { format } from 'date-fns';

export function TradesListPage() {
  const navigate = useNavigate();
  const { data: trades, isLoading } = useQuery({
    queryKey: ['trades'],
    queryFn: tradesApi.getTrades,
  });

  const formatCurrency = (val?: number) => {
    if (val === undefined || val === null) return '-';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
  };

  // ---------------------------------------------------------------------------
  // Map a trade ROW to the values the table needs, reading from the REAL stored
  // shape. The old code read non-existent mock fields (client_id, clientName,
  // frigo_total, sale_total, net_profit) so every row showed N/A / -.
  // edited_data is the nested ContractData; extracted_data is the flat server
  // parse — prefer edited, fall back to extracted.
  // ---------------------------------------------------------------------------
  const num = (v: unknown): number | undefined =>
    v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v);

  const resolveRow = (trade: any) => {
    const edited = (trade.edited_data ?? {}) as any;
    const extracted = (trade.extracted_data ?? {}) as any;
    const t = (edited.trade ?? {}) as any;

    const clientName =
      edited.buyer?.name ?? extracted.buyer?.name ?? edited.clientName ?? trade.client_id ?? '';

    // The only financial total stored on a trade is the contract total
    // (quantity × unitPrice) = the Frigorifico contract amount.
    const qty = num(t.quantity) ?? num(edited.quantity) ?? num(extracted.quantity);
    const unitPrice = num(t.unitPrice) ?? num(edited.unitPrice) ?? num(extracted.unitPrice);
    const computed = qty !== undefined && unitPrice !== undefined ? qty * unitPrice : undefined;
    const frigoTotal =
      num(t.totalAmount) ?? num(edited.totalAmount) ?? num(extracted.totalAmount) ?? computed;

    // No separate sale/resale figure is captured in the trade data, so Sale Total
    // has no source and Net Profit (Sale − Frigo) is only shown when both exist.
    const saleTotal: number | undefined = num(t.saleTotal) ?? num(edited.saleTotal);
    const netProfit =
      saleTotal !== undefined && frigoTotal !== undefined ? saleTotal - frigoTotal : undefined;

    return { clientName, frigoTotal, saleTotal, netProfit };
  };

  if (trades && trades.length) {
    // Debug: verify the actual payload + how the first row maps.
    console.log('[TradesList] payload sample:', {
      id: trades[0].id,
      edited_data: trades[0].edited_data,
      extracted_data: trades[0].extracted_data,
      resolved: resolveRow(trades[0]),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Trades</h1>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Trade Ref
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Client
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Date
                </th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Frigo Total
                </th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Sale Total
                </th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Net Profit
                </th>
                <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    Loading...
                  </td>
                </tr>
              ) : trades?.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                    No trades found.
                  </td>
                </tr>
              ) : (
                trades?.map((trade) => {
                  const row = resolveRow(trade);
                  return (
                  <tr
                    key={trade.id}
                    onClick={() => navigate(`/app/trades/${trade.id}`)}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600">
                      {trade.trade_reference || trade.id.substring(0, 8)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                      {row.clientName || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500">
                      {trade.created_at ? format(new Date(trade.created_at), 'MMM dd, yyyy') : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 text-right font-medium">
                      {formatCurrency(row.frigoTotal)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900 text-right font-medium">
                      {formatCurrency(row.saleTotal)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 text-right font-medium">
                      {formatCurrency(row.netProfit)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                        trade.status === 'completed' ? 'bg-green-100 text-green-800' :
                        trade.status === 'active' ? 'bg-blue-100 text-blue-800' :
                        'bg-slate-100 text-slate-800'
                      }`}>
                        {trade.status}
                      </span>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
