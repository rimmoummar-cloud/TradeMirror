// ---------------------------------------------------------------------------
// Client routes — all protected by requireAuth.
//
//   GET    /api/clients                 list (optional ?search=)
//   POST   /api/clients                 create
//   GET    /api/clients/:id             get one
//   PUT    /api/clients/:id             update
//   DELETE /api/clients/:id             delete (blocked if trades exist)
//   GET    /api/clients/:id/analytics         live trade statistics
//   GET    /api/clients/:id/trades            trades linked to this client
//   GET    /api/clients/:id/financial-summary aggregated financial figures
//   GET    /api/clients/:id/profit-analysis   overall + monthly profit
// ---------------------------------------------------------------------------

import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import * as controller from "../controllers/client.controller";

const router = Router();
const canRead = requireRole("super_admin", "admin", "employee");
const canManage = requireRole("super_admin", "admin");

router.get("/", requireAuth, canRead, asyncHandler(controller.listClients));
router.post("/", requireAuth, canManage, asyncHandler(controller.createClient));
router.get("/:id", requireAuth, canRead, asyncHandler(controller.getClient));
router.put("/:id", requireAuth, canManage, asyncHandler(controller.updateClient));
router.delete("/:id", requireAuth, canManage, asyncHandler(controller.deleteClient));
router.get("/:id/analytics", requireAuth, canRead, asyncHandler(controller.getClientAnalytics));
router.get("/:id/trades", requireAuth, canRead, asyncHandler(controller.listClientTrades));
router.get("/:id/financial-summary", requireAuth, canRead, asyncHandler(controller.getFinancialSummary));
router.get("/:id/profit-analysis", requireAuth, canRead, asyncHandler(controller.getProfitAnalysis));
router.get("/:id/dashboard", requireAuth, canRead, asyncHandler(controller.getDashboard));

export default router;
