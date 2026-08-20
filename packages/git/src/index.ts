import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DomainError, type GitHubRepositoryIdentity, type ScannedFile } from "@repovista/domain";

const executeFile = promisify(execFile);
const githubHosts = new Set(["github.com", "www.github.com"]);
const fullCommitSha = /^[a-f0-9]{40}$/i;
const ignoredSegments = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
]);

export function parseGitHubUrl(rawUrl: string): GitHubRepositoryIdentity {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new DomainError("REPOSITORY_URL_INVALID", "The repository URL is invalid.", {
      cause: error,
    });
  }

  if (parsed.protocol !== "https:" || !githubHosts.has(parsed.hostname.toLowerCase())) {
    throw new DomainError(
      "REPOSITORY_HOST_NOT_ALLOWED",
      "Only public HTTPS GitHub repository URLs are supported.",
    );
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new DomainError(
      "REPOSITORY_URL_CREDENTIALS",
      "Repository URLs must not include credentials, query parameters, or fragments.",
    );
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) {
    throw new DomainError(
      "REPOSITORY_URL_INVALID",
      "A repository URL must contain one owner and one repository name.",
    );
  }
  const owner = parts[0];
  const rawName = parts[1];
  if (!owner || !rawName) {
    throw new DomainError("REPOSITORY_URL_INVALID", "Repository owner and name are required.");
  }
  const name = rawName.replace(/\.git$/i, "");
  const validPart = /^[A-Za-z0-9_.-]+$/;
  if (!validPart.test(owner) || !validPart.test(name)) {
    throw new DomainError("REPOSITORY_URL_INVALID", "Repository owner or name is invalid.");
  }
  const canonicalUrl = `https://github.com/${owner}/${name}`;
  return {
    owner,
    name,
    canonicalUrl,
    cloneUrl: `${canonicalUrl}.git`,
  };
}

export function languageForPath(filePath: string): string | null {
  const extension = path.extname(filePath).toLowerCase();
  const languages: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".go": "go",
    ".mod": "go-mod",
    ".json": "json",
    ".md": "markdown",
    ".css": "css",
    ".scss": "scss",
    ".html": "html",
  };
  return languages[extension] ?? null;
}

function matchesIgnore(filePath: string, patterns: readonly string[]): boolean {
  const normalized = filePath.split(path.sep).join("/");
  if (normalized.split("/").some((segment) => ignoredSegments.has(segment))) {
    return true;
  }
  if (patterns.some((pattern) => normalized === pattern || normalized.startsWith(`${pattern}/`))) {
    return true;
  }
  const baseName = path.posix.basename(normalized);
  return (
    baseName === ".env" ||
    baseName.startsWith(".env.") ||
    baseName.endsWith(".pem") ||
    baseName.endsWith(".key")
  );
}

export async function createWorkspace(prefix = "repovista-"): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function removeWorkspace(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}

export interface ScanWorkspaceOptions {
  directory: string;
  maxFiles: number;
  maxBytes: number;
  maxFileBytes: number;
  ignore?: readonly string[];
}

export async function scanWorkspace(options: ScanWorkspaceOptions): Promise<ScannedFile[]> {
  const files: ScannedFile[] = [];
  let totalBytes = 0;

  async function visit(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      const relativePath = path.relative(options.directory, absolutePath);
      if (matchesIgnore(relativePath, options.ignore ?? [])) continue;
      if (entry.isSymbolicLink()) {
        throw new DomainError(
          "REPOSITORY_SYMLINK_REJECTED",
          `Symbolic links are not allowed: ${relativePath}`,
        );
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const fileStat = await stat(absolutePath);
      if (fileStat.size > options.maxFileBytes) continue;
      totalBytes += fileStat.size;
      if (totalBytes > options.maxBytes) {
        throw new DomainError("REPOSITORY_TOO_LARGE", "Repository exceeds the byte limit.", {
          details: { maxBytes: options.maxBytes },
        });
      }
      if (files.length >= options.maxFiles) {
        throw new DomainError("REPOSITORY_TOO_LARGE", "Repository exceeds the file limit.", {
          details: { maxFiles: options.maxFiles },
        });
      }

      const contentBuffer = await readFile(absolutePath);
      if (contentBuffer.includes(0)) continue;
      const content = contentBuffer.toString("utf8");
      files.push({
        path: relativePath.split(path.sep).join("/"),
        absolutePath,
        language: languageForPath(relativePath),
        byteSize: fileStat.size,
        lineCount: content.length === 0 ? 0 : content.split(/\r?\n/).length,
        content,
        contentHash: `sha256:${createHash("sha256").update(contentBuffer).digest("hex")}`,
        isGenerated: false,
      });
    }
  }

  await visit(options.directory);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export interface CloneRepositoryOptions {
  cloneUrl: string;
  destination: string;
  ref?: string | null;
  timeoutMs: number;
}

function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_ALLOW_PROTOCOL: "https",
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function gitArgs(...args: string[]): string[] {
  return [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "credential.helper=",
    // Pin the transport independently of user/system Git configuration. Besides making clone
    // behavior reproducible, HTTP/1.1 avoids known HTTP/2 stalls seen with GitHub through some
    // corporate/local proxy stacks while preserving the same HTTPS-only security boundary.
    "-c",
    "http.version=HTTP/1.1",
    ...args,
  ];
}

async function cloneCommit(options: CloneRepositoryOptions, environment: NodeJS.ProcessEnv) {
  await executeFile("git", gitArgs("init", "--quiet", "--", options.destination), {
    env: environment,
    timeout: 10_000,
  });
  await executeFile(
    "git",
    gitArgs("-C", options.destination, "remote", "add", "origin", options.cloneUrl),
    { env: environment, timeout: 10_000 },
  );
  await executeFile(
    "git",
    gitArgs(
      "-C",
      options.destination,
      "fetch",
      "--depth",
      "1",
      "--filter=blob:none",
      "--no-tags",
      "origin",
      options.ref as string,
    ),
    {
      env: environment,
      timeout: options.timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  await executeFile(
    "git",
    gitArgs("-C", options.destination, "checkout", "--quiet", "--detach", "FETCH_HEAD"),
    { env: environment, timeout: 30_000 },
  );
}

export async function cloneRepository(
  options: CloneRepositoryOptions,
): Promise<{ commitSha: string; branch: string | null }> {
  const args = gitArgs(
    "clone",
    "--depth",
    "1",
    "--filter=blob:none",
    "--no-tags",
    "--single-branch",
  );
  if (options.ref) {
    args.push("--branch", options.ref);
  }
  args.push("--", options.cloneUrl, options.destination);

  const environment = gitEnvironment();
  try {
    if (options.ref && fullCommitSha.test(options.ref)) {
      await cloneCommit(options, environment);
    } else {
      await executeFile("git", args, {
        env: environment,
        timeout: options.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
      });
    }
    const commit = await executeFile("git", gitArgs("rev-parse", "HEAD"), {
      cwd: options.destination,
      env: environment,
      timeout: 10_000,
    });
    const branch = await executeFile("git", gitArgs("branch", "--show-current"), {
      cwd: options.destination,
      env: environment,
      timeout: 10_000,
    });
    const commitSha = commit.stdout.trim();
    if (!fullCommitSha.test(commitSha)) {
      throw new DomainError("REPOSITORY_COMMIT_INVALID", "Git returned an invalid commit SHA.");
    }
    return {
      commitSha,
      branch: branch.stdout.trim() || null,
    };
  } catch (error) {
    throw new DomainError("REPOSITORY_CLONE_FAILED", "Unable to clone the public repository.", {
      retryable: true,
      cause: error,
    });
  }
}
