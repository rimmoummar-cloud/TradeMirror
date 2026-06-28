// ---------------------------------------------------------------------------
// Trade routes
//
//   POST /api/trades/create           multipart upload -> create trade
//   GET  /api/trades                  list all trades
//   GET  /api/trades/:id              get one trade
//   PUT  /api/trades/:id              update edited_data / status
//   POST /api/trades/:id/generate-pdf regenerate PDF from edited_data (versioned)
//   GET  /api/trades/:id/generations  list the trade's PDF generation history
//   DELETE /api/trades/:id            delete a trade (+ its stored PDFs)
//   GET    /api/trades/:id/documents          list Trade Folder documents
//   POST   /api/trades/:id/documents          upload a document (multipart 'file')
//   DELETE /api/trades/:id/documents/:docId   delete a document
// ---------------------------------------------------------------------------

import { Router } from "express";
import { uploadPdf, uploadDocument } from "../middleware/upload";
import { asyncHandler } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import * as controller from "../controllers/trade.controller";
import * as docController from "../controllers/document.controller";

const router = Router();

// Role groups per the permission matrix.
const canRead = requireRole("super_admin", "admin", "employee", "partner"); // all active users
const canManageTrade = requireRole("super_admin", "admin");                 // create/edit/generate/delete
const canUpload = requireRole("super_admin", "admin", "employee");          // upload documents
const canDeleteDoc = requireRole("super_admin", "admin");

router.post("/create", requireAuth, canManageTrade, uploadPdf.single("pdf"), asyncHandler(controller.createTrade));
router.get("/", requireAuth, canRead, asyncHandler(controller.listTrades));
router.get("/:id", requireAuth, canRead, asyncHandler(controller.getTrade));
router.put("/:id", requireAuth, canManageTrade, asyncHandler(controller.updateTrade));
router.post("/:id/generate-pdf", requireAuth, canManageTrade, asyncHandler(controller.generatePdf));
router.get("/:id/generations", requireAuth, canRead, asyncHandler(controller.listGenerations));
router.delete("/:id", requireAuth, canManageTrade, asyncHandler(controller.deleteTrade));

// ---- Trade Folder documents (signed contracts, BOLs, additional docs) ------
router.get("/:id/documents", requireAuth, canRead, asyncHandler(docController.listDocuments));
router.post(
  "/:id/documents",
  requireAuth,
  canUpload,
  uploadDocument.single("file"),
  asyncHandler(docController.uploadDocument)
);
router.delete("/:id/documents/:docId", requireAuth, canDeleteDoc, asyncHandler(docController.deleteDocument));

export default router;
