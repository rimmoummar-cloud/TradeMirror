import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { tradesApi, type Trade } from "../lib/api";
import { showToast } from "../lib/toast";
import { PdfPreview } from "../components/PdfPreview";
import { Button } from "../components/Button";
import { Spinner } from "../components/Spinner";

export function PreviewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [trade, setTrade] = useState<Trade | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Generate exactly once per mount for this id (StrictMode-safe).
  const generatedForId = useRef<string | null>(null);

  // FINAL step: ask the backend to generate the PDF for the EXISTING trade.
  // The backend reads edited_data, builds + uploads the PDF, sets
  // generated_pdf_url and status="completed", and returns the updated Trade.
  useEffect(() => {
    if (!id) {
      navigate("/app/upload");
      return;
    }
    if (generatedForId.current === id) return;
    generatedForId.current = id;

    // NOTE: we deliberately do NOT use a `cancelled` flag here. The
    // `generatedForId` ref-guard above already guarantees this work runs exactly
    // once per mount. Under React StrictMode the run that actually executes is
    // the one whose cleanup fires first — gating the state updates on a
    // `cancelled` flag would discard that run's results and leave `loading`
    // stuck at true forever. React 18 makes setState-after-unmount a safe no-op,
    // so the setters below are always allowed to run.
    (async () => {
      // ---- [GENERATE] triggered ------------------------------------------
      console.group("[PreviewPage] 🧾 Generate PDF triggered");
      console.log("Current trade ID:", id);
      console.log("[PreviewPage] Loading started (loading=true)");
      setLoading(true);
      setError(null);
      try {
        const updated = await tradesApi.generatePdf(id);
        console.log("[PreviewPage] Generate succeeded — full trade from DB:", updated);
        console.log("[PreviewPage] generated_pdf_url:", updated.generated_pdf_url, "status:", updated.status);
        setTrade(updated);
        // Generate changed status→completed + generated_pdf_url. Invalidate the
        // caches so Trade Details AND the trades list reflect the new state and
        // never show stale data anywhere.
        queryClient.setQueryData(["trade", id], updated);
        await queryClient.invalidateQueries({ queryKey: ["trade", id] });
        await queryClient.invalidateQueries({ queryKey: ["trades"] });
        // History grew by one version — refresh the "Last Generations" list.
        await queryClient.invalidateQueries({ queryKey: ["trade-generations", id] });
        console.log("[PreviewPage] React Query caches invalidated after generate");
      } catch (err) {
        // Full error already logged by the axios interceptor + toast shown.
        console.error("[PreviewPage] Generate FAILED:", err);
        generatedForId.current = null; // allow a retry
        const msg = err instanceof Error ? err.message : "Failed to generate PDF";
        setError(msg);
        showToast("PDF generation failed. See console for details.", "error");
      } finally {
        // LOADING SAFETY: the spinner ALWAYS stops, regardless of mount churn.
        console.log("[PreviewPage] Loading finished (loading=false)");
        setLoading(false);
        console.groupEnd();
      }
    })();
  }, [id, navigate]);

  return (
    <div className="card">
      <h2>Generated PDF</h2>

      {/* Error state — visible message + escape hatches (never a dead end). */}
      {error && !loading && (
        <div style={{ marginTop: 16 }}>
          <p className="error">⚠️ {error}</p>
          <div className="row">
            <Button variant="secondary" onClick={() => navigate(`/app/editor/${id}`)}>
              ← Back to edit
            </Button>
            <Button onClick={() => navigate(0)}>Retry</Button>
          </div>
        </div>
      )}

      {/* Loading state — driven by the explicit `loading` flag (cannot hang). */}
      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 24 }}>
          <Spinner />
          <span>Generating PDF…</span>
        </div>
      )}

      {/* Success state. */}
      {!loading && trade?.generated_pdf_url && (
        <>
          <p className="text-sm text-green-600" style={{ marginBottom: 12 }}>
            Status: <strong>{trade.status}</strong>
          </p>
          <PdfPreview url={trade.generated_pdf_url} />
          <div className="row">
            <Button variant="secondary" onClick={() => navigate(`/app/editor/${id}`)}>
              ← Back to edit
            </Button>
            <Button onClick={() => window.open(trade.generated_pdf_url!, "_blank")}>
              Download PDF
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
