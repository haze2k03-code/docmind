import bcrypt from "bcryptjs";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { pool } from "../db.js";
import { clearAuthCookie, requireAuth, setAuthCookie, signToken } from "../middleware/auth.js";
import { HttpError, type AuthUser } from "../types.js";

export const authRouter = Router();

// Slows down password guessing: 10 attempts per IP every 15 minutes.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts, try again in a few minutes" },
});

const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

const USER_COLUMNS = "id, email, name, role, department";

// New accounts always start as employees in "general". Only an admin can grant access
// to other departments, so nobody can sign up straight into HR documents.
authRouter.post("/register", loginLimiter, async (req, res) => {
  const { name, email, password } = registerSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const { rows } = await pool.query<AuthUser>(
      `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING ${USER_COLUMNS}`,
      [name, email, passwordHash],
    );
    setAuthCookie(res, signToken(rows[0].id));
    res.status(201).json({ user: rows[0] });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new HttpError(409, "An account with this email already exists");
    throw err;
  }
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const { rows } = await pool.query<AuthUser & { password_hash: string }>(
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = $1`,
    [email],
  );

  // Same message whether the email or the password is wrong, so attackers
  // can't use this endpoint to discover which emails are registered.
  const row = rows[0];
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    throw new HttpError(401, "Invalid email or password");
  }

  const { password_hash: _omit, ...user } = row;
  setAuthCookie(res, signToken(user.id));
  res.json({ user });
});

authRouter.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
