"use client";

import type {
  GuardrailComparison,
  GuardrailExplanation,
  GuardrailExplanationComparison,
  GuardrailExplanationHistory,
  GuardrailExplanationSummary,
  GuardrailProfile,
  GuardrailReport,
  GuardrailReview,
  GuardrailReviewHistoryPage,
  GuardrailReviewsResponse,
  Snapshot,
} from "@repovista/contracts";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Download,
  FileCode2,
  GitCompareArrows,
  History,
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
  applyGuardrailReviewBatch,
  fetchGuardrailJson,
  fetchGuardrailSarif,
  type GuardrailExplanationResult,
} from "@/lib/api";

function metricText(metric: Record<string, string | number>): string {
  return Object.entries(metric)
    .map(([key, value]) => `${key.replaceAll(/([A-Z])/g, " $1").toLowerCase()}: ${value}`)
    .join(" · ");
}

const EXPLANATION_HISTORY_PAGE_SIZE = 10;

interface ExplanationSelection {
  baseId: string;
  headId: string;
}

function explanationHistoryLabel(item: GuardrailExplanationSummary): string {
  return `${item.snapshot.commitSha.slice(0, 12)} · ${item.answer.status} · ${item.answer.provider}/${item.answer.model}`;
}

function ExplanationVersionDetails({
  explanation,
  label,
  onOpenCitation,
}: {
  explanation: GuardrailExplanation;
  label: "Base" | "Head";
  onOpenCitation: (
    explanation: GuardrailExplanation,
    citation: GuardrailExplanation["answer"]["citations"][number],
  ) => void;
}) {
  return (
    <article className="guardrail-explanation-version">
      <div className="guardrail-explanation-version-heading">
        <strong>{label}</strong>
        <code>{explanation.id}</code>
      </div>
      <dl>
        <div>
          <dt>Snapshot</dt>
          <dd>{explanation.snapshot.id}</dd>
        </div>
        <div>
          <dt>Commit</dt>
          <dd>{explanation.snapshot.commitSha}</dd>
        </div>
        <div>
          <dt>Parser / algorithm</dt>
          <dd>
            {explanation.snapshot.parserVersion} · {explanation.snapshot.algorithmVersion}
          </dd>
        </div>
        <div>
          <dt>Profile</dt>
          <dd>{explanation.profileFingerprint}</dd>
        </div>
        <div>
          <dt>Provider / model</dt>
          <dd>
            {explanation.answer.provider} / {explanation.answer.model}
          </dd>
        </div>
        <div>
          <dt>Prompt</dt>
          <dd>{explanation.promptVersion}</dd>
        </div>
        <div>
          <dt>Finding</dt>
          <dd>
            [{explanation.finding.severity}] {explanation.finding.message}
          </dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>
            {explanation.finding.path}:{explanation.finding.startLine}-{explanation.finding.endLine}
          </dd>
        </div>
        <div>
          <dt>Metric</dt>
          <dd>{metricText(explanation.finding.metric)}</dd>
        </div>
        <div>
          <dt>Answer</dt>
          <dd>
            [{explanation.answer.status}] {explanation.answer.summary}
          </dd>
        </div>
      </dl>
      {explanation.answer.steps.length > 0 ? (
        <ol>
          {explanation.answer.steps.map((step, index) => (
            <li key={`${explanation.id}-comparison-step-${index}`}>{step.text}</li>
          ))}
        </ol>
      ) : null}
      {explanation.answer.limitations.length > 0 ? (
        <ul>
          {explanation.answer.limitations.map((limitation, index) => (
            <li key={`${explanation.id}-comparison-limitation-${index}`}>{limitation}</li>
          ))}
        </ul>
      ) : null}
      <div className="guardrail-explanation-version-citations">
        {explanation.answer.citations.map((citation) => (
          <button
            key={`${explanation.id}-${citation.evidenceId}`}
            onClick={() => onOpenCitation(explanation, citation)}
            type="button"
          >
            <FileCode2 size={13} /> {label} · {citation.path}:{citation.startLine}-
            {citation.endLine}
          </button>
        ))}
      </div>
    </article>
  );
}

