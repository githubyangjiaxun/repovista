import { createPrivateKey, sign } from "node:crypto";
import type { AppConfig } from "@repovista/config";
import { DomainError } from "@repovista/domain";
import { z } from "zod";

const githubUserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1).max(100),
  name: z.string().nullable(),
  avatar_url: z.url().nullable(),
  html_url: z.url(),
  email: z.string().email().nullable().optional(),
});

const githubEmailSchema = z.object({
  email: z.string().email(),
  primary: z.boolean(),
  verified: z.boolean(),
});

const installationSchema = z.object({
  id: z.number().int().positive(),
  account: z.object({
    id: z.number().int().positive(),
    login: z.string().min(1).max(100),
    type: z.enum(["User", "Organization"]),
  }),
  repository_selection: z.enum(["all", "selected"]),
  permissions: z.record(z.string(), z.string()),
  suspended_at: z.string().nullable(),
});

const installationTokenSchema = z.object({
  token: z.string().min(20),
  expires_at: z.iso.datetime(),
});

const installationRepositorySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  full_name: z.string().min(3),
  private: z.boolean(),
  html_url: z.url(),
  clone_url: z.url(),
  default_branch: z.string().min(1),
  owner: z.object({ login: z.string().min(1) }),
});

const installationRepositoriesSchema = z.object({
  total_count: z.number().int().nonnegative(),
  repositories: z.array(installationRepositorySchema),
});

export type GitHubInstallationMetadata = z.infer<typeof installationSchema>;
export type GitHubInstallationRepository = z.infer<typeof installationRepositorySchema>;

export interface GitHubUserProfile {
  providerUserId: string;
  login: string;
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
  profileUrl: string;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function requireAppConfig(config: AppConfig): asserts config is AppConfig & {
  GITHUB_APP_ID: number;
  GITHUB_APP_PRIVATE_KEY: string;
} {
  if (!config.GITHUB_APP_ID || !config.GITHUB_APP_PRIVATE_KEY) {
    throw new DomainError("GITHUB_APP_DISABLED", "GitHub App installation access is disabled.", {
      retryable: true,
    });
  }
}

function requireOAuthConfig(config: AppConfig): asserts config is AppConfig & {
  GITHUB_APP_CLIENT_ID: string;
  GITHUB_APP_CLIENT_SECRET: string;
} {
  if (!config.GITHUB_APP_CLIENT_ID || !config.GITHUB_APP_CLIENT_SECRET) {
    throw new DomainError("GITHUB_AUTH_DISABLED", "GitHub login is disabled on this server.", {
      retryable: true,
    });
  }
}

export function createGitHubAppJwt(config: AppConfig, now = new Date()): string {
  requireAppConfig(config);
  const issuedAt = Math.floor(now.getTime() / 1_000) - 30;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: issuedAt, exp: issuedAt + 540, iss: String(config.GITHUB_APP_ID) }),
  );
  let signature: Buffer;
  try {
    const key = createPrivateKey(config.GITHUB_APP_PRIVATE_KEY.replaceAll("\\n", "\n"));
    signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), key);
  } catch (cause) {
    throw new DomainError("GITHUB_PRIVATE_KEY_INVALID", "The GitHub App private key is invalid.", {
      cause,
    });
  }
  return `${header}.${payload}.${base64url(signature)}`;
}

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "RepoVista/0.5",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubJson<T>(
  schema: z.ZodType<T>,
  url: string,
  init: RequestInit,
  resource: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    throw new DomainError("GITHUB_API_FAILED", `GitHub could not load ${resource}.`, {
      retryable: true,
      cause,
    });
  }
  if (!response.ok) {
    if (response.status === 404) {
      throw new DomainError(
        "GITHUB_INSTALLATION_NOT_FOUND",
        "The GitHub installation is unavailable.",
      );
    }
    if (response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0") {
      throw new DomainError("GITHUB_RATE_LIMITED", "GitHub API rate limit was exhausted.", {
        retryable: true,
      });
    }
    throw new DomainError("GITHUB_API_FAILED", `GitHub could not load ${resource}.`, {
      retryable: response.status >= 500,
      details: { status: response.status },
    });
  }
  const payload = await response.json().catch(() => null);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new DomainError("GITHUB_API_FAILED", `GitHub returned invalid ${resource}.`);
  }
  return parsed.data;
}

