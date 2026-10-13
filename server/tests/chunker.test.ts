import { describe, expect, it } from "vitest";
import { chunkPages } from "../src/services/chunker.js";

const sentence = (n: number) => `This is sentence number ${n} of the policy document. `;
const longText = Array.from({ length: 80 }, (_, i) => sentence(i)).join("");

describe("chunkPages", () => {
  it("keeps a short page as a single chunk with its page number", () => {
    const chunks = chunkPages([{ page: 3, text: "Employees get 12 days of casual leave per year." }]);
    expect(chunks).toEqual([{ page: 3, index: 0, content: "Employees get 12 days of casual leave per year." }]);
  });

  it("skips empty and near-empty pages", () => {
    expect(chunkPages([{ page: 1, text: "   " }, { page: 2, text: "Page 2" }])).toEqual([]);
  });

  it("never exceeds the chunk size and never crosses pages", () => {
    const chunks = chunkPages(
      [
        { page: 1, text: longText },
        { page: 2, text: longText },
      ],
      500,
      100,
    );
    expect(chunks.length).toBeGreaterThan(4);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(500);
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1, 2]));
  });

  it("ends chunks at sentence boundaries when possible", () => {
    const chunks = chunkPages([{ page: 1, text: longText }], 500, 100);
    for (const c of chunks.slice(0, -1)) expect(c.content.endsWith(".")).toBe(true);
  });

  it("overlaps neighbouring chunks so boundary facts aren't lost", () => {
    const [first, second] = chunkPages([{ page: 1, text: longText }], 500, 100);
    const tail = first.content.slice(-50);
    expect(second.content).toContain(tail.trim().slice(-30));
  });

  it("numbers chunks sequentially across pages", () => {
    const chunks = chunkPages([
      { page: 1, text: longText },
      { page: 2, text: longText },
    ]);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it("rejects an overlap that could stall the loop", () => {
    expect(() => chunkPages([], 100, 60)).toThrow();
  });
});
