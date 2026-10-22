# DocMind: Interview Prep Guide

Read this after you have the app running. Open each file mentioned and find the code being described. If you can explain every section below in your own words, you can defend this project in any technical round.

---

## 1. Your 60-second pitch

> "DocMind is an internal knowledge assistant. Companies have hundreds of policy documents and handbooks, and employees waste time searching them or asking HR the same questions. With DocMind, an admin uploads PDFs, and employees ask questions in plain English. The answer comes only from those documents, with a citation to the exact page.
>
> It uses Retrieval-Augmented Generation. I split each PDF into chunks, convert them to embeddings with Gemini, and store them in PostgreSQL using pgvector. When someone asks a question, I find the most similar chunks, but only from documents their department can access. That filter happens in the SQL query, so the AI never even sees restricted content. Then Gemini writes an answer from those chunks, streamed to a Next.js frontend.
>
> I also added guardrails: prompt-injection checks, a citation check that flags ungrounded answers, an audit log, and a script that measures retrieval accuracy. It runs in Docker with a GitHub Actions pipeline."

Practise saying this out loud until it takes about a minute and doesn't sound memorised.

---

## 2. Core concepts you must be able to explain

**What is RAG?**
LLMs only know their training data and can't see your company's private documents. RAG = first *retrieve* relevant text from your own data, then give it to the model along with the question, so it *generates* an answer grounded in that text. It's cheaper and faster than fine-tuning, and when a document changes you just re-upload it.

**What is an embedding?**
A list of numbers (here, 768 of them) that represents the *meaning* of a piece of text. Texts with similar meanings get vectors that point in similar directions. "How many leave days do I get?" and "Employees receive 18 days of paid annual leave" share few words but have close embeddings. That's why this beats keyword search.

**What is cosine similarity?**
It measures the angle between two vectors: 1 = same direction (same meaning), 0 = unrelated. pgvector's `<=>` operator returns cosine *distance*, so I compute `1 - distance` to get similarity. See `retriever.ts`.

**What is a vector database / pgvector?**
A database that can efficiently find "the nearest vectors to this one". pgvector adds a `vector` column type and distance operators to PostgreSQL. I chose it over a dedicated vector DB (Pinecone, Weaviate) because my users, documents and permissions are relational data anyway. One database means I can JOIN chunks with documents and filter by permission in a single query, inside one transaction.

**What is HNSW?**
An approximate nearest-neighbour index (Hierarchical Navigable Small World graph). Without an index, Postgres compares the question to every chunk: fine for 1,000 chunks, slow for 10 million. HNSW builds a layered graph so search jumps quickly toward close vectors. The trade-off: it's *approximate*, so it can occasionally miss the true closest match, in exchange for big speed gains.

**Why chunk documents at all?**
Three reasons: embeddings work best on focused passages, a whole document doesn't fit well in a prompt, and small chunks let me cite a precise page. I use ~1,000 characters with 200 characters of overlap, so a fact sitting on a boundary still appears whole in one chunk. Chunks never cross pages, so citations stay exact. See `chunker.ts`.

---

## 3. Walk through the code: one question, start to finish

1. **Browser** (`web/app/chat/page.tsx`) sends `POST /api/chat`. Next.js forwards it to Express (`next.config.ts` rewrites).
2. **Auth** (`middleware/auth.ts`): reads the JWT from the httpOnly cookie, verifies it, then loads the user *fresh from the database*.
3. **Rate limit**: 20 questions per minute per user.
4. **Validation**: Zod checks the question is 1–1000 characters.
5. **Injection check** (`guard.ts`): regex patterns for things like "ignore previous instructions". If matched → blocked and logged as flagged.
6. **Embed the question** (`gemini.ts`) with task type `RETRIEVAL_QUERY`.
7. **Retrieve** (`retriever.ts`): top 5 nearest chunks, with `WHERE` filtering by role and department.
8. **Threshold**: chunks below 0.55 similarity are dropped. If none are left → reply "I couldn't find this…" **without calling the LLM** (saves money, prevents a made-up answer).
9. **Build the prompt** (`guard.ts`): a system prompt with strict rules + numbered `<source>` blocks + the question.
10. **Stream** the answer back as Server-Sent Events: first a `sources` event, then many `token` events, then `done`.
11. **Grounding check**: does the answer cite at least one real source? If not, the UI shows a warning and the log row is flagged.
12. **Audit log**: question, answer, chunk IDs used, grounded flag → `chat_logs` table.

