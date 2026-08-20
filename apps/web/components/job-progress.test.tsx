// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobProgress } from "./job-progress";

const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, EventListener[]>();
  readonly close = vi.fn();
  onerror: ((event: Event) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener !== "function") return;
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function succeededJobResponse(): Response {
  return new Response(
    JSON.stringify({
      data: {
        id: "01900000-0000-7000-8000-000000000003",
        snapshotId: "01900000-0000-7000-8000-000000000002",
        type: "index_snapshot",
        status: "succeeded",
        phase: "completed",
        progress: 1,
        processed: 2,
        total: 2,
        retryable: false,
        error: null,
      },
      meta: { requestId: "job-progress-test" },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

async function flushRequests(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("JobProgress", () => {
  beforeEach(() => {
    router.replace.mockReset();
    FakeEventSource.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => succeededJobResponse()),
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("navigates only once when polling and stream updates repeat terminal status", async () => {
    render(
      <JobProgress
        jobId="01900000-0000-7000-8000-000000000003"
        repositoryId="01900000-0000-7000-8000-000000000001"
        snapshotId="01900000-0000-7000-8000-000000000002"
      />,
    );
    await flushRequests();

    const events = FakeEventSource.instances[0];
    expect(events?.url).toBe(
      "http://localhost:4000/v1/jobs/01900000-0000-7000-8000-000000000003/events",
    );
    events?.emit("progress", new MessageEvent("progress", { data: "{}" }));
    events?.emit("completed", new MessageEvent("completed", { data: "{}" }));
    await flushRequests();

    await act(async () => vi.advanceTimersByTime(900));
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith(
      "/repositories/01900000-0000-7000-8000-000000000001?snapshotId=01900000-0000-7000-8000-000000000002",
    );

    await act(async () => vi.advanceTimersByTime(6_000));
    await flushRequests();
    expect(router.replace).toHaveBeenCalledTimes(1);
  });
});
