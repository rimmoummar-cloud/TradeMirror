import { create } from 'zustand';
import type { User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { authApi, type AppUser } from '../lib/api';

interface AuthState {
  user: User | null;
  profile: AppUser | null;        // public.users row (role, is_active, full_name…)
  isAuthenticated: boolean;
  isLoading: boolean;
  initialize: () => Promise<void>;
  login: (email: string, password?: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  isAuthenticated: false,
  isLoading: true,
  initialize: async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // Hydrate the profile (role/active) so gating survives a refresh.
        try {
          const profile = await authApi.me();
          if (!profile.is_active) {
            await supabase.auth.signOut();
            set({ user: null, profile: null, isAuthenticated: false, isLoading: false });
            return;
          }
          set({ user: session.user, profile, isAuthenticated: true, isLoading: false });
        } catch {
          set({ user: session.user, profile: null, isAuthenticated: true, isLoading: false });
        }
      } else {
        set({ user: null, profile: null, isAuthenticated: false, isLoading: false });
      }

      supabase.auth.onAuthStateChange((_event, s) => {
        set({ user: s?.user ?? null, isAuthenticated: !!s });
      });
    } catch (e) {
      set({ user: null, profile: null, isAuthenticated: false, isLoading: false });
    }
  },
  login: async (email: string, password?: string) => {
    if (!supabaseConfigured) {
      throw new Error(
        'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in client/.env and restart the dev server.'
      );
    }
    if (!password) {
      throw new Error('Password is required.');
    }
    set({ isLoading: true });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data.user) {
        // Backend session: enforces the active check + records the login.
        // A 403 here means the account is inactive — sign back out and surface it.
        try {
          const profile = await authApi.session();
          set({ user: data.user, profile, isAuthenticated: true });
        } catch (err: any) {
          await supabase.auth.signOut();
          set({ user: null, profile: null, isAuthenticated: false });
          const msg = err?.response?.data?.error || err?.response?.data?.debug?.error;
          throw new Error(msg || 'Your account is inactive. Please contact the administrator.');
        }
      }
    } finally {
      set({ isLoading: false });
    }
  },
  logout: async () => {
    // Record logout server-side BEFORE the token is revoked.
    await authApi.logout();
    await supabase.auth.signOut();
    set({ user: null, profile: null, isAuthenticated: false });
  },
}));
