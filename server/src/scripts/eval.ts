// DocMind evaluation: measures retrieval, access control, refusals and (optionally) answers.
//
// Reads eval/questions.json. Three kinds of question:
//   answerable   - the docs contain the answer. Checks the right page is retrieved, and with
//                  --answers, that the answer contains the expected facts and cites that page.
//   unanswerable - the docs don't contain the answer. DocMind should say it couldn't find it
//                  instead of making something up.
//   access       - asked by a user who must NOT see a document. Fails if any chunk of that
//                  document is retrieved for them (this is a leak).
//
// Usage (upload the sample PDFs first, see README):
//   npm run eval                              retrieval + access + refusals, no LLM calls
//   npm run eval -- --answers                 also generate answers with the LLM and grade them
//   npm run eval -- --k 8 --min-sim 0.5       try different settings without editing .env
//   npm run eval -- --label before            save results to eval/results/before.json
//   npm run eval -- --label after --compare before   save, then print before vs after
//   npm run eval -- --only access             run just one type of question
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { config } from "../config.js";
import { pool } from "../db.js";
import { embedQuery, streamAnswer } from "../services/gemini.js";
import { NOT_FOUND_ANSWER, SYSTEM_PROMPT, buildUserPrompt, isGrounded } from "../services/guard.js";
import { retrieveChunks, type RetrievedChunk } from "../services/retriever.js";
import {
  citesExpectedPage,
  containsAll,
  containsDocument,
  findRank,
  formatRatio,
  parseArgs,
  ratio,
  type EvalCase,
  type EvalUser,
  type Ratio,
} from "./evalLib.js";

const args = parseArgs(process.argv.slice(2));
const K = args.k ?? config.TOP_K;
const MIN_SIM = args.minSim ?? config.MIN_SIMILARITY;
const ADMIN: EvalUser = { role: "admin", department: "general" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries rate-limit (429) and overload (503) errors from Gemini with growing waits. */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const waits = [15_000, 30_000, 60_000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= waits.length || !/\b(429|503)\b/.test(msg)) throw err;
      console.log(`   ...${label} rate-limited, waiting ${waits[attempt] / 1000}s`);
      await sleep(waits[attempt]);
    }
  }
}

/** Same steps as the chat route: no strong chunks -> fixed "not found" answer, no LLM call. */
async function generateAnswer(question: string, chunks: RetrievedChunk[]): Promise<string> {
  if (chunks.length === 0) return NOT_FOUND_ANSWER;
  return withRetry(async () => {
    let text = "";
    for await (const part of streamAnswer(SYSTEM_PROMPT, buildUserPrompt(question, chunks))) text += part;
    return text;
  }, "LLM");
}

interface CaseResult {
  id: string;
  type: string;
  difficulty?: string;
  question: string;
  pass: boolean;
  reasons: string[];
  rank?: number;
  keptChunks: number;
  topChunk?: string;
  leak?: boolean;
  answer?: string;
  answerCorrect?: boolean;
  citationCorrect?: boolean;
  grounded?: boolean;
}

let cases = JSON.parse(await readFile("eval/questions.json", "utf8")) as EvalCase[];
cases = cases.map((c, i) => ({ ...c, id: c.id ?? `q${i + 1}`, type: c.type ?? "answerable" }));
if (args.only) cases = cases.filter((c) => c.type === args.only || c.id === args.only);
if (cases.length === 0) {
  console.error(`No questions match --only ${args.only}`);
  process.exit(1);
}

console.log(
  `Running ${cases.length} questions  (top-k=${K}, min similarity=${MIN_SIM}${args.answers ? `, answers with ${config.GEMINI_CHAT_MODEL}` : ", retrieval only"})\n`,
);

const results: CaseResult[] = [];
let llmCalls = 0;

