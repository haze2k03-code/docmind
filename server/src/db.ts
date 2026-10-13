import pg from "pg";
import { config } from "./config.js";

// One shared connection pool for the whole app. Each query borrows a connection
// and returns it, instead of opening a new TCP connection per request.
export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });

// pgvector accepts vectors written as '[0.1,0.2,...]'.
export function toSqlVector(values: number[]): string {
  return `[${values.join(",")}]`;
}
