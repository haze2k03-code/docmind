"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isLogin = mode === "login";

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      await api(`/auth/${mode}`, { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
      router.replace("/chat");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <div className="brand brand-lg">
          <span className="brand-mark">D</span> DocMind
        </div>
        <p className="muted">
          {isLogin ? "Log in to ask questions about your company's documents." : "Create an employee account."}
        </p>

        {!isLogin && (
          <label>
            Name
            <input name="name" required autoComplete="name" />
          </label>
        )}
        <label>
          Email
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            minLength={isLogin ? 1 : 8}
            autoComplete={isLogin ? "current-password" : "new-password"}
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Please wait…" : isLogin ? "Log in" : "Create account"}
        </button>

        <p className="muted small center">
          {isLogin ? (
            <>
              New here? <Link href="/register">Create an account</Link>
            </>
          ) : (
            <>
              Already have an account? <Link href="/login">Log in</Link>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
