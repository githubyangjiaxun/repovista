"use client";

import type {
  ApiTokenMetadata,
  AuditEvent,
  CreateApiTokenResponse,
  GitHubInstallation,
  WorkspaceMember,
} from "@repovista/contracts";
import {
  Activity,
  AlertCircle,
  Check,
  Copy,
  Github,
  KeyRound,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { apiErrorMessage, apiFetch, apiOrigin } from "@/lib/api";

type SettingsData = {
  members: WorkspaceMember[];
  installations: GitHubInstallation[];
  tokens: ApiTokenMetadata[];
  audit: AuditEvent[];
};

const emptyData: SettingsData = { members: [], installations: [], tokens: [], audit: [] };

export function SettingsWorkspace() {
  const router = useRouter();
  const { session, loading: authLoading, refresh } = useAuth();
  const [data, setData] = useState<SettingsData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newWorkspace, setNewWorkspace] = useState("");
  const [memberLogin, setMemberLogin] = useState("");
  const [memberRole, setMemberRole] = useState<"owner" | "editor" | "viewer">("viewer");
  const [tokenName, setTokenName] = useState("");
  const [rawToken, setRawToken] = useState<string | null>(null);
  const workspace = session?.workspace ?? null;
  const owner = workspace?.role === "owner";

  const load = useCallback(async () => {
    if (!session?.authenticated || !workspace) {
      setData(emptyData);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [members, installations, tokens, audit] = await Promise.all([
        apiFetch<WorkspaceMember[]>(`/v1/workspaces/${workspace.id}/members`, {
          cache: "no-store",
        }),
        apiFetch<GitHubInstallation[]>("/v1/integrations/github/installations", {
          cache: "no-store",
        }),
        owner
          ? apiFetch<ApiTokenMetadata[]>("/v1/auth/tokens", { cache: "no-store" })
          : Promise.resolve([]),
        apiFetch<AuditEvent[]>("/v1/audit-events?limit=50", { cache: "no-store" }),
      ]);
      setData({ members, installations, tokens, audit });
    } catch (cause) {
      setError(apiErrorMessage(cause, "Unable to load workspace settings."));
    } finally {
      setLoading(false);
    }
  }, [owner, session?.authenticated, workspace]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(label: string, operation: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await operation();
      await load();
    } catch (cause) {
      setError(apiErrorMessage(cause, "The workspace change could not be saved."));
    } finally {
      setBusy(null);
    }
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run("workspace", async () => {
      const created = await apiFetch<{ id: string }>("/v1/workspaces", {
        method: "POST",
        body: JSON.stringify({ name: newWorkspace.trim() }),
      });
      await apiFetch("/v1/auth/session/workspace", {
        method: "PUT",
        body: JSON.stringify({ workspaceId: created.id }),
      });
      setNewWorkspace("");
      await refresh();
      router.refresh();
    });
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    await run("member-add", async () => {
      await apiFetch(`/v1/workspaces/${workspace.id}/members`, {
        method: "POST",
        body: JSON.stringify({ login: memberLogin.trim(), role: memberRole }),
      });
      setMemberLogin("");
    });
  }

  async function updateMember(userId: string, role: WorkspaceMember["role"]) {
    if (!workspace) return;
    await run(`member-${userId}`, async () => {
      await apiFetch(`/v1/workspaces/${workspace.id}/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
    });
  }

  async function removeMember(userId: string) {
    if (!workspace) return;
    await run(`member-${userId}`, async () => {
      await apiFetch(`/v1/workspaces/${workspace.id}/members/${userId}`, {
        method: "DELETE",
      });
    });
  }

  async function connectGitHub() {
    await run("github-connect", async () => {
      const result = await apiFetch<{ url: string }>("/v1/integrations/github/install-url");
      window.location.assign(result.url);
    });
  }

  async function disconnectInstallation(installationId: number) {
    await run(`installation-${installationId}`, async () => {
      await apiFetch(`/v1/integrations/github/installations/${installationId}`, {
        method: "DELETE",
      });
    });
  }

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run("token-create", async () => {
      const created = await apiFetch<CreateApiTokenResponse>("/v1/auth/tokens", {
        method: "POST",
        body: JSON.stringify({
          name: tokenName.trim(),
          scopes: ["repo:read", "repo:write"],
          expiresInDays: 90,
        }),
      });
      setRawToken(created.token);
      setTokenName("");
    });
  }

  async function revokeToken(tokenId: string) {
    await run(`token-${tokenId}`, async () => {
      await apiFetch(`/v1/auth/tokens/${tokenId}`, { method: "DELETE" });
    });
  }

  if (authLoading || loading) {
    return (
      <div className="settings-loading">
        <LoaderCircle className="spin" size={20} /> Loading secure workspace settings…
      </div>
    );
  }

  if (!session?.authenticated || !workspace) {
    return (
      <section className="settings-signin">
        <ShieldCheck size={28} />
        <h2>Sign in to create a private workspace.</h2>
        <p>
          GitHub OAuth establishes your identity; RepoVista never stores your GitHub user token.
        </p>
        {session?.capabilities.githubLogin ? (
          <a
            className="primary-button"
            href={`${apiOrigin}/v1/auth/github/start?returnTo=%2Fsettings`}
          >
            <Github size={17} /> Sign in with GitHub
          </a>
        ) : (
          <p className="form-error">GitHub login is not configured on this deployment.</p>
        )}
      </section>
    );
  }

  return (
    <div className="settings-grid">
      {error ? (
        <div className="form-error settings-error" role="alert">
          <AlertCircle size={17} /> {error}
        </div>
      ) : null}

      <section className="settings-card">
        <div className="settings-card-heading">
          <ShieldCheck size={20} />
          <div>
            <h2>Workspace</h2>
            <p>Current authorization boundary for private resources.</p>
          </div>
        </div>
        <dl className="settings-details">
          <div>
            <dt>Name</dt>
            <dd>{workspace.name}</dd>
          </div>
          <div>
            <dt>Kind</dt>
            <dd>{workspace.kind}</dd>
          </div>
          <div>
            <dt>Your role</dt>
            <dd>{workspace.role}</dd>
          </div>
          <div>
            <dt>Visibility</dt>
            <dd>{workspace.visibility}</dd>
          </div>
        </dl>
        <form className="inline-settings-form" onSubmit={(event) => void createWorkspace(event)}>
          <input
            aria-label="New workspace name"
            minLength={2}
            onChange={(event) => setNewWorkspace(event.target.value)}
            placeholder="New team workspace"
            required
            value={newWorkspace}
          />
          <button className="secondary-button" disabled={busy === "workspace"} type="submit">
            <Plus size={16} /> Create
          </button>
        </form>
      </section>

      <section className="settings-card settings-card-wide">
        <div className="settings-card-heading">
          <Users size={20} />
          <div>
            <h2>Members</h2>
            <p>Only owners can change team membership.</p>
          </div>
        </div>
        {owner && workspace.kind === "team" ? (
          <form className="member-add-form" onSubmit={(event) => void addMember(event)}>
            <input
              aria-label="GitHub login"
              onChange={(event) => setMemberLogin(event.target.value)}
              placeholder="GitHub login"
              required
              value={memberLogin}
            />
            <select
              aria-label="Member role"
              onChange={(event) => setMemberRole(event.target.value as typeof memberRole)}
              value={memberRole}
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="owner">Owner</option>
            </select>
            <button className="secondary-button" disabled={busy === "member-add"} type="submit">
              <Plus size={16} /> Add member
            </button>
          </form>
        ) : null}
        <div className="settings-list">
          {data.members.map((member) => (
            <div className="settings-list-row" key={member.userId}>
              <div className="member-identity">
                <span className="member-avatar">
                  {(member.login ?? member.displayName).slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{member.displayName}</strong>
                  <small>@{member.login ?? "local-user"}</small>
                </span>
              </div>
              {owner && workspace.kind === "team" ? (
                <select
                  aria-label={`Role for ${member.login ?? member.displayName}`}
                  disabled={
                    busy === `member-${member.userId}` || member.userId === session.user?.id
                  }
                  onChange={(event) =>
                    void updateMember(member.userId, event.target.value as WorkspaceMember["role"])
                  }
                  value={member.role}
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="owner">Owner</option>
                </select>
              ) : (
                <span className="settings-badge">{member.role}</span>
              )}
              {owner && workspace.kind === "team" && member.userId !== session.user?.id ? (
                <button
                  aria-label={`Remove ${member.login ?? member.displayName}`}
                  className="icon-button danger-text"
                  disabled={busy === `member-${member.userId}`}
                  onClick={() => void removeMember(member.userId)}
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-heading">
          <Github size={20} />
          <div>
            <h2>GitHub App</h2>
            <p>Short-lived credentials for selected repositories.</p>
          </div>
        </div>
        <div className="settings-list compact-list">
          {data.installations.map((installation) => (
            <div className="settings-list-row" key={installation.installationId}>
              <span>
                <strong>{installation.accountLogin}</strong>
                <small>{installation.repositorySelection} repositories</small>
              </span>
              <span
                className={
                  installation.suspendedAt ? "settings-badge danger-text" : "settings-badge"
                }
              >
                {installation.suspendedAt ? "suspended" : "connected"}
              </span>
              {owner ? (
                <button
                  className="icon-button danger-text"
                  onClick={() => void disconnectInstallation(installation.installationId)}
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
        {owner && session.capabilities.githubApp ? (
          <button
            className="secondary-button"
            disabled={busy === "github-connect"}
            onClick={() => void connectGitHub()}
            type="button"
          >
            <Github size={16} /> Connect installation
          </button>
        ) : null}
      </section>

      <section className="settings-card">
        <div className="settings-card-heading">
          <KeyRound size={20} />
          <div>
            <h2>CLI API tokens</h2>
            <p>Workspace-bound and revocable. The secret is shown once.</p>
          </div>
        </div>
        {rawToken ? (
          <div className="raw-token-panel">
            <span>
              <Check size={16} /> Copy this token now
            </span>
            <code>{rawToken}</code>
            <button
              className="secondary-button"
              onClick={() => void navigator.clipboard.writeText(rawToken)}
              type="button"
            >
              <Copy size={15} /> Copy
            </button>
          </div>
        ) : null}
        {owner ? (
          <form className="inline-settings-form" onSubmit={(event) => void createToken(event)}>
            <input
              aria-label="Token name"
              onChange={(event) => setTokenName(event.target.value)}
              placeholder="Laptop CLI"
              required
              value={tokenName}
            />
            <button className="secondary-button" disabled={busy === "token-create"} type="submit">
              <Plus size={16} /> Create
            </button>
          </form>
        ) : null}
        <div className="settings-list compact-list">
          {data.tokens.map((token) => (
            <div className="settings-list-row" key={token.id}>
              <span>
                <strong>{token.name}</strong>
                <small>
                  {token.tokenPrefix}… · {token.scopes.join(", ")}
                </small>
              </span>
              <span className="settings-badge">{token.revokedAt ? "revoked" : "active"}</span>
              {!token.revokedAt ? (
                <button
                  className="icon-button danger-text"
                  onClick={() => void revokeToken(token.id)}
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="settings-card settings-card-wide">
        <div className="settings-card-heading">
          <Activity size={20} />
          <div>
            <h2>Security activity</h2>
            <p>Append-only workspace audit trail.</p>
          </div>
        </div>
        <div className="audit-list">
          {data.audit.map((event) => (
            <div className="audit-row" key={event.id}>
              <span className="audit-dot" />
              <span>
                <strong>{event.action}</strong>
                <small>
                  {event.actorLogin ? `@${event.actorLogin}` : event.actorKind} ·{" "}
                  {event.resourceType}
                </small>
              </span>
              <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
