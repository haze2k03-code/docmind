"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Header } from "@/components/Header";
import { api, DEPARTMENTS, type DocumentInfo, type User } from "@/lib/api";
import { useUser } from "@/lib/useUser";

export default function AdminPage() {
  const me = useUser({ requireAdmin: true });
  const [documents, setDocuments] = useState<DocumentInfo[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const [docs, people] = await Promise.all([
      api<{ documents: DocumentInfo[] }>("/documents"),
      api<{ users: User[] }>("/users"),
    ]);
    setDocuments(docs.documents);
    setUsers(people.users);
  }, []);

  useEffect(() => {
    if (me) void refresh();
  }, [me, refresh]);

  async function handleUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setUploading(true);
    setMessage(null);
    try {
      const result = await api<{ pages: number; chunks: number }>("/documents", {
        method: "POST",
        body: new FormData(form),
      });
      setMessage({ kind: "ok", text: `Indexed ${result.pages} pages into ${result.chunks} searchable chunks.` });
      form.reset();
      await refresh();
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setUploading(false);
    }
  }

  async function deleteDocument(doc: DocumentInfo) {
    if (!confirm(`Delete "${doc.title}"? This removes it from search for everyone.`)) return;
    try {
      await api(`/documents/${doc.id}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    }
  }

  async function updateUser(id: number, change: Partial<Pick<User, "role" | "department">>) {
    try {
      await api(`/users/${id}`, { method: "PATCH", body: JSON.stringify(change) });
      await refresh();
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    }
  }

  if (!me) return <div className="loading">Loading…</div>;

  return (
    <div className="app">
      <Header user={me} />
      <main className="admin">
        <section className="card">
          <h2>Upload a document</h2>
          <p className="muted small">
            PDFs with selectable text, up to 10 MB. The text is split into chunks, embedded, and stored for search.
          </p>
          <form className="upload-form" onSubmit={handleUpload}>
            <label>
              PDF file
              <input name="file" type="file" accept="application/pdf" required />
            </label>
            <label>
              Title (optional)
              <input name="title" placeholder="Taken from the file name if empty" maxLength={120} />
            </label>
            <label>
              Who can see it
              <select name="department" defaultValue="all">
                <option value="all">Everyone</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d} department only
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn-primary" disabled={uploading}>
              {uploading ? "Indexing…" : "Upload and index"}
            </button>
          </form>
          {message && <p className={message.kind === "ok" ? "success" : "error"}>{message.text}</p>}
        </section>

        <section className="card">
          <h2>Documents ({documents.length})</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Visible to</th>
                  <th>Pages</th>
                  <th>Chunks</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td>{d.title}</td>
                    <td>{d.department === "all" ? "Everyone" : d.department}</td>
                    <td>{d.pageCount}</td>
                    <td>{d.chunkCount}</td>
                    <td>
                      <button className="btn btn-ghost btn-danger" onClick={() => void deleteDocument(d)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <h2>Users ({users.length})</h2>
          <p className="muted small">New sign-ups join the &quot;general&quot; department. Move people here to give them access.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Department</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td>
                      <select value={u.department} onChange={(e) => void updateUser(u.id, { department: e.target.value })}>
                        {DEPARTMENTS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={u.role}
                        disabled={u.id === me.id}
                        onChange={(e) => void updateUser(u.id, { role: e.target.value as User["role"] })}
                      >
                        <option value="employee">employee</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
