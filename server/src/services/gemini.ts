import { config } from "../config.js";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MAX_BATCH = 100; // Gemini's limit for one batchEmbedContents call

/** Must match the vector(768) column in db/init.sql. */
export const EMBEDDING_DIM = 768;

// RETRIEVAL_DOCUMENT vs RETRIEVAL_QUERY tells the model which side of the search
// the text is on, which measurably improves retrieval quality.
type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

async function post(path: string, body: unknown): Promise<Response> {
  const res = await fetch(`${BASE_URL}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": config.GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res;
}

// When we ask for fewer dimensions than the model's full size, Google recommends
// normalising the vector to length 1 so cosine similarity stays accurate.
function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

export async function embedTexts(texts: string[], taskType: TaskType): Promise<number[][]> {
  const model = `models/${config.GEMINI_EMBED_MODEL}`;
  const vectors: number[][] = [];

  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const res = await post(`${model}:batchEmbedContents`, {
      requests: batch.map((text) => ({
        model,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: EMBEDDING_DIM,
      })),
    });
    const data = (await res.json()) as { embeddings: { values: number[] }[] };
    vectors.push(...data.embeddings.map((e) => normalize(e.values)));
  }

  return vectors;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text], "RETRIEVAL_QUERY");
  return vector;
}

interface StreamChunk {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
}

/**
 * Streams the model's answer token by token.
 * `alt=sse` makes Gemini send Server-Sent Events: lines starting with "data: {json}".
 */
export async function* streamAnswer(systemPrompt: string, userPrompt: string): AsyncGenerator<string> {
  const res = await post(`models/${config.GEMINI_CHAT_MODEL}:streamGenerateContent?alt=sse`, {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    // Low temperature = less creative, more faithful to the sources.
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
  });
  if (!res.body) throw new Error("Gemini returned an empty stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;

      const payload = line.slice(5).trim();
      if (!payload) continue;

      const chunk = JSON.parse(payload) as StreamChunk;
      const text = (chunk.candidates?.[0]?.content?.parts ?? [])
        .filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("");
      if (text) yield text;
    }
  }
}
