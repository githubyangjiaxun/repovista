"use client";

import type {
  GuardrailComparison,
  GuardrailExplanation,
  GuardrailProfile,
  GuardrailReport,
  Snapshot,
} from "@repovista/contracts";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Download,
  FileCode2,
  Info,
  LoaderCircle,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useOptionalAuth } from "@/components/auth-provider";
import {
  apiErrorMessage,
  apiFetch,
  fetchGuardrailSarif,
  type GuardrailExplanationResult,
} from "@/lib/api";

function metricText(metric: Record<string, string | number>): string {
  return Object.entries(metric)
    .map(([key, value]) => `${key.replaceAll(/([A-Z])/g, " $1").toLowerCase()}: ${value}`)
    .join(" · ");
}

export function GuardrailsPanel({
  repositoryId,
  snapshotId,
  availableSnapshots = [],
  onOpenSource,
  onOpenSnapshotSource,
}: {
  repositoryId: string;
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
  const session = useOptionalAuth()?.session ?? null;
  const canManageProfiles = Boolean(
    session?.authenticated && session.workspace && session.workspace.role !== "viewer",
  );
  const canRequestExplanations = !session?.authenticated || session.workspace?.role !== "viewer";
  const [report, setReport] = useState<GuardrailReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [baselineSnapshotId, setBaselineSnapshotId] = useState("");
  const [comparison, setComparison] = useState<GuardrailComparison | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [profiles, setProfiles] = useState<GuardrailProfile[]>([]);
  const [repositoryProfile, setRepositoryProfile] = useState<GuardrailProfile | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [assigningProfile, setAssigningProfile] = useState(false);
  const [assignmentMessage, setAssignmentMessage] = useState<string | null>(null);
  const [explanations, setExplanations] = useState<Record<string, GuardrailExplanation>>({});
  const [explanationErrors, setExplanationErrors] = useState<Record<string, string>>({});
  const [explainingFindingId, setExplainingFindingId] = useState<string | null>(null);
  const profileRequest = useRef(0);
  const explanationRequest = useRef(0);

  const baselineSnapshots = availableSnapshots.filter(
    (item) => item.id !== snapshotId && item.status === "ready" && Boolean(item.commitSha),
  );

  useEffect(() => {
    let active = true;
    setBaselineSnapshotId("");
    setReport(null);
    setLoading(true);
    setError(null);
    setExplanations({});
    setExplanationErrors({});
    setExplainingFindingId(null);
    explanationRequest.current += 1;
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
    const request = ++profileRequest.current;
    let active = true;
    setProfiles([]);
    setRepositoryProfile(null);
    setSelectedProfileId("");
    setProfilesLoading(true);
    setProfilesError(null);
    setAssigningProfile(false);
    setAssignmentMessage(null);
    Promise.all([
      apiFetch<GuardrailProfile[]>("/v1/guardrail-profiles"),
      apiFetch<GuardrailProfile>(
        `/v1/repositories/${encodeURIComponent(repositoryId)}/guardrail-profile`,
      ),
    ])
      .then(([available, current]) => {
        if (!active || profileRequest.current !== request) return;
        setProfiles(available);
        setRepositoryProfile(current);
        setSelectedProfileId(current.id);
      })
      .catch((cause) => {
        if (active && profileRequest.current === request) {
          setProfilesError(apiErrorMessage(cause, "Unable to load Guardrail policy profiles."));
        }
      })
      .finally(() => {
        if (active && profileRequest.current === request) setProfilesLoading(false);
      });
    return () => {
      active = false;
      profileRequest.current += 1;
    };
  }, [repositoryId]);

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

  async function assignProfile() {
    if (!canManageProfiles || !selectedProfileId || selectedProfileId === repositoryProfile?.id) {
      return;
    }
    const request = ++profileRequest.current;
    setAssigningProfile(true);
    setProfilesError(null);
    setAssignmentMessage(null);
    try {
      const selected = profiles.find((profile) => profile.id === selectedProfileId);
      if (!selected) throw new Error("The selected Guardrail profile is unavailable.");
      const next = await apiFetch<GuardrailProfile>(
        `/v1/repositories/${encodeURIComponent(repositoryId)}/guardrail-profile`,
        {
          method: "PUT",
          body: JSON.stringify({ profileId: selected.builtIn ? null : selected.id }),
        },
      );
      if (profileRequest.current !== request) return;
      setRepositoryProfile(next);
      setSelectedProfileId(next.id);
      setAssignmentMessage(
        `${next.profileKey} v${next.version} will apply to newly created Snapshots only.`,
      );
    } catch (cause) {
      if (profileRequest.current === request) {
        setProfilesError(apiErrorMessage(cause, "Unable to assign the Guardrail policy profile."));
      }
    } finally {
      if (profileRequest.current === request) setAssigningProfile(false);
    }
  }

  async function explainFinding(findingId: string) {
    const request = ++explanationRequest.current;
    setExplainingFindingId(findingId);
    setExplanationErrors((current) => ({ ...current, [findingId]: "" }));
    try {
      const result = await apiFetch<GuardrailExplanationResult>(
        `/v1/snapshots/${encodeURIComponent(snapshotId)}/guardrails/explanations`,
        {
          method: "POST",
          body: JSON.stringify({ findingId }),
        },
      );
      if (request !== explanationRequest.current) return;
      setExplanations((current) => ({ ...current, [findingId]: result.explanation }));
    } catch (cause) {
      if (request !== explanationRequest.current) return;
      setExplanationErrors((current) => ({
        ...current,
        [findingId]: apiErrorMessage(cause, "Unable to generate a verified explanation."),
      }));
    } finally {
      if (request === explanationRequest.current) setExplainingFindingId(null);
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

      <section className="guardrails-policy" aria-label="Guardrail policy profile">
        <div className="guardrails-policy-snapshot">
          <div>
            <ShieldCheck size={18} />
            <span>Snapshot policy</span>
          </div>
          {report.profile ? (
            <>
              <strong>
                {report.profile.profileKey} v{report.profile.version}
              </strong>
              <code title={report.profile.fingerprint}>
                {report.profile.fingerprint.slice(0, 19)}…
              </code>
              <p>{report.profile.description || "No profile description."}</p>
            </>
          ) : (
            <>
              <strong>Legacy default</strong>
              <p>This report predates profile provenance and uses the built-in thresholds.</p>
            </>
          )}
          <small>
            This Snapshot is immutable; changing the repository default cannot rewrite it.
          </small>
        </div>

        <div className="guardrails-policy-assignment">
          <div>
            <strong>Policy for future Snapshots</strong>
            <span>Choose a reviewed immutable version. AI cannot modify or apply policies.</span>
          </div>
          {profilesError ? (
            <div className="guardrails-policy-error" role="alert">
              {profilesError}
            </div>
          ) : null}
          {profilesLoading ? (
            <output>
              <LoaderCircle className="spin" size={15} /> Loading policy profiles…
            </output>
          ) : repositoryProfile && profiles.length > 0 ? (
            <div className="guardrails-policy-controls">
              <label>
                <span>Repository default</span>
                <select
                  aria-label="Repository Guardrail profile"
                  disabled={!canManageProfiles || assigningProfile}
                  onChange={(event) => {
                    setSelectedProfileId(event.target.value);
                    setAssignmentMessage(null);
                  }}
                  value={selectedProfileId}
                >
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.profileKey} v{profile.version} · {profile.name}
                    </option>
                  ))}
                </select>
              </label>
              {canManageProfiles ? (
                <button
                  className="secondary-button"
                  disabled={
                    assigningProfile ||
                    !selectedProfileId ||
                    selectedProfileId === repositoryProfile.id
                  }
                  onClick={() => void assignProfile()}
                  type="button"
                >
                  {assigningProfile ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Save size={15} />
                  )}
                  Apply to future Snapshots
                </button>
              ) : (
                <small>
                  {session?.authenticated
                    ? "Viewer access is read-only."
                    : "Sign in as an Editor or Owner to change the repository default."}
                </small>
              )}
            </div>
          ) : profilesError ? null : (
            <p>No policy profiles are available for this workspace.</p>
          )}
          {repositoryProfile ? (
            <small>
              Current default: {repositoryProfile.profileKey} v{repositoryProfile.version} ·{" "}
              {repositoryProfile.fingerprint.slice(0, 19)}…
            </small>
          ) : null}
          {assignmentMessage ? (
            <div className="guardrails-policy-success">{assignmentMessage}</div>
          ) : null}
        </div>
      </section>

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
                {canRequestExplanations ? (
                  <div className="guardrail-explanation-actions">
                    <button
                      aria-label={`Explain ${finding.title} with AI`}
                      aria-busy={explainingFindingId === finding.id}
                      disabled={explainingFindingId === finding.id}
                      onClick={() => void explainFinding(finding.id)}
                      type="button"
                    >
                      {explainingFindingId === finding.id ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : null}
                      {explainingFindingId === finding.id
                        ? "Verifying explanation…"
                        : "Explain with AI"}
                    </button>
                  </div>
                ) : null}
                {explanationErrors[finding.id] ? (
                  <div className="guardrail-explanation-error" role="alert">
                    {explanationErrors[finding.id]}
                  </div>
                ) : null}
                {explanations[finding.id] ? (
                  <section
                    className="guardrail-explanation"
                    aria-label="Verified Guardrail explanation"
                  >
                    <div className="guardrail-explanation-meta">
                      <strong>
                        Verified explanation · {explanations[finding.id]?.answer.status}
                      </strong>
                      <span>
                        {explanations[finding.id]?.answer.provider} ·{" "}
                        {explanations[finding.id]?.answer.model}
                      </span>
                    </div>
                    <div className="guardrail-explanation-provenance">
                      <span>
                        {explanations[finding.id]?.finding.ruleId} ·{" "}
                        {explanations[finding.id]?.finding.severity}
                      </span>
                      <code title={explanations[finding.id]?.finding.fingerprint}>
                        {explanations[finding.id]?.finding.fingerprint.slice(0, 19)}
                      </code>
                    </div>
                    <p>{explanations[finding.id]?.answer.summary}</p>
                    {explanations[finding.id]?.answer.steps.length ? (
                      <ol>
                        {explanations[finding.id]?.answer.steps.map((step, index) => (
                          <li key={`${finding.id}-explanation-${index}`}>{step.text}</li>
                        ))}
                      </ol>
                    ) : null}
                    {explanations[finding.id]?.answer.limitations.length ? (
                      <ul className="guardrail-explanation-limitations">
                        {explanations[finding.id]?.answer.limitations.map((limitation, index) => (
                          <li key={`${finding.id}-limitation-${index}`}>{limitation}</li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="guardrail-explanation-provenance">
                      <span title={explanations[finding.id]?.snapshot.commitSha}>
                        commit {explanations[finding.id]?.snapshot.commitSha.slice(0, 12)}
                      </span>
                      <span title={explanations[finding.id]?.profileFingerprint}>
                        profile {explanations[finding.id]?.profileFingerprint.slice(0, 19)}
                      </span>
                      <code>{explanations[finding.id]?.promptVersion}</code>
                      <span>
                        {explanations[finding.id]?.answer.citations.length} fixed citations
                      </span>
                    </div>
                    {explanations[finding.id]?.answer.citations.map((citation) => (
                      <button
                        key={`${finding.id}-${citation.evidenceId}`}
                        onClick={() =>
                          void onOpenSource(citation.path, citation.startLine, citation.endLine)
                        }
                        type="button"
                      >
                        <FileCode2 size={13} /> {citation.path}:{citation.startLine}-
                        {citation.endLine}
                      </button>
                    ))}
                  </section>
                ) : null}
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
