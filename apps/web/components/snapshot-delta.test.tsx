// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Snapshot } from "@/lib/api";
import { SnapshotDelta } from "./snapshot-delta";

const repositoryId = "01900000-0000-7000-8000-000000000001";
const baseSnapshotId = "01900000-0000-7000-8000-000000000003";

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: "01900000-0000-7000-8000-000000000002",
    repositoryId,
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    refName: "main",
    status: "ready",
    parserVersion: "tree-sitter-ts-js-py-v1",
    baseSnapshotId: null,
    indexMode: "full",
    treeHash: "sha256:tree",
    stats: {
      files: 3,
      symbols: 5,
      edges: 4,
      languages: { python: 1, typescript: 2 },
      warnings: 0,
      indexing: {
        mode: "full",
        baseSnapshotId: null,
        baseCommitSha: null,
        scannedFiles: 3,
        changedFiles: 3,
        reusedFiles: 0,
        parsedFiles: 3,
        deletedFiles: 0,
      },
    },
    requestedAt: "2026-01-01T00:00:00.000Z",
    readyAt: "2026-01-01T00:00:03.000Z",
    failure: null,
    ...overrides,
  };
}

afterEach(cleanup);

describe("SnapshotDelta", () => {
  it("renders full indexing counters without inventing a baseline", () => {
    render(<SnapshotDelta repositoryId={repositoryId} snapshot={snapshot()} />);

    expect(screen.getByText("full index")).toBeInTheDocument();
    expect(screen.getByText("No compatible baseline")).toBeInTheDocument();
    expect(screen.getByText("3 files scanned this run")).toBeInTheDocument();
  });

  it("links an incremental result to its exact base snapshot", () => {
    const incremental = snapshot({
      baseSnapshotId,
      indexMode: "incremental",
      stats: {
        ...snapshot().stats,
        indexing: {
          mode: "incremental",
          baseSnapshotId,
          baseCommitSha: "fedcba9876543210fedcba9876543210fedcba98",
          scannedFiles: 3,
          changedFiles: 1,
          reusedFiles: 2,
          parsedFiles: 1,
          deletedFiles: 1,
        },
      },
    });
    render(<SnapshotDelta repositoryId={repositoryId} snapshot={incremental} />);

    expect(screen.getByText("incremental index")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /fedcba9 · view snapshot/ })).toHaveAttribute(
      "href",
      `/repositories/${repositoryId}?snapshotId=${baseSnapshotId}`,
    );
  });

  it("labels old snapshots as legacy and leaves unavailable counters blank", () => {
    render(
      <SnapshotDelta
        repositoryId={repositoryId}
        snapshot={snapshot({ stats: { ...snapshot().stats, indexing: null } })}
      />,
    );

    expect(screen.getByText("Legacy full index")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(4);
  });
});
