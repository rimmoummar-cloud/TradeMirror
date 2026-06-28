// ---------------------------------------------------------------------------
// Bank Profile routes — Banking Profiles module (super_admin / admin only).
//
//   GET    /api/bank-profiles        list
//   GET    /api/bank-profiles/:id    get one
//   POST   /api/bank-profiles        create
//   PUT    /api/bank-profiles/:id    update
//   DELETE /api/bank-profiles/:id    delete
//
// All other roles receive 403 (enforced by requireRole).
// ---------------------------------------------------------------------------

import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import * as controller from "../controllers/bankProfile.controller";

const router = Router();
const canManage = requireRole("super_admin", "admin");

router.get("/", requireAuth, canManage, asyncHandler(controller.listBankProfiles));
router.get("/:id", requireAuth, canManage, asyncHandler(controller.getBankProfile));
router.get("/:id/trades", requireAuth, canManage, asyncHandler(controller.listBankProfileTrades));
router.post("/", requireAuth, canManage, asyncHandler(controller.createBankProfile));
router.put("/:id", requireAuth, canManage, asyncHandler(controller.updateBankProfile));
router.delete("/:id", requireAuth, canManage, asyncHandler(controller.deleteBankProfile));

export default router;
