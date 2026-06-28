import { createClient } from '@supabase/supabase-js';
console.log("ENV CHECK:", {
  url: import.meta.env.VITE_SUPABASE_URL,
  key: import.meta.env.VITE_SUPABASE_ANON_KEY,
});
// ---------------------------------------------------------------------------
// Supabase browser client
//
// These MUST be provided via client/.env (see VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY). Vite bakes them in at build time — restart the dev
// server after changing .env.
// ---------------------------------------------------------------------------

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const isPlaceholder =
  !supabaseAnonKey ||
  supabaseAnonKey === 'PASTE_YOUR_SUPABASE_ANON_PUBLIC_KEY_HERE' ||
  supabaseAnonKey === 'dummy_anon_key';

// Fail loudly and clearly. A misconfigured client otherwise points at a
// non-existent local Supabase and surfaces only an opaque "Failed to fetch"
// on every auth/network call, which is very hard to diagnose.
if (!supabaseUrl || isPlaceholder) {
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] Missing configuration.\n' +
      `  VITE_SUPABASE_URL      = ${supabaseUrl ?? '(unset)'}\n` +
      `  VITE_SUPABASE_ANON_KEY = ${isPlaceholder ? '(unset/placeholder)' : '(set)'}\n` +
      'Create/complete client/.env with your Supabase project URL and ANON key, ' +
      'then restart the dev server. Login will fail with "Failed to fetch" until this is set.'
  );
}

// Construct the client even when misconfigured so the app still renders the
// login page; auth calls will reject with a clear message (see authStore).
export const supabaseConfigured = Boolean(supabaseUrl) && !isPlaceholder;

export const supabase = createClient(
  supabaseUrl || 'http://localhost:54321',
  supabaseAnonKey || 'dummy_anon_key'
);
