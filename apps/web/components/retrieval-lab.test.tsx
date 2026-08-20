// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RetrievalStatus, SearchResult } from "@/lib/api";
import { RetrievalLab } from "./retrieval-lab";

const snapshotId = "01900000-0000-7000-8000-000000000101";
const embeddingIndexId = "01900000-0000-7000-8000-000000000102";
const jobId = "01900000-0000-7000-8000-000000000103";

const embeddingIndex = {
  id: embeddingIndexId,
  snapshotId,
  provider: "ollama" as const,
  model: "nomic-embed-text",
  inputVersion: "code-chunk-v1",
  status: "ready" as const,
  dimensions: 768,
  totalChunks: 12,
  embeddedChunks: 12,
  revision: 1,
  jobId,
  failure: null,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:02.000Z",
  readyAt: "2026-08-20T00:00:02.000Z",
};

function retrievalStatus(semantic: Partial<RetrievalStatus["semantic"]> = {}): RetrievalStatus {
  return {
    snapshotId,
    text: { ready: true, reason: null },
    symbol: { ready: true, reason: null },
    semantic: {
      configured: false,
      queryable: false,
      reason: "provider_disabled",
      currentIndex: null,
      latestIndex: null,
      ...semantic,
    },
  };
}

function success(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, meta: { requestId: "request-ok" } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function failure(message: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "SEMANTIC_RETRIEVAL_UNAVAILABLE",
        message,
        requestId: "request-semantic",
        retryable: true,
      },
    }),
    { status: 409, headers: { "Content-Type": "application/json" } },
  );
}

function runSearch(query: string): void {
  fireEvent.change(screen.getByLabelText("Search query"), { target: { value: query } });
  const form = screen.getByLabelText("Search query").closest("form");
  if (!form) throw new Error("Expected the search input to belong to a form.");
  fireEvent.submit(form);
}

