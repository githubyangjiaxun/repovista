import {
  CSRF_COOKIE,
  clearCookie,
  createApiToken,
  hashSecret,
  INSTALL_STATE_COOKIE,
  isValidSecret,
  OAUTH_STATE_COOKIE,
  parseCookieHeader,
  randomSecret,
  requirePrincipalAdmin,
  SESSION_COOKIE,
  safeReturnTo,
  serializeCookie,
} from "@repovista/auth";
import type { AppConfig } from "@repovista/config";
import {
  addWorkspaceMemberRequestSchema,
  createApiTokenRequestSchema,
  createWorkspaceRequestSchema,
  idSchema,
  switchWorkspaceRequestSchema,
  updateWorkspaceMemberRequestSchema,
} from "@repovista/contracts";
import type { RepoVistaStore } from "@repovista/database";
import { DomainError, isDomainError } from "@repovista/domain";
import { exchangeGitHubOAuthCode, type GitHubAppClient } from "@repovista/github";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  requireAuthenticated,
  requireSession,
  resolveRequestAuth,
  verifySessionCsrf,
} from "./auth.js";

const oauthStartQuerySchema = z.object({ returnTo: z.string().max(500).optional() });
const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1).max(500).optional(),
  state: z.string().min(32).max(300).optional(),
  error: z.string().min(1).max(100).optional(),
});
const installSetupQuerySchema = z.object({
  installation_id: z.coerce.number().int().positive(),
  state: z.string().min(32).max(300),
  setup_action: z.string().max(100).optional(),
});
const installationParamsSchema = z.object({ installationId: z.coerce.number().int().positive() });
const installationRepositoriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
const tokenParamsSchema = z.object({ tokenId: idSchema });
const workspaceParamsSchema = z.object({ workspaceId: idSchema });
const workspaceMemberParamsSchema = z.object({ workspaceId: idSchema, userId: idSchema });
const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

function parseInput<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_FAILED", "The request contains invalid input.", {
      details: {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }
  return parsed.data;
}

function response<T>(request: FastifyRequest, data: T) {
  return { data, meta: { requestId: request.id } };
}

function cookieOptions(config: AppConfig) {
  return {
    secure: config.AUTH_COOKIE_SECURE || config.APP_ENV === "production",
    domain: config.AUTH_COOKIE_DOMAIN,
  };
}

function appendCookies(reply: FastifyReply, cookies: string[]): void {
  reply.header("Set-Cookie", cookies);
}

function githubLoginEnabled(config: AppConfig): boolean {
  return Boolean(config.GITHUB_APP_CLIENT_ID && config.GITHUB_APP_CLIENT_SECRET);
}

function oauthErrorCode(error: unknown): string {
  if (!isDomainError(error)) return "OAUTH_FAILED";
  if (error.code === "VALIDATION_FAILED") return "OAUTH_CALLBACK_INVALID";
  const allowed = new Set([
    "AUTH_SIGNUP_DISABLED",
    "GITHUB_API_FAILED",
    "GITHUB_AUTH_DISABLED",
    "GITHUB_IDENTITY_CONFLICT",
    "GITHUB_RATE_LIMITED",
    "OAUTH_ACCESS_DENIED",
    "OAUTH_CALLBACK_INVALID",
    "OAUTH_STATE_INVALID",
  ]);
  return allowed.has(error.code) ? error.code : "OAUTH_FAILED";
}

