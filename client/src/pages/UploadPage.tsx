import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useContractStore } from "../store/contractStore";
import { FileDropzone } from "../components/FileDropzone";
import { Spinner } from "../components/Spinner";
import { tradesApi } from "../lib/api";
import { showToast } from "../lib/toast";

export function UploadPage() {
  const navigate = useNavigate();
  const { status, error, parseFile, draft, sourceFile, createdTradeId, markCreated } =
    useContractStore();
  const [isCreating, setIsCreating] = useState(false);

  // CREATE-ONCE guard (within a single mount). Keyed by the File instance so the
  // trade is created exactly once even under React StrictMode, which invokes
  // effects twice in development. (A useState flag is insufficient: both runs
  // read the stale `false` before the state commit, so two POSTs could fire.)
  const createdForFile = useRef<File | null>(null);

  // Once client-side parsing finishes, upload the file to the backend which
  // creates the single Trade row, then navigate to the edit screen by its id.
  useEffect(() => {
    if (status !== "ready" || !draft || !sourceFile) return;

    // CROSS-REMOUNT guard: the store remembers if THIS file was already turned
    // into a trade. Without this, navigating away and re-opening Upload (sidebar)
    // remounts the page with a fresh ref while the store still holds the old
    // "ready" file — which previously re-fired createTrade and inserted a
    // DUPLICATE. If it's already created, do NOT create again (and don't bounce
    // the user — show the dropzone so they can start a new upload).
    if (createdTradeId) {
      console.log("[UploadPage] File already created as trade", createdTradeId, "— skip (no duplicate)");
      return;
    }

    // Same-mount (StrictMode) guard.
    if (createdForFile.current === sourceFile) return;
    createdForFile.current = sourceFile;

    let mounted = true;

    (async () => {
      // ---- [UPLOAD] create-trade triggered -------------------------------
      console.group("[UploadPage] ⬆️ Upload → create trade");
      console.log("[UploadPage] Request start — file:", sourceFile.name, `(${sourceFile.size} bytes)`);
      console.log("[UploadPage] Loading started (isCreating=true)");
      setIsCreating(true);
      try {
        const trade = await tradesApi.createTrade(sourceFile);
        console.log("[UploadPage] Response received — trade id:", trade.id);
        // Persist the create-once flag in the store BEFORE navigating so any
        // re-entry of Upload can never create a second row.
        markCreated(trade.id);
        if (mounted) {
          console.log("[UploadPage] Navigating to editor");
          navigate(`/app/editor/${trade.id}`); // navigation executed
        }
      } catch (err) {
        // Full error already logged by the axios interceptor + toast shown.
        console.error("[UploadPage] Create trade FAILED:", err);
        createdForFile.current = null; // allow a retry of the SAME file
        if (mounted) {
          // LOADING SAFETY: drop back to the dropzone so the user can retry.
          setIsCreating(false);
          showToast("Upload failed. Please try the file again.", "error");
        }
      } finally {
        console.log("[UploadPage] Request finished (finally)");
        console.groupEnd();
      }
    })();

    return () => {
      mounted = false;
    };
  }, [status, draft, sourceFile, createdTradeId, markCreated, navigate]);

  return (
    <div className="card">
      <h2>Upload contract</h2>
      <p style={{ color: "#6b7280" }}>
        Upload a supplier PDF contract. We extract the data so you can edit it.
      </p>

      {status === "parsing" || isCreating ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 24 }}>
          <Spinner />
          <span>{isCreating ? "Creating Trade..." : "Parsing PDF…"}</span>
        </div>
      ) : (
        <FileDropzone onFile={parseFile} />
      )}

      {status === "error" && (
        <p className="error" style={{ marginTop: 16 }}>
          {error}
        </p>
      )}
    </div>
  );
}
