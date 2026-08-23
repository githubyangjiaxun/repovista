"use client";

import type { GraphLevel, RetrievalMode } from "@repovista/contracts";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Braces,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Code2,
  ExternalLink,
  FileCode2,
  Files,
  GitBranch,
  Github,
  GitPullRequest,
  Layers3,
  Link2,
  LoaderCircle,
  Map as MapIcon,
  RefreshCw,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type MouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArchitectureMap } from "@/components/architecture-map";
import { AutomationStatus } from "@/components/automation-status";
import { GuardrailsPanel } from "@/components/guardrails-panel";
import { RetrievalLab } from "@/components/retrieval-lab";
import { SnapshotDelta } from "@/components/snapshot-delta";
import {
  ApiError,
  type AskResult,
  apiErrorMessage,
  apiFetch,
  type CreateRepositoryResult,
  fetchSnapshotExport,
  type GitHubIntegrationStatus,
  type GraphResponse,
  type RepositorySummary,
  type Snapshot,
  type SnapshotExportFormat,
  type SnapshotFilePage,
  type SnapshotFileSummary,
  type SourceFile,
  snapshotExportUrl,
} from "@/lib/api";

type WorkspaceTab = "ask" | "guardrails" | "map" | "overview" | "search";

const exampleQuestions = [
  "Where does this application start?",
  "Which files should a new contributor read first?",
  "How are the main modules connected?",
  "What does the most central service do?",
];

function shortSha(value: string | null): string {
  return value?.slice(0, 7) ?? "pending";
}

function languageEntries(snapshot: Snapshot): [string, number][] {
  return Object.entries(snapshot.stats.languages).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
}

function sourceUrl(snapshotId: string, filePath: string, startLine?: number, endLine?: number) {
  const query = new URLSearchParams({ path: filePath });
  if (startLine) query.set("startLine", String(startLine));
  if (endLine) query.set("endLine", String(endLine));
  return `/v1/snapshots/${snapshotId}/source?${query.toString()}`;
}

