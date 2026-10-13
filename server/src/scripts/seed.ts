// Creates (or resets) the first admin account from ADMIN_EMAIL / ADMIN_PASSWORD in .env.
// Usage: npm run seed   (in Docker: docker compose exec server node dist/scripts/seed.js)
import bcrypt from "bcryptjs";
import { pool } from "../db.js";

const email = (process.env.ADMIN_EMAIL ?? "admin@docmind.local").toLowerCase();
const password = process.env.ADMIN_PASSWORD ?? "ChangeMe123!";

if (password.length < 8) {
  console.error("ADMIN_PASSWORD must be at least 8 characters");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 10);
await pool.query(
  `INSERT INTO users (name, email, password_hash, role, department)
   VALUES ('Admin', $1, $2, 'admin', 'general')
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'`,
  [email, hash],
);
console.log(`Admin ready: ${email}`);
await pool.end();