export async function exchangeGitHubOAuthCode(
  config: AppConfig,
  code: string,
): Promise<GitHubUserProfile> {
  requireOAuthConfig(config);
  const tokenPayload = await githubJson(
    z.object({ access_token: z.string().min(20) }),
    `${config.GITHUB_OAUTH_ORIGIN.replace(/\/+$/, "")}/login/oauth/access_token`,
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: config.GITHUB_APP_CLIENT_ID,
        client_secret: config.GITHUB_APP_CLIENT_SECRET,
        code,
      }),
    },
    "OAuth token",
  );
  const [user, emails] = await Promise.all([
    githubJson(
      githubUserSchema,
      `${config.GITHUB_API_ORIGIN.replace(/\/+$/, "")}/user`,
      { headers: githubHeaders(tokenPayload.access_token) },
      "user profile",
    ),
    githubJson(
      z.array(githubEmailSchema),
      `${config.GITHUB_API_ORIGIN.replace(/\/+$/, "")}/user/emails`,
      { headers: githubHeaders(tokenPayload.access_token) },
      "verified email",
    ).catch(() => []),
  ]);
  const primaryEmail =
    emails.find((item) => item.primary && item.verified)?.email ?? user.email ?? null;
  return {
    providerUserId: String(user.id),
    login: user.login,
    displayName: user.name?.trim() || user.login,
    avatarUrl: user.avatar_url,
    email: primaryEmail,
    profileUrl: user.html_url,
  };
}

export class GitHubAppClient {
  private readonly tokenCache = new Map<number, { token: string; expiresAt: number }>();
  private readonly pending = new Map<number, Promise<string>>();

  constructor(private readonly config: AppConfig) {}

  enabled(): boolean {
    return Boolean(this.config.GITHUB_APP_ID && this.config.GITHUB_APP_PRIVATE_KEY);
  }

  installUrl(state: string): string {
    if (!this.config.GITHUB_APP_SLUG) {
      throw new DomainError("GITHUB_APP_DISABLED", "GitHub App installation access is disabled.");
    }
    const url = new URL(`https://github.com/apps/${this.config.GITHUB_APP_SLUG}/installations/new`);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async getInstallation(installationId: number): Promise<GitHubInstallationMetadata> {
    const jwt = createGitHubAppJwt(this.config);
    return githubJson(
      installationSchema,
      `${this.config.GITHUB_API_ORIGIN.replace(/\/+$/, "")}/app/installations/${installationId}`,
      { headers: githubHeaders(jwt) },
      "installation",
    );
  }

  async installationToken(installationId: number): Promise<string> {
    const now = Date.now();
    const cached = this.tokenCache.get(installationId);
    if (cached && cached.expiresAt - 60_000 > now) return cached.token;
    const existing = this.pending.get(installationId);
    if (existing) return existing;
    const request = (async () => {
      const jwt = createGitHubAppJwt(this.config);
      const payload = await githubJson(
        installationTokenSchema,
        `${this.config.GITHUB_API_ORIGIN.replace(/\/+$/, "")}/app/installations/${installationId}/access_tokens`,
        { method: "POST", headers: githubHeaders(jwt) },
        "installation token",
      );
      this.tokenCache.set(installationId, {
        token: payload.token,
        expiresAt: new Date(payload.expires_at).getTime(),
      });
      return payload.token;
    })();
    this.pending.set(installationId, request);
    try {
      return await request;
    } finally {
      this.pending.delete(installationId);
    }
  }

  async listInstallationRepositories(
    installationId: number,
    page = 1,
    perPage = 50,
  ): Promise<{ repositories: GitHubInstallationRepository[]; totalCount: number }> {
    const token = await this.installationToken(installationId);
    const url = new URL(
      `${this.config.GITHUB_API_ORIGIN.replace(/\/+$/, "")}/installation/repositories`,
    );
    url.searchParams.set("page", String(Math.max(1, page)));
    url.searchParams.set("per_page", String(Math.min(100, Math.max(1, perPage))));
    const payload = await githubJson(
      installationRepositoriesSchema,
      url.toString(),
      { headers: githubHeaders(token) },
      "installation repositories",
    );
    return { repositories: payload.repositories, totalCount: payload.total_count };
  }

  async getInstallationRepository(
    installationId: number,
    owner: string,
    name: string,
  ): Promise<GitHubInstallationRepository> {
    const token = await this.installationToken(installationId);
    return githubJson(
      installationRepositorySchema,
      `${this.config.GITHUB_API_ORIGIN.replace(/\/+$/, "")}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      { headers: githubHeaders(token) },
      "installation repository",
    );
  }
}
