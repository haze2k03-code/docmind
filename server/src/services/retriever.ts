import { config } from "../config.js";
import { pool, toSqlVector } from "../db.js";
import type { AuthUser } from "../types.js";

export interface RetrievedChunk {
  id: number;
  documentId: number;
  title: string;
  page: number;
  content: string;
  similarity: number;
}

/**
 * Finds the chunks closest in meaning to the question, among documents this user may see.
 *
 * `<=>` is pgvector's cosine-distance operator (0 = same direction, 2 = opposite),
 * so `1 - distance` gives a similarity score.
 *
 * Access control lives in this WHERE clause, inside the database. The LLM never sees a chunk
 * the user isn't allowed to read, so no prompt trick can make it leak one.
 */
export async function retrieveChunks(
  queryEmbedding: number[],
  user: Pick<AuthUser, "role" | "department">,
  k = config.TOP_K,
): Promise<RetrievedChunk[]> {
  const { rows } = await pool.query<{
    id: number;
    document_id: number;
    title: string;
    page_number: number;
    content: string;
    similarity: number;
  }>(
    `SELECT c.id, c.document_id, d.title, c.page_number, c.content,
            1 - (c.embedding <=> $1::vector) AS similarity
       FROM chunks c
       JOIN documents d ON d.id = c.document_id
      WHERE $2 = 'admin' OR d.department = 'all' OR d.department = $3
      ORDER BY c.embedding <=> $1::vector
      LIMIT $4`,
    [toSqlVector(queryEmbedding), user.role, user.department, k],
  );

  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    title: r.title,
    page: r.page_number,
    content: r.content,
    similarity: Number(r.similarity),
  }));
}
