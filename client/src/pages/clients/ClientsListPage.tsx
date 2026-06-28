import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Users, Search, Mail, Phone, Globe } from 'lucide-react';
import { clientsApi } from '../../lib/api';

export function ClientsListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const { data: clients = [], isLoading, error } = useQuery({
    queryKey: ['clients', search],
    queryFn: () => clientsApi.list(search || undefined),
    staleTime: 0,
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Users className="w-6 h-6 text-slate-400" />
        <h1 className="text-2xl font-bold text-slate-900">Clients</h1>
        <span className="ml-2 text-sm text-slate-500">{clients.length} total</span>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or country…"
          className="w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-500">Failed to load clients.</div>
        ) : clients.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Users className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p>{search ? 'No clients match your search.' : 'No clients yet. They are created automatically when you upload a trade.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
                <th className="px-6 py-3 font-medium">Name</th>
                <th className="px-6 py-3 font-medium">Country</th>
                <th className="px-6 py-3 font-medium">Tax ID</th>
                <th className="px-6 py-3 font-medium">Contact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clients.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/app/clients/${c.id}`)}
                  className="hover:bg-blue-50 cursor-pointer transition-colors"
                >
                  <td className="px-6 py-4 font-medium text-slate-900">{c.name}</td>
                  <td className="px-6 py-4 text-slate-600">
                    {c.country ? (
                      <span className="inline-flex items-center gap-1"><Globe className="w-3.5 h-3.5 text-slate-400" />{c.country}</span>
                    ) : '—'}
                  </td>
                  <td className="px-6 py-4 text-slate-600">{c.tax_id || '—'}</td>
                  <td className="px-6 py-4 text-slate-600">
                    <div className="flex flex-col gap-0.5">
                      {c.email && <span className="inline-flex items-center gap-1 text-xs"><Mail className="w-3.5 h-3.5 text-slate-400" />{c.email}</span>}
                      {c.phone && <span className="inline-flex items-center gap-1 text-xs"><Phone className="w-3.5 h-3.5 text-slate-400" />{c.phone}</span>}
                      {!c.email && !c.phone && '—'}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
