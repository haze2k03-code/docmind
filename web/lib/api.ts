export interface User {
  id: number;
  name: string;
  email: string;
  role: "admin" | "employee";
  department: string;
}

export interface DocumentInfo {
  id: number;
  title: string;
  filename: string;
  department: string;
  pageCount: number;
  chunkCount: number;
  createdAt: string;
}

export interface Source {
  n: number;
  documentId: number;
  title: string;
  page: number;
  similarity: number;
  preview: string;
}

export const DEPARTMENTS = ["general", "hr", "engineering", "finance", "sales"] as const;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Small fetch wrapper: JSON in, JSON out, and a readable error when the API says no. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: isForm ? init.headers : { "Content-Type": "application/json", ...init.headers },
  });
  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

interface ChatHandlers {
  onSources: (sources: Source[]) => void;
  onToken: (text: string) => void;
  onDone: (result: { grounded: boolean }) => void;
  onError: (message: string, status?: number) => void;
}

/**
 * Sends a question and reads the Server-Sent Events stream as it arrives.
 * Each event is a block like "event: token\ndata: {...}" separated by a blank line.
 */
export async function streamChat(question: string, handlers: ChatHandlers, signal?: AbortSignal): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    signal,
  });

  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    handlers.onError(data.error ?? `Request failed (${res.status})`, res.status);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;

      const payload = JSON.parse(data);
      if (event === "sources") handlers.onSources(payload);
      else if (event === "token") handlers.onToken(payload.text);
      else if (event === "done") handlers.onDone(payload);
      else if (event === "error") handlers.onError(payload.error);
    }
  }
}
