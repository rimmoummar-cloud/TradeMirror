// ---------------------------------------------------------------------------
// Audit routes — all protected by requireAuth.
//   GET  /api/audit/logs                 paginated/filterable trail
//   GET  /api/audit/entity/:type/:id     recent activity for one entity
//   POST /api/audit/event                record an event (auth/login/logout)
// ---------------------------------------------------------------------------

import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requireAuth, requireActive, requireRole } from "../middleware/auth";
import * as controller from "../controllers/audit.controller";

const router = Router();

// Global audit trail: Super Admin only (per the permission matrix).
router.get("/logs", requireAuth, requireRole("super_admin"), asyncHandler(controller.listLogs));
// Per-entity activity timeline (e.g. a trade's): any active user who can view it.
router.get("/entity/:type/:id", requireAuth, requireActive, asyncHandler(controller.listEntityLogs));
router.post("/event", requireAuth, requireActive, asyncHandler(controller.recordEvent));

export default router;
