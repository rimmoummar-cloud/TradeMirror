// ---------------------------------------------------------------------------
// Central logging utility (backend)
//
// One place that decides HOW we print, so every layer logs consistently and
// nothing is ever swallowed. Used by the request-logging middleware, the
// services, the storage layer and the PDF utils.
//
// Design goals:
//   - Always visible: a request/step is printed the moment it STARTS, so a hang
//     is obvious (you see where execution reached and then silence).
//   - Never swallow: logError() always prints the COMPLETE stack.
//   - Bounded: large payloads (edited_data, raw PDF text) are truncated so the
//     terminal stays readable.
// ---------------------------------------------------------------------------

const MAX_LEN = 1500;

/** Pretty-print any value as bounded JSON (safe against circular refs). */
export function fmt(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    return value.length > MAX_LEN ? value.slice(0, MAX_LEN) + " …[truncated]" : value;
  }
  let out: string;
  try {
    out = JSON.stringify(value, null, 2);
  } catch {
    out = String(value);
  }
  if (out && out.length > MAX_LEN) out = out.slice(0, MAX_LEN) + " …[truncated]";
  return out;
}

/** Current ISO timestamp. */
export function now(): string {
  return new Date().toISOString();
}

/** Log a single service/util step. `[scope] message` + optional payload. */
export function logStep(scope: string, message: string, extra?: unknown): void {
  const prefix = scope.startsWith("[") ? scope : `[${scope}]`;
  if (extra === undefined) {
    console.log(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}\n${fmt(extra)}`);
  }
}

/**
 * Log an error WITHOUT swallowing it: prints the full stack (or the value if it
 * is not an Error). The caller decides whether to rethrow.
 */
export function logError(scope: string, err: unknown): void {
  const prefix = scope.startsWith("[") ? scope : `[${scope}]`;
  console.error(`\n${prefix} ❌ ERROR @ ${now()}`);
  if (err instanceof Error) {
    console.error(err.stack || `${err.name}: ${err.message}`);
  } else {
    console.error(fmt(err));
  }
}

/**
 * Log the outcome of a Supabase query in a uniform shape:
 * operation name, error, rows affected, and (truncated) returned data.
 */
export function logSupabase(
  operation: string,
  result: { data?: unknown; error?: unknown; count?: number | null },
  intent?: string
): void {
  const { data, error } = result;
  const rows =
    typeof result.count === "number"
      ? result.count
      : Array.isArray(data)
      ? data.length
      : data
      ? 1
      : 0;

  console.log(`\n[DATABASE] ${operation}`);
  if (intent) console.log(`  Intent: ${intent}`);
  console.log(`  Rows affected: ${rows}`);
  
  if (error) {
    console.log(`  Error: ${fmt(error)}`);
    // Specifically log if it seems like an RLS block
    if (typeof error === 'object' && error !== null && 'code' in error && (error as any).code === '42501') {
      console.log(`  [RLS WARNING] Operation blocked by Row Level Security policy`);
    }
  } else {
    console.log(`  Error: none`);
  }
  
  console.log(`  Returned data: ${data === undefined ? "n/a" : fmt(data)}`);
}
