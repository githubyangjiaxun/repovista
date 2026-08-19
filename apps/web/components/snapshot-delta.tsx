import { CheckCircle2, FileDiff, GitCommitHorizontal, RefreshCw, ScanSearch } from "lucide-react";
import Link from "next/link";
import type { Snapshot } from "@/lib/api";

function shortSha(value: string | null): string {
  return value?.slice(0, 7) ?? "pending";
}

function formatCount(value: number | undefined): string {
  return (value ?? 0).toLocaleString();
}

export function SnapshotDelta({
  repositoryId,
  snapshot,
}: {
  repositoryId: string;
  snapshot: Snapshot;
}) {
  const indexing = snapshot.stats.indexing;
  const legacy = !indexing;
  const mode = indexing?.mode ?? snapshot.indexMode;
  const hasBaseline = Boolean(indexing?.baseSnapshotId ?? snapshot.baseSnapshotId);
  const baseSnapshotId = indexing?.baseSnapshotId ?? snapshot.baseSnapshotId;
  const baseCommitSha = indexing?.baseCommitSha ?? null;

  const metrics = [
    { label: "Parsed", value: indexing?.parsedFiles, icon: ScanSearch },
    { label: "Reused", value: indexing?.reusedFiles, icon: RefreshCw },
    { label: "Changed", value: indexing?.changedFiles, icon: FileDiff },
    { label: "Deleted", value: indexing?.deletedFiles, icon: FileDiff },
  ];

  return (
    <article className="panel snapshot-delta-panel" aria-labelledby="snapshot-delta-title">
      <div className="panel-heading">
        <div>
          <span id="snapshot-delta-title">Update delta</span>
          <small>
            {legacy
              ? "Legacy snapshot without incremental counters"
              : `${indexing?.scannedFiles.toLocaleString() ?? 0} files scanned this run`}
          </small>
        </div>
        <span className={`index-mode-chip ${mode === "incremental" ? "incremental" : "full"}`}>
          <CheckCircle2 size={14} aria-hidden />
          {legacy ? "Legacy full index" : `${mode} index`}
        </span>
      </div>
      <div className="delta-metrics">
        {metrics.map(({ icon: Icon, label, value }) => (
          <div key={label}>
            <Icon size={15} aria-hidden />
            <strong>{legacy ? "—" : formatCount(value)}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="delta-baseline">
        <GitCommitHorizontal size={15} aria-hidden />
        <span>Base</span>
        {hasBaseline && baseSnapshotId ? (
          <Link
            href={`/repositories/${repositoryId}?snapshotId=${encodeURIComponent(baseSnapshotId)}`}
          >
            {shortSha(baseCommitSha)} · view snapshot
          </Link>
        ) : (
          <em>No compatible baseline</em>
        )}
      </div>
    </article>
  );
}
