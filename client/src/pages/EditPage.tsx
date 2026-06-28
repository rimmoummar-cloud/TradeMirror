import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useContractStore } from "../store/contractStore";
import { ContractForm } from "../features/contract/ContractForm";
import { buildContractData } from "../features/contract/contractSchema";
import { tradesApi } from "../lib/api";
import { showToast } from "../lib/toast";

export function EditPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const { draft, updateDraft, reset, createdTradeId } = useContractStore();
  const [isSaving, setIsSaving] = useState(false);
  const [ready, setReady] = useState(false);

  // We load the form data ONCE per trade id. The ref makes the load idempotent
  // so calling updateDraft() (which re-runs this effect) cannot loop or refetch.
  const loadedForId = useRef<string | null>(null);

  // ---------------------------------------------------------------------------
  // LOAD — initialise the editor for the trade in the URL.
  //
  // ROOT-CAUSE FIX: the old code did `if (draft) return`, reusing whatever draft
  // happened to be in the global Zustand store — even if it belonged to a
  // DIFFERENT trade. That made edits merge onto a stale base and persist wrong
  // data. We now scope loading to the URL `id`:
  //
  //   • CASE A — the draft was freshly produced by the uploader for THIS exact
  //     trade (createdTradeId === id): use it. (Right after upload the backend
  //     only has the flat parse; the rich ContractData lives only in the store.)
  //   • CASE B — otherwise the BACKEND is the source of truth: always fetch
  //     getTrade(id) and hydrate from its edited_data. Never trust a stale draft.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    console.log("[EditPage] route param id =", id);
    if (!id) {
      navigate("/app/upload");
      return;
    }
    if (loadedForId.current === id) return; // already loaded this trade

    // CASE A: fresh-upload draft for this exact trade.
    if (createdTradeId === id && draft) {
      loadedForId.current = id;
      console.log("[EditPage] LOAD — using freshly-uploaded draft for trade", id, draft);
      setReady(true);
      return;
    }

    // CASE B: backend is the source of truth — fetch fresh for the URL id.
    //
    // NOTE: NO `cancelled` flag. The `loadedForId` ref already guarantees a
    // single fetch, even under React StrictMode (Run 2 returns early). A
    // `cancelled` flag here would discard the result of the ONE run that
    // executed (StrictMode cancels it) and leave `ready` false forever — that
    // was the "stuck on Loading editor…" bug. React 18 makes setState after
    // unmount a safe no-op, so the setters below always run.
    loadedForId.current = id;
    setReady(false);

    (async () => {
      console.group("[EditPage] LOAD — fetching trade from backend");
      console.log("[EditPage] LOAD — API request start: getTrade(", id, ")");
      try {
        const trade = await tradesApi.getTrade(id);
        console.log("[EditPage] LOAD — API response (full trade):", trade);
        console.log("[EditPage] LOAD — edited_data:", trade.edited_data);
        console.log("[EditPage] LOAD — extracted_data:", trade.extracted_data);

        // Always build a COMPLETE ContractData (handles nested OR flat shapes)
        // so the form renders for ANY trade and never bounces / hangs.
        const contract = buildContractData(trade.edited_data, trade.extracted_data);
        console.log("[EditPage] LOAD — normalized ContractData for form:", contract);

        updateDraft(contract); // replace any stale draft with THIS trade's data
        setReady(true);
        console.log("[EditPage] LOAD — ready=true, form will render");
      } catch (err) {
        // Full error already logged by the axios interceptor; never silent.
        console.error("[EditPage] LOAD — fetch FAILED:", err);
        showToast("Failed to load trade for editing. Returning to list.", "error");
        loadedForId.current = null; // allow a retry on re-entry
        // Resolve the UI: don't strand the user on an endless spinner.
        navigate("/app/trades");
      } finally {
        console.log("[EditPage] LOAD — finally (loading resolved)");
        console.groupEnd();
      }
    })();
  }, [id, createdTradeId, draft, navigate, updateDraft]);

  // Until the correct trade's data is loaded, do NOT render the form — this
  // prevents a stale draft (from a previous trade) flashing in the inputs.
  if (!ready || !draft) {
    return (
      <div className="card">
        <p style={{ color: "#6b7280" }}>Loading editor…</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Edit contract</h2>
      <ContractForm
        // Remount when the contract identity changes so the form starts from
        // fresh defaultValues with zero residual react-hook-form state.
        key={draft.trade.id}
        contract={draft}
        onSubmit={async (updated) => {
          // ---- [UPDATE] button clicked --------------------------------------
          console.group("[EditPage] 💾 Save/Update clicked");
          console.log("Current trade ID:", id);
          console.log("Current edited data:", updated);

          updateDraft(updated);
          if (!id) {
            // No id means we lost the trade reference — never silently create a
            // new one. Send the user back to upload to start cleanly.
            console.warn("[EditPage] No trade id — redirecting to upload");
            console.groupEnd();
            navigate("/app/upload");
            return;
          }

          // EDIT = UPDATE ONLY: patch edited_data on the existing trade by id.
          console.log("[EditPage] Loading started (isSaving=true)");
          setIsSaving(true);
          try {
            // --- mandated update-flow logging ---
            console.log("[EditPage] UPDATE — calling updateTrade BEFORE navigation. id:", id);
            console.log("[EditPage] UPDATE — payload sent:", { edited_data: updated });
            const saved = await tradesApi.updateTrade(id, { edited_data: updated });
            console.log("[EditPage] UPDATE — backend response (full trade):", saved);
            console.log("[EditPage] UPDATE — DB stored edited_data:", saved.edited_data);
            // CRITICAL: drop the React Query cache for this trade (and the list)
            // so TradeDetailsPage refetches the freshly-saved row instead of the
            // 5-minute-stale cache (which made edits look "reverted").
            await queryClient.invalidateQueries({ queryKey: ["trade", id] });
            await queryClient.invalidateQueries({ queryKey: ["trades"] });
            console.log("[EditPage] React Query cache invalidated for trade", id);
            navigate(`/app/generate/${id}`); // navigation executed
          } catch (err) {
            // Error already logged in full by the axios interceptor; surface it.
            console.error("[EditPage] Update FAILED:", err);
            showToast("Failed to save changes. Please try again.", "error");
          } finally {
            // LOADING SAFETY: spinner can never get stuck on.
            console.log("[EditPage] Loading finished (isSaving=false)");
            setIsSaving(false);
            console.groupEnd();
          }
        }}
        onBack={() => {
          reset();
          navigate("/app/upload");
        }}
      />
      {isSaving && <p className="text-sm text-blue-600 mt-4">Saving trade...</p>}
    </div>
  );
}
