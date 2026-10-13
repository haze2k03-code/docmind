import { extractText, getDocumentProxy } from "unpdf";
import type { PageText } from "./chunker.js";

/** Returns the text of each page separately, so we can cite page numbers later. */
export async function extractPages(buffer: Buffer): Promise<PageText[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  return text.map((pageText, i) => ({ page: i + 1, text: pageText }));
}

/** Checks the file's first bytes, because the browser-reported MIME type can be faked. */
export function looksLikePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}