for (const c of cases) {
  const user = c.asUser ?? ADMIN;
  const embedding = await withRetry(() => embedQuery(c.question), "embedding");
  const raw = await retrieveChunks(embedding, user, K);
  const kept = raw.filter((ch) => ch.similarity >= MIN_SIM);
  const r: CaseResult = {
    id: c.id!,
    type: c.type!,
    difficulty: c.difficulty,
    question: c.question,
    pass: true,
    reasons: [],
    keptChunks: kept.length,
    topChunk: raw[0] ? `${raw[0].title} p${raw[0].page} (${raw[0].similarity.toFixed(2)})` : undefined,
  };
  const fail = (why: string) => {
    r.pass = false;
    r.reasons.push(why);
  };

  if (c.type === "access") {
    r.leak = containsDocument(raw, c.restrictedTitle!);
    if (r.leak) fail(`LEAK: "${c.restrictedTitle}" retrieved for ${user.role}/${user.department}`);
  } else {
    if (c.type === "answerable") {
      r.rank = findRank(raw, c.expectedTitle!, c.expectedPage!);
      if (r.rank === 0) fail(`expected page not in top ${K}`);
      else if (findRank(kept, c.expectedTitle!, c.expectedPage!) === 0)
        fail(`expected page retrieved but below similarity ${MIN_SIM}`);
    }

    if (args.answers) {
      if (kept.length > 0 && llmCalls > 0 && args.delayMs > 0) await sleep(args.delayMs);
      if (kept.length > 0) llmCalls++;
      const answer = await generateAnswer(c.question, kept);
      r.answer = answer.trim();
      const saidNotFound = answer.includes(NOT_FOUND_ANSWER);

      if (c.type === "answerable") {
        r.answerCorrect = !saidNotFound && containsAll(answer, c.mustContain ?? []);
        r.citationCorrect = citesExpectedPage(answer, kept, c.expectedTitle!, c.expectedPage!);
        r.grounded = isGrounded(answer, kept.length);
        if (!r.answerCorrect) fail(saidNotFound ? "answered 'not found'" : `answer missing: ${(c.mustContain ?? []).join(", ")}`);
        if (!r.citationCorrect) fail("didn't cite the expected page");
      } else {
        r.answerCorrect = saidNotFound;
        if (!saidNotFound) fail("made up an answer instead of saying 'not found'");
      }
    } else if (c.type === "unanswerable" && kept.length > 0) {
      // Without --answers we can only say the LLM *would* be called; the model may still refuse.
      r.reasons.push(`${kept.length} chunk(s) passed the threshold, so the LLM must refuse (run --answers to check)`);
    }
  }

  results.push(r);
  const tag = r.pass ? "PASS" : "FAIL";
  const detail = r.type === "answerable" ? `rank=${r.rank || "-"}` : r.type === "access" ? `leak=${r.leak ? "YES" : "no"}` : `kept=${r.keptChunks}`;
  console.log(`${tag}  ${r.id.padEnd(4)} ${r.type.padEnd(12)} ${detail.padEnd(9)} ${c.question}`);
  for (const why of r.reasons) console.log(`        -> ${why}`);
}

// ---------------------------------------------------------------- metrics
const answerable = results.filter((r) => r.type === "answerable");
const unanswerable = results.filter((r) => r.type === "unanswerable");
const access = results.filter((r) => r.type === "access");
const count = <T>(xs: T[], f: (x: T) => boolean | undefined) => xs.filter((x) => f(x) === true).length;
const byDiff = (d: string) => answerable.filter((r) => r.difficulty === d);

const metrics: Record<string, Ratio | number | string> = {
  [`Retrieval hit rate@${K}`]: ratio(count(answerable, (r) => (r.rank ?? 0) > 0), answerable.length),
  "  - simple questions": ratio(count(byDiff("simple"), (r) => (r.rank ?? 0) > 0), byDiff("simple").length),
  "  - tricky questions": ratio(count(byDiff("tricky"), (r) => (r.rank ?? 0) > 0), byDiff("tricky").length),
  MRR: answerable.length
    ? (answerable.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / answerable.length).toFixed(2)
    : "n/a",
  "Access leaks (lower is better)": ratio(count(access, (r) => r.leak), access.length),
  "Unanswerable: no chunk passed threshold": ratio(count(unanswerable, (r) => r.keptChunks === 0), unanswerable.length),
};
if (args.answers) {
  Object.assign(metrics, {
    "Answer accuracy": ratio(count(answerable, (r) => r.answerCorrect), answerable.length),
    "  - simple answers": ratio(count(byDiff("simple"), (r) => r.answerCorrect), byDiff("simple").length),
    "  - tricky answers": ratio(count(byDiff("tricky"), (r) => r.answerCorrect), byDiff("tricky").length),
    "Citation accuracy": ratio(count(answerable, (r) => r.citationCorrect), answerable.length),
    "Grounded (cites a source)": ratio(count(answerable, (r) => r.grounded), answerable.length),
    "Unanswerable: correctly said 'not found'": ratio(count(unanswerable, (r) => r.answerCorrect), unanswerable.length),
  });
}

const show = (v: Ratio | number | string | undefined) =>
  v === undefined ? "n/a" : typeof v === "object" ? formatRatio(v) : String(v);

const label = args.label ?? "latest";
let previous: { label: string; metrics: typeof metrics } | undefined;
if (args.compare) {
  try {
    previous = JSON.parse(await readFile(`eval/results/${args.compare}.json`, "utf8"));
  } catch {
    console.error(`\nCouldn't read eval/results/${args.compare}.json - run with --label ${args.compare} first.`);
  }
}

console.log("\n" + "-".repeat(previous ? 78 : 60));
console.log("Metric".padEnd(42) + (previous ? previous.label.padEnd(18) : "") + label);
console.log("-".repeat(previous ? 78 : 60));
for (const [name, value] of Object.entries(metrics)) {
  console.log(name.padEnd(42) + (previous ? show(previous.metrics[name]).padEnd(18) : "") + show(value));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} questions passed.` + (failed.length ? ` Failures: ${failed.map((r) => r.id).join(", ")}` : ""));

await mkdir("eval/results", { recursive: true });
await writeFile(
  `eval/results/${label}.json`,
  JSON.stringify(
    {
      label,
      runAt: new Date().toISOString(),
      settings: { topK: K, minSimilarity: MIN_SIM, answers: args.answers, chatModel: config.GEMINI_CHAT_MODEL, embedModel: config.GEMINI_EMBED_MODEL },
      metrics,
      results,
    },
    null,
    2,
  ),
);
console.log(`Saved eval/results/${label}.json`);
await pool.end();
