// ---------------------------------------------------------------------------
// PDF text extraction (Node)
//
// The legacy overlay engine needs each text fragment's SPATIAL position
// (x, y, width, size) so it can locate and mask the exact box of every field.
// In the browser the legacy code used `pdfjs-dist` with a Vite-bundled worker
// (`?url` import). In Node we load the *legacy* build and let pdfjs fall back to
// its in-process ("fake") worker — no separate worker file required.
//
// pdfjs-dist v4 is ESM-only. This backend compiles to CommonJS, where TypeScript
// would rewrite a normal `import()` into `require()` and fail to load ESM. The
// `Function("s","return import(s)")` indirection performs a genuine runtime ESM
// dynamic import that survives the CommonJS transpile. (Node 22 here, so the
// v4 requirement `Promise.withResolvers` is available.)
// ---------------------------------------------------------------------------

/** A single positioned text fragment from a PDF page. */
export interface PdfTextItem {
  str: string;
  transform: number[]; // [a, b, c, d, e=x, f=y]
  width?: number;
  height?: number;
  /** Whether this fragment's font is bold/black — detected from the embedded
   * font so generated overlays can match the ORIGINAL weight instead of a
   * hardcoded guess. Undefined when weight could not be resolved. */
  bold?: boolean;
}

// Real runtime ESM import, hidden from the TS->CJS transform.
const esmImport = new Function("s", "return import(s)") as (s: string) => Promise<any>;

let pdfjsPromise: Promise<any> | null = null;
function getPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = esmImport("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsPromise;
}

/**
 * Extract the positioned text items of page 1 of a PDF.
 * @param data raw PDF bytes (a COPY is passed to pdfjs, which takes ownership).
 */
export async function extractTextItems(data: Uint8Array): Promise<PdfTextItem[]> {
  const pdfjs = await getPdfjs();

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data), // give pdfjs its own buffer
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  });

  const doc = await loadingTask.promise;
  try {
    const page = await doc.getPage(1);

    // Resolve embedded fonts into commonObjs so per-fragment weight is readable.
    // This is best-effort: if it fails, weight detection simply returns
    // undefined and the overlay falls back to its hardcoded weights.
    try {
      await page.getOperatorList();
    } catch {
      /* non-fatal — weight detection degrades gracefully */
    }

    const content = await page.getTextContent();

    // Cache bold-ness per converted font name (e.g. "g_d0_f3"); a font is bold
    // when pdfjs flags it (.bold/.black) or its name says so (Helvetica-Bold).
    const boldCache = new Map<string, boolean | undefined>();
    const resolveBold = (fontName: string): boolean | undefined => {
      if (!fontName) return undefined;
      if (boldCache.has(fontName)) return boldCache.get(fontName);
      let bold: boolean | undefined;
      try {
        const f: any = (page as any).commonObjs.get(fontName);
        if (f) bold = !!(f.bold || f.black) || /bold|black|semibold|heavy/i.test(String(f.name ?? ""));
      } catch {
        bold = undefined; // font not resolved — leave it to the overlay fallback
      }
      boldCache.set(fontName, bold);
      return bold;
    };

    return (content.items as any[])
      .filter((i) => "str" in i)
      .map((i) => ({ ...i, bold: resolveBold(i.fontName) })) as PdfTextItem[];
  } finally {
    await doc.cleanup();
    await doc.destroy();
  }
}