---

## 4. Likely interview questions and strong answers

**Q: Why did you build access control in the database and not in the prompt?**
Prompts can be manipulated. If I sent all chunks and told the model "don't show HR content to engineers", a clever prompt could break that. Filtering in the SQL `WHERE` clause means restricted text never enters the prompt, so there is nothing to leak. Security should never depend on the LLM obeying instructions.

**Q: How do you prevent prompt injection?**
Layered defence, because no single method is perfect:
- A regex check on the question for obvious attacks.
- Document text is wrapped in `<source>` tags and the system prompt says content inside them is data, not instructions. I also neutralise any `</source>` inside document text so a malicious PDF can't close the tag early.
- Least privilege: the model has no tools and no database access, it only sees chunks the user may already read.
- Output check: uncited answers are flagged.
I'd be honest that regex is easy to bypass. In production I'd add a classifier model or a service like Azure AI Content Safety.

**Q: How do you reduce hallucinations?**
Temperature 0.2, a system prompt that forbids outside knowledge and requires citations, a similarity threshold that skips the LLM when nothing relevant was found, and the citation check afterwards. The UI also shows the source passages so the user can verify.

**Q: How did you evaluate quality?**
`npm run eval` runs 36 questions through the real pipeline, in three types. **Answerable** (25, split into simple and tricky, where tricky ones are phrased like a real employee would ask): checks *hit rate@K* (was the right page in the top K?), *MRR* (rank 1 scores 1, rank 2 scores 0.5…), and with `--answers`, whether the answer contains the expected facts and cites the right page. **Unanswerable** (5): DocMind must say "I couldn't find this" instead of inventing an answer. **Access** (6): asked as a user without access to a document; if a single chunk of it is retrieved, that's a leak. Results are saved per run, so I can change top-K or the similarity threshold and compare before vs after. Fill in your real numbers here after running it: *[hit rate, answer accuracy, leaks, what you changed]*. Next step: LLM-as-judge for open-ended answers, or a framework like RAGAS.

**Q: Why JWT in a cookie instead of localStorage?**
localStorage is readable by any JavaScript on the page, so one XSS bug could steal the token. An `httpOnly` cookie is invisible to JavaScript. `SameSite=Strict` stops the browser sending it on requests from other sites, which blocks CSRF.

**Q: JWTs are stateless. How do you revoke one?**
I don't trust the token's contents for permissions. On every request I load the user from the database, so changing someone's department or deleting them takes effect immediately. The trade-off is one small DB query per request. At scale I'd cache it or use short-lived access tokens plus refresh tokens.

**Q: How are passwords stored?**
bcrypt with a cost factor of 10. bcrypt is deliberately slow and salts each hash, so leaked hashes are hard to brute-force and identical passwords give different hashes. Login returns the same message for wrong email or wrong password, so attackers can't discover registered emails. Login is rate-limited to 10 attempts per 15 minutes.

**Q: How do you prevent SQL injection?**
Every query uses parameterised queries (`$1`, `$2`). The values are sent separately from the SQL text, so user input is never executed as SQL.

**Q: Why Server-Sent Events and not WebSockets?**
Communication here is one-way: the server streams an answer to one request. SSE runs over plain HTTP, works through proxies, and needs no extra library. WebSockets suit two-way, long-lived connections like live collaboration or chat between users.

**Q: Why is the upload wrapped in a transaction?**
A document row and its chunks must exist together. If inserting chunks fails halfway, `ROLLBACK` removes the document row too, so search never sees a half-indexed file. I also call the embedding API *before* opening the transaction, so I don't hold a database connection during slow network calls.

**Q: Why did you put all chunks in one INSERT?**
`unnest()` turns parallel arrays into rows, so 200 chunks are one round-trip to the database instead of 200.

**Q: What happens with a scanned PDF?**
It has no text layer, so extraction returns nothing and the API replies 422 "Scanned PDFs need OCR first". Adding OCR (for example Tesseract or a cloud OCR service) is on my improvement list.

**Q: What breaks at scale? How would you scale it?**
- Large uploads block the request. → Move ingestion to a background queue (BullMQ with Redis, or Kafka) and show progress.
- Filtering after an HNSW search can return fewer than 5 results when most chunks are restricted. → pgvector 0.8's iterative index scans, or partitioning by department.
- Repeated questions cost API calls. → Cache embeddings and answers.
- The API is stateless, so it scales horizontally behind a load balancer. Postgres can use read replicas.

