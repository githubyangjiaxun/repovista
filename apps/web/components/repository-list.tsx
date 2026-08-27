"use client";

import { isBundledDemoRepository } from "@repovista/contracts";
import { ArrowRight, GitBranch, Github, LoaderCircle, LockKeyhole, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiErrorMessage, apiFetch, type RepositorySummary } from "@/lib/api";

export function RepositoryList() {
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<RepositorySummary[]>("/v1/repositories")
      .then(setRepositories)
      .catch((cause) => setError(apiErrorMessage(cause, "Unable to load repositories.")))
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="list-loading">
        <LoaderCircle className="spin" size={22} /> Loading repositories…
      </div>
    );
  if (error) return <div className="form-error">{error}</div>;

  return (
    <div className="repository-list">
      {repositories.length === 0 ? (
        <div className="empty-repositories">
          <Github size={30} />
          <h2>No repositories yet</h2>
          <p>
            Analyze a public URL or an installed private repository to build the first immutable
            code map.
          </p>
          <Link className="primary-button" href="/repositories/new">
            <Plus size={16} /> Analyze repository
          </Link>
        </div>
      ) : (
        repositories.map((repository) => (
          <Link
            className="repository-card"
            href={
              repository.latestSnapshotId
                ? `/repositories/${repository.id}?snapshotId=${encodeURIComponent(repository.latestSnapshotId)}`
                : `/repositories/${repository.id}`
            }
            key={repository.id}
          >
            <div className="repository-card-icon">
              <Github size={20} />
            </div>
            <div>
              <span>{repository.owner}</span>
              <h2>
                {repository.name}
                {repository.visibility === "private" ? (
                  <LockKeyhole aria-label="Private repository" size={14} />
                ) : null}
              </h2>
              {isBundledDemoRepository(repository.canonicalUrl) ? (
                <span className="fixture-badge">Bundled demo</span>
              ) : null}
              <p>
                <GitBranch size={13} /> {repository.defaultBranch ?? "default branch"} ·{" "}
                {repository.latestCommitSha?.slice(0, 7) ?? "waiting"}
              </p>
            </div>
            <span
              className={`snapshot-status status-${repository.latestSnapshotStatus ?? "requested"}`}
            >
              {repository.latestSnapshotStatus ?? "not indexed"}
            </span>
            <ArrowRight size={18} />
          </Link>
        ))
      )}
    </div>
  );
}