async function visibleWorkspaces(
  store: RepoVistaStore,
  principal: Awaited<ReturnType<typeof requireAuthenticated>>,
) {
  const workspaces = await store.listUserWorkspaces(principal.userId);
  // An API token is deliberately bound to one workspace.  Do not turn a
  // token-authenticated request into a directory of every workspace the
  // token's creator happens to belong to.
  return principal.kind === "token"
    ? workspaces.filter((workspace) => workspace.id === principal.workspaceId)
    : workspaces;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  dependencies: { config: AppConfig; store: RepoVistaStore; github: GitHubAppClient },
): void {
  const { config, store, github } = dependencies;

  app.get("/v1/auth/github/start", async (request, reply) => {
    if (!githubLoginEnabled(config)) {
      throw new DomainError("GITHUB_AUTH_DISABLED", "GitHub login is disabled on this server.");
    }
    const query = parseInput(oauthStartQuerySchema, request.query);
    const state = randomSecret(32);
    const returnTo = safeReturnTo(query.returnTo);
    await store.createOAuthState(
      hashSecret(state),
      returnTo,
      new Date(Date.now() + config.AUTH_OAUTH_STATE_TTL_SECONDS * 1_000),
    );
    appendCookies(reply, [
      serializeCookie(OAUTH_STATE_COOKIE, state, {
        ...cookieOptions(config),
        maxAge: config.AUTH_OAUTH_STATE_TTL_SECONDS,
        httpOnly: true,
      }),
    ]);
    const target = new URL(
      `${config.GITHUB_OAUTH_ORIGIN.replace(/\/+$/, "")}/login/oauth/authorize`,
    );
    target.searchParams.set("client_id", config.GITHUB_APP_CLIENT_ID as string);
    target.searchParams.set("state", state);
    target.searchParams.set("scope", "read:user user:email");
    return reply.redirect(target.toString());
  });

  app.get("/v1/auth/github/callback", async (request, reply) => {
    try {
      const query = parseInput(oauthCallbackQuerySchema, request.query);
      const cookieState = parseCookieHeader(request.headers.cookie).get(OAUTH_STATE_COOKIE);
      if (
        !query.state ||
        !cookieState ||
        !isValidSecret(cookieState) ||
        cookieState !== query.state
      ) {
        throw new DomainError(
          "OAUTH_STATE_INVALID",
          "The GitHub login state is invalid or expired.",
        );
      }
      const returnTo = await store.consumeOAuthState(hashSecret(query.state));
      if (!returnTo) {
        throw new DomainError(
          "OAUTH_STATE_INVALID",
          "The GitHub login state is invalid or expired.",
        );
      }
      if (query.error) {
        throw new DomainError("OAUTH_ACCESS_DENIED", "GitHub login was cancelled or denied.");
      }
      if (!query.code) {
        throw new DomainError("OAUTH_CALLBACK_INVALID", "The GitHub login callback is incomplete.");
      }
      const profile = await exchangeGitHubOAuthCode(config, query.code);
      const sessionToken = randomSecret(32);
      const csrfToken = randomSecret(32);
      await store.createSessionFromGitHub({
        profile,
        allowSignup: config.AUTH_ALLOW_SIGNUP,
        sessionTokenHash: hashSecret(sessionToken),
        csrfTokenHash: hashSecret(csrfToken),
        expiresAt: new Date(Date.now() + config.AUTH_SESSION_TTL_SECONDS * 1_000),
      });
      appendCookies(reply, [
        serializeCookie(SESSION_COOKIE, sessionToken, {
          ...cookieOptions(config),
          maxAge: config.AUTH_SESSION_TTL_SECONDS,
          httpOnly: true,
        }),
        serializeCookie(CSRF_COOKIE, csrfToken, {
          ...cookieOptions(config),
          maxAge: config.AUTH_SESSION_TTL_SECONDS,
        }),
        clearCookie(OAUTH_STATE_COOKIE, cookieOptions(config)),
      ]);
      return reply.redirect(new URL(returnTo, config.WEB_ORIGIN).toString());
    } catch (error) {
      appendCookies(reply, [clearCookie(OAUTH_STATE_COOKIE, cookieOptions(config))]);
      const target = new URL("/auth/error", config.WEB_ORIGIN);
      target.searchParams.set("code", oauthErrorCode(error));
      return reply.redirect(target.toString());
    }
  });

  app.get("/v1/auth/session", async (request) => {
    const auth = await resolveRequestAuth(request, store);
    const capabilities = {
      githubLogin: githubLoginEnabled(config),
      githubApp: github.enabled(),
      privateRepositories: github.enabled(),
    };
    if (auth.principal.kind === "anonymous") {
      return response(request, {
        authenticated: false,
        user: null,
        workspace: null,
        workspaces: [],
        csrfToken: null,
        capabilities,
      });
    }
    const principal = requireAuthenticated(auth);
    const workspaces = await visibleWorkspaces(store, principal);
    return response(request, {
      authenticated: true,
      user: auth.identity?.user ?? null,
      workspace:
        auth.identity?.workspace ??
        workspaces.find((item) => item.id === principal.workspaceId) ??
        null,
      workspaces,
      csrfToken: auth.principal.kind === "session" ? auth.csrfToken : null,
      capabilities,
    });
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const auth = await resolveRequestAuth(request, store);
    const principal = requireSession(auth);
    verifySessionCsrf(request, config, auth);
    await store.revokeSession(principal.sessionId, principal.userId);
    appendCookies(reply, [
      clearCookie(SESSION_COOKIE, cookieOptions(config)),
      clearCookie(CSRF_COOKIE, cookieOptions(config)),
    ]);
    reply.code(204).send();
  });

  app.get("/v1/workspaces", async (request) => {
    const principal = requireAuthenticated(await resolveRequestAuth(request, store));
    return response(request, await visibleWorkspaces(store, principal));
  });

  app.post("/v1/workspaces", async (request, reply) => {
    const auth = await resolveRequestAuth(request, store);
    const principal = requireSession(auth);
    verifySessionCsrf(request, config, auth);
    const body = parseInput(createWorkspaceRequestSchema, request.body);
    const workspace = await store.createWorkspace(principal.userId, body.name);
    reply.code(201);
    return response(request, workspace);
  });

  app.get("/v1/workspaces/:workspaceId/members", async (request) => {
    const principal = requireAuthenticated(await resolveRequestAuth(request, store));
    const { workspaceId } = parseInput(workspaceParamsSchema, request.params);
    if (workspaceId !== principal.workspaceId) {
      throw new DomainError("WORKSPACE_NOT_FOUND", "The workspace is not available.");
    }
    return response(request, await store.listWorkspaceMembers(workspaceId));
  });

  app.post("/v1/workspaces/:workspaceId/members", async (request, reply) => {
    const auth = await resolveRequestAuth(request, store);
    const principal = requireSession(auth);
    requirePrincipalAdmin(principal);
    verifySessionCsrf(request, config, auth);
    const { workspaceId } = parseInput(workspaceParamsSchema, request.params);
    if (workspaceId !== principal.workspaceId) {
      throw new DomainError("WORKSPACE_NOT_FOUND", "The workspace is not available.");
    }
    const body = parseInput(addWorkspaceMemberRequestSchema, request.body);
    const member = await store.addWorkspaceMember(
      workspaceId,
      principal.userId,
      body.login,
      body.role,
    );
    reply.code(201);
    return response(request, member);
  });

  app.patch("/v1/workspaces/:workspaceId/members/:userId", async (request) => {
    const auth = await resolveRequestAuth(request, store);
    const principal = requireSession(auth);
    requirePrincipalAdmin(principal);
    verifySessionCsrf(request, config, auth);
    const { workspaceId, userId } = parseInput(workspaceMemberParamsSchema, request.params);
    if (workspaceId !== principal.workspaceId) {
      throw new DomainError("WORKSPACE_NOT_FOUND", "The workspace is not available.");
    }
    const body = parseInput(updateWorkspaceMemberRequestSchema, request.body);
    return response(
      request,
      await store.updateWorkspaceMemberRole(workspaceId, principal.userId, userId, body.role),
    );
  });

  app.delete("/v1/workspaces/:workspaceId/members/:userId", async (request, reply) => {
    const auth = await resolveRequestAuth(request, store);
    const principal = requireSession(auth);
    requirePrincipalAdmin(principal);
    verifySessionCsrf(request, config, auth);
    const { workspaceId, userId } = parseInput(workspaceMemberParamsSchema, request.params);
    if (workspaceId !== principal.workspaceId) {
      throw new DomainError("WORKSPACE_NOT_FOUND", "The workspace is not available.");
    }
    await store.removeWorkspaceMember(workspaceId, principal.userId, userId);
    reply.code(204).send();
  });

  app.put("/v1/auth/session/workspace", async (request) => {
    const auth = await resolveRequestAuth(request, store);
    const principal = requireSession(auth);
    verifySessionCsrf(request, config, auth);
    const body = parseInput(switchWorkspaceRequestSchema, request.body);
    return response(
      request,
      await store.switchSessionWorkspace(principal.sessionId, principal.userId, body.workspaceId),
    );
  });

  app.get("/v1/audit-events", async (request) => {
    const principal = requireAuthenticated(await resolveRequestAuth(request, store));
    const query = parseInput(auditQuerySchema, request.query);
    return response(request, await store.listAuditEvents(principal.workspaceId, query.limit));
  });

  app.get("/v1/auth/tokens", async (request) => {
    const auth = await resolveRequestAuth(request, store);
    const principal = requireSession(auth);
    requirePrincipalAdmin(principal);
    return response(request, await store.listApiTokens(principal.workspaceId));
  });

  app.post("/v1/auth/tokens", async (request, reply) => {
    const auth = await resolveRequestAuth(request, store);
    const principal = requireSession(auth);
    requirePrincipalAdmin(principal);
    verifySessionCsrf(request, config, auth);
    const body = parseInput(createApiTokenRequestSchema, request.body);
    const token = createApiToken();
    const days = body.expiresInDays ?? config.AUTH_TOKEN_TTL_DAYS;
    const metadata = await store.createApiToken({
      workspaceId: principal.workspaceId,
      userId: principal.userId,
      name: body.name,
      tokenPrefix: token.slice(0, 11),
      tokenHash: hashSecret(token),
      scopes: body.scopes,
      expiresAt: days ? new Date(Date.now() + days * 86_400_000) : null,
    });
    reply.code(201);
    return response(request, { token, metadata });
  });

  app.delete("/v1/auth/tokens/:tokenId", async (request, reply) => {
    const auth = await resolveRequestAuth(request, store);
    const principal = requireSession(auth);
    requirePrincipalAdmin(principal);
    verifySessionCsrf(request, config, auth);
    const { tokenId } = parseInput(tokenParamsSchema, request.params);
    if (!(await store.revokeApiToken(principal.workspaceId, tokenId, principal.userId))) {
      throw new DomainError("AUTH_TOKEN_NOT_FOUND", "The API token does not exist.");
    }
    reply.code(204).send();
  });

  app.get("/v1/integrations/github/install-url", async (request, reply) => {
    const auth = await resolveRequestAuth(request, store);
    const principal = requireSession(auth);
    requirePrincipalAdmin(principal);
    const state = randomSecret(32);
    await store.createInstallationState(
      hashSecret(state),
      principal.workspaceId,
      principal.userId,
      "/settings?tab=github",
      new Date(Date.now() + config.AUTH_OAUTH_STATE_TTL_SECONDS * 1_000),
    );
    appendCookies(reply, [
      serializeCookie(INSTALL_STATE_COOKIE, state, {
        ...cookieOptions(config),
        maxAge: config.AUTH_OAUTH_STATE_TTL_SECONDS,
        httpOnly: true,
      }),
    ]);
    return response(request, { url: github.installUrl(state) });
  });

  app.get("/v1/integrations/github/setup", async (request, reply) => {
    const auth = await resolveRequestAuth(request, store);
    const principal = requireSession(auth);
    requirePrincipalAdmin(principal);
    const query = parseInput(installSetupQuerySchema, request.query);
    const cookieState = parseCookieHeader(request.headers.cookie).get(INSTALL_STATE_COOKIE);
    if (!cookieState || !isValidSecret(cookieState) || cookieState !== query.state) {
      throw new DomainError(
        "OAUTH_STATE_INVALID",
        "The GitHub installation state is invalid or expired.",
      );
    }
    const state = await store.consumeInstallationState(hashSecret(query.state));
    if (
      !state ||
      state.userId !== principal.userId ||
      state.workspaceId !== principal.workspaceId
    ) {
      throw new DomainError(
        "OAUTH_STATE_INVALID",
        "The GitHub installation state is invalid or expired.",
      );
    }
    const installation = await github.getInstallation(query.installation_id);
    await store.upsertGitHubInstallation({
      installationId: installation.id,
      workspaceId: state.workspaceId,
      accountId: installation.account.id,
      accountLogin: installation.account.login,
      accountType: installation.account.type,
      repositorySelection: installation.repository_selection,
      permissions: installation.permissions,
      installedBy: principal.userId,
      suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null,
    });
    appendCookies(reply, [clearCookie(INSTALL_STATE_COOKIE, cookieOptions(config))]);
    return reply.redirect(new URL(state.returnTo, config.WEB_ORIGIN).toString());
  });

  app.get("/v1/integrations/github/installations", async (request) => {
    const principal = requireAuthenticated(await resolveRequestAuth(request, store));
    return response(request, await store.listGitHubInstallations(principal.workspaceId));
  });

  app.get("/v1/integrations/github/installations/:installationId/repositories", async (request) => {
    const principal = requireAuthenticated(await resolveRequestAuth(request, store));
    const { installationId } = parseInput(installationParamsSchema, request.params);
    const query = parseInput(installationRepositoriesQuerySchema, request.query);
    const installation = await store.getGitHubInstallation(principal.workspaceId, installationId);
    if (!installation) {
      throw new DomainError(
        "GITHUB_INSTALLATION_NOT_FOUND",
        "The GitHub installation is unavailable.",
      );
    }
    if (installation.suspendedAt) {
      throw new DomainError(
        "GITHUB_INSTALLATION_SUSPENDED",
        "The GitHub installation is suspended.",
      );
    }
    return response(
      request,
      await github.listInstallationRepositories(installationId, query.page, query.pageSize),
    );
  });

  app.delete("/v1/integrations/github/installations/:installationId", async (request, reply) => {
    const auth = await resolveRequestAuth(request, store);
    const principal = requireSession(auth);
    requirePrincipalAdmin(principal);
    verifySessionCsrf(request, config, auth);
    const { installationId } = parseInput(installationParamsSchema, request.params);
    if (
      !(await store.disconnectGitHubInstallation(
        principal.workspaceId,
        installationId,
        principal.userId,
      ))
    ) {
      throw new DomainError(
        "GITHUB_INSTALLATION_NOT_FOUND",
        "The GitHub installation is unavailable.",
      );
    }
    reply.code(204).send();
  });
}
