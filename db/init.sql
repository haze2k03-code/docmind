-- DocMind schema. Runs automatically the first time the Postgres container starts.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
  department    TEXT NOT NULL DEFAULT 'general',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- department = 'all' means every logged-in user can see the document.
CREATE TABLE documents (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  filename    TEXT NOT NULL,
  department  TEXT NOT NULL DEFAULT 'all',
  page_count  INT  NOT NULL,
  uploaded_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX documents_department_idx ON documents (department);

-- 768 dimensions = the size we ask Gemini to return (see server/src/services/gemini.ts).
CREATE TABLE chunks (
  id          SERIAL PRIMARY KEY,
  document_id INT  NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_number INT  NOT NULL,
  chunk_index INT  NOT NULL,
  content     TEXT NOT NULL,
  embedding   vector(768) NOT NULL
);
CREATE INDEX chunks_document_idx ON chunks (document_id);
-- HNSW = approximate nearest-neighbour index, so search stays fast as chunks grow.
CREATE INDEX chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);

-- Audit trail: who asked what, which chunks were used, and whether the answer was flagged.
CREATE TABLE chat_logs (
  id         SERIAL PRIMARY KEY,
  user_id    INT REFERENCES users(id) ON DELETE SET NULL,
  question   TEXT NOT NULL,
  answer     TEXT,
  chunk_ids  INT[] NOT NULL DEFAULT '{}',
  grounded   BOOLEAN,
  flagged    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chat_logs_user_idx ON chat_logs (user_id, created_at DESC);
