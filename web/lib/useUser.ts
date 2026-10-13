"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type User } from "./api";

/**
 * Loads the logged-in user. Sends visitors who aren't logged in to /login,
 * and non-admins away from admin-only pages.
 *
 * This is only for a smooth UI. The real access checks happen on the server,
 * so hiding a page here is never what keeps data safe.
 */
export function useUser({ requireAdmin = false } = {}) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    api<{ user: User }>("/auth/me")
      .then(({ user }) => {
        if (requireAdmin && user.role !== "admin") router.replace("/chat");
        else setUser(user);
      })
      .catch(() => router.replace("/login"));
  }, [requireAdmin, router]);

  return user;
}
