import type { NextFunction, Request, Response } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { config } from "../config.js";
import { pool } from "../db.js";
import { HttpError, type AuthUser } from "../types.js";

export const COOKIE_NAME = "docmind_token";
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export function signToken(userId: number): string {
  return jwt.sign({ sub: String(userId) }, config.JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
}

// httpOnly: JavaScript in the browser cannot read the token, so an XSS bug can't steal it.
// sameSite=strict: the browser won't send it on requests started by other sites (CSRF protection).
export function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.COOKIE_SECURE,
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: "/",
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

// Verifies the JWT, then loads the user fresh from the database. Reading the role and
// department from the DB (not from the token) means an admin's change takes effect
// immediately, and a deleted user is locked out even if their token hasn't expired.
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token: unknown = req.cookies?.[COOKIE_NAME];
  if (typeof token !== "string") throw new HttpError(401, "Not logged in");

  let userId: number;
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
    userId = Number(payload.sub);
  } catch {
    throw new HttpError(401, "Session expired, please log in again");
  }

  const { rows } = await pool.query<AuthUser>(
    "SELECT id, email, name, role, department FROM users WHERE id = $1",
    [userId],
  );
  if (rows.length === 0) throw new HttpError(401, "Account no longer exists");

  req.user = rows[0];
  next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin") throw new HttpError(403, "Admins only");
  next();
}
