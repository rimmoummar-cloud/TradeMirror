/**
 * pdf.js worker setup. Not used by the MVP mock parser, but kept here so the
 * real `pdfParser.ts` (using pdfjs-dist) can import and configure the worker
 * in one place.
 *
 * Example usage when wiring real parsing:
 *
 *   import * as pdfjsLib from "pdfjs-dist";
 *   import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
 *   pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
 */
export {};
