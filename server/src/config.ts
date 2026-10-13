import { z } from "zod";

// Load the shared .env from the repo root when running locally.
// In Docker the variables come from docker-compose instead, so a missing file is fine.
for (const path of ["../.env", ".env"]) {
  try {
    process.loadEnvFile(path);
    break;
  } catch {
    /* file not found: try the next one */
  }
}

// Validate every setting once at startup so the app fails fast with a clear message
// instead of crashing later in the middle of a request.
const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  GEMINI_CHAT_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_EMBED_MODEL: z.string().default("gemini-embedding-001"),
  // Chunks less similar than this to the question are ignored (0 = unrelated, 1 = identical).
  MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.55),
  TOP_K: z.coerce.number().int().min(1).max(20).default(5),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;

export const DEPARTMENTS = ["general", "hr", "engineering", "finance", "sales"] as const;
export type Department = (typeof DEPARTMENTS)[number];
