"use client";

import type { GuardrailComparison, GuardrailReport, Snapshot } from "@repovista/contracts";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Download,
  FileCode2,
  Info,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { apiErrorMessage, apiFetch, fetchGuardrailSarif } from "@/lib/api";

function metricText(metric: Record<string, string | number>): string {
  return Object.entries(metric)
    .map(([key, value]) => `${key.replaceAll(/([A-Z])/g, " $1").toLowerCase()}: ${value}`)
    .join(" · ");
}

export function GuardrailsPanel({
  snapshotId,
  availableSnapshots = [],
  onOpenSource,
  onOpenSnapshotSource,
}: {
  snapshotId: string;
  availableSnapshots?: Snapshot[];
  onOpenSource: (path: string, startLine?: number, endLine?: number) => void | Promise<void>;
  onOpenSnapshotSource?: (
    snapshotId: string,
    path: string,
    startLine?: number,
    endLine?: number,
  ) => void | Promise<void>;
}) {
  const [report, setReport] = useState<GuardrailReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [baselineSnapshotId, setBaselineSnapshotId] = useState("");
  const [comparison, setComparison] = useState<GuardrailComparison | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);

  const baselineSnapshots = availableSnapshots.filter(
    (item) => item.id !== snapshotId && item.status === "ready" && Boolean(item.commitSha),
  );

  useEffect(() => {
    let active = true;
    setBaselineSnapshotId("");
    setLoading(true);
    setError(null);
    apiFetch<GuardrailReport>(`/v1/snapshots/${snapshotId}/guardrails`)
      .then((result) => {
        if (active) setReport(result);
      })
      .catch((cause) => {
        if (active) setError(apiErrorMessage(cause, "Unable to evaluate architecture guardrails."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [snapshotId]);

  useEffect(() => {
    if (!baselineSnapshotId) {
      setComparison(null);
      setComparisonError(null);
      setComparisonLoading(false);
      return;
    }
    let active = true;
    setComparison(null);
    setComparisonLoading(true);
    setComparisonError(null);
    apiFetch<GuardrailComparison>(
      `/v1/snapshots/${encodeURIComponent(snapshotId)}/guardrails/compare?${new URLSearchParams({ baseSnapshotId: baselineSnapshotId })}`,
    )
      .then((result) => {
        if (active) setComparison(result);
      })
      .catch((cause) => {
        if (active) {
          setComparison(null);
          setComparisonError(apiErrorMessage(cause, "Unable to compare guardrails."));
        }
      })
      .finally(() => {
        if (active) setComparisonLoading(false);
      });
    return () => {
      active = false;
    };
  }, [baselineSnapshotId, snapshotId]);

  async function downloadSarif() {
    setDownloading(true);
    setError(null);
    try {
      const artifact = await fetchGuardrailSarif(snapshotId);
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
      setError(apiErrorMessage(cause, "Unable to download the SARIF report."));
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <section className="workspace-view guardrails-view">
        <output className="guardrails-loading">
          <LoaderCircle className="spin" size={24} /> Evaluating deterministic rules…
        </output>
      </section>
    );
  }

  if (!report) {
    return (
      <section className="workspace-view guardrails-view">
        <div className="guardrails-error" role="alert">
          <CircleAlert size={22} />
          <strong>Guardrails unavailable</strong>
          <p>{error ?? "The report could not be loaded."}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-view guardrails-view">
      <div className="guardrails-hero">
        <div>
          <p className="eyebrow">Architecture Guardrails · {report.algorithmVersion}</p>
          <h1>Deterministic checks with fixed source evidence.</h1>
          <p>
            Rules inspect the immutable graph for this commit. AI does not decide whether a check
            passes or fails.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={downloading}
          onClick={() => void downloadSarif()}
          type="button"
        >
          {downloading ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
          Download SARIF
        </button>
      </div>

      {error ? <div className="retrieval-alert">{error}</div> : null}

      {baselineSnapshots.length > 0 ? (
        <section className="guardrails-baseline" aria-label="Guardrails baseline comparison">
          <div>
            <strong>Compare with baseline</strong>
            <span>Use an earlier Ready Snapshot to find newly introduced architecture risks.</span>
          </div>
          <label>
            <span>Baseline snapshot</span>
            <select
              aria-label="Baseline snapshot"
              onChange={(event) => setBaselineSnapshotId(event.target.value)}
              value={baselineSnapshotId}
            >
              <option value="">Current snapshot only</option>
              {baselineSnapshots.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.commitSha?.slice(0, 12) ?? item.id.slice(0, 12)} ·{" "}
                  {item.requestedAt.slice(0, 10)}
                </option>
              ))}
            </select>
          </label>
        </section>
      ) : null}

      {comparisonLoading ? (
        <output className="guardrails-comparison-loading">
          <LoaderCircle className="spin" size={17} /> Comparing immutable snapshots…
        </output>
      ) : comparisonError ? (
        <div className="guardrails-error" role="alert">
          <CircleAlert size={18} />
          <span>{comparisonError}</span>
        </div>
      ) : comparison ? (
        <section className="guardrails-comparison" aria-label="Guardrails comparison result">
          <div className={`guardrails-comparison-summary comparison-${comparison.overall}`}>
            <div>
              <strong>Baseline comparison: {comparison.overall}</strong>
              <span>
                {comparison.summary.added} added · {comparison.summary.resolved} resolved ·{" "}
                {comparison.summary.changed} changed · {comparison.summary.unchanged} unchanged
              </span>
            </div>
            <small>
              {comparison.base.snapshot.commitSha.slice(0, 7)} →{" "}
              {comparison.head.snapshot.commitSha.slice(0, 7)}
            </small>
          </div>
          <div className="guardrails-comparison-findings">
            {comparison.findings.map((item) => {
              const evidence = item.head ?? item.base;
              const baseFinding = item.base;
              const headFinding = item.head;
              if (!evidence) return null;
              return (
                <article
                  className={`guardrails-comparison-finding comparison-${item.status}`}
                  key={`${item.key}:${item.status}:${evidence.id}`}
                >
                  <div>
                    <strong>{item.status}</strong>
                    <code>{evidence.ruleId}</code>
                  </div>
                  <p>{evidence.message}</p>
                  <div className="comparison-evidence-actions">
                    {baseFinding ? (
                      <button
                        onClick={() =>
                          void (onOpenSnapshotSource
                            ? onOpenSnapshotSource(
                                comparison.base.snapshot.id,
                                baseFinding.path,
                                baseFinding.startLine,
                                baseFinding.endLine,
                              )
                            : onOpenSource(
                                baseFinding.path,
                                baseFinding.startLine,
                                baseFinding.endLine,
                              ))
                        }
                        type="button"
                      >
                        Base · {baseFinding.path}:{baseFinding.startLine}
                      </button>
                    ) : null}
                    {headFinding ? (
                      <button
                        onClick={() =>
                          void (onOpenSnapshotSource
                            ? onOpenSnapshotSource(
                                comparison.head.snapshot.id,
                                headFinding.path,
                                headFinding.startLine,
                                headFinding.endLine,
                              )
                            : onOpenSource(
                                headFinding.path,
                                headFinding.startLine,
                                headFinding.endLine,
                              ))
                        }
                        type="button"
                      >
                        Head · {headFinding.path}:{headFinding.startLine}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className={`guardrails-status guardrails-${report.status}`}>
        {report.status === "pass" ? (
          <CheckCircle2 size={22} />
        ) : report.status === "fail" ? (
          <CircleAlert size={22} />
        ) : (
          <AlertTriangle size={22} />
        )}
        <div>
          <strong>
            {report.status === "pass" ? "All checks passed" : `${report.summary.total} findings`}
          </strong>
          <span>
            {report.summary.errors} errors · {report.summary.warnings} warnings ·{" "}
            {report.summary.infos} infos
          </span>
        </div>
        <small>{report.snapshot.commitSha.slice(0, 12)}</small>
      </div>

      <section className="guardrail-thresholds" aria-label="Guardrail thresholds">
        <article>
          <ShieldCheck size={17} />
          <strong>{report.thresholds.cycleMaxLength}</strong>
          <span>max cycle packages</span>
        </article>
        <article>
          <FileCode2 size={17} />
          <strong>{report.thresholds.largeFileLines}</strong>
          <span>file line threshold</span>
        </article>
        <article>
          <FileCode2 size={17} />
          <strong>{report.thresholds.largeSymbolLines}</strong>
          <span>symbol line threshold</span>
        </article>
        <article>
          <ShieldCheck size={17} />
          <strong>{report.thresholds.highFanIn}</strong>
          <span>fan-in threshold</span>
        </article>
      </section>

      {report.findings.length === 0 ? (
        <div className="guardrails-empty">
          <CheckCircle2 size={27} />
          <strong>No architecture findings for this Snapshot.</strong>
          <span>Reindex a later commit to evaluate it against the same fixed profile.</span>
        </div>
      ) : (
        <div className="guardrail-findings">
          {report.findings.map((finding) => (
            <article className={`guardrail-finding finding-${finding.severity}`} key={finding.id}>
              <div className="guardrail-finding-icon">
                {finding.severity === "error" ? (
                  <CircleAlert size={19} />
                ) : finding.severity === "warning" ? (
                  <AlertTriangle size={19} />
                ) : (
                  <Info size={19} />
                )}
              </div>
              <div className="guardrail-finding-body">
                <div>
                  <span>{finding.severity}</span>
                  <code>{finding.ruleId}</code>
                </div>
                <h2>{finding.title}</h2>
                <p>{finding.message}</p>
                <small>{metricText(finding.metric)}</small>
              </div>
              <button
                aria-label={`Open evidence for ${finding.title}`}
                onClick={() => void onOpenSource(finding.path, finding.startLine, finding.endLine)}
                type="button"
              >
                <FileCode2 size={14} />
                {finding.path}:{finding.startLine}-{finding.endLine}
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
