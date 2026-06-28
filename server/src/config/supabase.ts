// ---------------------------------------------------------------------------
// Supabase client
//
// A single shared client instance used across the whole server for both
// Postgres (the `trades` table) and Storage (PDF files). It is created with the
// service-role key, so it bypasses Row Level Security — appropriate for a
// trusted backend, NOT for browser code.
// ---------------------------------------------------------------------------

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

// ---------------------------------------------------------------------------
// Trusted server-side client (service-role key).
//
// This is the ONLY client the backend uses for Postgres + Storage. The
// service-role key bypasses Row Level Security — which is correct and
// documented for a trusted backend: every request has already passed through
// `requireAuth`, so authorization is enforced at the application layer.
//
// RLS stays ENABLED on the tables/buckets to protect the *public* path (the
// browser uses the anon/publishable key); the server is simply trusted.
//
// IMPORTANT: do NOT override `Authorization` with a user JWT here. Doing so
// demotes the client out of the service_role context and re-subjects every
// operation to RLS — which is exactly what caused storage uploads to fail with
// "new row violates row-level security policy".
// ---------------------------------------------------------------------------
export const supabase: SupabaseClient = createClient(
  env.supabaseUrl,
  env.supabaseKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);
