import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Landmark, Search, Plus, Pencil, Trash2, Loader2, X, Star } from 'lucide-react';
import { bankProfilesApi, type BankProfile, type BankProfileInput } from '../../lib/api';
import { showToast } from '../../lib/toast';

interface DialogState {
  mode: 'create' | 'edit';
  profile?: BankProfile;
}

export function BankProfilesListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const { data: profiles = [], isLoading, error } = useQuery({
    queryKey: ['bank-profiles'],
    queryFn: () => bankProfilesApi.list(),
    staleTime: 0,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['bank-profiles'] });

  const remove = useMutation({
    mutationFn: (id: string) => bankProfilesApi.remove(id),
    onSuccess: () => { showToast('Bank profile deleted.', 'success'); invalidate(); },
    onError: (e: any) => showToast(e?.response?.data?.error || 'Failed to delete bank profile.', 'error'),
  });

  const handleDelete = (p: BankProfile) => {
    if (!window.confirm(`Delete bank profile “${p.profile_name}”? This cannot be undone.`)) return;
    remove.mutate(p.id);
  };

  const filtered = profiles.filter((p) =>
    p.profile_name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Landmark className="w-6 h-6 text-slate-400" />
          <h1 className="text-2xl font-bold text-slate-900">Bank Profiles</h1>
          <span className="ml-2 text-sm text-slate-500">{profiles.length} total</span>
        </div>
        <button
          onClick={() => setDialog({ mode: 'create' })}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> Add Bank Profile
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by profile name…"
          className="w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />)}
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-500">Failed to load bank profiles.</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Landmark className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p>{search ? 'No bank profiles match your search.' : 'No bank profiles yet. Click “Add Bank Profile” to create one.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
                  <th className="px-6 py-3 font-medium">Profile Name</th>
                  <th className="px-6 py-3 font-medium">Beneficiary</th>
                  <th className="px-6 py-3 font-medium">Bank</th>
                  <th className="px-6 py-3 font-medium">Currency</th>
                  <th className="px-6 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => navigate(`/app/bank-profiles/${p.id}`)}
                    className="hover:bg-blue-50 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4 font-medium text-slate-900">
                      <span className="inline-flex items-center gap-2">
                        {p.profile_name}
                        {p.is_default && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                            <Star className="w-3 h-3" /> Default
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{p.beneficiary_name}</td>
                    <td className="px-6 py-4 text-slate-600">{p.bank_name}</td>
                    <td className="px-6 py-4 text-slate-600">{p.currency || '—'}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setDialog({ mode: 'edit', profile: p })} className="text-slate-400 hover:text-blue-600" title="Edit"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => handleDelete(p)} disabled={remove.isPending} className="text-slate-400 hover:text-red-600 disabled:opacity-50" title="Delete"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialog && (
        <BankProfileDialog
          state={dialog}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); invalidate(); }}
        />
      )}
    </div>
  );
}

// --- Create / Edit dialog ---------------------------------------------------

type FormState = {
  profile_name: string;
  beneficiary_name: string;
  beneficiary_address: string;
  intermediary_bank_name: string;
  intermediary_bank_address: string;
  intermediary_bank_swift: string;
  bank_name: string;
  bank_swift: string;
  account_number: string;
  iban: string;
  ara_number: string;
  field_71a: string;
  currency: string;
  is_default: boolean;
};

const EMPTY: FormState = {
  profile_name: '', beneficiary_name: '', beneficiary_address: '',
  intermediary_bank_name: '', intermediary_bank_address: '', intermediary_bank_swift: '',
  bank_name: '', bank_swift: '', account_number: '', iban: '', ara_number: '',
  field_71a: 'OUR', currency: 'USD', is_default: false,
};

