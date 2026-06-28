import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  UserCog, Search, UserPlus, Pencil, Power, Trash2, Loader2, X, ShieldCheck,
} from 'lucide-react';
import { usersApi, type AppUser, type UserRole } from '../../lib/api';
import { showToast } from '../../lib/toast';

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'admin', label: 'Admin' },
  { value: 'employee', label: 'Employee' },
  { value: 'partner', label: 'Partner' },
];
const ROLE_LABEL: Record<string, string> = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r.label]));
const ROLE_CLS: Record<string, string> = {
  super_admin: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
  employee: 'bg-teal-100 text-teal-700',
  partner: 'bg-slate-100 text-slate-700',
};

interface DialogState {
  mode: 'invite' | 'edit';
  user?: AppUser;
}

export function UsersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const { data: users = [], isLoading, error } = useQuery({
    queryKey: ['users', { search, roleFilter }],
    queryFn: () => usersApi.list({ search: search || undefined, role: roleFilter || undefined }),
    staleTime: 0,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => usersApi.setActive(id, active),
    onSuccess: (_d, v) => { showToast(`User ${v.active ? 'activated' : 'deactivated'}.`, 'success'); invalidate(); },
    onError: (e: any) => showToast(e?.response?.data?.error || 'Failed to update status.', 'error'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => { showToast('User deleted.', 'success'); invalidate(); },
    onError: (e: any) => showToast(e?.response?.data?.error || 'Failed to delete user.', 'error'),
  });

  const handleDelete = (u: AppUser) => {
    if (!window.confirm(`Delete ${u.email}? This permanently removes their account.`)) return;
    remove.mutate(u.id);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <UserCog className="w-6 h-6 text-slate-400" />
          <h1 className="text-2xl font-bold text-slate-900">Users</h1>
          <span className="ml-2 text-sm text-slate-500">{users.length}</span>
        </div>
        <button
          onClick={() => setDialog({ mode: 'invite' })}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm"
        >
          <UserPlus className="w-4 h-4" /> Add User
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full pl-10 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All roles</option>
          {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {error ? (
          <div className="p-8 text-center text-red-500">Failed to load users.</div>
        ) : isLoading ? (
          <div className="p-6 space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}</div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center text-slate-500">No users match your filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Last Login</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{u.full_name || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_CLS[u.role] ?? 'bg-slate-100 text-slate-700'}`}>
                        {ROLE_LABEL[u.role] ?? u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.is_active ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
                      ) : u.invitation_status === 'pending' ? (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Invited</span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{u.created_at ? format(new Date(u.created_at), 'MMM dd, yyyy') : '—'}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{u.last_login_at ? format(new Date(u.last_login_at), 'MMM dd, HH:mm') : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => setDialog({ mode: 'edit', user: u })} className="text-slate-400 hover:text-blue-600" title="Edit"><Pencil className="w-4 h-4" /></button>
                        <button
                          onClick={() => setActive.mutate({ id: u.id, active: !u.is_active })}
                          disabled={setActive.isPending}
                          className={`hover:opacity-80 disabled:opacity-50 ${u.is_active ? 'text-amber-500' : 'text-green-600'}`}
                          title={u.is_active ? 'Deactivate' : 'Activate'}
                        >
                          <Power className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(u)} disabled={remove.isPending} className="text-slate-400 hover:text-red-600 disabled:opacity-50" title="Delete"><Trash2 className="w-4 h-4" /></button>
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
        <UserDialog
          state={dialog}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); invalidate(); }}
        />
      )}
    </div>
  );
}

// --- Invite / Edit dialog ---------------------------------------------------
function UserDialog({ state, onClose, onSaved }: { state: DialogState; onClose: () => void; onSaved: () => void }) {
  const isEdit = state.mode === 'edit';
  const [fullName, setFullName] = useState(state.user?.full_name ?? '');
  const [email, setEmail] = useState(state.user?.email ?? '');
  const [role, setRole] = useState<UserRole>((state.user?.role as UserRole) ?? 'employee');

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const mutation = useMutation({
    mutationFn: async () => {
      if (isEdit && state.user) {
        return usersApi.update(state.user.id, { full_name: fullName, role });
      }
      return usersApi.invite({ email, full_name: fullName, role });
    },
    onSuccess: (res: any) => {
      if (!isEdit) {
        if (res?.alreadyActive) showToast('This user already has an active account — name & role were synced.', 'info');
        else if (res?.emailSent) showToast('Invitation email sent.', 'success');
        else showToast(`User invited. Email not sent — share this link:\n${res?.invitationLink ?? ''}`, 'info', 12000);
      } else {
        showToast('User updated.', 'success');
      }
      onSaved();
    },
    onError: (e: any) => showToast(e?.response?.data?.error || 'Operation failed.', 'error'),
  });

  const canSubmit = isEdit ? fullName.trim().length > 0 : emailValid;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-md">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2 bg-slate-50 rounded-t-xl">
          <ShieldCheck className="w-5 h-5 text-slate-400" />
          <h3 className="text-base font-semibold text-slate-900">{isEdit ? 'Edit User' : 'Invite User'}</h3>
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">Full Name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Jane Doe" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isEdit}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
              placeholder="user@company.com"
            />
            {!isEdit && email && !emailValid && <p className="mt-1 text-xs text-red-600">Enter a valid email address.</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            {isEdit ? 'Save' : 'Send Invitation'}
          </button>
        </div>
      </div>
    </div>
  );
}
