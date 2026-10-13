import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { HttpError } from "../types.js";

// Express 5 forwards errors thrown in async handlers here automatically.
// One place decides what the client sees, so internal details never leak.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: err.issues[0]?.message ?? "Invalid input", issues: err.issues });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "File is too large (max 10 MB)" : err.message;
    res.status(400).json({ error: message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our side" });
}
