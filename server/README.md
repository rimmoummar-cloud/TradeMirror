# TradeMirror OS — Backend

Production-ready Node.js + TypeScript backend for the **TradeMirror OS** trade
management system. It manages the lifecycle of a **Trade** — a business
transaction originating from a PDF contract — and integrates with **Supabase**
for both Postgres storage and file (PDF) storage.

> **Phase 1 scope:** Trade lifecycle + Supabase integration only.
> No authentication or roles (intentionally out of scope).

---

## Stack

- Node.js + Express
- TypeScript
- Supabase (`@supabase/supabase-js`) — Postgres + Storage
- `pdf-parse` — extract text/fields from uploaded PDFs
- `pdf-lib` — generate / overlay PDFs
- `multer` — multipart file uploads
- `dotenv` — environment configuration

## Architecture (clean layered structure)

```
src/
├─ config/        # env validation + Supabase client
│  ├─ env.ts
│  └─ supabase.ts
├─ routes/        # Express route definitions
│  └─ trade.routes.ts
├─ controllers/   # request/response handling (thin)
│  └─ trade.controller.ts
├─ services/      # business logic (Trade lifecycle, Storage)
│  ├─ trade.service.ts
│  └─ storage.service.ts
├─ utils/         # PDF parsing + generation helpers
│  ├─ pdfParser.ts
│  └─ pdfGenerator.ts
├─ middleware/    # multer upload, error handling
│  ├─ upload.ts
│  └─ errorHandler.ts
├─ types/         # domain types
│  └─ trade.ts
└─ app.ts         # server entry point
```

## The Trade entity

| Column              | Type        | Notes                                  |
| ------------------- | ----------- | -------------------------------------- |
| `id`                | uuid        | primary key                            |
| `original_pdf_url`  | text        | uploaded source PDF (Supabase Storage) |
| `extracted_data`    | jsonb       | fields parsed from the PDF             |
| `edited_data`       | jsonb       | user-corrected fields                  |
| `generated_pdf_url` | text (opt.) | regenerated/overlaid PDF               |
| `status`            | text        | `draft` \| `active` \| `completed`     |
| `created_at`        | timestamptz | timestamp                              |
| `updated_at`        | timestamptz | timestamp                              |

---

## Setup

### 1. Install dependencies

```bash
cd server
npm install
```

### 2. Provision Supabase

1. Create a Supabase project.
2. In the **SQL editor**, run [`supabase/schema.sql`](./supabase/schema.sql) to
   create the `trades` table.
3. In **Storage**, create a **public** bucket named `trade-pdfs`
   (must match `SUPABASE_BUCKET`).

### 3. Configure environment

Create a `.env` file in the `server/` directory (locally) or set the same keys
as environment variables in your hosting platform (Render, Railway, a VPS, …).

| Variable                | Required | Description                                            |
| ----------------------- | -------- | ------------------------------------------------------ |
| `SUPABASE_URL`          | yes      | Project URL (`https://xxxx.supabase.co`)               |
| `SUPABASE_KEY`          | yes      | **Service-role** key (server-side, bypasses RLS)       |
| `SUPABASE_BUCKET`       | no       | Storage bucket name (default `trade-pdfs`)             |
| `SUPABASE_TRADES_TABLE` | no       | Table name (default `trades`)                          |
| `PORT`                  | no       | HTTP port (default `4000`; platforms usually inject this) |
| `APP_BASE_URL`          | prod     | Public frontend URL used to build invitation links     |
| `CORS_ORIGIN`           | prod     | Comma-separated allowed frontend origin(s); empty = any |
| `BREVO_API_KEY`         | no       | Brevo API key for invitation emails (empty = skip send) |
| `BREVO_FROM`            | no       | Verified Brevo sender, `Name <email>` or bare email     |
| `NODE_ENV`              | prod     | Set to `production` to hide stack traces in responses   |

### 4. Run

```bash
npm run dev      # hot-reload (ts-node-dev)
# or
npm run build && npm start
```

Health check: `GET http://localhost:4000/health`

---

## API

Base path: `/api/trades`

### `POST /api/trades/create`

Upload a PDF (multipart, field name **`pdf`**). Uploads it to Storage, extracts
data, and creates a `draft` trade.

```bash
curl -X POST http://localhost:4000/api/trades/create \
  -F "pdf=@./contract.pdf"
```

### `GET /api/trades`

List all trades (newest first).

### `GET /api/trades/:id`

Get a single trade.

### `PUT /api/trades/:id`

Update `edited_data` and/or `status`.

```bash
curl -X PUT http://localhost:4000/api/trades/<id> \
  -H "Content-Type: application/json" \
  -d '{ "edited_data": { "commodity": "Soybean", "quantity": 500 }, "status": "active" }'
```

### `POST /api/trades/:id/generate-pdf`

Regenerate a PDF from `edited_data`. If the original PDF is available it overlays
the edits on it; otherwise it builds a fresh summary PDF. Saves the result to
Storage and returns the updated trade (with `generated_pdf_url`).

---

## Notes

- The PDF field-extraction heuristics in [`src/utils/pdfParser.ts`](./src/utils/pdfParser.ts)
  are generic regex patterns — tune them to your real contract templates.
- The overlay logic in [`src/utils/pdfGenerator.ts`](./src/utils/pdfGenerator.ts)
  draws a summary block; map your template's field coordinates for pixel-perfect
  placement.
- `extracted_data` / `edited_data` are stored as free-form JSON so the contract
  shape can evolve without a server change (mirrors the frontend `ContractData`).
