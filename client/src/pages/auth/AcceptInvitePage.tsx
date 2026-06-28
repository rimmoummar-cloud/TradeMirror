import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react';
import { authApi, type InvitationCheck } from '../../lib/api';
import { useAuthStore } from '../../store/authStore';

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const [check, setCheck] = useState<InvitationCheck | null>(null);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!token) { setCheck({ valid: false, reason: 'Missing invitation token.' }); setChecking(false); return; }
      try {
        const result = await authApi.validateInvite(token);
        if (active) setCheck(result);
      } catch {
        if (active) setCheck({ valid: false, reason: 'Could not validate this invitation.' });
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => { active = false; };
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setSubmitting(true);
    try {
      const { email } = await authApi.acceptInvite(token, password);
      // Activate done server-side — now sign in and go to the dashboard.
      await login(email, password);
      navigate('/app/dashboard');
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to accept invitation.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4 sm:px-6">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg">
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
        </div>
        <h2 className="mt-4 text-center text-2xl font-extrabold text-slate-900">Accept your invitation</h2>
        <p className="mt-2 text-center text-sm text-slate-600">TradeMirror OS</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-xl shadow-slate-200/40 sm:rounded-xl border border-slate-100">
          {checking ? (
            <div className="flex items-center justify-center gap-2 text-slate-500 py-6">
              <Loader2 className="w-5 h-5 animate-spin" /> Validating invitation…
            </div>
          ) : !check?.valid ? (
            <div className="text-center py-4">
              <XCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
              <p className="text-slate-700 font-medium">Invitation unavailable</p>
              <p className="text-sm text-slate-500 mt-1">{check?.reason}</p>
              <button onClick={() => navigate('/login')} className="mt-4 text-blue-600 hover:underline text-sm">Go to login</button>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-md p-3">
                <CheckCircle2 className="w-4 h-4" />
                <span>Invited as <strong>{(check.role ?? '').replace(/_/g, ' ')}</strong> ({check.email})</span>
              </div>
              {error && <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
              <div>
                <label className="block text-sm font-medium text-slate-700">Set password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="At least 8 characters" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">Confirm password</label>
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required
                  className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <button type="submit" disabled={submitting}
                className="w-full flex justify-center items-center gap-2 py-2.5 px-4 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                Activate account
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
