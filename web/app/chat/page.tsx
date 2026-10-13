"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/Header";
import { api, streamChat, type DocumentInfo, type Source } from "@/lib/api";
import { useUser } from "@/lib/useUser";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  sources?: Source[];
  grounded?: boolean;
  error?: string;
  streaming?: boolean;
}

const SUGGESTIONS = [
  "How many days of annual leave do I get?",
  "Can I work from another country?",
  "How many approvals does a pull request need?",
];

/** Turns "[1]" markers in the answer into small badges that show the source on hover. */
function AnswerText({ text, sources }: { text: string; sources: Source[] }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\[(\d+)\]$/);
        const source = match ? sources.find((s) => s.n === Number(match[1])) : undefined;
        if (!source) return <span key={i}>{part}</span>;
        return (
          <sup key={i} className="cite" title={`${source.title}, page ${source.page}`}>
            {source.n}
          </sup>
        );
      })}
    </>
  );
}

export default function ChatPage() {
  const user = useUser();
  const router = useRouter();
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    if (!user) return;
    api<{ documents: DocumentInfo[] }>("/documents")
      .then(({ documents }) => setDocuments(documents))
      .catch(() => setDocuments([]));
  }, [user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Stop any in-flight answer if the user leaves the page.
  useEffect(() => () => abortRef.current?.abort(), []);

  function updateMessage(id: number, change: (m: Message) => Partial<Message>) {
    setMessages((all) => all.map((m) => (m.id === id ? { ...m, ...change(m) } : m)));
  }

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    const assistantId = nextId.current + 1;
    setMessages((all) => [
      ...all,
      { id: nextId.current, role: "user", text: trimmed },
      { id: assistantId, role: "assistant", text: "", sources: [], streaming: true },
    ]);
    nextId.current += 2;
    setInput("");
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat(
        trimmed,
        {
          onSources: (sources) => updateMessage(assistantId, () => ({ sources })),
          onToken: (text) => updateMessage(assistantId, (m) => ({ text: m.text + text })),
          onDone: ({ grounded }) => updateMessage(assistantId, () => ({ grounded })),
          onError: (error, status) => {
            if (status === 401) router.replace("/login");
            updateMessage(assistantId, () => ({ error }));
          },
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        updateMessage(assistantId, () => ({ error: "Connection lost. Please try again." }));
      }
    } finally {
      updateMessage(assistantId, () => ({ streaming: false }));
      setBusy(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(input);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void ask(input);
    }
  }

  if (!user) return <div className="loading">Loading…</div>;

  return (
    <div className="app">
      <Header user={user} />
      <div className="chat-layout">
        <aside className="sidebar">
          <h2 className="sidebar-title">Your documents</h2>
          {documents.length === 0 ? (
            <p className="muted small">
              {user.role === "admin" ? "Upload PDFs from the Admin page to get started." : "No documents shared with you yet."}
            </p>
          ) : (
            <ul className="doc-list">
              {documents.map((d) => (
                <li key={d.id}>
                  <span className="doc-title">{d.title}</span>
                  <span className="muted small">
                    {d.pageCount} pages · {d.department === "all" ? "everyone" : d.department}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small sidebar-note">
            You only see documents shared with everyone or with your department ({user.department}).
          </p>
        </aside>

        <section className="chat">
          <div className="messages">
            {messages.length === 0 && (
              <div className="empty">
                <h1>Ask your documents anything</h1>
                <p className="muted">Answers come only from your company&apos;s documents, with page citations.</p>
                <div className="suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="suggestion" onClick={() => void ask(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="msg msg-user">
                  {m.text}
                </div>
              ) : (
                <div key={m.id} className="msg msg-assistant">
                  {m.error ? (
                    <p className="error">{m.error}</p>
                  ) : m.text ? (
                    <div className="answer">
                      <AnswerText text={m.text} sources={m.sources ?? []} />
                      {m.streaming && <span className="cursor" />}
                    </div>
                  ) : (
                    <p className="muted">Searching your documents…</p>
                  )}

                  {m.grounded === false && (
                    <p className="warning">This answer didn&apos;t cite any source. Double-check it before relying on it.</p>
                  )}

                  {!m.streaming && !m.error && (m.sources?.length ?? 0) > 0 && (
                    <details className="sources">
                      <summary>{m.sources!.length} sources</summary>
                      <ol>
                        {m.sources!.map((s) => (
                          <li key={s.n}>
                            <strong>
                              [{s.n}] {s.title}, page {s.page}
                            </strong>
                            <span className="muted small"> · match {Math.round(s.similarity * 100)}%</span>
                            <p className="preview">{s.preview}…</p>
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </div>
              ),
            )}
            <div ref={bottomRef} />
          </div>

          <form className="composer" onSubmit={handleSubmit}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question… (Enter to send, Shift+Enter for a new line)"
              rows={2}
              maxLength={1000}
            />
            <button className="btn btn-primary" disabled={busy || !input.trim()}>
              {busy ? "Answering…" : "Ask"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
