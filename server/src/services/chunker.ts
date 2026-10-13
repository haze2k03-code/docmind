export interface PageText {
  page: number;
  text: string;
}

export interface Chunk {
  page: number;
  index: number;
  content: string;
}

const MIN_CHUNK_CHARS = 20;

/**
 * Splits each page into overlapping chunks of roughly `size` characters.
 *
 * - Chunks never cross a page boundary, so every chunk keeps an exact page number for citations.
 * - We try to end a chunk at a sentence boundary so we don't cut a sentence in half.
 * - Consecutive chunks overlap by `overlap` characters, so a fact that sits on a boundary
 *   still appears whole in at least one chunk.
 */
export function chunkPages(pages: PageText[], size = 1000, overlap = 200): Chunk[] {
  if (size <= 0) throw new Error("size must be positive");
  if (overlap < 0 || overlap >= size / 2) throw new Error("overlap must be between 0 and size/2");

  const chunks: Chunk[] = [];
  let index = 0;

  for (const { page, text } of pages) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length < MIN_CHUNK_CHARS) continue;

    let start = 0;
    while (start < clean.length) {
      let end = Math.min(start + size, clean.length);

      if (end < clean.length) {
        // Prefer to break right after the last full stop in the second half of the window.
        const lastBreak = clean.lastIndexOf(". ", end);
        if (lastBreak > start + size / 2) end = lastBreak + 1;
      }

      const content = clean.slice(start, end).trim();
      if (content.length >= MIN_CHUNK_CHARS) chunks.push({ page, index: index++, content });

      if (end >= clean.length) break;
      start = end - overlap;
    }
  }

  return chunks;
}