describe("RetrievalLab", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps lexical retrieval available when embeddings are disabled", async () => {
    vi.mocked(fetch).mockResolvedValue(success(retrievalStatus()));

    render(<RetrievalLab snapshotId={snapshotId} onOpenSource={vi.fn()} />);

    expect(
      await screen.findByText(
        "No embedding provider configured; lexical search remains available.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("provider disabled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /index/i })).not.toBeInTheDocument();
  });

  it("builds a missing profile and exposes an immediate retry after failure", async () => {
    const missing = retrievalStatus({
      configured: true,
      reason: "index_missing",
    });
    const failedIndex = {
      ...embeddingIndex,
      status: "failed" as const,
      dimensions: null,
      embeddedChunks: 4,
      failure: { code: "OLLAMA_UNAVAILABLE", message: "Ollama stopped.", retryable: true },
      readyAt: null,
    };
    const failed = retrievalStatus({
      configured: true,
      reason: "index_failed",
      currentIndex: failedIndex,
      latestIndex: failedIndex,
    });
    const queuedIndex = {
      ...failedIndex,
      status: "queued" as const,
      embeddedChunks: 0,
      failure: null,
    };
    const queued = retrievalStatus({
      configured: true,
      reason: "index_building",
      currentIndex: queuedIndex,
      latestIndex: queuedIndex,
    });
    let statusReads = 0;
    const fetchMock = vi.mocked(fetch).mockImplementation(async (_input, init) => {
      if (init?.method === "POST") {
        return success({ embeddingIndex: queuedIndex, jobId, reused: false }, 202);
      }
      statusReads += 1;
      return success(statusReads === 1 ? missing : statusReads === 2 ? failed : queued);
    });

    render(<RetrievalLab snapshotId={snapshotId} onOpenSource={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Build index" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry index" }));

    await waitFor(() => expect(screen.getByText("index building")).toBeInTheDocument());
    expect(screen.getByRole("progressbar", { name: "Semantic index progress" })).toHaveValue(0);
    expect(screen.getByRole("link", { name: "View job" })).toHaveAttribute(
      "href",
      `/jobs/${jobId}`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });

  it("shows hybrid degradation, channel ranks, raw scores, and opens fixed source", async () => {
    const result: SearchResult = {
      query: "response compression",
      trace: {
        requestedMode: "hybrid",
        usedChannels: ["text", "symbol"],
        degraded: true,
        degradationReason: "provider_disabled",
        embeddingIndex: null,
        channels: [
          {
            channel: "text",
            status: "used",
            candidateCount: 4,
            reason: null,
            latencyMs: 3,
          },
          {
            channel: "symbol",
            status: "used",
            candidateCount: 2,
            reason: null,
            latencyMs: 2,
          },
          {
            channel: "semantic",
            status: "unavailable",
            candidateCount: 0,
            reason: "provider_disabled",
            latencyMs: null,
          },
        ],
      },
      results: [
        {
          id: "evidence-compression",
          snapshotId,
          commitSha: "0123456789abcdef0123456789abcdef01234567",
          fileId: "01900000-0000-7000-8000-000000000104",
          path: "src/server.ts",
          symbolId: null,
          symbol: "createServer",
          startLine: 18,
          endLine: 31,
          content: "app.register(compress, { global: true });",
          contentHash: "sha256:compression",
          score: 0.031754,
          signals: [
            { channel: "text", rank: 1, rawScore: 0.92 },
            { channel: "symbol", rank: 2, rawScore: 0.71 },
          ],
        },
      ],
    };
    const fetchMock = vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      return success(url.includes("/search?") ? result : retrievalStatus());
    });
    const onOpenSource = vi.fn();
    render(<RetrievalLab snapshotId={snapshotId} onOpenSource={onOpenSource} />);

    await screen.findByText("provider disabled");
    runSearch("response compression");

    expect(await screen.findByText(/Hybrid degraded: provider disabled/)).toBeInTheDocument();
    expect(screen.getByText("Fusion 0.0318")).toBeInTheDocument();
    expect(screen.getByText("Text #1 · 0.9200")).toBeInTheDocument();
    expect(screen.getByText("Symbol #2 · 0.7100")).toBeInTheDocument();
    expect(screen.getByText(/Semantic · unavailable · 0 candidates/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /src\/server\.ts:18-31/ }));
    expect(onOpenSource).toHaveBeenCalledWith("src/server.ts", 18, 31);
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("mode=hybrid"),
      expect.any(Object),
    );
  });

  it("surfaces semantic-only unavailability as an explicit API error", async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input).includes("/search?")
        ? failure("Semantic retrieval requires a ready embedding index.")
        : success(retrievalStatus()),
    );
    render(<RetrievalLab snapshotId={snapshotId} onOpenSource={vi.fn()} />);

    await screen.findByText("provider disabled");
    fireEvent.click(screen.getByRole("tab", { name: "Semantic" }));
    runSearch("meaningful handler");

    expect(
      await screen.findByText(/Semantic retrieval requires a ready embedding index/),
    ).toHaveTextContent("Request ID: request-semantic");
  });

  it("prevents an older search response from replacing a newer query", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    let resolveSecond: ((response: Response) => void) | undefined;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<Response>((resolve) => {
      resolveSecond = resolve;
    });
    const result = (id: string, query: string, path: string): SearchResult => ({
      query,
      trace: {
        requestedMode: "hybrid",
        usedChannels: ["text"],
        degraded: true,
        degradationReason: "provider_disabled",
        embeddingIndex: null,
        channels: [
          {
            channel: "text",
            status: "used",
            candidateCount: 1,
            reason: null,
            latencyMs: 1,
          },
        ],
      },
      results: [
        {
          id,
          snapshotId,
          commitSha: "0123456789abcdef0123456789abcdef01234567",
          fileId: "01900000-0000-7000-8000-000000000104",
          path,
          symbolId: null,
          symbol: null,
          startLine: 1,
          endLine: 2,
          content: query,
          contentHash: `sha256:${id}`,
          score: 0.02,
          signals: [{ channel: "text", rank: 1, rawScore: 0.8 }],
        },
      ],
    });
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (!url.includes("/search?")) return success(retrievalStatus());
      return url.includes("q=first") ? first : second;
    });
    render(<RetrievalLab snapshotId={snapshotId} onOpenSource={vi.fn()} />);

    await screen.findByText("provider disabled");
    runSearch("first query");
    runSearch("second query");
    resolveSecond?.(success(result("newer", "second query", "src/newer.ts")));
    expect(await screen.findByRole("button", { name: /src\/newer\.ts:1-2/ })).toBeInTheDocument();
    resolveFirst?.(success(result("older", "first query", "src/older.ts")));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /src\/older\.ts:1-2/ })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /src\/newer\.ts:1-2/ })).toBeInTheDocument();
  });
});
