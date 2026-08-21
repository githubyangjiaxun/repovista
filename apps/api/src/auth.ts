import {
  anonymousPrincipal,
  CSRF_COOKIE,
  equalSecret,
  hashSecret,
  isValidSecret,
  parseCookieHeader,
  SESSION_COOKIE,
} from "@repovista/auth";
import type { AppConfig } from "@repovista/config";
import type { RepoVistaStore, SessionIdentity } from "@repovista/database";
import { DomainError, type Principal } from "@repovista/domain";
import type { FastifyRequest } from "fastify";

export interface RequestAuth {
  principal: Principal;
  identity: SessionIdentity | null;
  csrfToken: string | null;
}

const requestAuth = new WeakMap<FastifyRequest, Promise<RequestAuth>>();

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{35,300})$/.exec(header);
  if (!match?.[1] || !match[1].startsWith("rv_")) {
    throw new DomainError("AUTH_INVALID", "The API authorization token is invalid.");
  }
  return match[1];
}

export async function resolveRequestAuth(
  request: FastifyRequest,
  store: RepoVistaStore,
): Promise<RequestAuth> {
  const cached = requestAuth.get(request);
  if (cached) return cached;
  const resolving = (async (): Promise<RequestAuth> => {
    const cookies = parseCookieHeader(request.headers.cookie);
    const sessionToken = cookies.get(SESSION_COOKIE) ?? null;
    const csrfToken = cookies.get(CSRF_COOKIE) ?? null;
    const bearer = bearerToken(request);
    if (bearer && sessionToken) {
      throw new DomainError(
        "AUTH_AMBIGUOUS",
        "Use either a browser session or an API token, not both.",
      );
    }
    if (bearer) {
      const principal = await store.resolveApiToken(hashSecret(bearer));
      if (!principal) throw new DomainError("AUTH_INVALID", "The API token is invalid or expired.");
      return { principal, identity: null, csrfToken: null };
    }
    if (sessionToken) {
      if (!isValidSecret(sessionToken)) {
        throw new DomainError("AUTH_INVALID", "The browser session is invalid.");
      }
      const identity = await store.resolveSession(hashSecret(sessionToken));
      if (!identity) throw new DomainError("AUTH_EXPIRED", "The browser session has expired.");
      return { principal: identity.principal, identity, csrfToken };
    }
    return { principal: anonymousPrincipal(), identity: null, csrfToken: null };
  })();
  requestAuth.set(request, resolving);
  return resolving;
}

export function requireAuthenticated(auth: RequestAuth): Principal & { userId: string } {
  if (auth.principal.kind === "anonymous" || !auth.principal.userId) {
    throw new DomainError("AUTH_REQUIRED", "Authentication is required.");
  }
  return auth.principal as Principal & { userId: string };
}

export function requireSession(auth: RequestAuth): Principal & {
  kind: "session";
  userId: string;
  sessionId: string;
} {
  if (auth.principal.kind !== "session" || !auth.principal.userId || !auth.principal.sessionId) {
    throw new DomainError("AUTH_SESSION_REQUIRED", "A browser session is required.");
  }
  return auth.principal as Principal & {
    kind: "session";
    userId: string;
    sessionId: string;
  };
}

export function verifySessionCsrf(
  request: FastifyRequest,
  config: AppConfig,
  auth: RequestAuth,
): void {
  if (auth.principal.kind !== "session") return;
  const origin = request.headers.origin;
  const header = request.headers["x-repovista-csrf"];
  const csrfHeader = typeof header === "string" ? header : null;
  const expectedHash = auth.principal.csrfTokenHash;
  if (
    origin !== config.WEB_ORIGIN ||
    !csrfHeader ||
    !auth.csrfToken ||
    !expectedHash ||
    !isValidSecret(csrfHeader) ||
    !equalSecret(csrfHeader, auth.csrfToken) ||
    !equalSecret(hashSecret(csrfHeader), expectedHash)
  ) {
    throw new DomainError("CSRF_INVALID", "The browser request failed CSRF verification.");
  }
}
