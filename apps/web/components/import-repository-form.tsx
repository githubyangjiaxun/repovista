"use client";

import type { GitHubInstallation } from "@repovista/contracts";
import {
  ArrowRight,
  ChevronDown,
  Github,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { useOptionalAuth } from "@/components/auth-provider";
import { apiErrorMessage, apiFetch, type CreateRepositoryResult } from "@/lib/api";

function validateGitHubUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      !["github.com", "www.github.com"].includes(parsed.hostname)
    ) {
      return "Use a public HTTPS github.com repository URL.";
    }
    if (parsed.pathname.split("/").filter(Boolean).length !== 2) {
      return "The URL should look like https://github.com/owner/repository.";
    }
    return null;
  } catch {
    return "Enter a valid GitHub repository URL.";
  }
}

type InstallationRepository = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  clone_url: string;
  default_branch: string;
  owner: { login: string };
};

export function ImportRepositoryForm({ initialUrl = "" }: { initialUrl?: string }) {
  const router = useRouter();
  const session = useOptionalAuth()?.session ?? null;
  const [url, setUrl] = useState(initialUrl);
  const [ref, setRef] = useState("");
  const [ignore, setIgnore] = useState("dist\nbuild\ndocs/generated");
  const [advanced, setAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"url" | "installation">("url");
  const [installations, setInstallations] = useState<GitHubInstallation[]>([]);
  const [installationId, setInstallationId] = useState<number | null>(null);
  const [installedRepositories, setInstalledRepositories] = useState<InstallationRepository[]>([]);
  const [loadingRepositories, setLoadingRepositories] = useState(false);
  const selectedRepository = installedRepositories.find(
    (repository) => repository.html_url === url,
  );
  const viewer = session?.authenticated && session.workspace?.role === "viewer";

  useEffect(() => {
    if (!session?.authenticated || viewer || !session.capabilities.githubApp) return;
    apiFetch<GitHubInstallation[]>("/v1/integrations/github/installations")
      .then((items) => {
        setInstallations(items);
        setInstallationId((current) => current ?? items[0]?.installationId ?? null);
      })
      .catch(() => undefined);
  }, [session, viewer]);

  useEffect(() => {
    if (source !== "installation" || !installationId) return;
    setLoadingRepositories(true);
    apiFetch<{ repositories: InstallationRepository[]; totalCount: number }>(
      `/v1/integrations/github/installations/${installationId}/repositories?pageSize=100`,
    )
      .then((result) => {
        setInstalledRepositories(result.repositories);
        setUrl((current) =>
          result.repositories.some((repository) => repository.html_url === current)
            ? current
            : (result.repositories[0]?.html_url ?? ""),
        );
      })
      .catch((cause) => setError(apiErrorMessage(cause, "Unable to load installed repositories.")))
      .finally(() => setLoadingRepositories(false));
  }, [installationId, source]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateGitHubUrl(url.trim());
    if (validation) {
      setError(validation);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiFetch<CreateRepositoryResult>("/v1/repositories", {
        method: "POST",
        body: JSON.stringify({
          url: url.trim(),
          ...(source === "installation" && installationId ? { installationId } : {}),
          ...(ref.trim() ? { ref: ref.trim() } : {}),
          ignore: ignore
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean),
        }),
      });
      const query = new URLSearchParams({
        repositoryId: result.repositoryId,
        snapshotId: result.snapshotId,
      });
      router.push(`/jobs/${result.jobId}?${query.toString()}`);
    } catch (cause) {
      setError(apiErrorMessage(cause, "Unable to start the repository analysis."));
    } finally {
      setSubmitting(false);
    }
  }

  if (viewer) {
    return (
      <div className="form-error" role="alert">
        Viewer access is read-only. Ask a workspace owner to grant Editor access before importing or
        reindexing repositories.
      </div>
    );
  }

  return (
    <form className="new-repository-form" onSubmit={submit}>
      {session?.authenticated && installations.length > 0 ? (
        <div className="import-source-tabs" role="tablist" aria-label="Repository source">
          <button
            aria-selected={source === "url"}
            className={source === "url" ? "active" : ""}
            onClick={() => setSource("url")}
            role="tab"
            type="button"
          >
            Public URL
          </button>
          <button
            aria-selected={source === "installation"}
            className={source === "installation" ? "active" : ""}
            onClick={() => setSource("installation")}
            role="tab"
            type="button"
          >
            <LockKeyhole size={14} /> Installed repositories
          </button>
        </div>
      ) : null}

      <div className="form-section">
        <label htmlFor={source === "installation" ? "installed-repository" : "repository-url"}>
          {source === "installation" ? "Installed GitHub repository" : "Public GitHub repository"}
        </label>
        {source === "installation" ? (
          <div className="installed-repository-fields">
            <select
              aria-label="GitHub installation"
              onChange={(event) => setInstallationId(Number(event.target.value))}
              value={installationId ?? ""}
            >
              {installations.map((installation) => (
                <option key={installation.installationId} value={installation.installationId}>
                  {installation.accountLogin}
                </option>
              ))}
            </select>
            <select
              disabled={loadingRepositories}
              id="installed-repository"
              onChange={(event) => setUrl(event.target.value)}
              required
              value={url}
            >
              {installedRepositories.map((repository) => (
                <option key={repository.id} value={repository.html_url}>
                  {repository.private ? "Private · " : "Public · "}
                  {repository.full_name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="input-with-icon">
            <Github aria-hidden size={19} />
            <input
              autoComplete="url"
              id="repository-url"
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://github.com/owner/repository"
              required
              type="url"
              value={url}
            />
          </div>
        )}
        <p className="field-hint">
          {selectedRepository?.private
            ? "Private source stays inside the active workspace and uses a short-lived GitHub App token."
            : "RepoVista clones source code only. It never installs packages or runs repository scripts."}
        </p>
      </div>

      <button
        aria-expanded={advanced}
        className="advanced-toggle"
        onClick={() => setAdvanced((value) => !value)}
        type="button"
      >
        Analysis options
        <ChevronDown className={advanced ? "rotate" : ""} size={17} />
      </button>

      {advanced ? (
        <div className="advanced-fields">
          <div className="form-section">
            <label htmlFor="repository-ref">Branch, tag, or commit</label>
            <input
              id="repository-ref"
              onChange={(event) => setRef(event.target.value)}
              placeholder="Default branch"
              value={ref}
            />
          </div>
          <div className="form-section">
            <label htmlFor="repository-ignore">Ignored paths</label>
            <textarea
              id="repository-ignore"
              onChange={(event) => setIgnore(event.target.value)}
              rows={4}
              value={ignore}
            />
            <p className="field-hint">One repository-relative directory or file per line.</p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}

      <button className="primary-button wide-button" disabled={submitting} type="submit">
        {submitting ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}
        {submitting ? "Starting analysis…" : "Analyze repository"}
        {!submitting ? <ArrowRight size={18} /> : null}
      </button>
    </form>
  );
}
