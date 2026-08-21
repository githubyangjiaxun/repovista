"use client";

import { Github, LibraryBig, LoaderCircle, LogIn, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { apiFetch, apiOrigin } from "@/lib/api";

export function SiteHeader({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { session, loading, refresh } = useAuth();
  const [switching, setSwitching] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function switchWorkspace(workspaceId: string) {
    if (!session?.authenticated || workspaceId === session.workspace?.id) return;
    setSwitching(true);
    try {
      await apiFetch("/v1/auth/session/workspace", {
        method: "PUT",
        body: JSON.stringify({ workspaceId }),
      });
      await refresh();
      router.refresh();
      router.push("/repositories");
    } finally {
      setSwitching(false);
    }
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await apiFetch("/v1/auth/logout", { method: "POST" });
      await refresh();
      router.push("/");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <header className={compact ? "site-header site-header-compact" : "site-header"}>
      <Link className="brand" href="/">
        <span className="brand-mark">R</span>
        <span>RepoVista</span>
      </Link>
      <nav className="nav-links" aria-label="Primary navigation">
        <Link href="/repositories">
          <LibraryBig size={16} />
          Repositories
        </Link>
        <Link href="/docs">Docs</Link>
        {loading ? (
          <output className="auth-loading" aria-label="Loading session">
            <LoaderCircle className="spin" size={16} />
          </output>
        ) : session?.authenticated ? (
          <>
            <label className="workspace-switcher">
              <span className="sr-only">Current workspace</span>
              <select
                aria-label="Current workspace"
                disabled={switching}
                onChange={(event) => void switchWorkspace(event.target.value)}
                value={session.workspace?.id ?? ""}
              >
                {session.workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
            <Link href="/settings">
              <Settings size={16} /> Settings
            </Link>
            <button
              className="header-action"
              disabled={loggingOut}
              onClick={() => void logout()}
              type="button"
            >
              {loggingOut ? <LoaderCircle className="spin" size={16} /> : <LogOut size={16} />}
              Logout
            </button>
          </>
        ) : session?.capabilities.githubLogin ? (
          <a href={`${apiOrigin}/v1/auth/github/start?returnTo=%2Frepositories`}>
            <LogIn size={16} /> Sign in
          </a>
        ) : (
          <a href="https://github.com" rel="noreferrer" target="_blank">
            <Github size={16} /> GitHub
          </a>
        )}
      </nav>
    </header>
  );
}
