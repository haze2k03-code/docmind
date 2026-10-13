import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { DEPARTMENTS } from "../config.js";
import { pool } from "../db.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { chunkPages } from "../services/chunker.js";
import { embedTexts } from "../services/gemini.js";
import { extractPages, looksLikePdf } from "../services/pdf.js";
import { HttpError } from "../types.js";

export const documentsRouter = Router();
documentsRouter.use(requireAuth);

// Keep uploads in memory: we only need the text, and the original file is never stored.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

const uploadSchema = z.object({
  title: z.string().trim().max(120).optional(),
  department: z.enum(["all", ...DEPARTMENTS]).default("all"),
});

// "northwind-employee-handbook.pdf" -> "Northwind Employee Handbook"
function titleFromFilename(filename: string): string {
  return filename
    .replace(/\.pdf$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim();
}

documentsRouter.get("/", async (req, res) => {
  const user = req.user!;
  const { rows } = await pool.query(
    `SELECT d.id, d.title, d.filename, d.department, d.page_count AS "pageCount",
            d.created_at AS "createdAt", COUNT(c.id)::int AS "chunkCount"
       FROM documents d
       LEFT JOIN chunks c ON c.document_id = d.id
      WHERE $1 = 'admin' OR d.department = 'all' OR d.department = $2
      GROUP BY d.id
      ORDER BY d.created_at DESC`,
    [user.role, user.department],
  );
  res.json({ documents: rows });
});

/**
 * Ingestion pipeline: PDF -> text per page -> chunks -> embeddings -> Postgres.
 * Everything is inserted in one transaction, so a failure never leaves a half-indexed document.
 */
documentsRouter.post("/", requireAdmin, upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, "Attach a PDF file in the 'file' field");
  if (!looksLikePdf(file.buffer)) throw new HttpError(400, "Only PDF files are supported");

  const { title, department } = uploadSchema.parse(req.body);

  const pages = await extractPages(file.buffer);
  const chunks = chunkPages(pages);
  if (chunks.length === 0) {
    throw new HttpError(422, "No text found in this PDF. Scanned PDFs need OCR first.");
  }

  // Embed before opening the transaction, so we don't hold a DB connection during slow API calls.
  const embeddings = await embedTexts(
    chunks.map((c) => c.content),
    "RETRIEVAL_DOCUMENT",
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO documents (title, filename, department, page_count, uploaded_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [title || titleFromFilename(file.originalname), file.originalname, department, pages.length, req.user!.id],
    );
    const documentId = rows[0].id;

    // One INSERT for all chunks: unnest() turns the parallel arrays into rows.
    await client.query(
      `INSERT INTO chunks (document_id, page_number, chunk_index, content, embedding)
       SELECT $1, t.page, t.idx, t.content, t.embedding::vector
         FROM unnest($2::int[], $3::int[], $4::text[], $5::text[]) AS t(page, idx, content, embedding)`,
      [
        documentId,
        chunks.map((c) => c.page),
        chunks.map((c) => c.index),
        chunks.map((c) => c.content),
        embeddings.map((e) => `[${e.join(",")}]`),
      ],
    );
    await client.query("COMMIT");

    res.status(201).json({ id: documentId, pages: pages.length, chunks: chunks.length });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

documentsRouter.delete("/:id", requireAdmin, async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  // ON DELETE CASCADE in the schema removes the document's chunks too.
  const { rowCount } = await pool.query("DELETE FROM documents WHERE id = $1", [id]);
  if (rowCount === 0) throw new HttpError(404, "Document not found");
  res.status(204).end();
});
