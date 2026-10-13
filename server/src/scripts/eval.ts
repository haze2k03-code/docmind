// Retrieval evaluation: does search find the right page for questions we know the answer to?
//
// Reads eval/questions.json, runs each question through the same embedding + vector search
// the app uses (as an admin, so access rules don't hide anything), and reports:
//   - Hit rate @K: share of questions where the expected page appears in the top K chunks
//   - MRR (mean reciprocal rank): rewards finding it at rank 1 more than at rank 5
//
// Usage: npm run eval   (upload the sample PDFs first)
import { readFile } from "node:fs/promises";
import { config } from "../config.js";
import { pool } from "../db.js";
import { embedQuery } from "../services/gemini.js";
import { retrieveChunks } from "../services/retriever.js";

interface EvalCase {
  question: string;
  expectedTitle: string;
  expectedPage: number;
}

const cases = JSON.parse(await readFile("eval/questions.json", "utf8")) as EvalCase[];
let hits = 0;
let reciprocalRankSum = 0;

for (const c of cases) {
  const results = await retrieveChunks(await embedQuery(c.question), { role: "admin", department: "general" });
  const rank =
    results.findIndex(
      (r) => r.title.toLowerCase() === c.expectedTitle.toLowerCase() && r.page === c.expectedPage,
    ) + 1;

  if (rank > 0) {
    hits++;
    reciprocalRankSum += 1 / rank;
  }
  const top = results[0];
  console.log(
    `${rank > 0 ? "PASS" : "MISS"}  rank=${rank || "-"}  top=${top ? `${top.title} p${top.page} (${top.similarity.toFixed(2)})` : "none"}  ${c.question}`,
  );
}

console.log("\n----------------------------------------");
console.log(`Questions:  ${cases.length}`);
console.log(`Hit rate@${config.TOP_K}: ${((hits / cases.length) * 100).toFixed(0)}%`);
console.log(`MRR:        ${(reciprocalRankSum / cases.length).toFixed(2)}`);
await pool.end();
