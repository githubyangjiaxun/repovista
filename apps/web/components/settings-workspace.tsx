"use client";

import type {
  ApiTokenMetadata,
  AuditEvent,
  CreateApiTokenResponse,
  GitHubInstallation,
  NotificationAdapter,
  NotificationDelivery,
  NotificationEndpoint,
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
  Send,
  ShieldCheck,
  Trash2,
  Users,
  Webhook,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  apiErrorMessage,
  apiFetch,
  apiOrigin,
  createNotificationEndpoint,
  deleteNotificationEndpoint,
  listNotificationDeliveries,
  listNotificationEndpoints,
  testNotificationEndpoint,
  updateNotificationEndpoint,
} from "@/lib/api";

type SettingsData = {
  members: WorkspaceMember[];
  installations: GitHubInstallation[];
  tokens: ApiTokenMetadata[];
  audit: AuditEvent[];
  notificationEndpoints: NotificationEndpoint[];
  notificationDeliveries: NotificationDelivery[];
};

const emptyData: SettingsData = {
  members: [],
  installations: [],
  tokens: [],
  audit: [],
  notificationEndpoints: [],
  notificationDeliveries: [],
};

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
  const [notificationName, setNotificationName] = useState("");
  const [notificationUrl, setNotificationUrl] = useState("");
  const [notificationAdapter, setNotificationAdapter] = useState<NotificationAdapter>("generic");
  const [notificationUpdated, setNotificationUpdated] = useState(true);
  const [notificationCleared, setNotificationCleared] = useState(true);
  const [notificationSecret, setNotificationSecret] = useState<string | null>(null);
  const [editingEndpointId, setEditingEndpointId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingUrl, setEditingUrl] = useState("");
  const [editingAdapter, setEditingAdapter] = useState<NotificationAdapter>("generic");
  const [editingUpdated, setEditingUpdated] = useState(true);
  const [editingCleared, setEditingCleared] = useState(true);
  const [notificationBatchUpdated, setNotificationBatchUpdated] = useState(true);
  const [editingBatchUpdated, setEditingBatchUpdated] = useState(true);
  const workspace = session?.workspace ?? null;
  const owner = workspace?.role === "owner";
  const canTestNotifications = workspace?.role !== "viewer";

  const load = useCallback(async () => {
    if (!session?.authenticated || !workspace) {
      setData(emptyData);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [members, installations, tokens, audit, notificationEndpoints, notificationDeliveries] =
        await Promise.all([
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
          listNotificationEndpoints(workspace.id).catch(() => []),
          listNotificationDeliveries(workspace.id, { limit: 50 })
            .then((page) => page.deliveries)
            .catch(() => []),
        ]);
      setData({
        members,
        installations,
        tokens,
        audit,
        notificationEndpoints,
        notificationDeliveries,
      });
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

  async function createNotification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !notificationName.trim() || !notificationUrl.trim()) return;
    const eventTypes = [
      ...(notificationUpdated ? (["guardrail_review.updated"] as const) : []),
      ...(notificationCleared ? (["guardrail_review.cleared"] as const) : []),
      ...(notificationBatchUpdated ? (["guardrail_review.batch_updated"] as const) : []),
    ];
    if (eventTypes.length === 0) {
      setError("Select at least one notification event.");
      return;
    }
    await run("notification-create", async () => {
      const created = await createNotificationEndpoint(workspace.id, {
        name: notificationName.trim(),
        url: notificationUrl.trim(),
        adapter: notificationAdapter,
        eventTypes,
      });
      setNotificationSecret(created.signingSecret);
      setNotificationName("");
      setNotificationUrl("");
    });
  }

  function beginEdit(endpoint: NotificationEndpoint): void {
    setEditingEndpointId(endpoint.id);
    setEditingName(endpoint.name);
    setEditingUrl(endpoint.url);
    setEditingAdapter(endpoint.adapter);
    setEditingUpdated(endpoint.eventTypes.includes("guardrail_review.updated"));
    setEditingCleared(endpoint.eventTypes.includes("guardrail_review.cleared"));
    setEditingBatchUpdated(endpoint.eventTypes.includes("guardrail_review.batch_updated"));
  }

  async function saveNotificationEdit(event: FormEvent<HTMLFormElement>, endpointId: string) {
    event.preventDefault();
    if (!workspace || !editingName.trim() || !editingUrl.trim()) return;
    const eventTypes = [
      ...(editingUpdated ? (["guardrail_review.updated"] as const) : []),
      ...(editingCleared ? (["guardrail_review.cleared"] as const) : []),
      ...(editingBatchUpdated ? (["guardrail_review.batch_updated"] as const) : []),
    ];
    if (eventTypes.length === 0) {
      setError("Select at least one notification event.");
      return;
    }
    await run(`notification-edit-${endpointId}`, async () => {
      await updateNotificationEndpoint(workspace.id, endpointId, {
        name: editingName.trim(),
        url: editingUrl.trim(),
        adapter: editingAdapter,
        eventTypes,
      });
      setEditingEndpointId(null);
    });
  }

  async function toggleNotification(endpoint: NotificationEndpoint) {
    if (!workspace) return;
    await run(`notification-toggle-${endpoint.id}`, async () => {
      await updateNotificationEndpoint(workspace.id, endpoint.id, { enabled: !endpoint.enabled });
    });
  }

  async function removeNotification(endpointId: string) {
    if (!workspace) return;
    await run(`notification-delete-${endpointId}`, async () => {
      await deleteNotificationEndpoint(workspace.id, endpointId);
    });
  }

  async function sendNotificationTest(endpointId: string) {
    if (!workspace) return;
    await run(`notification-test-${endpointId}`, async () => {
      await testNotificationEndpoint(workspace.id, endpointId);
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

      <section className="settings-card settings-card-wide" aria-label="Notification endpoints">
        <div className="settings-card-heading">
          <Webhook size={20} />
          <div>
            <h2>Signed notification Webhooks</h2>
            <p>
              Review changes are delivered asynchronously. Payloads never include review note text,
              source code, model output, or credentials.
            </p>
          </div>
        </div>
        {owner ? (
          <form
            className="notification-endpoint-form"
            onSubmit={(event) => void createNotification(event)}
          >
            <input
              aria-label="Notification endpoint name"
              onChange={(event) => setNotificationName(event.target.value)}
              placeholder="Team review relay"
              required
              value={notificationName}
            />
            <input
              aria-label="Notification endpoint URL"
              onChange={(event) => setNotificationUrl(event.target.value)}
              placeholder="https://hooks.example.test/repovista"
              required
              type="url"
              value={notificationUrl}
            />
            <label>
              <span>Adapter</span>
              <select
                aria-label="Notification adapter"
                onChange={(event) =>
                  setNotificationAdapter(event.target.value as NotificationAdapter)
                }
                value={notificationAdapter}
              >
                <option value="generic">Generic Webhook</option>
                <option value="slack">Slack Incoming Webhook</option>
              </select>
            </label>
            <label>
              <input
                checked={notificationUpdated}
                onChange={(event) => setNotificationUpdated(event.target.checked)}
                type="checkbox"
              />
              Review updated
            </label>
            <label>
              <input
                checked={notificationCleared}
                onChange={(event) => setNotificationCleared(event.target.checked)}
                type="checkbox"
              />
              Review cleared
            </label>
            <label>
              <input
                checked={notificationBatchUpdated}
                onChange={(event) => setNotificationBatchUpdated(event.target.checked)}
                type="checkbox"
              />
              Batch review updated
            </label>
            <button
              className="secondary-button"
              disabled={busy === "notification-create"}
              type="submit"
            >
              <Plus size={16} /> Add endpoint
            </button>
          </form>
        ) : null}
        {notificationSecret ? (
          <output className="raw-token-panel notification-secret-panel">
            <span>
              <Check size={16} /> Save this signing secret now; it is shown only once.
            </span>
            <code>{notificationSecret}</code>
            <button
              className="secondary-button"
              onClick={() => void navigator.clipboard.writeText(notificationSecret)}
              type="button"
            >
              <Copy size={15} /> Copy secret
            </button>
            <button
              className="icon-button"
              onClick={() => setNotificationSecret(null)}
              type="button"
            >
              Dismiss
            </button>
          </output>
        ) : null}
        <div className="settings-list notification-endpoint-list">
          {data.notificationEndpoints.length === 0 ? (
            <p className="settings-empty">No notification endpoints configured.</p>
          ) : (
            data.notificationEndpoints.map((endpoint) => (
              <div className="notification-endpoint-row" key={endpoint.id}>
                {editingEndpointId === endpoint.id ? (
                  <form onSubmit={(event) => void saveNotificationEdit(event, endpoint.id)}>
                    <input
                      aria-label={`Edit name for ${endpoint.name}`}
                      onChange={(event) => setEditingName(event.target.value)}
                      required
                      value={editingName}
                    />
                    <input
                      aria-label={`Edit URL for ${endpoint.name}`}
                      onChange={(event) => setEditingUrl(event.target.value)}
                      required
                      type="url"
                      value={editingUrl}
                    />
                    <label>
                      <span>Adapter</span>
                      <select
                        aria-label={`Edit adapter for ${endpoint.name}`}
                        onChange={(event) =>
                          setEditingAdapter(event.target.value as NotificationAdapter)
                        }
                        value={editingAdapter}
                      >
                        <option value="generic">Generic Webhook</option>
                        <option value="slack">Slack Incoming Webhook</option>
                      </select>
                    </label>
                    <label>
                      <input
                        checked={editingUpdated}
                        onChange={(event) => setEditingUpdated(event.target.checked)}
                        type="checkbox"
                      />
                      Updated
                    </label>
                    <label>
                      <input
                        checked={editingCleared}
                        onChange={(event) => setEditingCleared(event.target.checked)}
                        type="checkbox"
                      />
                      Cleared
                    </label>
                    <label>
                      <input
                        checked={editingBatchUpdated}
                        onChange={(event) => setEditingBatchUpdated(event.target.checked)}
                        type="checkbox"
                      />
                      Batch updated
                    </label>
                    <button className="secondary-button" type="submit">
                      <Check size={14} /> Save
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => setEditingEndpointId(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <div>
                      <strong>{endpoint.name}</strong>
                      <small>{endpoint.url}</small>
                      <small>Adapter: {endpoint.adapter}</small>
                      <small>{endpoint.eventTypes.join(", ")}</small>
                    </div>
                    <span className="settings-badge">
                      {endpoint.enabled ? "enabled" : "disabled"}
                    </span>
                    <span className="settings-badge">
                      {endpoint.lastDeliveryStatus ?? "no deliveries"}
                    </span>
                    {owner ? (
                      <>
                        <button
                          className="icon-button"
                          disabled={busy === `notification-toggle-${endpoint.id}`}
                          onClick={() => void toggleNotification(endpoint)}
                          type="button"
                        >
                          {endpoint.enabled ? "Disable" : "Enable"}
                        </button>
                        <button
                          className="icon-button"
                          onClick={() => beginEdit(endpoint)}
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          aria-label={`Delete ${endpoint.name}`}
                          className="icon-button danger-text"
                          disabled={busy === `notification-delete-${endpoint.id}`}
                          onClick={() => void removeNotification(endpoint.id)}
                          type="button"
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    ) : null}
                    {canTestNotifications ? (
                      <button
                        className="icon-button"
                        disabled={busy === `notification-test-${endpoint.id}`}
                        onClick={() => void sendNotificationTest(endpoint.id)}
                        type="button"
                      >
                        <Send size={14} /> Test
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            ))
          )}
        </div>
        {data.notificationDeliveries.length > 0 ? (
          <div className="notification-delivery-list">
            <h3>Recent deliveries</h3>
            {data.notificationDeliveries.slice(0, 20).map((delivery) => (
              <div className="audit-row" key={delivery.id}>
                <span className="audit-dot" />
                <span>
                  <strong>{delivery.eventType}</strong>
                  <small>
                    {delivery.adapter} · {delivery.status} · {delivery.attemptCount}/
                    {delivery.maxAttempts} attempts · HTTP {delivery.lastStatusCode ?? "—"}
                  </small>
                </span>
                <time dateTime={delivery.updatedAt}>
                  {new Date(delivery.updatedAt).toLocaleString()}
                </time>
              </div>
            ))}
          </div>
        ) : null}
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
