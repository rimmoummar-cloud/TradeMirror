// ---------------------------------------------------------------------------
// Auth routes.
//   POST /api/auth/session              (auth) bootstrap session + active check
//   POST /api/auth/logout               (auth) record logout
//   GET  /api/auth/invitation/:token    (public) validate an invite token
//   POST /api/auth/accept-invite        (public) set password + activate
// ---------------------------------------------------------------------------

import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { requireAuth } from "../middleware/auth";
import * as controller from "../controllers/auth.controller";

const router = Router();

router.get("/me", requireAuth, asyncHandler(controller.me));
router.post("/session", requireAuth, asyncHandler(controller.bootstrapSession));
router.post("/logout", requireAuth, asyncHandler(controller.logout));
router.get("/invitation/:token", asyncHandler(controller.validateInvitation));
router.post("/accept-invite", asyncHandler(controller.acceptInvite));

export default router;
