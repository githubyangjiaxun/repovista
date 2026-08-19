"use client";

import type { GraphLevel } from "@repovista/contracts";
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
  Layers3,
  Link2,
  LoaderCircle,
  Map as MapIcon,
  RefreshCw,
  Search,
  Send,
  Share2,
  Sparkles,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArchitectureMap } from "@/components/architecture-map";
import {
  ApiError,
  type AskResult,
  apiFetch,
  type CreateRepositoryResult,
  type GraphResponse,
  type RepositorySummary,
  type Snapshot,
  type SnapshotFilePage,
  type SnapshotFileSummary,
  type SourceFile,
} from "@/lib/api";

type WorkspaceTab = "ask" | "map" | "overview";

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
  return Object.entries(snapshot.stats.languages).sort((left, right) => right[1] - left[1]);
}

function sourceUrl(snapshotId: string, filePath: string, startLine?: number, endLine?: number) {
  const query = new URLSearchParams({ path: filePath });
  if (startLine) query.set("startLine", String(startLine));
  if (endLine) query.set("endLine", String(endLine));
  return `/v1/snapshots/${snapshotId}/source?${query.toString()}`;
}

export function RepositoryExplorer({ repositoryId }: { repositoryId: string }) {
  const router = useRouter();
  const [repository, setRepository] = useState<RepositorySummary | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [files, setFiles] = useState<SnapshotFileSummary[]>([]);
  const [fileFilter, setFileFilter] = useState("");
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [level, setLevel] = useState<GraphLevel>("package");
  const [mapQuery, setMapQuery] = useState("");
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const [source, setSource] = useState<SourceFile | null>(null);
  const [sourceRange, setSourceRange] = useState<{ startLine?: number; endLine?: number }>({});
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [graphLoading, setGraphLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGraph = useCallback(async (snapshotId: string, nextLevel: GraphLevel, query = "") => {
    setGraphLoading(true);
    try {
      const params = new URLSearchParams({ level: nextLevel });
      if (query.trim()) params.set("query", query.trim());
      setGraph(await apiFetch<GraphResponse>(`/v1/snapshots/${snapshotId}/map?${params}`));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to load the architecture map.");
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
        if (!nextRepository.latestSnapshotId) {
          throw new ApiError("This repository does not have a ready snapshot yet.", {
            code: "SNAPSHOT_NOT_READY",
            retryable: true,
          });
        }
        const [nextSnapshot, filePage] = await Promise.all([
          apiFetch<Snapshot>(`/v1/snapshots/${nextRepository.latestSnapshotId}`),
          apiFetch<SnapshotFilePage>(
            `/v1/snapshots/${nextRepository.latestSnapshotId}/files?pageSize=100`,
          ),
        ]);
        if (!active) return;
        setRepository(nextRepository);
        setSnapshot(nextSnapshot);
        setFiles(filePage.files);
        await loadGraph(nextSnapshot.id, "package");
      } catch (cause) {
        if (active) {
          setError(cause instanceof ApiError ? cause.message : "Unable to load this repository.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [loadGraph, repositoryId]);

  async function changeLevel(nextLevel: GraphLevel) {
    setLevel(nextLevel);
    if (snapshot) await loadGraph(snapshot.id, nextLevel, mapQuery);
  }

  async function openSource(filePath: string, startLine?: number, endLine?: number) {
    if (!snapshot) return;
    setSourceRange({ startLine, endLine });
    try {
      setSource(await apiFetch<SourceFile>(sourceUrl(snapshot.id, filePath, startLine, endLine)));
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Unable to load this source file.");
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
      setError(cause instanceof ApiError ? cause.message : "Unable to answer this question.");
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
          title: `${repository.owner}/${repository.name} architecture tour`,
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
      setError(cause instanceof ApiError ? cause.message : "Unable to create a share report.");
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
      setError(cause instanceof ApiError ? cause.message : "Unable to start reindexing.");
      setReindexing(false);
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
            Share tour
          </button>
        </div>
      </header>

      <aside className="workspace-sidebar">
        <a className="workspace-brand" href="/">
          <span className="brand-mark">R</span> RepoVista
        </a>
        <nav className="workspace-nav" aria-label="Repository views">
          <button
            className={tab === "overview" ? "active" : ""}
            onClick={() => setTab("overview")}
            type="button"
          >
            <Layers3 size={17} /> Overview
          </button>
          <button
            className={tab === "map" ? "active" : ""}
            onClick={() => setTab("map")}
            type="button"
          >
            <MapIcon size={17} /> Architecture map
          </button>
          <button
            className={tab === "ask" ? "active" : ""}
            onClick={() => setTab("ask")}
            type="button"
          >
            <Bot size={17} /> Ask repository
          </button>
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
              <span>{file.path}</span>
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
                  <button onClick={() => setTab("map")} type="button">
                    Explore <ArrowRight size={14} />
                  </button>
                </div>
                {graph ? <ArchitectureMap compact graph={graph} onOpenSource={openSource} /> : null}
              </article>
            </div>
            <article className="panel trust-panel">
              <div>
                <Sparkles size={19} />
                <strong>AI is an explanation layer, not the source of truth.</strong>
              </div>
              <p>
                Maps, files, symbols, edges, search, and source navigation work without a model.
                Answers only cite evidence saved for this commit.
              </p>
              <button className="secondary-button" onClick={() => setTab("ask")} type="button">
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
                    {answer.answer.provider} · {answer.answer.model}
                  </span>
                  <span>{answer.answer.citations.length} citations</span>
                </div>
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