**Q: Why Gemini? Can you switch to another model?**
It has a free tier, which suited a student project. All model calls live in one file, `gemini.ts`, so switching to Azure OpenAI or Claude means rewriting that one file and adjusting the vector size in the schema. One caveat: switching the embedding model means re-embedding every document, because vectors from different models aren't comparable.

**Q: Why the Next.js rewrite instead of calling Express directly?**
The browser only talks to one origin. That avoids CORS configuration, and the `SameSite=Strict` cookie works without extra setup.

**Q: What does Docker give you here?**
Anyone can run the full system, including Postgres with pgvector, with one command, and it behaves the same on every machine. Multi-stage builds keep the images small (no TypeScript compiler or dev tools in production), and containers run as a non-root user.

**Q: What does your CI pipeline do?**
On every push and pull request: type-check and unit-test the API, type-check and build the frontend, and build both Docker images. A broken build can't be merged unnoticed.

**Q: What is MCP?** *(the JD mentions it)*
Model Context Protocol, an open standard from Anthropic for connecting AI assistants to tools and data. Instead of writing a custom integration for every AI app, you write one MCP server exposing "tools" (like `search_documents`), and any MCP-compatible assistant can use them. A natural extension of DocMind is an MCP server wrapping the retriever, so an assistant like Claude could search company documents directly.

**Q: What was the hardest part?**
Pick something real from your own experience setting it up. A good honest answer: tuning the similarity threshold. Too high and real questions get "not found", too low and irrelevant chunks reach the model. The evaluation script is how you'd tune it properly instead of guessing.

**Q: Did you use AI tools to build this?** *(the JD explicitly values this)*
Answer honestly: you used an AI assistant to help write and scaffold the code, then you reviewed it, ran it, tested it and understood each part. Mention how you checked its output (running the tests, reading every file, verifying behaviour in the demo). The JD asks for exactly this: using AI tools "while applying engineering judgment".

---

## 5. Honest limitations (say these before they ask)

Interviewers respect candidates who know their project's weaknesses.

- Regex injection detection is basic and easy to get around.
- No conversation memory: each question is answered independently.
- Ingestion runs inside the HTTP request, so very large PDFs are slow.
- Vector search only. Hybrid search (keyword + vector) would handle exact terms like policy codes better.
- Grounding check only confirms citations exist, not that the cited source actually supports the claim.

---

## 6. How this maps to the HCL JD

| JD requirement | Where it is in DocMind |
|---|---|
| React, Next.js, TypeScript | `web/`, the whole codebase is TypeScript |
| Node.js, REST APIs | `server/src/routes/` |
| SQL, schema design, indexing, normalization | `db/init.sql`: foreign keys, cascades, B-tree and HNSW indexes |
| JWT, sessions, authorization | `middleware/auth.ts`, role + department checks |
| LLM APIs, RAG, embeddings, vector DB, semantic search | `services/gemini.ts`, `retriever.ts`, pgvector |
| Prompt templates, AI response validation | `services/guard.ts` |
| AI evaluation (grounding, accuracy) | `scripts/eval.ts`, citation check |
| Security: XSS, CSRF, SQL injection, prompt injection | httpOnly + SameSite cookie, parameterised queries, Helmet, guardrails |
| Responsible AI: human oversight, transparency | Visible sources, ungrounded-answer warning, audit log |
| Docker, CI/CD, GitHub Actions | `Dockerfile`s, `docker-compose.yml`, `.github/workflows/ci.yml` |
| Unit testing | `server/tests/` |

---

## 7. Draft resume entry

**DocMind – AI Knowledge Assistant (RAG)** | Next.js, TypeScript, Node.js, PostgreSQL, pgvector, Gemini API, Docker | [GitHub] [Live]
- Built a full-stack RAG application that answers employee questions from company PDFs with page-level citations, streaming responses via Server-Sent Events.
- Designed a PostgreSQL + pgvector schema with HNSW indexing for semantic search; enforced department-based access control inside the SQL query so restricted content never reaches the LLM.
- Implemented AI guardrails (prompt-injection screening, citation-based grounding checks, audit logging) and a retrieval evaluation pipeline measuring hit rate and MRR.
- Secured the app with JWT in httpOnly cookies, bcrypt, rate limiting and parameterised queries; containerised with Docker and automated testing and builds with GitHub Actions.

Put your real eval numbers in once you've run `npm run eval`, for example "achieving 93% hit rate@5 on a 14-question benchmark". Only use numbers you actually got.