function fromProfile(p: BankProfile): FormState {
  return {
    profile_name: p.profile_name ?? '',
    beneficiary_name: p.beneficiary_name ?? '',
    beneficiary_address: p.beneficiary_address ?? '',
    intermediary_bank_name: p.intermediary_bank_name ?? '',
    intermediary_bank_address: p.intermediary_bank_address ?? '',
    intermediary_bank_swift: p.intermediary_bank_swift ?? '',
    bank_name: p.bank_name ?? '',
    bank_swift: p.bank_swift ?? '',
    account_number: p.account_number ?? '',
    iban: p.iban ?? '',
    ara_number: p.ara_number ?? '',
    field_71a: p.field_71a ?? '',
    currency: p.currency ?? '',
    is_default: p.is_default ?? false,
  };
}

function Field({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

function BankProfileDialog({ state, onClose, onSaved }: { state: DialogState; onClose: () => void; onSaved: () => void }) {
  const isEdit = state.mode === 'edit';
  const [form, setForm] = useState<FormState>(state.profile ? fromProfile(state.profile) : EMPTY);
  const set = (key: keyof FormState) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  const canSubmit =
    form.profile_name.trim().length > 0 &&
    form.beneficiary_name.trim().length > 0 &&
    form.bank_name.trim().length > 0;

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: BankProfileInput = {
        profile_name: form.profile_name.trim(),
        beneficiary_name: form.beneficiary_name.trim(),
        beneficiary_address: form.beneficiary_address.trim() || null,
        intermediary_bank_name: form.intermediary_bank_name.trim() || null,
        intermediary_bank_address: form.intermediary_bank_address.trim() || null,
        intermediary_bank_swift: form.intermediary_bank_swift.trim() || null,
        bank_name: form.bank_name.trim(),
        bank_swift: form.bank_swift.trim() || null,
        account_number: form.account_number.trim() || null,
        iban: form.iban.trim() || null,
        ara_number: form.ara_number.trim() || null,
        field_71a: form.field_71a.trim() || null,
        currency: form.currency.trim() || null,
        is_default: form.is_default,
      };
      return isEdit && state.profile
        ? bankProfilesApi.update(state.profile.id, payload)
        : bankProfilesApi.create(payload);
    },
    onSuccess: () => { showToast(isEdit ? 'Bank profile updated.' : 'Bank profile created.', 'success'); onSaved(); },
    onError: (e: any) => showToast(e?.response?.data?.error || 'Operation failed.', 'error'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2 bg-slate-50 rounded-t-xl">
          <Landmark className="w-5 h-5 text-slate-400" />
          <h3 className="text-base font-semibold text-slate-900">{isEdit ? 'Edit Bank Profile' : 'Add Bank Profile'}</h3>
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2"><Field label="Profile Name" value={form.profile_name} onChange={set('profile_name')} required /></div>
          <Field label="Beneficiary Name" value={form.beneficiary_name} onChange={set('beneficiary_name')} required />
          <div className="sm:col-span-2"><Field label="Beneficiary Address" value={form.beneficiary_address} onChange={set('beneficiary_address')} /></div>
          <Field label="Intermediary Bank Name" value={form.intermediary_bank_name} onChange={set('intermediary_bank_name')} />
          <Field label="Intermediary Bank SWIFT" value={form.intermediary_bank_swift} onChange={set('intermediary_bank_swift')} />
          <div className="sm:col-span-2"><Field label="Intermediary Bank Address" value={form.intermediary_bank_address} onChange={set('intermediary_bank_address')} /></div>
          <Field label="Bank Name" value={form.bank_name} onChange={set('bank_name')} required />
          <Field label="Bank SWIFT" value={form.bank_swift} onChange={set('bank_swift')} />
          <Field label="Account Number" value={form.account_number} onChange={set('account_number')} />
          <Field label="IBAN" value={form.iban} onChange={set('iban')} />
          <Field label="ARA Number" value={form.ara_number} onChange={set('ara_number')} />
          <Field label="Field 71A" value={form.field_71a} onChange={set('field_71a')} />
          <Field label="Currency" value={form.currency} onChange={set('currency')} />
          <div className="flex items-center gap-2 mt-6">
            <input
              id="is_default"
              type="checkbox"
              checked={form.is_default}
              onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))}
              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="is_default" className="text-sm font-medium text-slate-700">Default Profile</label>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
