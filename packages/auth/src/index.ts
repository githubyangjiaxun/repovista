import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthScope, Principal, WorkspaceRole } from "@repovista/domain";
import { DomainError, PUBLIC_WORKSPACE_ID } from "@repovista/domain";

export const SESSION_COOKIE = "repovista_session";
export const CSRF_COOKIE = "repovista_csrf";
export const OAUTH_STATE_COOKIE = "repovista_oauth_state";
export const INSTALL_STATE_COOKIE = "repovista_install_state";

const tokenPattern = /^[A-Za-z0-9_-]{32,256}$/;

export function hashSecret(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function randomSecret(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 128) {
    throw new DomainError("AUTH_SECRET_INVALID", "The generated secret length is invalid.");
  }
  return randomBytes(bytes).toString("base64url");
}

export function createApiToken(): string {
  return `rv_${randomSecret(32)}`;
}

export function isValidSecret(value: string): boolean {
  return tokenPattern.test(value);
}

export function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function parseCookieHeader(header: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (!header) return result;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(name) || rawValue.length > 1_000) continue;
    try {
      result.set(name, decodeURIComponent(rawValue));
    } catch {
      // Ignore malformed cookies instead of reflecting their bytes.
    }
  }
  return result;
}

export function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAge?: number;
    httpOnly?: boolean;
    sameSite?: "lax" | "strict" | "none";
    secure?: boolean;
    path?: string;
    domain?: string;
  } = {},
): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(name) || !tokenPattern.test(value)) {
    throw new DomainError("AUTH_COOKIE_INVALID", "The authentication cookie value is invalid.");
  }
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? "/"}`];
  if (options.maxAge !== undefined)
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.domain) {
    if (!/^[A-Za-z0-9.-]{1,253}$/.test(options.domain)) {
      throw new DomainError("AUTH_COOKIE_INVALID", "The authentication cookie domain is invalid.");
    }
    parts.push(`Domain=${options.domain}`);
  }
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  parts.push(`SameSite=${(options.sameSite ?? "lax").replace(/^./, (char) => char.toUpperCase())}`);
  return parts.join("; ");
}

export function clearCookie(
  name: string,
  options: { secure?: boolean; domain?: string } = {},
): string {
  return serializeCookie(name, randomSecret(32), {
    ...options,
    maxAge: 0,
    httpOnly: name !== CSRF_COOKIE,
  });
}

export function safeReturnTo(value: string | undefined): string {
  if (
    !value ||
    value.length > 500 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return "/repositories";
  }
  try {
    const parsed = new URL(value, "https://repovista.invalid");
    if (parsed.origin !== "https://repovista.invalid") return "/repositories";
  } catch {
    return "/repositories";
  }
  return value;
}

export function roleAllows(role: WorkspaceRole, required: "read" | "write" | "admin"): boolean {
  if (required === "read") return true;
  if (required === "write") return role === "owner" || role === "editor";
  return role === "owner";
}

export function scopeAllows(scopes: readonly AuthScope[], required: AuthScope): boolean {
  return scopes.includes(required) || scopes.includes("workspace:admin");
}

export function anonymousPrincipal(): Principal {
  return {
    kind: "anonymous",
    userId: null,
    workspaceId: PUBLIC_WORKSPACE_ID,
    role: "viewer",
    scopes: ["repo:read"],
    sessionId: null,
    tokenId: null,
    csrfTokenHash: null,
  };
}

export function requirePrincipalWrite(principal: Principal): void {
  if (principal.kind === "anonymous")
    throw new DomainError(
      "AUTH_REQUIRED",
      "Authentication with workspace write access is required.",
    );
  if (!roleAllows(principal.role, "write"))
    throw new DomainError("WORKSPACE_FORBIDDEN", "Workspace write access is required.");
  if (principal.kind === "token" && !scopeAllows(principal.scopes, "repo:write")) {
    throw new DomainError("WORKSPACE_FORBIDDEN", "The API token does not allow this operation.");
  }
}

export function requirePrincipalAdmin(principal: Principal): void {
  if (principal.kind === "anonymous" || principal.role !== "owner") {
    throw new DomainError("WORKSPACE_FORBIDDEN", "Workspace owner access is required.");
  }
  if (principal.kind === "token" && !scopeAllows(principal.scopes, "workspace:admin")) {
    throw new DomainError("WORKSPACE_FORBIDDEN", "The API token does not allow administration.");
  }
}
