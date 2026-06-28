// ---------------------------------------------------------------------------
// Error handling utilities
//
//  - ApiError       : an error carrying an HTTP status code.
//  - asyncHandler   : wraps async route handlers so thrown errors/rejections
//                     are forwarded to Express's error middleware instead of
//                     crashing the process.
//  - errorHandler   : the central Express error middleware.
//  - notFoundHandler: 404 fallback for unmatched routes.
// ---------------------------------------------------------------------------

import { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";
import { logError } from "../utils/logger";
import { env } from "../config/env";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

/** Wrap an async handler so rejections reach Express's error pipeline. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** 404 handler for routes that do not match. */
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

/** Central error middleware — must have 4 args for Express to recognise it. */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // ALWAYS print the complete stack — errors are never swallowed here.
  logError(`[ERROR] errorHandler ${req.method} ${req.originalUrl}`, err);

  // The full stack is always written to the server log above. We only expose it
  // in the HTTP response outside production to avoid leaking internals to
  // clients; the response shape (success/data/debug) is unchanged.
  const debug = {
    step: "errorHandler",
    error: err instanceof Error ? err.message : String(err),
    trace: env.isProduction ? undefined : err instanceof Error ? err.stack : undefined,
    warnings: []
  };

  if (err instanceof ApiError) {
    return res.status(err.status).json({ success: false, data: null, debug });
  }
  if (err instanceof MulterError) {
    debug.error = `Upload error: ${err.message}`;
    return res.status(400).json({ success: false, data: null, debug });
  }
  return res.status(500).json({ success: false, data: null, debug });
}
