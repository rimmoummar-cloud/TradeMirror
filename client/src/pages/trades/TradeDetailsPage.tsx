import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { tradesApi, clientsApi } from '../../lib/api';
import { showToast } from '../../lib/toast';
import { FileEdit, FileOutput, ArrowLeft, Building2, FileText, DollarSign, Link as LinkIcon, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { TradeFolder } from '../../features/documents/TradeFolder';
import { TradeActivity } from '../../features/audit/TradeActivity';
// import { FinancialSummary } from '../../features/financials/FinancialSummary';

export function TradeDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!id) return;
    if (!window.confirm('Delete this trade permanently? This cannot be undone.')) return;
    console.group('[TradeDetailsPage] 🗑️ Delete trade');
    console.log('Trade ID:', id);
    setDeleting(true);
    try {
      const res = await tradesApi.deleteTrade(id);
      console.log('[TradeDetailsPage] Delete response:', res);
      // Remove from caches so the list/dashboard update immediately.
      queryClient.removeQueries({ queryKey: ['trade', id] });
      await queryClient.invalidateQueries({ queryKey: ['trades'] });
      showToast('Trade deleted.', 'success');
      navigate('/app/trades');
    } catch (err) {
      console.error('[TradeDetailsPage] Delete FAILED:', err);
      showToast('Failed to delete trade. Please try again.', 'error');
    } finally {
      console.log('[TradeDetailsPage] Delete finished');
      setDeleting(false);
      console.groupEnd();
    }
  };

  const { data: trade, isLoading, error } = useQuery({
    queryKey: ['trade', id],
    queryFn: async () => {
      console.log('[TradeDetailsPage] LOAD — getTrade', id);
      const fresh = await tradesApi.getTrade(id!);
      console.log('[TradeDetailsPage] LOAD response — full trade:', fresh);
      return fresh;
    },
    enabled: !!id,
    // Source of truth = backend. Never show cached/stale state: re-fetch every
    // time this page mounts so edits made in the editor are always reflected.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Linked client (single source of truth). Loaded only when the trade has one.
  const { data: linkedClient } = useQuery({
    queryKey: ['trade-client', trade?.client_id],
    queryFn: () => clientsApi.get(trade!.client_id!),
    enabled: !!trade?.client_id,
    staleTime: 0,
  });

  // PDF generation history for this trade (newest first). Always fresh.
  const { data: generations = [] } = useQuery({
    queryKey: ['trade-generations', id],
    queryFn: async () => {
      console.log('[TradeDetailsPage] LOAD — getTradeGenerations', id);
      const list = await tradesApi.getTradeGenerations(id!);
      console.log('[TradeDetailsPage] generations:', list);
      return list;
    },
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-slate-500">Loading trade details...</div>;
  }

  if (error || !trade) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500">
        <p className="mb-4 text-red-500">Failed to load trade details.</p>
        <button onClick={() => navigate('/app/trades')} className="text-blue-600 hover:underline">
          Go back to trades
        </button>
      </div>
    );
  }

  const formatCurrency = (val?: number, currency = 'USD') => {
    if (val === undefined || val === null || Number.isNaN(Number(val))) return '-';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(val));
  };

  // ---------------------------------------------------------------------------
  // SAFE FIELD MAPPING
  //
  // `edited_data` can be EITHER:
  //   • a full nested ContractData ({ buyer, seller, trade, ... }) — after the
  //     user saves the edit form, OR
  //   • the flat server-parsed object ({ contractNumber, commodity, ... }) —
  //     right after upload, before any edit.
  // `extracted_data` is always the flat server parse.
  //
  // We read nested first, then flat-on-edited, then flat-on-extracted, so the UI
  // shows real data in every state instead of "Not specified".
  // ---------------------------------------------------------------------------
  const edited = (trade.edited_data ?? {}) as Record<string, any>;
  const extracted = (trade.extracted_data ?? {}) as Record<string, any>;
  const buyer = (edited.buyer ?? {}) as Record<string, any>;
  const t = (edited.trade ?? {}) as Record<string, any>;

  const view = {
    clientName: buyer.name ?? edited.clientName ?? extracted.buyer?.name ?? '',
    clientEmail: buyer.email ?? edited.clientEmail ?? '',
    clientAddress:
      [buyer.address, buyer.city, buyer.country].filter(Boolean).join(', ') ||
      edited.clientAddress ||
      '',
    contractNumber: edited.contractNumber ?? extracted.contractNumber ?? '',
    contractDate: edited.contractDate ?? extracted.contractDate ?? '',
    incoterm: t.incoterm ?? edited.incoterm ?? extracted.incoterm ?? '',
    commodity: t.commodity ?? edited.commodity ?? extracted.commodity ?? '',
    unit: t.unit ?? edited.unit ?? '',
    quantity: t.quantity ?? edited.quantity ?? extracted.quantity,
    unitPrice: t.unitPrice ?? edited.unitPrice ?? extracted.unitPrice,
    totalAmount: t.totalAmount ?? edited.totalAmount ?? extracted.totalAmount,
    currency: t.currency ?? edited.currency ?? extracted.currency ?? 'USD',
  };

  // DEBUG: surface exactly what the backend returned and how it was mapped, so a
  // "Not specified" can be traced to data vs. mapping in one glance.
  console.log('[TradeDetailsPage] trade loaded:', trade.id, {
    edited_data: trade.edited_data,
    extracted_data: trade.extracted_data,
    mappedView: view,
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => navigate('/app/trades')}
          className="flex items-center text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back to Trades
        </button>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={() => navigate(`/app/editor/${trade.id}`)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm"
          >
            <FileEdit className="w-4 h-4" />
            Open Editor
          </button>
          <button
            onClick={() => navigate(`/app/generate/${trade.id}`)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 border border-transparent text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm"
          >
            <FileOutput className="w-4 h-4" />
            Generate PDF
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-4 h-4" />
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>

      {/* Title Block */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {view.contractNumber || trade.trade_reference || 'Trade ' + trade.id.substring(0, 8)}
          </h1>
          <p className="text-slate-500 mt-1">
            Created on {trade.created_at ? format(new Date(trade.created_at), 'PPP') : 'Unknown'}
          </p>
        </div>
        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium capitalize ${
          trade.status === 'completed' ? 'bg-green-100 text-green-800' :
          trade.status === 'active' ? 'bg-blue-100 text-blue-800' :
          'bg-slate-100 text-slate-800'
        }`}>
          {trade.status}
        </span>
      </div>

      {/* Client (single source of truth) — clickable through to the client page */}
      {trade.client_id && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Client</p>
              <button
                onClick={() => navigate(`/app/clients/${trade.client_id}`)}
                className="text-lg font-semibold text-blue-600 hover:underline text-left"
              >
                {linkedClient?.name || view.clientName || 'View client'}
              </button>
              {(linkedClient?.country || linkedClient?.email) && (
                <p className="text-xs text-slate-500">
                  {[linkedClient?.country, linkedClient?.email].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={() => navigate(`/app/clients/${trade.client_id}`)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Building2 className="w-4 h-4" />
            View Client
          </button>
        </div>
      )}

      {/* Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Client Info */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2 bg-slate-50">
            <Building2 className="w-5 h-5 text-slate-400" />
            <h3 className="text-lg font-semibold text-slate-900">Client Info</h3>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Client Name</p>
              <p className="mt-1 text-slate-900">{linkedClient?.name || view.clientName || 'Not specified'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Contact Email</p>
              <p className="mt-1 text-slate-900">{linkedClient?.email || view.clientEmail || 'Not specified'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Address</p>
              <p className="mt-1 text-slate-900">
                {[linkedClient?.address, linkedClient?.city, linkedClient?.country].filter(Boolean).join(', ') || view.clientAddress || 'Not specified'}
              </p>
            </div>
            {trade.client_id && (
              <p className="text-xs text-slate-400">🔒 Read-only — managed in the Clients module.</p>
            )}
          </div>
        </div>

        {/* Contract Data */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2 bg-slate-50">
            <FileText className="w-5 h-5 text-slate-400" />
            <h3 className="text-lg font-semibold text-slate-900">Contract Data</h3>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Contract Number</p>
              <p className="mt-1 text-slate-900">{view.contractNumber || 'Not specified'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Commodity</p>
              <p className="mt-1 text-slate-900">{view.commodity || 'Not specified'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Incoterm</p>
              <p className="mt-1 text-slate-900">{view.incoterm || 'Not specified'}</p>
            </div>
          </div>
        </div>

        {/* Financial Data */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2 bg-slate-50">
            <DollarSign className="w-5 h-5 text-slate-400" />
            <h3 className="text-lg font-semibold text-slate-900">Financial Data</h3>
          </div>
          <div className="p-6 grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-slate-500">Quantity</p>
              <p className="mt-1 text-lg font-medium text-slate-900">
                {view.quantity !== undefined && view.quantity !== null
                  ? `${view.quantity}${view.unit ? ' ' + view.unit : ''}`
                  : '-'}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Unit Price</p>
              <p className="mt-1 text-lg font-medium text-slate-900">
                {formatCurrency(view.unitPrice, view.currency)}
              </p>
            </div>
            <div className="col-span-2 pt-4 border-t border-slate-100">
              <p className="text-sm font-medium text-slate-500">Total Amount</p>
              <p className="mt-1 text-2xl font-bold text-green-600">
                {formatCurrency(view.totalAmount, view.currency)}
              </p>
            </div>
          </div>
        </div>

        {/* Document Links */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2 bg-slate-50">
            <LinkIcon className="w-5 h-5 text-slate-400" />
            <h3 className="text-lg font-semibold text-slate-900">Document Links</h3>
          </div>
          <div className="p-6 space-y-4">
            <button
              onClick={() => navigate(`/app/generate/${trade.id}`)}
              className="w-full flex items-center justify-between p-4 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                  <FileOutput className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <p className="font-medium text-slate-900 group-hover:text-blue-700 transition-colors">Final Contract PDF</p>
                  <p className="text-xs text-slate-500">Ready to download or preview</p>
                </div>
              </div>
              <span className="text-sm text-blue-600 font-medium group-hover:underline">View</span>
            </button>
            {/* Can add more document links here if needed */}
          </div>
        </div>
      </div>

      {/* Financial Summary — editable inputs; totals computed + stored server-side */}
      {/* <FinancialSummary trade={trade} /> */}

      {/* Trade Folder — original, generated versions, signed contract, BOL, extras */}
      <TradeFolder
        tradeId={trade.id}
        originalPdfUrl={trade.original_pdf_url ?? null}
        generations={generations}
      />

      {/* Activity timeline — last 10 audit events for this trade */}
      <TradeActivity tradeId={trade.id} />
    </div>
  );
}
