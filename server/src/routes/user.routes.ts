// ---------------------------------------------------------------------------
// User management routes — SUPER ADMIN ONLY (backend-enforced).
//   GET    /api/users            list (?search= &role=)
//   POST   /api/users            invite
//   PUT    /api/users/:id        update name/role
//   PATCH  /api/users/:id/active activate / deactivate
//   DELETE /api/users/:id        delete
// ---------------------------------------------------------------------------

import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requireAuth, requireRole } from "../middleware/auth";
import * as controller from "../controllers/user.controller";

const router = Router();
const superAdmin = requireRole("super_admin");

router.get("/", requireAuth, superAdmin, asyncHandler(controller.listUsers));
router.post("/", requireAuth, superAdmin, asyncHandler(controller.inviteUser));
router.put("/:id", requireAuth, superAdmin, asyncHandler(controller.updateUser));
router.patch("/:id/active", requireAuth, superAdmin, asyncHandler(controller.setActive));
router.delete("/:id", requireAuth, superAdmin, asyncHandler(controller.deleteUser));

export default router;
