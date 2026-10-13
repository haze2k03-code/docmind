import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { embedQuery, streamAnswer } from "../services/gemini.js";
import {
  NOT_FOUND_ANSWER,
  SYSTEM_PROMPT,
  buildUserPrompt,
  detectInjection,
  isGrounded,
} from "../services/guard.js";
import { retrieveChunks } from "../services/retriever.js";
import { HttpError } from "../types.js";

export const chatRouter = Router();
chatRouter.use(requireAuth);

// Each question costs an API call, so cap it per user: 20 questions per minute.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (req) => `user:${req.user!.id}`,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "You're asking too fast. Wait a minute and try again." },
});

const chatSchema = z.object({
  question: z.string().trim().min(1, "Ask a question").max(1000, "Keep questions under 1000 characters"),
});

// Server-Sent Events: a long-lived HTTP response where we push "event: name / data: json" blocks.
function sendEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function logChat(entry: {
  userId: number;
  question: string;
  answer: string | null;
  chunkIds: number[];
  grounded: boolean | null;
  flagged: boolean;
}): Promise<void> {
  await pool
    .query(
      `INSERT INTO chat_logs (user_id, question, answer, chunk_ids, grounded, flagged)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entry.userId, entry.question, entry.answer, entry.chunkIds, entry.grounded, entry.flagged],
    )
    .catch((err) => console.error("Failed to write chat log", err));
}

/**
 * The RAG flow:
 *   1. embed the question
 *   2. retrieve the most similar chunks the user may access
 *   3. drop weak matches; if nothing is left, say so without calling the LLM
 *   4. send question + chunks to the LLM and stream its answer back
 *   5. check the answer cites its sources, and log everything for auditing
 */
chatRouter.post("/", chatLimiter, async (req, res) => {
  const user = req.user!;
  const { question } = chatSchema.parse(req.body);

  if (detectInjection(question)) {
    await logChat({ userId: user.id, question, answer: null, chunkIds: [], grounded: null, flagged: true });
    throw new HttpError(400, "This question looks like an attempt to override DocMind's instructions, so it was blocked.");
  }

  const queryEmbedding = await embedQuery(question);
  const chunks = (await retrieveChunks(queryEmbedding, user)).filter((c) => c.similarity >= config.MIN_SIMILARITY);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let clientGone = false;
  res.on("close", () => {
    if (!res.writableEnded) clientGone = true;
  });

  sendEvent(
    res,
    "sources",
    chunks.map((c, i) => ({
      n: i + 1,
      documentId: c.documentId,
      title: c.title,
      page: c.page,
      similarity: Math.round(c.similarity * 100) / 100,
      preview: c.content.slice(0, 220),
    })),
  );

  if (chunks.length === 0) {
    sendEvent(res, "token", { text: NOT_FOUND_ANSWER });
    sendEvent(res, "done", { grounded: true });
    res.end();
    await logChat({ userId: user.id, question, answer: NOT_FOUND_ANSWER, chunkIds: [], grounded: true, flagged: false });
    return;
  }

  let answer = "";
  try {
    for await (const text of streamAnswer(SYSTEM_PROMPT, buildUserPrompt(question, chunks))) {
      if (clientGone) break;
      answer += text;
      sendEvent(res, "token", { text });
    }
  } catch (err) {
    console.error("LLM stream failed", err);
    if (!clientGone) sendEvent(res, "error", { error: "The AI service failed to answer. Please try again." });
    res.end();
    return;
  }

  const grounded = isGrounded(answer, chunks.length);
  if (!clientGone) {
    sendEvent(res, "done", { grounded });
    res.end();
  }
  await logChat({
    userId: user.id,
    question,
    answer,
    chunkIds: chunks.map((c) => c.id),
    grounded,
    flagged: !grounded,
  });
});
