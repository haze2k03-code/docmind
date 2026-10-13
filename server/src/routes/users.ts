import { Router } from "express";
import { z } from "zod";
import { DEPARTMENTS } from "../config.js";
import { pool } from "../db.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { HttpError, type AuthUser } from "../types.js";

export const usersRouter = Router();
usersRouter.use(requireAuth, requireAdmin);

usersRouter.get("/", async (_req, res) => {
  const { rows } = await pool.query<AuthUser>(
    `SELECT id, email, name, role, department FROM users ORDER BY created_at`,
  );
  res.json({ users: rows });
});

const updateSchema = z
  .object({
    role: z.enum(["admin", "employee"]).optional(),
    department: z.enum(DEPARTMENTS).optional(),
  })
  .refine((v) => v.role !== undefined || v.department !== undefined, "Nothing to update");

usersRouter.patch("/:id", async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const { role, department } = updateSchema.parse(req.body);

  if (id === req.user!.id && role === "employee") {
    throw new HttpError(400, "You can't remove your own admin role");
  }

  // COALESCE keeps the current value when a field isn't being changed.
  const { rows } = await pool.query<AuthUser>(
    `UPDATE users SET role = COALESCE($2, role), department = COALESCE($3, department)
      WHERE id = $1 RETURNING id, email, name, role, department`,
    [id, role ?? null, department ?? null],
  );
  if (rows.length === 0) throw new HttpError(404, "User not found");
  res.json({ user: rows[0] });
});
