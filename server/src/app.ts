import cookieParser from "cookie-parser";
import express from "express";
import helmet from "helmet";
import { pool } from "./db.js";
import { errorHandler } from "./middleware/error.js";
import { authRouter } from "./routes/auth.js";
import { chatRouter } from "./routes/chat.js";
import { documentsRouter } from "./routes/documents.js";
import { usersRouter } from "./routes/users.js";

export function createApp(): express.Express {
  const app = express();

  // The Next.js frontend proxies /api to us, so trust one proxy hop for the client IP.
  app.set("trust proxy", 1);

  app.use(helmet()); // sensible security headers (no sniffing, no framing, etc.)
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.get("/api/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/documents", documentsRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/chat", chatRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use(errorHandler);

  return app;
}
