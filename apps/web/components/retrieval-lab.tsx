"use client";

import type { RetrievalMode } from "@repovista/contracts";
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Database,
  FileCode2,
  GitCommitHorizontal,
  Hash,
  LoaderCircle,
  Search,
  Settings2,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  apiErrorMessage,
  apiFetch,
  type CreateEmbeddingIndexResponse,
  type RetrievalStatus,
  type SearchResult,
} from "@/lib/api";

const modes: { value: RetrievalMode; label: string; description: string }[] = [
  { value: "text", label: "Text", description: "Full-text and path matching" },
  { value: "symbol", label: "Symbol", description: "Names, qualified symbols, and paths" },
  { value: "semantic", label: "Semantic", description: "Embedding similarity only" },
  { value: "hybrid", label: "Hybrid", description: "Deterministic RRF across channels" },
];
const modeValues = new Set<RetrievalMode>(modes.map((item) => item.value));

function reasonLabel(reason: string | null): string {
  if (!reason) return "Ready";
  return reason.replaceAll("_", " ");
}

function channelLabel(channel: string): string {
  return `${channel.charAt(0).toUpperCase()}${channel.slice(1)}`;
}

function searchKey(snapshotId: string, query: string, mode: RetrievalMode, limit: number): string {
  return `${snapshotId}:${mode}:${limit}:${query.trim()}`;
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

export function RetrievalLab({
  snapshotId,
  onOpenSource,
  initialQuery = "",
  initialMode = "hybrid",
  initialLimit = 20,
  onSearchSubmitted,
}: {
  snapshotId: string;
  onOpenSource: (path: string, startLine?: number, endLine?: number) => void;
  initialQuery?: string;
  initialMode?: RetrievalMode;
  initialLimit?: number;
  onSearchSubmitted?: (input: { query: string; mode: RetrievalMode; limit: number }) => void;
}) {
  const [mode, setMode] = useState<RetrievalMode>(initialMode);
  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [limit, setLimit] = useState(initialLimit);
  const [status, setStatus] = useState<RetrievalStatus | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [queuedJobId, setQueuedJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusGeneration = useRef(0);
  const searchGeneration = useRef(0);
  const searchAbort = useRef<AbortController | null>(null);
  const lastSearchKey = useRef("");
  const initialSearch = useRef({
    snapshotId,
    query: initialQuery,
    mode: initialMode,
    limit: initialLimit,
  });
  initialSearch.current = {
    snapshotId,
    query: initialQuery,
    mode: initialMode,
    limit: initialLimit,
  };

  const loadStatus = useCallback(
    async (quiet = false) => {
      const generation = statusGeneration.current + 1;
      statusGeneration.current = generation;
      if (!quiet) setStatusLoading(true);
      try {
        const nextStatus = await apiFetch<RetrievalStatus>(
          `/v1/snapshots/${encodeURIComponent(snapshotId)}/retrieval`,
        );
        if (generation !== statusGeneration.current) return;
        setStatus(nextStatus);
        setQueuedJobId(nextStatus.semantic.currentIndex?.jobId ?? null);
        setError(null);
      } catch (cause) {
        if (generation !== statusGeneration.current) return;
        setError(apiErrorMessage(cause, "Unable to load retrieval status."));
      } finally {
        if (!quiet && generation === statusGeneration.current) setStatusLoading(false);
      }
    },
    [snapshotId],
  );

  useEffect(() => {
    setStatus(null);
    setResult(null);
    setSubmittedQuery("");
    setQueuedJobId(null);
    setError(null);
    void loadStatus();
    return () => {
      statusGeneration.current += 1;
      searchGeneration.current += 1;
      lastSearchKey.current = "";
      searchAbort.current?.abort();
    };
  }, [loadStatus]);

  const executeSearch = useCallback(
    async (nextQuery: string, nextMode: RetrievalMode, nextLimit: number) => {
      const normalizedQuery = nextQuery.trim();
      if (normalizedQuery.length < 2) return;
      const generation = searchGeneration.current + 1;
      searchGeneration.current = generation;
      searchAbort.current?.abort();
      const controller = new AbortController();
      searchAbort.current = controller;
      lastSearchKey.current = searchKey(snapshotId, normalizedQuery, nextMode, nextLimit);
      setSubmittedQuery(normalizedQuery);
      setLoading(true);
      setError(null);
      try {
        const nextResult = await apiFetch<SearchResult>(
          `/v1/snapshots/${encodeURIComponent(snapshotId)}/search?${new URLSearchParams({
            q: normalizedQuery,
            mode: nextMode,
            limit: String(nextLimit),
          })}`,
          { signal: controller.signal },
        );
        if (generation === searchGeneration.current) setResult(nextResult);
      } catch (cause) {
        if (generation === searchGeneration.current && !isAbortError(cause)) {
          setResult(null);
          setError(apiErrorMessage(cause, "Unable to search this snapshot."));
        }
      } finally {
        if (generation === searchGeneration.current) setLoading(false);
      }
    },
    [snapshotId],
  );

  useEffect(() => {
    const initial = initialSearch.current;
    setQuery(initial.query);
    setMode(initial.mode);
    setLimit(initial.limit);
    const nextKey = searchKey(initial.snapshotId, initial.query, initial.mode, initial.limit);
    if (initial.query.trim().length < 2) return;
    const timer = window.setTimeout(() => {
      if (lastSearchKey.current !== nextKey) {
        void executeSearch(initial.query, initial.mode, initial.limit);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [executeSearch]);

  useEffect(() => {
    function restoreSearchFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const nextQuery = params.get("q") ?? "";
      const rawMode = params.get("mode") as RetrievalMode | null;
      const nextMode = rawMode && modeValues.has(rawMode) ? rawMode : "hybrid";
      const rawLimit = Number.parseInt(params.get("limit") ?? "20", 10);
      const nextLimit = Number.isInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 20;
      setQuery(nextQuery);
      setMode(nextMode);
      setLimit(nextLimit);
      if (nextQuery.trim().length >= 2) void executeSearch(nextQuery, nextMode, nextLimit);
      else {
        searchGeneration.current += 1;
        searchAbort.current?.abort();
        setResult(null);
        setSubmittedQuery("");
        setLoading(false);
      }
    }

    window.addEventListener("popstate", restoreSearchFromUrl);
    return () => window.removeEventListener("popstate", restoreSearchFromUrl);
  }, [executeSearch]);

  const workingIndex = status?.semantic.currentIndex;
  useEffect(() => {
    if (workingIndex?.status !== "queued" && workingIndex?.status !== "running") return;
    const timer = window.setInterval(() => void loadStatus(true), 1_500);
    return () => window.clearInterval(timer);
  }, [loadStatus, workingIndex?.status]);

  async function buildEmbeddingIndex() {
    setBuilding(true);
    setError(null);
    try {
      const response = await apiFetch<CreateEmbeddingIndexResponse>(
        `/v1/snapshots/${encodeURIComponent(snapshotId)}/embeddings`,
        { method: "POST" },
      );
      setQueuedJobId(response.jobId);
      await loadStatus(true);
    } catch (cause) {
      setError(apiErrorMessage(cause, "Unable to queue the semantic index."));
    } finally {
      setBuilding(false);
    }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    void executeSearch(query, mode, limit);
    onSearchSubmitted?.({ query: query.trim(), mode, limit });
  }

  const semantic = status?.semantic;
  const semanticReady = semantic?.queryable === true;
  const displayedIndex = semantic?.currentIndex ?? semantic?.latestIndex;
  const indexJobId = displayedIndex?.jobId ?? queuedJobId;
  const indexInProgress =
    displayedIndex?.status === "queued" || displayedIndex?.status === "running";
  const indexProgress =
    displayedIndex && displayedIndex.totalChunks > 0
      ? Math.min(
          100,
          Math.round((displayedIndex.embeddedChunks / displayedIndex.totalChunks) * 100),
        )
      : 0;

  return (
    <section className="workspace-view retrieval-view" aria-labelledby="retrieval-title">
      <div className="view-title compact-title">
        <div>
          <p className="eyebrow">Transparent retrieval lab</p>
          <h1 id="retrieval-title">Search evidence without hiding the ranking.</h1>
          <p>
            Every result stays pinned to this snapshot. Raw channel scores, ranks, and any semantic
            degradation are shown beside the source range.
          </p>
        </div>
        <div className="retrieval-trust-mark" title="Evidence is commit-pinned">
          <Database size={20} />
          <span>fixed snapshot</span>
        </div>
      </div>

      <article className="panel embedding-status-card">
        <div className="panel-heading">
          <div>
            <span>
              <BrainCircuit size={16} /> Semantic index
            </span>
            <small>
              {statusLoading
                ? "Checking provider and profile…"
                : semantic?.configured
                  ? `${displayedIndex?.provider ?? "configured"} · ${displayedIndex?.model ?? "no index yet"}`
                  : "No embedding provider configured; lexical search remains available."}
            </small>
          </div>
          <span className={`retrieval-status-pill ${semanticReady ? "ready" : "muted"}`}>
            {semanticReady ? <CheckCircle2 size={14} /> : <Settings2 size={14} />}
            {reasonLabel(semantic ? semantic.reason : "provider_disabled")}
          </span>
        </div>
        <div className="embedding-status-body">
          <div className="embedding-facts">
            <span>
              Provider <strong>{displayedIndex?.provider ?? "none"}</strong>
            </span>
            <span>
              Model <strong>{displayedIndex?.model ?? "—"}</strong>
            </span>
            <span>
              Dimensions <strong>{displayedIndex?.dimensions ?? "—"}</strong>
            </span>
            <span>
              Chunks{" "}
              <strong>
                {displayedIndex
                  ? `${displayedIndex.embeddedChunks}/${displayedIndex.totalChunks}`
                  : "—"}
              </strong>
            </span>
          </div>
          {indexInProgress && displayedIndex ? (
            <div className="embedding-progress-block">
              <div>
                <span>{displayedIndex.status === "queued" ? "Queued" : "Embedding chunks"}</span>
                <strong>
                  {displayedIndex.embeddedChunks}/{displayedIndex.totalChunks} · {indexProgress}%
                </strong>
              </div>
              <progress
                aria-label="Semantic index progress"
                max={Math.max(1, displayedIndex.totalChunks)}
                value={displayedIndex.embeddedChunks}
              />
            </div>
          ) : null}
          {displayedIndex?.failure ? (
            <div className="embedding-failure" role="alert">
              <AlertTriangle size={15} />
              <span>
                <strong>{displayedIndex.failure.code}</strong> {displayedIndex.failure.message}
                {displayedIndex.failure.retryable ? " Retry is available." : ""}
              </span>
            </div>
          ) : null}
          {!semanticReady ? (
            <div className="embedding-cta">
              <p>
                {semantic?.configured
                  ? "Build or retry the profile to unlock Semantic and the semantic channel in Hybrid."
                  : "Set EMBEDDING_PROVIDER and EMBEDDING_MODEL on the API/Worker to enable real semantic retrieval."}
              </p>
              {semantic?.configured ? (
                <button
                  className="secondary-button"
                  disabled={building || indexInProgress}
                  onClick={() => void buildEmbeddingIndex()}
                  type="button"
                >
                  {building || indexInProgress ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Sparkles size={15} />
                  )}
                  {building
                    ? "Queueing…"
                    : indexInProgress
                      ? "Indexing…"
                      : displayedIndex?.status === "failed" ||
                          displayedIndex?.status === "cancelled"
                        ? "Retry index"
                        : "Build index"}
                </button>
              ) : null}
              {indexJobId ? (
                <Link className="text-link embedding-job-link" href={`/jobs/${indexJobId}`}>
                  View job
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </article>

      <form className="retrieval-search-form" onSubmit={search}>
        <div className="retrieval-mode-tabs" role="tablist" aria-label="Retrieval mode">
          {modes.map((item) => (
            <button
              aria-selected={mode === item.value}
              className={mode === item.value ? "active" : ""}
              key={item.value}
              onClick={() => setMode(item.value)}
              role="tab"
              title={item.description}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="retrieval-query-row">
          <Search size={18} />
          <input
            aria-label="Search query"
            maxLength={4000}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Where is response compression configured?"
            value={query}
          />
          <label>
            <span>Limit</span>
            <select
              aria-label="Result limit"
              onChange={(event) => setLimit(Number(event.target.value))}
              value={limit}
            >
              {[10, 20, 50, 100].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button" disabled={query.trim().length < 2} type="submit">
            {loading ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
      </form>

      {error ? (
        <div className="retrieval-alert" role="alert">
          <AlertTriangle size={16} /> {error}
        </div>
      ) : null}

      {result ? (
        <div className="retrieval-results" aria-live="polite">
          <div className="retrieval-result-summary">
            <div>
              <span className="eyebrow">Trace</span>
              <strong>{result.results.length} evidence hits</strong>
              <small>
                “{submittedQuery}” · {result.trace.usedChannels.join(" + ") || "No channels used"}
                {result.trace.embeddingIndex
                  ? ` · ${result.trace.embeddingIndex.model} · ${result.trace.embeddingIndex.dimensions ?? "?"}d`
                  : ""}
              </small>
            </div>
            {result.trace.degraded ? (
              <div className="retrieval-degraded">
                <AlertTriangle size={15} /> Hybrid degraded:{" "}
                {reasonLabel(result.trace.degradationReason)}
              </div>
            ) : (
              <div className="retrieval-complete">
                <CheckCircle2 size={15} /> Complete channel trace
              </div>
            )}
          </div>
          <div className="retrieval-channel-trace">
            {result.trace.channels.map((channel) => (
              <span className={`trace-${channel.status}`} key={channel.channel}>
                {channelLabel(channel.channel)} · {channel.status} · {channel.candidateCount}{" "}
                candidates
                {channel.reason ? ` · ${reasonLabel(channel.reason)}` : ""} ·{" "}
                {channel.latencyMs === null ? "—" : `${channel.latencyMs}ms`}
              </span>
            ))}
          </div>
          {result.results.length > 0 ? (
            result.results.map((hit, index) => (
              <article className="retrieval-hit" key={hit.id}>
                <div className="retrieval-hit-rank">{index + 1}</div>
                <div className="retrieval-hit-body">
                  <button
                    className="retrieval-hit-path"
                    onClick={() => onOpenSource(hit.path, hit.startLine, hit.endLine)}
                    type="button"
                  >
                    <FileCode2 size={15} /> {hit.path}:{hit.startLine}-{hit.endLine}
                  </button>
                  <div className="retrieval-hit-facts">
                    <span>{hit.symbol ?? "file evidence"}</span>
                    <span>
                      <GitCommitHorizontal size={12} /> {hit.commitSha.slice(0, 7)}
                    </span>
                    <span title={hit.contentHash}>
                      <Hash size={12} /> {hit.contentHash.slice(0, 18)}
                    </span>
                  </div>
                  <p>{hit.content}</p>
                  <div className="retrieval-hit-footer">
                    <div className="retrieval-signals">
                      <strong>Fusion {hit.score.toFixed(4)}</strong>
                      {hit.signals.map((signal) => (
                        <span key={`${hit.id}-${signal.channel}`}>
                          {channelLabel(signal.channel)} #{signal.rank} ·{" "}
                          {signal.rawScore.toFixed(4)}
                        </span>
                      ))}
                    </div>
                    <button
                      className="retrieval-open-source"
                      onClick={() => onOpenSource(hit.path, hit.startLine, hit.endLine)}
                      type="button"
                    >
                      Open source
                    </button>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className="retrieval-empty">No evidence matched this query.</div>
          )}
        </div>
      ) : (
        <div className="retrieval-empty retrieval-empty-intro">
          <Search size={26} />
          <strong>Run a search to inspect evidence and channel ranks.</strong>
          <span>
            Semantic-only fails clearly when its profile is unavailable; Hybrid keeps lexical
            results and tells you why.
          </span>
        </div>
      )}
    </section>
  );
}
