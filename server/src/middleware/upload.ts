// ---------------------------------------------------------------------------
// File upload middleware (multer)
//
// We keep uploads in memory (multer.memoryStorage) because the file is streamed
// straight on to Supabase Storage and parsed in-process — there is no need to
// touch the local disk. Limited to PDFs up to 20 MB.
// ---------------------------------------------------------------------------

import multer from "multer";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

export const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed."));
    }
  },
});

// ---------------------------------------------------------------------------
// Generic document uploader (Trade Folder).
//
// Signed contracts and BOLs are typically PDFs, but "Additional Documents"
// may be images or office files. We allow a pragmatic whitelist and lean on
// the same 20 MB memory-storage strategy as `uploadPdf`.
// ---------------------------------------------------------------------------
const ALLOWED_DOC_MIME = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_DOC_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: PDF, images, Word, Excel.`));
    }
  },
});
