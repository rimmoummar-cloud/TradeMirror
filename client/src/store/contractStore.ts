import { create } from "zustand";
import type { ContractState } from "../types/contract";
import { parsePdf } from "../core/pdfParser";

export const useContractStore = create<ContractState>((set) => ({
  sourceFile: null,
  sourceBytes: null,
  original: null,
  draft: null,
  status: "idle",
  error: undefined,
  createdTradeId: null,

  parseFile: async (file) => {
    // Start every parse from a clean slate: wipe any previously parsed contract
    // so stale data can never merge with — or mask — the new result, even while
    // the async parse is in flight. A NEW file means "not yet created", so the
    // create-once guard (createdTradeId) is cleared here.
    set({
      status: "parsing",
      sourceFile: file,
      sourceBytes: null,
      original: null,
      draft: null,
      error: undefined,
      createdTradeId: null,
    });

    try {
      const [data, bytes] = await Promise.all([
        parsePdf(file),
        file.arrayBuffer(),
      ]);

      set({
        original: data,
        // deep copy so editing draft never mutates the immutable original
        draft: structuredClone(data),
        sourceBytes: bytes,
        status: "ready",
      });
    } catch (e) {
      // Never silent: log the full error before resetting state.
      console.error("[contractStore] parseFile failed:", e);
      // On failure, leave NO stale contract behind.
      set({
        status: "error",
        original: null,
        draft: null,
        sourceBytes: null,
        error: e instanceof Error ? e.message : "Failed to parse PDF",
      });
    }
  },

  updateDraft: (draft) => set({ draft }),

  // Record that the CURRENT sourceFile has already been turned into a trade.
  // The Upload effect checks this so re-entering the page never re-creates it.
  markCreated: (tradeId) => set({ createdTradeId: tradeId }),

  reset: () =>
    set({
      sourceFile: null,
      sourceBytes: null, // ❌ كان خطأ (ما في bytes هون)
      original: null,
      draft: null,
      status: "idle",
      error: undefined,
      createdTradeId: null,
    }),
}));