import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, Landmark, Star, Layers, FileText } from 'lucide-react';
import { bankProfilesApi } from '../../lib/api';

const STATUS_META: Record<string, { label: string; cls: string }> = {
  draft:            { label: 'Draft',            cls: 'bg-slate-100 text-slate-700' },
  active:           { label: 'Active',           cls: 'bg-blue-100 text-blue-700' },
  advance_received: { label: 'Advance Received', cls: 'bg-indigo-100 text-indigo-700' },
  shipped:          { label: 'Shipped',          cls: 'bg-amber-100 text-amber-700' },
  balance_received: { label: 'Balance Received', cls: 'bg-teal-100 text-teal-700' },
  overdue:          { label: 'Overdue',          cls: 'bg-red-100 text-red-700' },
  completed:        { label: 'Completed',        cls: 'bg-green-100 text-green-700' },
};

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

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-slate-900 break-words">{value || 'Not specified'}</p>
    </div>
  );
}

export function BankProfileDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: profile, isLoading, error } = useQuery({
    queryKey: ['bank-profile', id],
    queryFn: () => bankProfilesApi.get(id!),
    enabled: !!id,
    staleTime: 0,
  });

  const { data: trades = [], isLoading: tradesLoading } = useQuery({
    queryKey: ['bank-profile-trades', id],
    queryFn: () => bankProfilesApi.trades(id!),
    enabled: !!id,
    staleTime: 0,
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-slate-500">Loading bank profile…</div>;
  }
  if (error || !profile) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500">
        <p className="mb-4 text-red-500">Failed to load bank profile.</p>
        <button onClick={() => navigate('/app/bank-profiles')} className="text-blue-600 hover:underline">Back to bank profiles</button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <button onClick={() => navigate('/app/bank-profiles')} className="flex items-center text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Bank Profiles
      </button>

      <Card
        title={profile.profile_name}
        icon={<Landmark className="w-5 h-5 text-slate-400" />}
        action={profile.is_default ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
            <Star className="w-3 h-3" /> Default
          </span>
        ) : undefined}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <InfoRow label="Beneficiary Name" value={profile.beneficiary_name} />
          <InfoRow label="Beneficiary Address" value={profile.beneficiary_address} />
          <InfoRow label="Intermediary Bank Name" value={profile.intermediary_bank_name} />
          <InfoRow label="Intermediary Bank SWIFT" value={profile.intermediary_bank_swift} />
          <InfoRow label="Intermediary Bank Address" value={profile.intermediary_bank_address} />
          <InfoRow label="Bank Name" value={profile.bank_name} />
          <InfoRow label="Bank SWIFT" value={profile.bank_swift} />
          <InfoRow label="Account Number" value={profile.account_number} />
          <InfoRow label="IBAN" value={profile.iban} />
          <InfoRow label="ARA Number" value={profile.ara_number} />
          <InfoRow label="Field 71A" value={profile.field_71a} />
          <InfoRow label="Currency" value={profile.currency} />
        </div>
      </Card>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-2 text-slate-400">
          <Layers className="w-4 h-4" />
          <span className="text-xs font-medium uppercase tracking-wide">Trades Using This Bank Profile</span>
        </div>
        <p className="mt-2 text-2xl font-bold text-slate-900">{tradesLoading ? '…' : trades.length}</p>
      </div>

      <Card title="Related Trades" icon={<FileText className="w-5 h-5 text-slate-400" />} action={<span className="text-sm text-slate-500">{trades.length}</span>}>
        {tradesLoading ? (
          <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}</div>
        ) : trades.length === 0 ? (
          <p className="text-sm text-slate-500">No trades use this bank profile yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 font-medium">Trade Reference</th>
                  <th className="py-2 font-medium">Client</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Created At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {trades.map((t) => {
                  const meta = STATUS_META[t.status] ?? { label: t.status, cls: 'bg-slate-100 text-slate-700' };
                  return (
                    <tr
                      key={t.id}
                      onClick={() => navigate(`/app/trades/${t.id}`)}
                      className="hover:bg-blue-50 cursor-pointer transition-colors"
                    >
                      <td className="py-2 font-medium text-slate-900">{t.trade_reference || t.id.slice(0, 8)}</td>
                      <td className="py-2 text-slate-600">{t.client_name || '—'}</td>
                      <td className="py-2"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${meta.cls}`}>{meta.label}</span></td>
                      <td className="py-2 text-slate-600">{t.created_at ? format(new Date(t.created_at), 'PP') : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
