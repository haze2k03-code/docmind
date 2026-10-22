// Pure helpers for the evaluation script, kept separate so they can be unit tested
// without a database or an API key.
import { extractCitations } from "../services/guard.js";

export interface EvalUser {
  role: "admin" | "employee";
  department: string;
}

export interface EvalCase {
  id?: string;
  /** answerable = the docs contain the answer; unanswerable = they don't; access = user must NOT see a document */
  type?: "answerable" | "unanswerable" | "access";
  difficulty?: "simple" | "tricky";
  question: string;
  expectedTitle?: string;
  expectedPage?: number;
  /** Every string must appear in a correct answer (case-insensitive; "1,500" matches "1500"). */
  mustContain?: string[];
  asUser?: EvalUser;
  restrictedTitle?: string;
}

export interface ChunkRef {
  title: string;
  page: number;
}

const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** 1-based position of the expected page in the results, or 0 if it isn't there. */
export function findRank(chunks: ChunkRef[], title: string, page: number): number {
  return chunks.findIndex((c) => sameTitle(c.title, title) && c.page === page) + 1;
}

/** True if any chunk comes from the given document. */
export function containsDocument(chunks: ChunkRef[], title: string): boolean {
  return chunks.some((c) => sameTitle(c.title, title));
}

/** Lowercase, drop thousands separators, unify dashes, collapse spaces. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does the answer contain every expected string?
 * Plain numbers are matched as whole numbers, so "8" doesn't match inside "18" or "2.8".
 */
export function containsAll(answer: string, needles: string[]): boolean {
  const hay = normalizeText(answer);
  return needles.every((needle) => {
    const n = normalizeText(needle);
    if (/^\d+(\.\d+)?$/.test(n)) {
      return new RegExp(`(?<![\\d.])${escapeRegExp(n)}(?!\\d|\\.\\d)`).test(hay);
    }
    return hay.includes(n);
  });
}

/** Did the answer cite (as [n]) at least one source that is the expected page? */
export function citesExpectedPage(answer: string, sources: ChunkRef[], title: string, page: number): boolean {
  return extractCitations(answer, sources.length).some((n) => {
    const s = sources[n - 1];
    return sameTitle(s.title, title) && s.page === page;
  });
}

export interface Ratio {
  n: number;
  of: number;
}

export const ratio = (n: number, of: number): Ratio => ({ n, of });

export function formatRatio(r: Ratio | undefined): string {
  if (!r || r.of === 0) return "n/a";
  return `${Math.round((100 * r.n) / r.of)}% (${r.n}/${r.of})`;
}

export interface EvalArgs {
  answers: boolean;
  k?: number;
  minSim?: number;
  label?: string;
  compare?: string;
  delayMs: number;
  only?: string;
}

/** Parses flags like --answers, --k 8, --k=8, --min-sim 0.5, --label before, --compare before. */
export function parseArgs(argv: string[]): EvalArgs {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const [key, inline] = arg.slice(2).split("=", 2);
    if (inline !== undefined) flags.set(key, inline);
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags.set(key, argv[++i]);
    else flags.set(key, true);
  }

  const num = (key: string): number | undefined => {
    const v = flags.get(key);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (v === true || Number.isNaN(n)) throw new Error(`--${key} needs a number`);
    return n;
  };
  const str = (key: string): string | undefined => {
    const v = flags.get(key);
    if (v === true) throw new Error(`--${key} needs a value`);
    return v;
  };

  const answers = flags.has("answers");
  return {
    answers,
    k: num("k"),
    minSim: num("min-sim"),
    label: str("label"),
    compare: str("compare"),
    // Gemini's free tier allows only a few LLM calls per minute, so space them out by default.
    delayMs: num("delay") ?? (answers ? 4000 : 0),
    only: str("only"),
  };
}
