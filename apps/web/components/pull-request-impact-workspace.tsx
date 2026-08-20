"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  FileDiff,
  Filter,
  GitCommitHorizontal,
  Github,
  LoaderCircle,
  RefreshCw,
  Route,
  Search,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  apiErrorMessage,
  apiFetch,
  type CreatePullRequestAnalysisResult,
  type PullRequestAnalysis,
  type PullRequestImpact,
  type PullRequestImpactResponse,
  type RepositorySummary,
  vscodeEvidenceUrl,
} from "@/lib/api";

type RiskFilter = "all" | PullRequestImpact["riskLevel"];
type ImpactFilter = "all" | PullRequestImpact["impactType"];

const terminalStatuses = new Set<PullRequestAnalysis["status"]>(["ready", "failed", "cancelled"]);

function shortSha(value: string | null): string {
  return value?.slice(0, 8) ?? "pending";
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function riskLabel(level: PullRequestImpact["riskLevel"]): string {
  return level === "critical" ? "Critical" : level[0]?.toUpperCase() + level.slice(1);
}

function statusMessage(analysis: PullRequestAnalysis): string {
  if (analysis.status === "queued") return "Waiting for immutable base and head snapshots.";
  if (analysis.status === "running") return "Computing changed symbols and reverse dependencies.";
  if (analysis.status === "failed") return analysis.failure?.message ?? "Impact analysis failed.";
  if (analysis.status === "cancelled") return "This analysis was cancelled before completion.";
  return "Impact analysis is fixed to both commits and ready to inspect.";
}

export function PullRequestImpactWorkspace({
  repositoryId,
  prNumber,
  initialAnalysisId,
}: {
  repositoryId: string;
  prNumber: number;
  initialAnalysisId?: string;
}) {
  const [repository, setRepository] = useState<RepositorySummary | null>(null);
  const [analysisId, setAnalysisId] = useState(initialAnalysisId ?? null);
  const [analysis, setAnalysis] = useState<PullRequestAnalysis | null>(null);
  const [files, setFiles] = useState<PullRequestImpactResponse["files"]>([]);
  const [symbols, setSymbols] = useState<PullRequestImpactResponse["symbols"]>([]);
  const [impacts, setImpacts] = useState<PullRequestImpact[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<PullRequestImpact | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [risk, setRisk] = useState<RiskFilter>("all");
  const [impactType, setImpactType] = useState<ImpactFilter>("all");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeAnalysis = useRef<string | null>(initialAnalysisId ?? null);

  const loadImpactPage = useCallback(async (id: string, cursor?: string) => {
    const params = new URLSearchParams({ limit: "50" });
    if (cursor) params.set("cursor", cursor);
    const page = await apiFetch<PullRequestImpactResponse>(
      `/v1/pull-request-analyses/${id}/impact?${params.toString()}`,
    );
    if (activeAnalysis.current !== id) return;
    setAnalysis(page.analysis);
    setFiles(page.files);
    setSymbols(page.symbols);
    setImpacts((current) => (cursor ? [...current, ...page.impacts] : page.impacts));
    setNextCursor(page.nextCursor);
  }, []);

  const loadAnalysis = useCallback(
    async (id: string) => {
      const next = await apiFetch<PullRequestAnalysis>(`/v1/pull-request-analyses/${id}`);
      if (activeAnalysis.current !== id) return next;
      if (next.repositoryId !== repositoryId || next.prNumber !== prNumber) {
        throw new ApiError("This analysis does not belong to the selected repository and PR.", {
          code: "PR_ANALYSIS_NOT_FOUND",
        });
      }
      setAnalysis(next);
      if (next.status === "ready") await loadImpactPage(id);
      return next;
    },
    [loadImpactPage, prNumber, repositoryId],
  );

  useEffect(() => {
    let active = true;
    async function initialize() {
      setLoading(true);
      setError(null);
      try {
        const nextRepository = await apiFetch<RepositorySummary>(
          `/v1/repositories/${repositoryId}`,
        );
        if (!active) return;
        setRepository(nextRepository);
        let id = initialAnalysisId;
        if (!id) {
          const created = await apiFetch<CreatePullRequestAnalysisResult>(
            `/v1/repositories/${repositoryId}/pull-requests`,
            { method: "POST", body: JSON.stringify({ number: prNumber }) },
          );
          id = created.analysisId;
          window.history.replaceState(
            null,
            "",
            `/repositories/${repositoryId}/pull-requests/${prNumber}?analysisId=${encodeURIComponent(id)}`,
          );
        }
        activeAnalysis.current = id;
        setAnalysisId(id);
        await loadAnalysis(id);
      } catch (cause) {
        if (active) setError(apiErrorMessage(cause, "Unable to load pull request impact."));
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialize();
    return () => {
      active = false;
      activeAnalysis.current = null;
    };
  }, [initialAnalysisId, loadAnalysis, prNumber, repositoryId]);

  useEffect(() => {
    if (!analysisId || !analysis || terminalStatuses.has(analysis.status)) return;
    const id = analysisId;
    const refresh = () => {
      void loadAnalysis(id).catch((cause) =>
        setError(apiErrorMessage(cause, "Unable to refresh pull request impact.")),
      );
    };
    const poll = window.setInterval(refresh, 2_000);
    return () => window.clearInterval(poll);
  }, [analysis, analysisId, loadAnalysis]);

  const filteredImpacts = useMemo(() => {
    const text = query.trim().toLowerCase();
    return impacts.filter(
      (impact) =>
        (risk === "all" || impact.riskLevel === risk) &&
        (impactType === "all" || impact.impactType === impactType) &&
        (!text ||
          impact.name.toLowerCase().includes(text) ||
          impact.path.toLowerCase().includes(text) ||
          impact.stableKey.toLowerCase().includes(text)),
    );
  }, [impactType, impacts, query, risk]);

  async function loadMore() {
    if (!analysisId || !nextCursor) return;
    setLoadingMore(true);
    try {
      await loadImpactPage(analysisId, nextCursor);
    } catch (cause) {
      setError(apiErrorMessage(cause, "Unable to load more impacts."));
    } finally {
      setLoadingMore(false);
    }
  }

  async function rerun() {
    if (!analysisId) return;
    setRerunning(true);
    setError(null);
    try {
      const created = await apiFetch<CreatePullRequestAnalysisResult>(
        `/v1/pull-request-analyses/${analysisId}/rerun`,
        { method: "POST" },
      );
      activeAnalysis.current = created.analysisId;
      setAnalysisId(created.analysisId);
      setAnalysis(null);
      setFiles([]);
      setSymbols([]);
      setImpacts([]);
      setSelected(null);
      setNextCursor(null);
      window.history.replaceState(
        null,
        "",
        `/repositories/${repositoryId}/pull-requests/${prNumber}?analysisId=${encodeURIComponent(created.analysisId)}`,
      );
      await loadAnalysis(created.analysisId);
    } catch (cause) {
      setError(apiErrorMessage(cause, "Unable to create a new analysis revision."));
    } finally {
      setRerunning(false);
    }
  }

  function togglePath(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <main className="impact-state-page">
        <LoaderCircle className="spin" size={30} />
        <h1>Preparing pull request impact…</h1>
        <p>Fixing the analysis to immutable base and head commits.</p>
      </main>
    );
  }

  if (!repository || !analysis) {
    return (
      <main className="impact-state-page">
        <CircleHelp size={32} />
        <h1>Impact workspace unavailable</h1>
        <p>{error ?? "This pull request analysis could not be loaded."}</p>
        <Link className="primary-button" href={`/repositories/${repositoryId}`}>
          Back to repository
        </Link>
      </main>
    );
  }

  return (
    <div className="impact-workspace">
      <header className="impact-topbar">
        <div>
          <Link href={`/repositories/${repositoryId}`}>
            <ArrowLeft size={16} /> Repository
          </Link>
          <span aria-hidden>/</span>
          <a href={analysis.url} rel="noreferrer" target="_blank">
            <Github size={16} /> {repository.owner}/{repository.name} #{analysis.prNumber}
            <ExternalLink size={13} />
          </a>
        </div>
        <button
          className="secondary-button"
          disabled={rerunning || !terminalStatuses.has(analysis.status)}
          onClick={() => void rerun()}
          type="button"
        >
          {rerunning ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
          New revision
        </button>
      </header>

      <main className={selected ? "impact-main with-drawer" : "impact-main"}>
        {error ? (
          <div className="workspace-alert impact-alert" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError(null)} type="button">
              <X size={14} />
            </button>
          </div>
        ) : null}

        <section className="impact-hero">
          <div>
            <p className="eyebrow">Pull request impact · revision {analysis.revision}</p>
            <h1>{analysis.title}</h1>
            <p>{statusMessage(analysis)}</p>
          </div>
          <div className="impact-provenance">
            <span>
              <GitCommitHorizontal size={14} /> base {shortSha(analysis.baseSha)}
            </span>
            <ArrowRight size={14} />
            <span>
              <GitCommitHorizontal size={14} /> head {shortSha(analysis.headSha)}
            </span>
            <small>
              {analysis.parserVersion} · {analysis.algorithmVersion}
            </small>
          </div>
        </section>

        {analysis.status !== "ready" ? (
          <section className={`impact-running impact-status-${analysis.status}`}>
            {analysis.status === "failed" ? (
              <ShieldAlert size={26} />
            ) : analysis.status === "cancelled" ? (
              <AlertTriangle size={26} />
            ) : (
              <LoaderCircle className="spin" size={26} />
            )}
            <div>
              <h2>{analysis.status === "failed" ? "Analysis failed" : "Analysis in progress"}</h2>
              <p>{statusMessage(analysis)}</p>
              {analysis.failure?.retryable ? <small>This failure is safe to retry.</small> : null}
            </div>
            <div
              aria-label={`${percent(analysis.progress)} complete`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.round(analysis.progress * 100)}
              className="impact-progress"
              role="progressbar"
            >
              <span style={{ width: percent(analysis.progress) }} />
            </div>
          </section>
        ) : (
          <>
            <section className="impact-summary-grid" aria-label="Impact summary">
              <article>
                <FileDiff size={17} />
                <strong>{analysis.stats.changedFiles}</strong>
                <span>changed files</span>
              </article>
              <article>
                <Sparkles size={17} />
                <strong>{analysis.stats.changedSymbols}</strong>
                <span>changed symbols</span>
              </article>
              <article>
                <Route size={17} />
                <strong>{analysis.stats.directImpacts}</strong>
                <span>direct impacts</span>
              </article>
              <article>
                <Route size={17} />
                <strong>{analysis.stats.transitiveImpacts}</strong>
                <span>transitive impacts</span>
              </article>
              <article className={analysis.stats.unknownImpacts > 0 ? "summary-warning" : ""}>
                <CircleHelp size={17} />
                <strong>{analysis.stats.unknownImpacts}</strong>
                <span>unknown evidence</span>
              </article>
            </section>

            {analysis.stats.truncated ? (
              <output aria-live="polite" className="impact-limited">
                <AlertTriangle size={17} />
                Static traversal reached its safety limit. The visible result is deterministic but
                incomplete.
              </output>
            ) : null}

            <section className="impact-changes">
              <div>
                <strong>Changed paths</strong>
                <span>{files.length} loaded</span>
              </div>
              <div className="impact-file-chips">
                {files.slice(0, 12).map((file) => (
                  <span
                    className={`change-${file.changeType}`}
                    key={`${file.path}-${file.changeType}`}
                  >
                    {file.changeType} · {file.path}
                  </span>
                ))}
                {files.length > 12 ? <span>+{files.length - 12} more</span> : null}
              </div>
            </section>

            <section className="impact-toolbar" aria-label="Impact filters">
              <label>
                <Search size={15} />
                <input
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter symbol or path"
                  value={query}
                />
              </label>
              <label>
                <Filter size={14} />
                <span>Risk</span>
                <select
                  aria-label="Risk"
                  onChange={(event) => setRisk(event.target.value as RiskFilter)}
                  value={risk}
                >
                  <option value="all">All</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label>
                <Filter size={14} />
                <span>Impact</span>
                <select
                  aria-label="Impact type"
                  onChange={(event) => setImpactType(event.target.value as ImpactFilter)}
                  value={impactType}
                >
                  <option value="all">All</option>
                  <option value="changed">Changed</option>
                  <option value="direct">Direct</option>
                  <option value="transitive">Transitive</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <span>{filteredImpacts.length} visible impacts</span>
            </section>

            <section className="impact-table" aria-label="Pull request impacts">
              <div className="impact-table-head">
                <span>Risk</span>
                <span>Symbol</span>
                <span>Type</span>
                <span>Distance</span>
                <span>Evidence</span>
              </div>
              {filteredImpacts.length === 0 ? (
                <div className="impact-empty">No impact matches the current filters.</div>
              ) : (
                filteredImpacts.map((impact) => {
                  const pathOpen = expanded.has(impact.id);
                  return (
                    <article className="impact-row" key={impact.id}>
                      <button
                        aria-label={`Inspect ${impact.name} evidence`}
                        className="impact-row-summary"
                        onClick={() => setSelected(impact)}
                        type="button"
                      >
                        <span className={`risk-badge risk-${impact.riskLevel}`}>
                          {riskLabel(impact.riskLevel)} · {Math.round(impact.riskScore * 100)}
                        </span>
                        <span className="impact-symbol-cell">
                          <strong>{impact.name}</strong>
                          <small>
                            {impact.path}:{impact.startLine}
                          </small>
                        </span>
                        <span className={`impact-type impact-type-${impact.impactType}`}>
                          {impact.impactType}
                        </span>
                        <span>{impact.distance}</span>
                        <span>{impact.evidence.length}</span>
                      </button>
                      {impact.paths.length > 0 ? (
                        <button
                          aria-expanded={pathOpen}
                          className="impact-path-toggle"
                          onClick={() => togglePath(impact.id)}
                          type="button"
                        >
                          {pathOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          {impact.paths.length}-step shortest static path
                        </button>
                      ) : null}
                      {pathOpen ? (
                        <ol className="impact-path-list">
                          {impact.paths.map((path) => (
                            <li key={`${impact.id}-${path.ordinal}`}>
                              <span>{path.fromPath ?? "unknown source"}</span>
                              <strong>{path.relationType}</strong>
                              <span>{path.toPath ?? "unknown target"}</span>
                              <small>{Math.round(path.confidence * 100)}% confidence</small>
                              {path.evidenceId ? (
                                <CheckCircle2 size={13} />
                              ) : (
                                <CircleHelp size={13} />
                              )}
                            </li>
                          ))}
                        </ol>
                      ) : null}
                    </article>
                  );
                })
              )}
            </section>

            {nextCursor ? (
              <button
                className="secondary-button impact-load-more"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                type="button"
              >
                {loadingMore ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <ArrowRight size={15} />
                )}
                Load next 50 impacts
              </button>
            ) : null}
            <p className="impact-symbol-count">
              {symbols.length} changed symbol records fixed to this revision.
            </p>
          </>
        )}
      </main>

      {selected ? (
        <aside aria-label="Fixed impact evidence" className="impact-evidence-drawer">
          <div className="impact-drawer-head">
            <div>
              <span className={`risk-badge risk-${selected.riskLevel}`}>
                {riskLabel(selected.riskLevel)} risk
              </span>
              <h2>{selected.name}</h2>
              <p>
                {selected.path}:{selected.startLine}-{selected.endLine}
              </p>
            </div>
            <button aria-label="Close evidence" onClick={() => setSelected(null)} type="button">
              <X size={17} />
            </button>
          </div>

          <div className="risk-breakdown">
            <strong>Risk inputs</strong>
            {Object.entries(selected.riskBreakdown).map(([key, value]) => (
              <div key={key}>
                <span>{key.replace(/Weight$/, "")}</span>
                <b>
                  <i style={{ width: percent(value) }} />
                </b>
                <small>{Math.round(value * 100)}</small>
              </div>
            ))}
          </div>

          <div className="fixed-evidence-meta">
            <span>
              <GitCommitHorizontal size={14} /> {selected.side} snapshot
            </span>
            <code>
              {(selected.side === "base" ? analysis.baseSnapshotId : analysis.headSnapshotId) ??
                "unavailable"}
            </code>
            <code>{selected.side === "base" ? analysis.baseSha : analysis.headSha}</code>
          </div>

          <div className="impact-evidence-list">
            {selected.evidence.length === 0 ? (
              <div className="evidence-unknown">
                <CircleHelp size={18} />
                <p>
                  RepoVista could not prove a fixed source range for this item, so it is marked
                  unknown instead of showing invented evidence.
                </p>
              </div>
            ) : (
              selected.evidence.map((evidence) => (
                <article key={evidence.id}>
                  <div>
                    <strong>
                      {evidence.path}:{evidence.startLine}-{evidence.endLine}
                    </strong>
                    <span>{evidence.relationType ?? "changed symbol"}</span>
                  </div>
                  <pre>{evidence.quote}</pre>
                  <div className="evidence-actions">
                    <a
                      className="secondary-button"
                      href={vscodeEvidenceUrl({
                        repositoryId,
                        snapshotId: evidence.snapshotId,
                        commitSha: evidence.commitSha,
                        path: evidence.path,
                        startLine: evidence.startLine,
                        endLine: evidence.endLine,
                      })}
                    >
                      Open in VS Code
                    </a>
                    <a
                      href={`${repository.canonicalUrl}/blob/${evidence.commitSha}/${evidence.path}#L${evidence.startLine}-L${evidence.endLine}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      GitHub <ExternalLink size={13} />
                    </a>
                  </div>
                  <small>{evidence.id}</small>
                </article>
              ))
            )}
          </div>
        </aside>
      ) : null}
    </div>
  );
}
