// ---------------------------------------------------------------------------
// Storage service
//
// Thin wrapper around Supabase Storage for uploading PDF files and obtaining a
// public URL. All bucket/path concerns live here so the rest of the codebase
// never touches the Storage API directly.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env";
import { ApiError } from "../middleware/errorHandler";
import { logStep, logSupabase } from "../utils/logger";

const SCOPE = "StorageService";

export interface StoredFile {
  path: string; // path inside the bucket
  url: string; // public URL
}

/**
 * Upload a PDF buffer to Supabase Storage.
 *
 * @param buffer  Raw PDF bytes.
 * @param folder  Logical sub-folder (e.g. "originals" or "generated").
 * @param name    File name (may include sub-paths), e.g. "<uuid>/v3.pdf".
 * @param cacheControl  Cache-Control max-age in seconds (string). Generated
 *        PDFs use "0" so a re-fetch of the same URL never serves a stale file.
 */
export async function uploadPdfToStorage(
  supabase: SupabaseClient,
  buffer: Buffer,
  folder: string,
  name: string,
  cacheControl = "3600"
): Promise<StoredFile> {
  const path = `${folder}/${name}`;
  logStep(SCOPE, `Starting uploadPdfToStorage() -> ${env.supabaseBucket}/${path} (${buffer.length} bytes)`);

  const { error } = await supabase.storage
    .from(env.supabaseBucket)
    .upload(path, buffer, {
      contentType: "application/pdf",
      upsert: true,
      cacheControl,
    });

  logSupabase(`STORAGE upload ${path}`, { data: error ? null : { path }, error });
  if (error) {
    throw new ApiError(502, `Failed to upload PDF to storage: ${error.message}`);
  }

  const { data } = supabase.storage.from(env.supabaseBucket).getPublicUrl(path);
  logStep(SCOPE, `uploadPdfToStorage() done — public URL: ${data.publicUrl}`);

  return { path, url: data.publicUrl };
}

/**
 * Upload an arbitrary document (any content type) to Supabase Storage.
 * Used by the Trade Folder for signed contracts, BOLs and extra documents.
 * Mirrors uploadPdfToStorage but accepts a caller-supplied content type.
 */
export async function uploadFileToStorage(
  supabase: SupabaseClient,
  buffer: Buffer,
  path: string,
  contentType: string,
  cacheControl = "3600"
): Promise<StoredFile> {
  logStep(SCOPE, `Starting uploadFileToStorage() -> ${env.supabaseBucket}/${path} (${buffer.length} bytes, ${contentType})`);

  const { error } = await supabase.storage
    .from(env.supabaseBucket)
    .upload(path, buffer, { contentType, upsert: true, cacheControl });

  logSupabase(`STORAGE upload ${path}`, { data: error ? null : { path }, error });
  if (error) {
    throw new ApiError(502, `Failed to upload file to storage: ${error.message}`);
  }

  const { data } = supabase.storage.from(env.supabaseBucket).getPublicUrl(path);
  logStep(SCOPE, `uploadFileToStorage() done — public URL: ${data.publicUrl}`);
  return { path, url: data.publicUrl };
}

/** Download a PDF previously stored in Supabase Storage as a Buffer. */
export async function downloadPdfFromStorage(supabase: SupabaseClient, path: string): Promise<Buffer> {
  logStep(SCOPE, `Starting downloadPdfFromStorage(${path})`);
  const { data, error } = await supabase.storage
    .from(env.supabaseBucket)
    .download(path);

  logSupabase(`STORAGE download ${path}`, { data: data ? "[Blob]" : null, error });
  if (error || !data) {
    throw new ApiError(502, `Failed to download PDF from storage: ${error?.message ?? "unknown"}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  logStep(SCOPE, `downloadPdfFromStorage() done (${arrayBuffer.byteLength} bytes)`);
  return Buffer.from(arrayBuffer);
}

/**
 * Best-effort removal of files from Storage. Used when deleting a trade so its
 * PDFs don't linger. Never throws — a failed cleanup must not block the row
 * delete; it is logged instead.
 */
export async function removeFromStorage(supabase: SupabaseClient, paths: string[]): Promise<void> {
  if (!paths.length) return;
  logStep(SCOPE, `Removing ${paths.length} object(s) from Storage: ${paths.join(", ")}`);
  const { data, error } = await supabase.storage.from(env.supabaseBucket).remove(paths);
  logSupabase(`STORAGE remove`, { data, error });
  if (error) {
    // Non-fatal: log and continue (the DB row delete is the important part).
    logStep(SCOPE, `Storage removal warning (continuing): ${error.message}`);
  }
}

/**
 * Derive the in-bucket storage path from a public URL produced by getPublicUrl.
 * Returns null if the URL does not look like one of ours.
 */
export function pathFromPublicUrl(url: string): string | null {
  const marker = `/object/public/${env.supabaseBucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}
