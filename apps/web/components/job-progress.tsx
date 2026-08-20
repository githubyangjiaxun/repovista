"use client";

import { Check, Circle, CircleX, LoaderCircle, Radio, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiErrorMessage, apiFetch, apiOrigin, type Job } from "@/lib/api";

const stages = [
  { key: "starting", label: "Reserve an immutable snapshot" },
  { key: "cloning", label: "Clone the fixed Git commit" },
  { key: "scanning", label: "Scan safe source files" },
  { key: "parsing", label: "Parse TypeScript, JavaScript, and Python" },
  { key: "building_graph", label: "Resolve symbols and relationships" },
  { key: "persisting", label: "Build searchable evidence" },
  { key: "completed", label: "Snapshot ready" },
];

function stageIndex(phase: string | null): number {
  const index = stages.findIndex((stage) => stage.key === phase);
  return index < 0 ? 0 : index;
}

export function JobProgress({
  jobId,
  repositoryId,
  snapshotId,
}: {
  jobId: string;
  repositoryId?: string;
  snapshotId?: string;
}) {
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamConnected, setStreamConnected] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const navigationScheduled = useRef(false);
  const navigationTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await apiFetch<Job>(`/v1/jobs/${jobId}`);
      setJob(next);
      setError(null);
      if (next.status === "succeeded" && repositoryId && !navigationScheduled.current) {
        navigationScheduled.current = true;
        const destination = snapshotId
          ? `/repositories/${repositoryId}?snapshotId=${encodeURIComponent(snapshotId)}`
          : `/repositories/${repositoryId}`;
        navigationTimer.current = window.setTimeout(() => {
          navigationTimer.current = null;
          router.replace(destination);
        }, 900);
      }
    } catch (cause) {
      setError(apiErrorMessage(cause, "Unable to load job progress."));
    }
  }, [jobId, repositoryId, router, snapshotId]);

  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => void refresh(), 2_000);
    const events = new EventSource(`${apiOrigin}/v1/jobs/${jobId}/events`);
    const update = (event: Event) => {
      if (event instanceof MessageEvent) {
        try {
          const payload = JSON.parse(event.data) as { message?: unknown };
          if (typeof payload.message === "string" && payload.message.trim()) {
            setProgressMessage(payload.message.trim());
          }
        } catch {
          // Polling still provides authoritative progress if an event payload is malformed.
        }
      }
      void refresh();
    };
    const terminal = (event: Event) => {
      update(event);
      events.close();
    };
    events.onopen = () => setStreamConnected(true);
    events.onerror = () => setStreamConnected(false);
    events.addEventListener("progress", update);
    events.addEventListener("started", update);
    events.addEventListener("completed", terminal);
    events.addEventListener("failed", terminal);
    events.addEventListener("cancelled", terminal);
    return () => {
      window.clearInterval(poll);
      events.close();
      if (navigationTimer.current !== null) {
        window.clearTimeout(navigationTimer.current);
        navigationTimer.current = null;
        navigationScheduled.current = false;
      }
    };
  }, [jobId, refresh]);

  const currentStage = useMemo(() => stageIndex(job?.phase ?? null), [job?.phase]);

  async function cancel() {
    if (!snapshotId) return;
    setCancelling(true);
    try {
      await apiFetch(`/v1/snapshots/${snapshotId}/cancel`, { method: "POST" });
      await refresh();
    } catch (cause) {
      setError(apiErrorMessage(cause, "Unable to cancel this analysis."));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="progress-card">
      <div className="progress-heading">
        <div>
          <p className="eyebrow">Immutable snapshot pipeline</p>
          <h1>
            {job?.status === "succeeded"
              ? "Your code map is ready."
              : "Building your repository map."}
          </h1>
          <p>
            {job?.status === "failed"
              ? job.error?.message
              : "You can leave this page. Progress is stored in PostgreSQL and resumes after refresh."}
          </p>
        </div>
        <span className={`live-badge ${streamConnected ? "online" : "fallback"}`}>
          <Radio size={14} />
          {streamConnected ? "Live updates" : "Polling fallback"}
        </span>
      </div>

      <div
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round((job?.progress ?? 0) * 100)}
        className="progress-meter"
        aria-label={`${Math.round((job?.progress ?? 0) * 100)} percent complete`}
        role="progressbar"
      >
        <span style={{ width: `${Math.round((job?.progress ?? 0) * 100)}%` }} />
      </div>
      <div className="progress-number">
        <strong>{Math.round((job?.progress ?? 0) * 100)}%</strong>
        <span>
          {job?.processed !== null && job?.total !== null
            ? `${job?.processed ?? 0} / ${job?.total ?? 0}`
            : (job?.phase ?? "queued")}
        </span>
      </div>

      {progressMessage ? (
        <p className="progress-message" aria-live="polite">
          {progressMessage}
        </p>
      ) : null}

      <ol className="stage-list">
        {stages.map((stage, index) => {
          const failed = job?.status === "failed" && index === currentStage;
          const cancelled = job?.status === "cancelled" && index === currentStage;
          const complete = job?.status === "succeeded" || index < currentStage;
          const active = !complete && index === currentStage && !failed && !cancelled;
          return (
            <li
              className={
                active ? "active" : complete ? "complete" : failed || cancelled ? "failed" : ""
              }
              key={stage.key}
            >
              <span className="stage-icon">
                {complete ? (
                  <Check size={16} />
                ) : failed || cancelled ? (
                  <CircleX size={16} />
                ) : active ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Circle size={13} />
                )}
              </span>
              <span>{stage.label}</span>
            </li>
          );
        })}
      </ol>

      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="progress-actions">
        {job?.status === "succeeded" && repositoryId ? (
          <Link
            className="primary-button"
            href={
              snapshotId
                ? `/repositories/${repositoryId}?snapshotId=${encodeURIComponent(snapshotId)}`
                : `/repositories/${repositoryId}`
            }
          >
            Open repository map
          </Link>
        ) : null}
        {job?.status === "failed" && job.retryable ? (
          <button className="secondary-button" onClick={() => void refresh()} type="button">
            <RotateCcw size={16} /> Retry status
          </button>
        ) : null}
        {job && ["queued", "running"].includes(job.status) && snapshotId ? (
          <button
            className="text-button danger-text"
            disabled={cancelling}
            onClick={() => void cancel()}
            type="button"
          >
            <X size={16} /> {cancelling ? "Cancelling…" : "Cancel analysis"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
