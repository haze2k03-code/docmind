"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api, type User } from "@/lib/api";

export function Header({ user }: { user: User }) {
  const router = useRouter();
  const pathname = usePathname();

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  }

  return (
    <header className="header">
      <Link href="/chat" className="brand">
        <span className="brand-mark">D</span> DocMind
      </Link>
      <nav className="nav">
        <Link href="/chat" className={pathname === "/chat" ? "active" : ""}>
          Chat
        </Link>
        {user.role === "admin" && (
          <Link href="/admin" className={pathname === "/admin" ? "active" : ""}>
            Admin
          </Link>
        )}
      </nav>
      <div className="header-user">
        <span className="user-chip">
          {user.name}
          <span className="badge">{user.role === "admin" ? "admin" : user.department}</span>
        </span>
        <button className="btn btn-ghost" onClick={logout}>
          Log out
        </button>
      </div>
    </header>
  );
}