export function RepositoryExplorer({
  repositoryId,
  snapshotId: requestedSnapshotId,
  initialTab = "overview",
  initialSearchQuery = "",
  initialSearchMode = "hybrid",
  initialSearchLimit = 20,
}: {
  repositoryId: string;
  snapshotId?: string;
  initialTab?: WorkspaceTab;
  initialSearchQuery?: string;
  initialSearchMode?: RetrievalMode;
  initialSearchLimit?: number;
}) {
  const router = useRouter();
  const [repository, setRepository] = useState<RepositorySummary | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [files, setFiles] = useState<SnapshotFileSummary[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [fileFilter, setFileFilter] = useState("");
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [level, setLevel] = useState<GraphLevel>("package");
  const [mapQuery, setMapQuery] = useState("");
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [source, setSource] = useState<SourceFile | null>(null);
  const [sourceRange, setSourceRange] = useState<{ startLine?: number; endLine?: number }>({});
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [graphLoading, setGraphLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [exporting, setExporting] = useState<SnapshotExportFormat | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [prNumber, setPrNumber] = useState("");
  const [creatingImpact, setCreatingImpact] = useState(false);
  const [integration, setIntegration] = useState<GitHubIntegrationStatus | null>(null);
  const [integrationUnavailable, setIntegrationUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  function selectTab(nextTab: WorkspaceTab) {
    setTab(nextTab);
    const url = new URL(window.location.href);
    if (nextTab === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", nextTab);
    if (nextTab !== "search") {
      url.searchParams.delete("q");
      url.searchParams.delete("mode");
      url.searchParams.delete("limit");
    }
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
  }

  function updateSearchUrl(input: { query: string; mode: RetrievalMode; limit: number }) {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "search");
    url.searchParams.set("q", input.query);
    url.searchParams.set("mode", input.mode);
    url.searchParams.set("limit", String(input.limit));
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
  }

  const loadGraph = useCallback(async (snapshotId: string, nextLevel: GraphLevel, query = "") => {
    setGraphLoading(true);
    try {
      const params = new URLSearchParams({ level: nextLevel });
      if (query.trim()) params.set("query", query.trim());
      setGraph(await apiFetch<GraphResponse>(`/v1/snapshots/${snapshotId}/map?${params}`));
    } catch (cause) {
      setError(apiErrorMessage(cause, "Unable to load the architecture map."));
    } finally {
      setGraphLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const nextRepository = await apiFetch<RepositorySummary>(
          `/v1/repositories/${repositoryId}`,
        );
        const selectedSnapshotId = requestedSnapshotId ?? nextRepository.latestSnapshotId;
        if (!selectedSnapshotId) {
          throw new ApiError("This repository does not have a ready snapshot yet.", {
            code: "SNAPSHOT_NOT_READY",
            retryable: true,
          });
        }
        const [nextSnapshot, filePage, nextSnapshots] = await Promise.all([
          apiFetch<Snapshot>(`/v1/snapshots/${selectedSnapshotId}`),
          apiFetch<SnapshotFilePage>(`/v1/snapshots/${selectedSnapshotId}/files?pageSize=100`),
          apiFetch<Snapshot[]>(`/v1/repositories/${repositoryId}/snapshots`),
        ]);
        if (nextSnapshot.repositoryId !== repositoryId) {
          throw new ApiError("The selected snapshot does not belong to this repository.", {
            code: "SNAPSHOT_NOT_FOUND",
          });
        }
        if (!active) return;
        setRepository(nextRepository);
        setSnapshot(nextSnapshot);
        setFiles(filePage.files);
        setSnapshots(nextSnapshots.filter((item) => item.status === "ready" && item.commitSha));
        await loadGraph(nextSnapshot.id, "package");
      } catch (cause) {
        if (active) {
          setError(apiErrorMessage(cause, "Unable to load this repository."));
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [loadGraph, requestedSnapshotId, repositoryId]);

  useEffect(() => {
    let active = true;
    apiFetch<GitHubIntegrationStatus>("/v1/integrations/github")
      .then((status) => {
        if (!active) return;
        setIntegration(status);
        setIntegrationUnavailable(false);
      })
      .catch(() => {
        if (active) setIntegrationUnavailable(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function changeLevel(nextLevel: GraphLevel) {
    setLevel(nextLevel);
    if (snapshot) await loadGraph(snapshot.id, nextLevel, mapQuery);
  }

  async function openSource(
    filePath: string,
    startLine?: number,
    endLine?: number,
    targetSnapshotId?: string,
  ) {
    const selectedSnapshotId = targetSnapshotId ?? snapshot?.id;
    if (!selectedSnapshotId) return;
    setSourceRange({ startLine, endLine });
    try {
      setSource(
        await apiFetch<SourceFile>(sourceUrl(selectedSnapshotId, filePath, startLine, endLine)),
      );
      setError(null);
    } catch (cause) {
      setError(apiErrorMessage(cause, "Unable to load this source file."));
    }
  }

  async function ask(event?: FormEvent) {
    event?.preventDefault();
    if (!question.trim() || !snapshot) return;
    setAsking(true);
    setError(null);
    try {
      setAnswer(
        await apiFetch<AskResult>(`/v1/repositories/${repositoryId}/ask`, {
          method: "POST",
          body: JSON.stringify({ question: question.trim(), snapshotId: snapshot.id }),
        }),
      );
    } catch (cause) {
      setError(apiErrorMessage(cause, "Unable to answer this question."));
    } finally {
      setAsking(false);
    }
  }

  async function createShare() {
    if (!snapshot || !repository) return;
    setSharing(true);
    // Open the tab during the user gesture so browser popup blockers do not discard the
    // share destination after the asynchronous API request completes.
    const shareWindow = window.open("about:blank", "_blank");
    if (shareWindow) shareWindow.opener = null;
    try {
      const report = await apiFetch<{ id: string; slug: string }>("/v1/share-reports", {
        method: "POST",
        body: JSON.stringify({
          snapshotId: snapshot.id,
          title: `${repository.owner}/${repository.name} architecture story`,
          visibility: repository.visibility === "private" ? "private" : "public",
        }),
      });
      const destination = `/share/${report.slug}`;
      if (shareWindow && !shareWindow.closed) {
        shareWindow.location.href = destination;
      } else {
        window.location.assign(destination);
      }
    } catch (cause) {
      if (shareWindow && !shareWindow.closed) shareWindow.close();
      setError(apiErrorMessage(cause, "Unable to create a share report."));
    } finally {
      setSharing(false);
    }
  }

  async function reindex() {
    if (!repository) return;
    setReindexing(true);
    try {
      const result = await apiFetch<CreateRepositoryResult>("/v1/repositories", {
        method: "POST",
        body: JSON.stringify({ url: repository.canonicalUrl, ignore: [] }),
      });
      router.push(
        `/jobs/${result.jobId}?repositoryId=${result.repositoryId}&snapshotId=${result.snapshotId}`,
      );
    } catch (cause) {
      setError(apiErrorMessage(cause, "Unable to start reindexing."));
      setReindexing(false);
    }
  }

  async function downloadExport(
    event: MouseEvent<HTMLAnchorElement>,
    format: SnapshotExportFormat,
    level: "package" | "file" | "symbol" = "package",
  ) {
    event.preventDefault();
    if (!snapshot) return;
    setExporting(format);
    setError(null);
    try {
      const artifact = await fetchSnapshotExport(snapshot.id, format, level);
      const objectUrl = URL.createObjectURL(artifact.blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = artifact.filename;
      anchor.rel = "noopener";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (cause) {
      setError(apiErrorMessage(cause, "Unable to download the snapshot export."));
    } finally {
      setExporting(null);
    }
  }

  async function analyzePullRequest(event: FormEvent) {
    event.preventDefault();
    const number = Number.parseInt(prNumber, 10);
    if (!Number.isInteger(number) || number < 1) {
      setError("Enter a valid public GitHub pull request number.");
      return;
    }
    setCreatingImpact(true);
    setError(null);
    try {
      const result = await apiFetch<{ analysisId: string }>(
        `/v1/repositories/${repositoryId}/pull-requests`,
        {
          method: "POST",
          body: JSON.stringify({ number }),
        },
      );
      router.push(
        `/repositories/${repositoryId}/pull-requests/${number}?analysisId=${encodeURIComponent(result.analysisId)}`,
      );
    } catch (cause) {
      setError(apiErrorMessage(cause, "Unable to start pull request impact analysis."));
      setCreatingImpact(false);
    }
  }

  const filteredFiles = useMemo(() => {
    const query = fileFilter.trim().toLowerCase();
    return query ? files.filter((file) => file.path.toLowerCase().includes(query)) : files;
  }, [fileFilter, files]);

  if (loading) {
    return (
      <div className="workspace-loading">
        <LoaderCircle className="spin" size={28} />
        <span>Loading immutable snapshot…</span>
      </div>
    );
  }

  if (!repository || !snapshot) {
    return (
      <div className="workspace-error">
        <CircleHelp size={30} />
        <h1>Repository unavailable</h1>
        <p>{error ?? "This repository could not be loaded."}</p>
        <a className="primary-button" href="/repositories/new">
          Analyze a repository
        </a>
      </div>
    );
  }

  return (
    <div className="repository-workspace">
      <header className="repository-topbar">
        <div className="repository-identity">
          <a href={repository.canonicalUrl} rel="noreferrer" target="_blank">
            <Github size={18} />
            <span>{repository.owner}</span>
            <ChevronRight size={14} />
            <strong>{repository.name}</strong>
            <ExternalLink size={13} />
          </a>
          <span className="commit-chip">
            <GitBranch size={13} /> {snapshot.refName ?? repository.defaultBranch ?? "detached"} ·{" "}
            {shortSha(snapshot.commitSha)}
          </span>
          <span
            className={`index-mode-chip ${snapshot.indexMode === "incremental" ? "incremental" : "full"}`}
          >
            {snapshot.indexMode === "incremental" ? "incremental index" : "full index"}
          </span>
          <span className="ready-chip">
            <CheckCircle2 size={13} /> indexed
          </span>
        </div>
        <div className="repository-actions">
          <button
            className="secondary-button"
            disabled={reindexing}
            onClick={() => void reindex()}
            type="button"
          >
            {reindexing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
            Reindex
          </button>
          <button
            className="primary-button"
            disabled={sharing}
            onClick={() => void createShare()}
            type="button"
          >
            {sharing ? <LoaderCircle className="spin" size={15} /> : <Share2 size={15} />}
            Share story
          </button>
        </div>
      </header>

      <aside className="workspace-sidebar">
        <Link className="workspace-brand" href="/">
          <span className="brand-mark">R</span> RepoVista
        </Link>
        <nav className="workspace-nav" aria-label="Repository views">
          <button
            className={tab === "overview" ? "active" : ""}
            onClick={() => selectTab("overview")}
            type="button"
          >
            <Layers3 size={17} /> Overview
          </button>
          <button
            className={tab === "map" ? "active" : ""}
            onClick={() => selectTab("map")}
            type="button"
          >
            <MapIcon size={17} /> Architecture map
          </button>
          <button
            className={tab === "ask" ? "active" : ""}
            onClick={() => selectTab("ask")}
            type="button"
          >
            <Bot size={17} /> Ask repository
          </button>
          <button
            className={tab === "guardrails" ? "active" : ""}
            onClick={() => selectTab("guardrails")}
            type="button"
          >
            <ShieldCheck size={17} /> Guardrails
          </button>
          <button
            className={tab === "search" ? "active" : ""}
            onClick={() => selectTab("search")}
            type="button"
          >
            <Search size={17} /> Search evidence
          </button>
          <form className="sidebar-impact-form" onSubmit={analyzePullRequest}>
            <label htmlFor="sidebar-pr-number">Pull request impact</label>
            <div>
              <GitPullRequest size={15} />
              <input
                id="sidebar-pr-number"
                inputMode="numeric"
                min={1}
                onChange={(event) => setPrNumber(event.target.value)}
                placeholder="PR number"
                type="number"
                value={prNumber}
              />
              <button
                aria-label="Analyze pull request"
                disabled={creatingImpact || !prNumber}
                type="submit"
              >
                {creatingImpact ? (
                  <LoaderCircle className="spin" size={14} />
                ) : (
                  <ArrowRight size={14} />
                )}
              </button>
            </div>
          </form>
        </nav>
        <div className="sidebar-files-heading">
          <span>
            <Files size={15} /> Files <small>{files.length}</small>
          </span>
          <label className="sidebar-search">
            <Search size={14} />
            <input
              onChange={(event) => setFileFilter(event.target.value)}
              placeholder="Filter files"
              value={fileFilter}
            />
          </label>
        </div>
        <div className="file-list">
          {filteredFiles.map((file) => (
            <button
              className={source?.path === file.path ? "active" : ""}
              key={file.id}
              onClick={() => void openSource(file.path)}
              title={file.path}
              type="button"
            >
              <FileCode2 size={14} />
              <span>
                {file.path}
                <small>{file.language ?? "text"}</small>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className={source ? "workspace-main with-source" : "workspace-main"}>
        {error ? (
          <div className="workspace-alert">
            <span>{error}</span>
            <button onClick={() => setError(null)} type="button">
              <X size={14} />
            </button>
          </div>
        ) : null}

        {tab === "overview" ? (
          <section className="workspace-view overview-view">
            <div className="view-title">
              <div>
                <p className="eyebrow">Snapshot {shortSha(snapshot.commitSha)}</p>
                <h1>See the system before reading every file.</h1>
                <p>
                  Deterministic Tree-sitter analysis pinned to a fixed commit. AI is optional and
                  clearly separated below.
                </p>
              </div>
            </div>
            <div className="stat-grid">
              <article>
                <FileCode2 size={18} />
                <strong>{snapshot.stats.files.toLocaleString()}</strong>
                <span>indexed files</span>
              </article>
              <article>
                <Braces size={18} />
                <strong>{snapshot.stats.symbols.toLocaleString()}</strong>
                <span>symbols</span>
              </article>
              <article>
                <Link2 size={18} />
                <strong>{snapshot.stats.edges.toLocaleString()}</strong>
                <span>relationships</span>
              </article>
              <article>
                <Code2 size={18} />
                <strong>{languageEntries(snapshot).length}</strong>
                <span>languages</span>
              </article>
            </div>
            <div className="overview-grid secondary-overview-grid">
              <SnapshotDelta repositoryId={repositoryId} snapshot={snapshot} />
              <AutomationStatus
                integration={integration}
                repository={repository}
                unavailable={integrationUnavailable}
              />
            </div>
            <div className="overview-grid">
              <article className="panel language-panel">
                <div className="panel-heading">
                  <div>
                    <span>Language distribution</span>
                    <small>Computed from indexed files</small>
                  </div>
                  <Code2 size={18} />
                </div>
                <div className="language-list">
                  {languageEntries(snapshot).map(([language, count]) => (
                    <div key={language}>
                      <span>
                        <i />
                        {language}
                      </span>
                      <strong>{count}</strong>
                      <div>
                        <b
                          style={{ width: `${Math.max(5, (count / snapshot.stats.files) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </article>
              <article className="panel map-preview-panel">
                <div className="panel-heading">
                  <div>
                    <span>Package topology</span>
                    <small>Click a node to inspect its source</small>
                  </div>
                  <button onClick={() => selectTab("map")} type="button">
                    Explore <ArrowRight size={14} />
                  </button>
                </div>
                {graph ? <ArchitectureMap compact graph={graph} onOpenSource={openSource} /> : null}
              </article>
            </div>
            {snapshot.status === "ready" ? (
              <article className="panel export-panel" aria-labelledby="export-title">
                <div>
                  <span className="eyebrow">Take the map with you</span>
                  <h2 id="export-title">Deterministic snapshot exports</h2>
                  <p>
                    Download a report or architecture SVG fixed to this snapshot&apos;s complete
                    commit and parser version.
                  </p>
                </div>
                <div className="export-actions">
                  <a
                    className="secondary-button"
                    download
                    href={snapshotExportUrl(snapshot.id, "markdown")}
                    onClick={(event) => void downloadExport(event, "markdown")}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {exporting === "markdown" ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <FileCode2 size={15} aria-hidden />
                    )}{" "}
                    Download Markdown
                  </a>
                  <a
                    className="secondary-button"
                    download
                    href={snapshotExportUrl(snapshot.id, "svg", "package")}
                    onClick={(event) => void downloadExport(event, "svg", "package")}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {exporting === "svg" ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <MapIcon size={15} aria-hidden />
                    )}{" "}
                    Download SVG
                  </a>
                </div>
              </article>
            ) : null}
            <article className="panel trust-panel">
              <div>
                <Sparkles size={19} />
                <strong>AI is an explanation layer, not the source of truth.</strong>
              </div>
              <p>
                Maps, files, symbols, edges, search, and source navigation work without a model.
                Answers only cite evidence saved for this commit.
              </p>
              <button className="secondary-button" onClick={() => selectTab("ask")} type="button">
                Ask with evidence <ArrowRight size={15} />
              </button>
            </article>
          </section>
        ) : null}

        {tab === "map" ? (
          <section className="workspace-view map-view">
            <div className="map-toolbar">
              <div className="segmented-control">
                {(["package", "file", "symbol"] as GraphLevel[]).map((item) => (
                  <button
                    className={level === item ? "active" : ""}
                    key={item}
                    onClick={() => void changeLevel(item)}
                    type="button"
                  >
                    {item}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void loadGraph(snapshot.id, level, mapQuery);
                }}
              >
                <Search size={15} />
                <input
                  onChange={(event) => setMapQuery(event.target.value)}
                  placeholder="Find a node or path"
                  value={mapQuery}
                />
              </form>
              <span>
                {graph?.nodes.length ?? 0} nodes · {graph?.edges.length ?? 0} edges
              </span>
            </div>
            <div className="map-canvas-wrap">
              {graphLoading ? (
                <div className="map-loading">
                  <LoaderCircle className="spin" size={24} /> Resolving graph…
                </div>
              ) : graph ? (
                <ArchitectureMap graph={graph} onOpenSource={openSource} />
              ) : null}
            </div>
          </section>
        ) : null}

        {tab === "ask" ? (
          <section className="workspace-view ask-view">
            <div className="view-title compact-title">
              <div>
                <p className="eyebrow">Evidence-backed AI</p>
                <h1>Ask the repository, then inspect the proof.</h1>
                <p>
                  Answers are generated from retrieved source snippets and validated before display.
                </p>
              </div>
            </div>
            {!answer ? (
              <div className="question-starters">
                {exampleQuestions.map((item) => (
                  <button key={item} onClick={() => setQuestion(item)} type="button">
                    <BookOpen size={16} />
                    <span>{item}</span>
                    <ArrowRight size={14} />
                  </button>
                ))}
              </div>
            ) : (
              <article className={`answer-card answer-${answer.answer.status}`}>
                <div className="answer-meta">
                  <span>
                    <Sparkles size={15} /> {answer.answer.status}
                  </span>
                  <span>
                    {answer.answer.provider === "fake"
                      ? "deterministic evidence summarizer"
                      : `${answer.answer.provider} · ${answer.answer.model}`}
                  </span>
                  <span>{answer.answer.citations.length} citations</span>
                </div>
                <section className="answer-retrieval-trace" aria-labelledby="retrieval-used-title">
                  <strong id="retrieval-used-title">Retrieval used</strong>
                  <span>{answer.trace.usedChannels.map((item) => item).join(" + ") || "none"}</span>
                  <span>
                    {answer.trace.degraded
                      ? `degraded · ${answer.trace.degradationReason?.replaceAll("_", " ")}`
                      : "complete"}
                  </span>
                  <span>{answer.evidence.length} evidence hits</span>
                  {answer.trace.embeddingIndex ? (
                    <span>
                      {answer.trace.embeddingIndex.model} ·{" "}
                      {answer.trace.embeddingIndex.dimensions ?? "?"}d
                    </span>
                  ) : null}
                </section>
                <h2>{answer.answer.summary}</h2>
                {answer.answer.steps.length > 0 ? (
                  <ol>
                    {answer.answer.steps.map((step, index) => (
                      <li key={`${index}-${step.text}`}>{step.text}</li>
                    ))}
                  </ol>
                ) : null}
                {answer.answer.limitations.length > 0 ? (
                  <div className="limitations">
                    <strong>Limits of this answer</strong>
                    {answer.answer.limitations.map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </div>
                ) : null}
                <div className="citation-grid">
                  {answer.answer.citations.map((citation) => (
                    <button
                      key={citation.evidenceId}
                      onClick={() =>
                        void openSource(citation.path, citation.startLine, citation.endLine)
                      }
                      type="button"
                    >
                      <span>
                        <FileCode2 size={15} />
                        {citation.path}:{citation.startLine}-{citation.endLine}
                      </span>
                      <strong>{citation.symbol ?? "source evidence"}</strong>
                      <code>
                        {citation.quote.slice(0, 180)}
                        {citation.quote.length > 180 ? "…" : ""}
                      </code>
                    </button>
                  ))}
                </div>
              </article>
            )}
            <form className="ask-composer" onSubmit={ask}>
              <textarea
                maxLength={4000}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="How does a request move through this codebase?"
                rows={3}
                value={question}
              />
              <div>
                <span>Fixed to commit {shortSha(snapshot.commitSha)}</span>
                <button
                  className="primary-button"
                  disabled={asking || question.trim().length < 2}
                  type="submit"
                >
                  {asking ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
                  {asking ? "Finding evidence…" : "Ask with evidence"}
                </button>
              </div>
            </form>
          </section>
        ) : null}

        {tab === "search" ? (
          <RetrievalLab
            initialLimit={initialSearchLimit}
            initialMode={initialSearchMode}
            initialQuery={initialSearchQuery}
            onOpenSource={openSource}
            onSearchSubmitted={updateSearchUrl}
            snapshotId={snapshot.id}
          />
        ) : null}

        {tab === "guardrails" ? (
          <GuardrailsPanel
            availableSnapshots={snapshots}
            onOpenSnapshotSource={(targetSnapshotId, path, startLine, endLine) =>
              openSource(path, startLine, endLine, targetSnapshotId)
            }
            onOpenSource={openSource}
            snapshotId={snapshot.id}
          />
        ) : null}
      </main>

      {source ? (
        <aside className="source-panel">
          <div className="source-panel-header">
            <div>
              <span>{source.path}</span>
              <small>
                {source.language ?? "text"} · {shortSha(source.commitSha)}
              </small>
            </div>
            <button aria-label="Close source" onClick={() => setSource(null)} type="button">
              <X size={17} />
            </button>
          </div>
          {sourceRange.startLine ? (
            <div className="source-evidence-label">
              <CheckCircle2 size={14} /> Evidence lines {sourceRange.startLine}-
              {sourceRange.endLine}
            </div>
          ) : null}
          <pre className="source-code">
            {source.content.split(/\r?\n/).map((line, index) => {
              const lineNumber = source.startLine + index;
              const highlighted =
                sourceRange.startLine !== undefined &&
                lineNumber >= sourceRange.startLine &&
                lineNumber <= (sourceRange.endLine ?? sourceRange.startLine);
              return (
                <code className={highlighted ? "highlighted" : ""} key={lineNumber}>
                  <span>{lineNumber}</span>
                  {line || " "}
                </code>
              );
            })}
          </pre>
        </aside>
      ) : null}
    </div>
  );
}
