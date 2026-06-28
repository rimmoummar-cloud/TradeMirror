# TradeMirror

Upload a PDF contract → extract data → edit it in a form → generate a new PDF.
Frontend-only MVP (React + Vite + TypeScript). No backend, no database.

## Stack

- React 18 + TypeScript + Vite
- Zustand (state)
- React Hook Form (form)
- pdf-lib (PDF generation)
- pdfjs-dist (PDF extraction — wired for the real parser)

> **Note:** PDF extraction is **mocked** in `src/core/pdfParser.ts` for the MVP so
> the full pipeline runs end-to-end. Swapping in real `pdfjs-dist` extraction is a
> single-function change with no callers affected.

## Getting started

```bash
npm install
npm run dev
```

Open the URL Vite prints (default http://localhost:5173).

## Flow

1. **Upload** — drop a PDF → `parsePdf()` returns mock `ContractData` → stored.
2. **Edit** — React Hook Form pre-filled with the data; edit and submit.
3. **Preview** — `generatePdf()` builds a new PDF with `pdf-lib`; preview + download.

## Structure

```
src/
  pages/        Upload / Edit / Preview screens (thin)
  components/   Reusable dumb UI
  features/     Contract form + its value mapping
  core/         Pure business logic: pdfParser, pdfGenerator (no React)
  store/        Zustand store (original + draft + status)
  types/        ContractData, Client, Trade
  utils/        download helper, pdf.js worker setup
```