function ExplanationComparisonView({
  comparison,
  onOpenCitation,
}: {
  comparison?: GuardrailExplanationComparison;
  onOpenCitation: (
    explanation: GuardrailExplanation,
    citation: GuardrailExplanation["answer"]["citations"][number],
  ) => void;
}) {
  if (!comparison) return null;
  return (
    <section
      className="guardrail-explanation-comparison"
      aria-label="Verified explanation structural comparison"
    >
      <div className="guardrail-explanation-comparison-heading">
        <div>
          <GitCompareArrows size={17} />
          <strong>Structural comparison · {comparison.changed ? "changed" : "same"}</strong>
        </div>
        <code title={comparison.subjectKey}>{comparison.subjectKey.slice(0, 19)}…</code>
      </div>
      <p>
        This compares saved fields exactly. It does not decide which model answer is better or rank
        explanation quality.
      </p>
      <div className="guardrail-explanation-difference-groups">
        {Object.entries(comparison.differences).map(([group, fields]) => (
          <section key={group} aria-label={`${group} differences`}>
            <strong>{group}</strong>
            <div>
              {Object.entries(fields).map(([field, status]) => (
                <span className={`difference-${status}`} key={`${group}-${field}`}>
                  {field}: {status}
                </span>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="guardrail-explanation-versions">
        <ExplanationVersionDetails
          explanation={comparison.base}
          label="Base"
          onOpenCitation={onOpenCitation}
        />
        <ExplanationVersionDetails
          explanation={comparison.head}
          label="Head"
          onOpenCitation={onOpenCitation}
        />
      </div>
    </section>
  );
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
  const canManageReviews = Boolean(
    session?.authenticated && session.workspace && session.workspace.role !== "viewer",
  );
  const [report, setReport] = useState<GuardrailReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadingJson, setDownloadingJson] = useState(false);
  const [reviews, setReviews] = useState<Record<string, GuardrailReview>>({});
  const [reviewDrafts, setReviewDrafts] = useState<
    Record<string, { status: GuardrailReview["status"]; note: string }>
  >({});
  const [reviewLoading, setReviewLoading] = useState<Record<string, boolean>>({});
  const [reviewErrors, setReviewErrors] = useState<Record<string, string>>({});
  const [openReviewHistories, setOpenReviewHistories] = useState<Record<string, boolean>>({});
  const [reviewHistories, setReviewHistories] = useState<
    Record<string, GuardrailReviewHistoryPage>
  >({});
  const [reviewHistoryErrors, setReviewHistoryErrors] = useState<Record<string, string>>({});
  const [reviewHistoryLoading, setReviewHistoryLoading] = useState<Record<string, boolean>>({});
  const [reviewHistoryLoadingMore, setReviewHistoryLoadingMore] = useState<Record<string, boolean>>(
    {},
  );
  const [selectedFindingIds, setSelectedFindingIds] = useState<Set<string>>(new Set());
  const [batchStatus, setBatchStatus] = useState<GuardrailReview["status"]>("acknowledged");
  const [batchNote, setBatchNote] = useState("");
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const batchIdempotencyKey = useRef<string | null>(null);
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
  const [openHistories, setOpenHistories] = useState<Record<string, boolean>>({});
  const [histories, setHistories] = useState<Record<string, GuardrailExplanationHistory>>({});
  const [historyErrors, setHistoryErrors] = useState<Record<string, string>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<string, boolean>>({});
  const [historyLoadingMore, setHistoryLoadingMore] = useState<Record<string, boolean>>({});
  const [historySelections, setHistorySelections] = useState<Record<string, ExplanationSelection>>(
    {},
  );
  const [explanationComparisons, setExplanationComparisons] = useState<
    Record<string, GuardrailExplanationComparison>
  >({});
  const [explanationComparisonErrors, setExplanationComparisonErrors] = useState<
    Record<string, string>
  >({});
  const [explanationComparisonLoading, setExplanationComparisonLoading] = useState<
    Record<string, boolean>
  >({});
  const profileRequest = useRef(0);
  const explanationRequest = useRef(0);
  const reviewHistoryEpoch = useRef(0);
  const reviewHistoryContext = useRef("");
  const reviewHistoryRequests = useRef<Record<string, number>>({});
  const explanationHistoryEpoch = useRef(0);
  const explanationHistoryContext = useRef("");
  const explanationHistoryRequests = useRef<Record<string, number>>({});
  const explanationComparisonRequests = useRef<Record<string, number>>({});

  const baselineSnapshots = availableSnapshots.filter(
    (item) => item.id !== snapshotId && item.status === "ready" && Boolean(item.commitSha),
  );
  const currentHistoryContext = `${repositoryId}:${snapshotId}`;

  useEffect(() => {
    let active = true;
    setBaselineSnapshotId("");
    setReport(null);
    setLoading(true);
    setError(null);
    setReviews({});
    setReviewDrafts({});
    setReviewLoading({});
    setReviewErrors({});
    setOpenReviewHistories({});
    setReviewHistories({});
    setReviewHistoryErrors({});
    setReviewHistoryLoading({});
    setReviewHistoryLoadingMore({});
    setSelectedFindingIds(new Set());
    setBatchStatus("acknowledged");
    setBatchNote("");
    setBatchLoading(false);
    setBatchError(null);
    batchIdempotencyKey.current = null;
    setExplanations({});
    setExplanationErrors({});
    setExplainingFindingId(null);
    setOpenHistories({});
    setHistories({});
    setHistoryErrors({});
    setHistoryLoading({});
    setHistoryLoadingMore({});
    setHistorySelections({});
    setExplanationComparisons({});
    setExplanationComparisonErrors({});
    setExplanationComparisonLoading({});
    explanationRequest.current += 1;
    reviewHistoryEpoch.current += 1;
    reviewHistoryContext.current = currentHistoryContext;
    reviewHistoryRequests.current = {};
    explanationHistoryEpoch.current += 1;
    explanationHistoryContext.current = currentHistoryContext;
    explanationHistoryRequests.current = {};
    explanationComparisonRequests.current = {};
    const reviewRequest = session?.authenticated
      ? apiFetch<GuardrailReviewsResponse>(`/v1/snapshots/${snapshotId}/guardrails/reviews`).catch(
          () => ({
            snapshot: { id: snapshotId, commitSha: "" },
            reviews: [],
          }),
        )
      : Promise.resolve({ snapshot: { id: snapshotId, commitSha: "" }, reviews: [] });
    Promise.all([
      apiFetch<GuardrailReport>(`/v1/snapshots/${snapshotId}/guardrails`),
      reviewRequest,
    ])
      .then(([result, reviewData]) => {
        if (!active) return;
        setReport(result);
        const byFinding: Record<string, GuardrailReview> = {};
        const drafts: Record<string, { status: GuardrailReview["status"]; note: string }> = {};
        for (const review of reviewData.reviews) {
          byFinding[review.findingId] = review;
          drafts[review.findingId] = { status: review.status, note: review.note };
        }
        setReviews(byFinding);
        setReviewDrafts(drafts);
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
  }, [currentHistoryContext, session?.authenticated, snapshotId]);

  async function loadReviewHistory(
    findingId: string,
    options: { append?: boolean; cursor?: string } = {},
  ): Promise<void> {
    if (!session?.authenticated) return;
    const append = options.append === true;
    const epoch = reviewHistoryEpoch.current;
    const context = currentHistoryContext;
    const requestNumber = (reviewHistoryRequests.current[findingId] ?? 0) + 1;
    reviewHistoryRequests.current[findingId] = requestNumber;
    const isCurrent = () =>
      reviewHistoryEpoch.current === epoch &&
      reviewHistoryContext.current === context &&
      reviewHistoryRequests.current[findingId] === requestNumber;
    setReviewHistoryErrors((current) => ({ ...current, [findingId]: "" }));
    if (append) {
      setReviewHistoryLoadingMore((current) => ({ ...current, [findingId]: true }));
    } else {
      setReviewHistoryLoading((current) => ({ ...current, [findingId]: true }));
    }
    const query = new URLSearchParams({ findingId, limit: "10" });
    if (options.cursor) query.set("cursor", options.cursor);
    try {
      const result = await apiFetch<GuardrailReviewHistoryPage>(
        `/v1/snapshots/${encodeURIComponent(snapshotId)}/guardrails/reviews/history?${query.toString()}`,
        { cache: "no-store" },
      );
      if (!isCurrent()) return;
      setReviewHistories((current) => {
        const previous = append ? (current[findingId]?.entries ?? []) : [];
        const seen = new Set(previous.map((entry) => entry.id));
        return {
          ...current,
          [findingId]: {
            ...result,
            entries: [...previous, ...result.entries.filter((entry) => !seen.has(entry.id))],
          },
        };
      });
    } catch (cause) {
      if (!isCurrent()) return;
      setReviewHistoryErrors((current) => ({
        ...current,
        [findingId]: apiErrorMessage(cause, "Unable to load review history."),
      }));
    } finally {
      if (isCurrent()) {
        if (append) {
          setReviewHistoryLoadingMore((current) => ({ ...current, [findingId]: false }));
        } else {
          setReviewHistoryLoading((current) => ({ ...current, [findingId]: false }));
        }
      }
    }
  }

  function toggleReviewHistory(findingId: string): void {
    if (!session?.authenticated) return;
    const nextOpen = !openReviewHistories[findingId];
    setOpenReviewHistories((current) => ({ ...current, [findingId]: nextOpen }));
    if (nextOpen && !reviewHistories[findingId] && !reviewHistoryLoading[findingId]) {
      void loadReviewHistory(findingId);
    }
  }

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

  async function downloadJson() {
    setDownloadingJson(true);
    setError(null);
    try {
      const artifact = await fetchGuardrailJson(snapshotId);
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
      setError(apiErrorMessage(cause, "Unable to download the Guardrails JSON."));
    } finally {
      setDownloadingJson(false);
    }
  }

  function updateReviewDraft(
    findingId: string,
    patch: Partial<{ status: GuardrailReview["status"]; note: string }>,
  ) {
    setReviewDrafts((current) => ({
      ...current,
      [findingId]: {
        status: current[findingId]?.status ?? "unreviewed",
        note: current[findingId]?.note ?? "",
        ...patch,
      },
    }));
  }

  async function saveReview(findingId: string) {
    if (!canManageReviews) return;
    const draft = reviewDrafts[findingId] ?? { status: "unreviewed" as const, note: "" };
    if (Array.from(draft.note).length > 2_000) {
      setReviewErrors((current) => ({
        ...current,
        [findingId]: "Review note must be 2,000 characters or fewer.",
      }));
      return;
    }
    setReviewLoading((current) => ({ ...current, [findingId]: true }));
    setReviewErrors((current) => ({ ...current, [findingId]: "" }));
    try {
      const next = await apiFetch<GuardrailReview>(
        `/v1/snapshots/${encodeURIComponent(snapshotId)}/guardrails/reviews/${encodeURIComponent(findingId)}`,
        { method: "PUT", body: JSON.stringify(draft) },
      );
      setReviews((current) => ({ ...current, [findingId]: next }));
      setReviewDrafts((current) => ({
        ...current,
        [findingId]: { status: next.status, note: next.note },
      }));
    } catch (cause) {
      setReviewErrors((current) => ({
        ...current,
        [findingId]: apiErrorMessage(cause, "Unable to save the review."),
      }));
    } finally {
      setReviewLoading((current) => ({ ...current, [findingId]: false }));
    }
  }

  async function clearReview(findingId: string) {
    if (!canManageReviews) return;
    setReviewLoading((current) => ({ ...current, [findingId]: true }));
    setReviewErrors((current) => ({ ...current, [findingId]: "" }));
    try {
      const next = await apiFetch<GuardrailReview>(
        `/v1/snapshots/${encodeURIComponent(snapshotId)}/guardrails/reviews/${encodeURIComponent(findingId)}`,
        { method: "DELETE" },
      );
      setReviews((current) => ({ ...current, [findingId]: next }));
      setReviewDrafts((current) => ({
        ...current,
        [findingId]: { status: "unreviewed", note: "" },
      }));
    } catch (cause) {
      setReviewErrors((current) => ({
        ...current,
        [findingId]: apiErrorMessage(cause, "Unable to clear the review."),
      }));
    } finally {
      setReviewLoading((current) => ({ ...current, [findingId]: false }));
    }
  }

  function toggleFindingSelection(findingId: string): void {
    setSelectedFindingIds((current) => {
      const next = new Set(current);
      if (next.has(findingId)) next.delete(findingId);
      else if (next.size < 50) next.add(findingId);
      return next;
    });
  }

  function toggleAllFindingSelection(): void {
    if (!report) return;
    const selectableCount = Math.min(report.findings.length, 50);
    setSelectedFindingIds((current) =>
      current.size === selectableCount
        ? new Set()
        : new Set(report.findings.slice(0, 50).map((finding) => finding.id)),
    );
  }

  async function applyReviewBatch(): Promise<void> {
    if (!canManageReviews || !report || selectedFindingIds.size === 0 || batchLoading) return;
    if (Array.from(batchNote).length > 2_000) {
      setBatchError("Batch review note must be 2,000 characters or fewer.");
      return;
    }
    setBatchLoading(true);
    setBatchError(null);
    batchIdempotencyKey.current ??= `web-${crypto.randomUUID()}`;
    try {
      const result = await applyGuardrailReviewBatch(snapshotId, {
        idempotencyKey: batchIdempotencyKey.current,
        items: Array.from(selectedFindingIds).map((findingId) => ({
          findingId,
          status: batchStatus,
          note: batchNote,
        })),
      });
      setReviewDrafts((current) => {
        const next = { ...current };
        for (const item of result.applied) {
          next[item.findingId] = {
            status: item.status,
            note: item.status === "unreviewed" ? "" : batchNote,
          };
        }
        return next;
      });
      setReviews((current) => {
        const next = { ...current };
        for (const item of result.applied) {
          const previous = next[item.findingId];
          next[item.findingId] = {
            findingId: item.findingId,
            subjectKey: item.subjectKey,
            status: item.status,
            note: item.status === "unreviewed" ? "" : batchNote,
            reviewer: previous?.reviewer ?? null,
            reviewedAt: previous?.reviewedAt ?? null,
            updatedAt: previous?.updatedAt ?? null,
          };
        }
        return next;
      });
      setReviewHistories((current) => {
        const next = { ...current };
        for (const item of result.applied) delete next[item.findingId];
        return next;
      });
      setSelectedFindingIds(new Set());
      setBatchNote("");
      batchIdempotencyKey.current = null;
    } catch (cause) {
      setBatchError(apiErrorMessage(cause, "Unable to apply the batch review."));
    } finally {
      setBatchLoading(false);
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

  async function loadExplanationHistory(
    findingId: string,
    options: { append?: boolean; cursor?: string } = {},
  ) {
    const append = options.append === true;
    const epoch = explanationHistoryEpoch.current;
    const context = currentHistoryContext;
    const request = (explanationHistoryRequests.current[findingId] ?? 0) + 1;
    explanationHistoryRequests.current[findingId] = request;
    setHistoryErrors((current) => ({ ...current, [findingId]: "" }));
    if (append) {
      setHistoryLoadingMore((current) => ({ ...current, [findingId]: true }));
    } else {
      setHistoryLoading((current) => ({ ...current, [findingId]: true }));
      setExplanationComparisons((current) => {
        const next = { ...current };
        delete next[findingId];
        return next;
      });
      setExplanationComparisonErrors((current) => ({ ...current, [findingId]: "" }));
    }
    const query = new URLSearchParams({
      findingId,
      limit: String(EXPLANATION_HISTORY_PAGE_SIZE),
    });
    if (options.cursor) query.set("cursor", options.cursor);
    try {
      const result = await apiFetch<GuardrailExplanationHistory>(
        `/v1/snapshots/${encodeURIComponent(snapshotId)}/guardrails/explanations?${query.toString()}`,
      );
      if (
        context !== explanationHistoryContext.current ||
        epoch !== explanationHistoryEpoch.current ||
        explanationHistoryRequests.current[findingId] !== request
      ) {
        return;
      }
      const previous = append ? (histories[findingId]?.explanations ?? []) : [];
      const seen = new Set(previous.map((item) => item.id));
      const explanations = [
        ...previous,
        ...result.explanations.filter((item) => !seen.has(item.id)),
      ];
      setHistories((current) => ({
        ...current,
        [findingId]: { ...result, explanations },
      }));
      setHistorySelections((selections) => {
        const currentSelection = selections[findingId];
        const ids = new Set(explanations.map((item) => item.id));
        const headId =
          currentSelection?.headId && ids.has(currentSelection.headId)
            ? currentSelection.headId
            : (explanations[0]?.id ?? "");
        let baseId =
          currentSelection?.baseId && ids.has(currentSelection.baseId)
            ? currentSelection.baseId
            : (explanations.at(-1)?.id ?? "");
        if (baseId === headId && explanations.length > 1) {
          baseId = explanations.findLast((item) => item.id !== headId)?.id ?? baseId;
        }
        return { ...selections, [findingId]: { baseId, headId } };
      });
    } catch (cause) {
      if (
        context === explanationHistoryContext.current &&
        epoch === explanationHistoryEpoch.current &&
        explanationHistoryRequests.current[findingId] === request
      ) {
        setHistoryErrors((current) => ({
          ...current,
          [findingId]: apiErrorMessage(cause, "Unable to load verified explanation history."),
        }));
      }
    } finally {
      if (
        context === explanationHistoryContext.current &&
        epoch === explanationHistoryEpoch.current &&
        explanationHistoryRequests.current[findingId] === request
      ) {
        if (append) {
          setHistoryLoadingMore((current) => ({ ...current, [findingId]: false }));
        } else {
          setHistoryLoading((current) => ({ ...current, [findingId]: false }));
        }
      }
    }
  }

  function toggleExplanationHistory(findingId: string) {
    const open = openHistories[findingId] === true;
    setOpenHistories((current) => ({ ...current, [findingId]: !open }));
    if (!open && !histories[findingId] && !historyLoading[findingId]) {
      void loadExplanationHistory(findingId);
    }
  }

  function updateExplanationSelection(
    findingId: string,
    side: keyof ExplanationSelection,
    value: string,
  ) {
    setHistorySelections((current) => ({
      ...current,
      [findingId]: {
        baseId: current[findingId]?.baseId ?? "",
        headId: current[findingId]?.headId ?? "",
        [side]: value,
      },
    }));
    setExplanationComparisons((current) => {
      const next = { ...current };
      delete next[findingId];
      return next;
    });
    setExplanationComparisonErrors((current) => ({ ...current, [findingId]: "" }));
  }

  async function compareExplanationHistory(findingId: string) {
    const selection = historySelections[findingId];
    if (!selection?.baseId || !selection.headId || selection.baseId === selection.headId) return;
    const epoch = explanationHistoryEpoch.current;
    const context = currentHistoryContext;
    const request = (explanationComparisonRequests.current[findingId] ?? 0) + 1;
    explanationComparisonRequests.current[findingId] = request;
    setExplanationComparisonLoading((current) => ({ ...current, [findingId]: true }));
    setExplanationComparisonErrors((current) => ({ ...current, [findingId]: "" }));
    setExplanationComparisons((current) => {
      const next = { ...current };
      delete next[findingId];
      return next;
    });
    const query = new URLSearchParams({
      baseExplanationId: selection.baseId,
      headExplanationId: selection.headId,
    });
    try {
      const result = await apiFetch<GuardrailExplanationComparison>(
        `/v1/repositories/${encodeURIComponent(repositoryId)}/guardrails/explanations/compare?${query.toString()}`,
      );
      if (
        context === explanationHistoryContext.current &&
        epoch === explanationHistoryEpoch.current &&
        explanationComparisonRequests.current[findingId] === request
      ) {
        setExplanationComparisons((current) => ({ ...current, [findingId]: result }));
      }
    } catch (cause) {
      if (
        context === explanationHistoryContext.current &&
        epoch === explanationHistoryEpoch.current &&
        explanationComparisonRequests.current[findingId] === request
      ) {
        setExplanationComparisonErrors((current) => ({
          ...current,
          [findingId]: apiErrorMessage(cause, "Unable to compare verified explanations."),
        }));
      }
    } finally {
      if (
        context === explanationHistoryContext.current &&
        epoch === explanationHistoryEpoch.current &&
        explanationComparisonRequests.current[findingId] === request
      ) {
        setExplanationComparisonLoading((current) => ({ ...current, [findingId]: false }));
      }
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
      void loadExplanationHistory(findingId);
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
        <div className="guardrails-export-actions">
          <button
            className="secondary-button"
            disabled={downloading}
            onClick={() => void downloadSarif()}
            type="button"
          >
            {downloading ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
            Download SARIF
          </button>
          <button
            className="secondary-button"
            disabled={downloadingJson}
            onClick={() => void downloadJson()}
            type="button"
          >
            {downloadingJson ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
            Download JSON
          </button>
        </div>
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
        <>
          {canManageReviews ? (
            <section className="guardrail-review-batch" aria-label="Batch review actions">
              <div className="guardrail-review-batch-heading">
                <strong>Batch review</strong>
                <span>{selectedFindingIds.size} selected (maximum 50)</span>
                <button onClick={toggleAllFindingSelection} type="button">
                  {selectedFindingIds.size === Math.min(report.findings.length, 50)
                    ? "Clear all"
                    : "Select all"}
                </button>
              </div>
              {selectedFindingIds.size > 0 ? (
                <div className="guardrail-review-batch-controls">
                  <label>
                    <span>Status</span>
                    <select
                      aria-label="Batch review status"
                      disabled={batchLoading}
                      onChange={(event) =>
                        setBatchStatus(event.target.value as GuardrailReview["status"])
                      }
                      value={batchStatus}
                    >
                      <option value="unreviewed">Unreviewed</option>
                      <option value="acknowledged">Acknowledged</option>
                      <option value="accepted_risk">Accepted risk</option>
                      <option value="false_positive">False positive</option>
                    </select>
                  </label>
                  <label>
                    <span>Note</span>
                    <textarea
                      aria-label="Batch review note"
                      disabled={batchLoading}
                      // HTML maxLength counts UTF-16 code units; the API limit is
                      // 2,000 Unicode code points, so allow up to 4,000 units
                      // and let applyReviewBatch enforce the exact code-point bound.
                      maxLength={4_000}
                      onChange={(event) => setBatchNote(event.target.value)}
                      placeholder="Optional note for selected Findings"
                      value={batchNote}
                    />
                  </label>
                  <button
                    disabled={batchLoading}
                    onClick={() => void applyReviewBatch()}
                    type="button"
                  >
                    {batchLoading ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <Save size={14} />
                    )}
                    Apply to selected
                  </button>
                </div>
              ) : null}
              {batchError ? (
                <div className="guardrail-review-error" role="alert">
                  {batchError}
                </div>
              ) : null}
            </section>
          ) : null}
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
                  {canManageReviews ? (
                    <label className="guardrail-finding-select">
                      <input
                        aria-label={`Select ${finding.title} for batch review`}
                        checked={selectedFindingIds.has(finding.id)}
                        onChange={() => toggleFindingSelection(finding.id)}
                        type="checkbox"
                      />
                      <span>Select for batch review</span>
                    </label>
                  ) : null}
                  <div>
                    <span>{finding.severity}</span>
                    <code>{finding.ruleId}</code>
                  </div>
                  <h2>{finding.title}</h2>
                  <p>{finding.message}</p>
                  <small>{metricText(finding.metric)}</small>
                  <section
                    className="guardrail-review"
                    aria-label={`Human review for ${finding.title}`}
                  >
                    <div className="guardrail-review-heading">
                      <strong>Human review</strong>
                      <span
                        className={`guardrail-review-status review-${reviews[finding.id]?.status ?? "unreviewed"}`}
                      >
                        {reviews[finding.id]?.status ?? "unreviewed"}
                      </span>
                    </div>
                    <p className="guardrail-review-disclaimer">
                      Review metadata never changes deterministic status or CI decisions.
                    </p>
                    <label>
                      <span>Status</span>
                      <select
                        aria-label={`Review status for ${finding.title}`}
                        disabled={!canManageReviews || reviewLoading[finding.id] === true}
                        onChange={(event) =>
                          updateReviewDraft(finding.id, {
                            status: event.target.value as GuardrailReview["status"],
                          })
                        }
                        value={reviewDrafts[finding.id]?.status ?? "unreviewed"}
                      >
                        <option value="unreviewed">Unreviewed</option>
                        <option value="acknowledged">Acknowledged</option>
                        <option value="accepted_risk">Accepted risk</option>
                        <option value="false_positive">False positive</option>
                      </select>
                    </label>
                    <label>
                      <span>Note</span>
                      <textarea
                        aria-label={`Review note for ${finding.title}`}
                        disabled={!canManageReviews || reviewLoading[finding.id] === true}
                        // HTML maxLength counts UTF-16 code units; the API limit is
                        // 2,000 Unicode code points, so allow up to 4,000 units
                        // and let saveReview enforce the exact code-point bound.
                        maxLength={4_000}
                        onChange={(event) =>
                          updateReviewDraft(finding.id, { note: event.target.value })
                        }
                        placeholder="Optional handoff note"
                        value={reviewDrafts[finding.id]?.note ?? ""}
                      />
                    </label>
                    {canManageReviews ? (
                      <div className="guardrail-review-actions">
                        <button
                          disabled={reviewLoading[finding.id] === true}
                          onClick={() => void saveReview(finding.id)}
                          type="button"
                        >
                          {reviewLoading[finding.id] ? (
                            <LoaderCircle className="spin" size={14} />
                          ) : (
                            <Save size={14} />
                          )}
                          Save review
                        </button>
                        <button
                          disabled={
                            reviewLoading[finding.id] === true ||
                            (reviews[finding.id]?.status ?? "unreviewed") === "unreviewed"
                          }
                          onClick={() => void clearReview(finding.id)}
                          type="button"
                        >
                          Clear
                        </button>
                      </div>
                    ) : (
                      <small>Viewer mode: review editing is unavailable.</small>
                    )}
                    {reviewErrors[finding.id] ? (
                      <div className="guardrail-review-error" role="alert">
                        {reviewErrors[finding.id]}
                      </div>
                    ) : null}
                    {session?.authenticated ? (
                      <>
                        <button
                          aria-controls={`guardrail-review-history-${finding.id}`}
                          aria-expanded={openReviewHistories[finding.id] === true}
                          onClick={() => toggleReviewHistory(finding.id)}
                          type="button"
                        >
                          <History size={14} /> Review history
                        </button>
                        {openReviewHistories[finding.id] ? (
                          <section
                            className="guardrail-review-history"
                            id={`guardrail-review-history-${finding.id}`}
                            aria-busy={
                              reviewHistoryLoading[finding.id] === true ||
                              reviewHistoryLoadingMore[finding.id] === true
                            }
                            aria-label={`Review history for ${finding.title}`}
                          >
                            {reviewHistoryLoading[finding.id] ? (
                              <output>
                                <LoaderCircle className="spin" size={14} /> Loading review history…
                              </output>
                            ) : null}
                            {reviewHistoryErrors[finding.id] ? (
                              <div className="guardrail-review-error" role="alert">
                                <span>{reviewHistoryErrors[finding.id]}</span>
                                <button
                                  onClick={() => void loadReviewHistory(finding.id)}
                                  type="button"
                                >
                                  Retry
                                </button>
                              </div>
                            ) : null}
                            {!reviewHistoryLoading[finding.id] &&
                            reviewHistories[finding.id]?.entries.length === 0 ? (
                              <p>No review changes recorded for this Finding.</p>
                            ) : null}
                            {reviewHistories[finding.id]?.entries.length ? (
                              <>
                                <ol>
                                  {reviewHistories[finding.id]?.entries.map((entry) => (
                                    <li key={entry.id}>
                                      <strong>
                                        {entry.fromStatus} → {entry.toStatus}
                                      </strong>{" "}
                                      <span>
                                        note {entry.fromNoteLength} → {entry.toNoteLength}
                                        {entry.noteChanged ? " · text changed" : ""}
                                      </span>
                                      <small>
                                        {entry.actorLogin
                                          ? `@${entry.actorLogin}`
                                          : entry.actorKind}{" "}
                                        · {entry.createdAt}
                                      </small>
                                    </li>
                                  ))}
                                </ol>
                                {reviewHistories[finding.id]?.nextCursor ? (
                                  <button
                                    disabled={reviewHistoryLoadingMore[finding.id] === true}
                                    onClick={() =>
                                      void loadReviewHistory(finding.id, {
                                        append: true,
                                        cursor:
                                          reviewHistories[finding.id]?.nextCursor ?? undefined,
                                      })
                                    }
                                    type="button"
                                  >
                                    {reviewHistoryLoadingMore[finding.id]
                                      ? "Loading…"
                                      : "Load more"}
                                  </button>
                                ) : null}
                              </>
                            ) : null}
                          </section>
                        ) : null}
                      </>
                    ) : null}
                    {reviews[finding.id]?.reviewer ? (
                      <small>
                        Reviewed by{" "}
                        {reviews[finding.id]?.reviewer?.login ??
                          reviews[finding.id]?.reviewer?.displayName}{" "}
                        · {reviews[finding.id]?.updatedAt}
                      </small>
                    ) : null}
                  </section>
                  <div className="guardrail-explanation-actions">
                    {canRequestExplanations ? (
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
                    ) : null}
                    <button
                      aria-controls={`guardrail-history-${finding.id}`}
                      aria-expanded={openHistories[finding.id] === true}
                      onClick={() => toggleExplanationHistory(finding.id)}
                      type="button"
                    >
                      <History size={14} /> Explanation history
                    </button>
                  </div>
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
                  {openHistories[finding.id] ? (
                    <section
                      className="guardrail-explanation-history"
                      id={`guardrail-history-${finding.id}`}
                      aria-busy={
                        historyLoading[finding.id] === true ||
                        historyLoadingMore[finding.id] === true
                      }
                      aria-label={`Explanation history for ${finding.title}`}
                    >
                      <div className="guardrail-explanation-history-heading">
                        <div>
                          <History size={16} />
                          <strong>Saved verified explanations</strong>
                        </div>
                        {histories[finding.id] ? (
                          <code title={histories[finding.id]?.subjectKey}>
                            {histories[finding.id]?.subjectKey.slice(0, 19)}…
                          </code>
                        ) : null}
                      </div>
                      {historyLoading[finding.id] ? (
                        <output>
                          <LoaderCircle className="spin" size={15} /> Loading explanation history…
                        </output>
                      ) : null}
                      {historyErrors[finding.id] ? (
                        <div className="guardrail-explanation-history-error" role="alert">
                          <span>{historyErrors[finding.id]}</span>
                          <button
                            onClick={() => void loadExplanationHistory(finding.id)}
                            type="button"
                          >
                            Retry
                          </button>
                        </div>
                      ) : null}
                      {!historyLoading[finding.id] &&
                      histories[finding.id]?.explanations.length === 0 ? (
                        <p className="guardrail-explanation-history-empty">
                          No saved explanations exist for this logical Finding yet.
                        </p>
                      ) : null}
                      {histories[finding.id]?.explanations.length ? (
                        <>
                          <div className="guardrail-explanation-history-list">
                            {histories[finding.id]?.explanations.map((item) => (
                              <article key={item.id}>
                                <div>
                                  <strong>
                                    {item.answer.status} · {item.answer.provider}/
                                    {item.answer.model}
                                  </strong>
                                  <code>{item.snapshot.commitSha.slice(0, 12)}</code>
                                </div>
                                <p>{item.answer.summary}</p>
                                <div>
                                  <span>Snapshot {item.snapshot.id}</span>
                                  <span>{item.promptVersion}</span>
                                  <span>{item.answer.citationCount} citations</span>
                                  <span>{item.createdAt}</span>
                                </div>
                                <code title={item.profileFingerprint}>
                                  profile {item.profileFingerprint.slice(0, 19)}…
                                </code>
                              </article>
                            ))}
                          </div>
                          {histories[finding.id]?.nextCursor ? (
                            <button
                              className="guardrail-explanation-load-more"
                              disabled={historyLoadingMore[finding.id] === true}
                              onClick={() =>
                                void loadExplanationHistory(finding.id, {
                                  append: true,
                                  cursor: histories[finding.id]?.nextCursor ?? undefined,
                                })
                              }
                              type="button"
                            >
                              {historyLoadingMore[finding.id] ? (
                                <LoaderCircle className="spin" size={14} />
                              ) : null}
                              {historyLoadingMore[finding.id] ? "Loading more…" : "Load more"}
                            </button>
                          ) : null}
                        </>
                      ) : null}
                      {(histories[finding.id]?.explanations.length ?? 0) >= 2 ? (
                        <section
                          className="guardrail-explanation-compare-controls"
                          aria-label="Choose verified explanations to compare"
                        >
                          <div>
                            <label>
                              <span>Base (older)</span>
                              <select
                                aria-label={`Base explanation for ${finding.title}`}
                                onChange={(event) =>
                                  updateExplanationSelection(
                                    finding.id,
                                    "baseId",
                                    event.target.value,
                                  )
                                }
                                value={historySelections[finding.id]?.baseId ?? ""}
                              >
                                {histories[finding.id]?.explanations.map((item) => (
                                  <option key={`base-${item.id}`} value={item.id}>
                                    {explanationHistoryLabel(item)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              <span>Head (newer)</span>
                              <select
                                aria-label={`Head explanation for ${finding.title}`}
                                onChange={(event) =>
                                  updateExplanationSelection(
                                    finding.id,
                                    "headId",
                                    event.target.value,
                                  )
                                }
                                value={historySelections[finding.id]?.headId ?? ""}
                              >
                                {histories[finding.id]?.explanations.map((item) => (
                                  <option key={`head-${item.id}`} value={item.id}>
                                    {explanationHistoryLabel(item)}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                          <button
                            disabled={
                              explanationComparisonLoading[finding.id] === true ||
                              !historySelections[finding.id]?.baseId ||
                              !historySelections[finding.id]?.headId ||
                              historySelections[finding.id]?.baseId ===
                                historySelections[finding.id]?.headId
                            }
                            onClick={() => void compareExplanationHistory(finding.id)}
                            type="button"
                          >
                            {explanationComparisonLoading[finding.id] ? (
                              <LoaderCircle className="spin" size={14} />
                            ) : (
                              <GitCompareArrows size={14} />
                            )}
                            Compare saved explanations
                          </button>
                        </section>
                      ) : null}
                      {explanationComparisonErrors[finding.id] ? (
                        <div className="guardrail-explanation-history-error" role="alert">
                          {explanationComparisonErrors[finding.id]}
                        </div>
                      ) : null}
                      <ExplanationComparisonView
                        comparison={explanationComparisons[finding.id]}
                        onOpenCitation={(explanation, citation) =>
                          void (onOpenSnapshotSource
                            ? onOpenSnapshotSource(
                                explanation.snapshot.id,
                                citation.path,
                                citation.startLine,
                                citation.endLine,
                              )
                            : onOpenSource(citation.path, citation.startLine, citation.endLine))
                        }
                      />
                    </section>
                  ) : null}
                </div>
                <button
                  aria-label={`Open evidence for ${finding.title}`}
                  onClick={() =>
                    void onOpenSource(finding.path, finding.startLine, finding.endLine)
                  }
                  type="button"
                >
                  <FileCode2 size={14} />
                  {finding.path}:{finding.startLine}-{finding.endLine}
                </button>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
