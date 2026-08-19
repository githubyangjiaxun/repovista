import { type BrowserContext, expect, type Locator, type Route, test } from "@playwright/test";

const apiOrigin = "http://localhost:4000";
const webOrigin = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const repositoryId = "01900000-0000-7000-8000-000000000001";
const snapshotId = "01900000-0000-7000-8000-000000000002";
const jobId = "01900000-0000-7000-8000-000000000003";
const fileId = "01900000-0000-7000-8000-000000000004";
const symbolId = "01900000-0000-7000-8000-000000000005";
const messageId = "01900000-0000-7000-8000-000000000006";

const repository = {
  id: repositoryId,
  owner: "acme",
  name: "signal-hub",
  canonicalUrl: "https://github.com/acme/signal-hub",
  defaultBranch: "main",
  latestSnapshotId: snapshotId,
  latestSnapshotStatus: "ready",
  latestCommitSha: "0123456789abcdef0123456789abcdef01234567",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:03.000Z",
};

const snapshot = {
  id: snapshotId,
  repositoryId,
  commitSha: repository.latestCommitSha,
  refName: "main",
  status: "ready",
  parserVersion: "tree-sitter-ts-v1",
  stats: {
    files: 2,
    symbols: 4,
    edges: 3,
    languages: { typescript: 2 },
    warnings: 0,
  },
  requestedAt: "2026-01-01T00:00:00.000Z",
  readyAt: "2026-01-01T00:00:03.000Z",
  failure: null,
};

const files = [
  {
    id: fileId,
    path: "src/server.ts",
    language: "typescript",
    byteSize: 480,
    lineCount: 14,
    blobHash: "sha256:server",
    parseStatus: "parsed",
  },
  {
    id: "01900000-0000-7000-8000-000000000007",
    path: "src/router.ts",
    language: "typescript",
    byteSize: 240,
    lineCount: 8,
    blobHash: "sha256:router",
    parseStatus: "parsed",
  },
];

const sourceLines = [
  'import { createRouter } from "./router.js";',
  "",
  "export async function start() {",
  "  const app = createRouter();",
  "  await app.registerRoutes();",
  "  await app.loadConfig();",
  "  await app.connectDatabase();",
  "  await app.prepare();",
  "  const host = process.env.HOST ?? '127.0.0.1';",
  "  await app.listen({ port: 4000, host });",
  "  return app;",
  "}",
  "",
  "void start();",
];

interface MockState {
  importRequests: unknown[];
  jobRequests: number;
  mapLevels: string[];
  questions: unknown[];
  shareRequests: unknown[];
}

function graph(level: string) {
  const nodes =
    level === "package"
      ? [
          {
            id: "package:src",
            level: "package",
            kind: "package",
            label: "src",
            path: "src/server.ts",
            range: null,
            importance: 1,
            metadata: {},
          },
        ]
      : [
          {
            id: "file:server",
            level,
            kind: level === "symbol" ? "function" : "file",
            label: level === "symbol" ? "start" : "server.ts",
            path: "src/server.ts",
            range: { startLine: 3, endLine: 12 },
            importance: 1,
            metadata: {},
          },
          {
            id: "file:router",
            level,
            kind: level === "symbol" ? "function" : "file",
            label: level === "symbol" ? "createRouter" : "router.ts",
            path: "src/router.ts",
            range: { startLine: 1, endLine: 8 },
            importance: 0.8,
            metadata: {},
          },
        ];
  return {
    snapshot: {
      id: snapshotId,
      commitSha: repository.latestCommitSha,
      parserVersion: snapshot.parserVersion,
    },
    level,
    nodes,
    edges:
      nodes.length > 1
        ? [
            {
              id: "edge:server-router",
              from: nodes[0]?.id,
              to: nodes[1]?.id,
              type: "imports",
              confidence: 1,
            },
          ]
        : [],
    truncated: false,
  };
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Headers": "Content-Type, X-Request-ID",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": webOrigin,
    Vary: "Origin",
  };
}

async function json(route: Route, data: unknown, status = 200): Promise<void> {
  await route.fulfill({
    body: JSON.stringify({ data, meta: { requestId: "e2e-request" } }),
    headers: corsHeaders(),
    status,
    contentType: "application/json",
  });
}

async function installMockApi(
  context: BrowserContext,
  options: { importFailure?: boolean } = {},
): Promise<MockState> {
  const state: MockState = {
    importRequests: [],
    jobRequests: 0,
    mapLevels: [],
    questions: [],
    shareRequests: [],
  };

  await context.route(`${apiOrigin}/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      await route.fulfill({ headers: corsHeaders(), status: 204 });
      return;
    }

    if (request.method() === "POST" && url.pathname === "/v1/repositories") {
      state.importRequests.push(request.postDataJSON());
      if (options.importFailure) {
        await route.fulfill({
          body: JSON.stringify({
            error: {
              code: "REPOSITORY_HOST_NOT_ALLOWED",
              message: "This Git host is not enabled by the server.",
              requestId: "e2e-import-failure",
              retryable: false,
            },
          }),
          headers: corsHeaders(),
          status: 400,
          contentType: "application/json",
        });
      } else {
        await json(route, { repositoryId, snapshotId, jobId, status: "queued" }, 202);
      }
      return;
    }

    if (request.method() === "GET" && url.pathname === `/v1/jobs/${jobId}`) {
      state.jobRequests += 1;
      const succeeded = state.jobRequests > 1;
      await json(route, {
        id: jobId,
        snapshotId,
        type: "index_snapshot",
        status: succeeded ? "succeeded" : "running",
        phase: succeeded ? "completed" : "building_graph",
        progress: succeeded ? 1 : 0.72,
        processed: succeeded ? 2 : 1,
        total: 2,
        retryable: false,
        error: null,
      });
      return;
    }

    if (request.method() === "GET" && url.pathname === `/v1/jobs/${jobId}/events`) {
      await route.fulfill({
        body: `event: completed\ndata: ${JSON.stringify({ snapshotId })}\n\n`,
        headers: { ...corsHeaders(), "Content-Type": "text/event-stream; charset=utf-8" },
        status: 200,
      });
      return;
    }

    if (request.method() === "GET" && url.pathname === "/v1/repositories") {
      await json(route, [repository]);
      return;
    }

    if (request.method() === "GET" && url.pathname === `/v1/repositories/${repositoryId}`) {
      await json(route, repository);
      return;
    }

    if (request.method() === "GET" && url.pathname === `/v1/snapshots/${snapshotId}`) {
      await json(route, snapshot);
      return;
    }

    if (request.method() === "GET" && url.pathname === `/v1/snapshots/${snapshotId}/files`) {
      await json(route, { files, nextCursor: null });
      return;
    }

    if (request.method() === "GET" && url.pathname === `/v1/snapshots/${snapshotId}/map`) {
      const level = url.searchParams.get("level") ?? "package";
      state.mapLevels.push(level);
      await json(route, graph(level));
      return;
    }

    if (request.method() === "GET" && url.pathname === `/v1/snapshots/${snapshotId}/source`) {
      const startLine = Number.parseInt(url.searchParams.get("startLine") ?? "1", 10);
      const endLine = Number.parseInt(url.searchParams.get("endLine") ?? "14", 10);
      await json(route, {
        id: fileId,
        path: url.searchParams.get("path") ?? "src/server.ts",
        language: "typescript",
        content: sourceLines.slice(startLine - 1, endLine).join("\n"),
        lineCount: sourceLines.length,
        startLine,
        commitSha: repository.latestCommitSha,
        blobHash: "sha256:server",
        truncated: false,
      });
      return;
    }

    if (request.method() === "POST" && url.pathname === `/v1/repositories/${repositoryId}/ask`) {
      state.questions.push(request.postDataJSON());
      await json(route, {
        messageId,
        answer: {
          summary: "Requests enter through start() and are handed to the configured router.",
          steps: [
            {
              text: "start() creates the router, prepares dependencies, and listens on port 4000.",
              evidenceIds: ["evidence-1"],
            },
          ],
          limitations: [],
          status: "grounded",
          citations: [
            {
              evidenceId: "evidence-1",
              path: "src/server.ts",
              symbol: "start",
              startLine: 3,
              endLine: 10,
              quote:
                "export async function start() { ... await app.listen({ port: 4000, host }); }",
            },
          ],
          provider: "fake",
          model: "evidence-demo-v1",
        },
        evidence: [
          {
            id: "evidence-1",
            snapshotId,
            commitSha: repository.latestCommitSha,
            fileId,
            path: "src/server.ts",
            symbolId,
            symbol: "start",
            startLine: 3,
            endLine: 10,
            content: sourceLines.slice(2, 10).join("\n"),
            contentHash: "sha256:evidence",
            score: 1,
          },
        ],
      });
      return;
    }

    if (request.method() === "POST" && url.pathname === "/v1/share-reports") {
      state.shareRequests.push(request.postDataJSON());
      await json(route, { id: messageId, slug: "acme-signal-hub-tour" }, 201);
      return;
    }

    if (request.method() === "GET" && url.pathname === "/v1/share-reports/acme-signal-hub-tour") {
      await json(route, {
        id: messageId,
        slug: "acme-signal-hub-tour",
        title: "acme/signal-hub architecture tour",
        repository,
        snapshot,
        content: {
          overview: "A small TypeScript service with a clear server and router boundary.",
          readingPath: [
            { path: "src/server.ts", reason: "Start with the process entry point." },
            { path: "src/router.ts", reason: "Then inspect request routing." },
          ],
          map: graph("package"),
        },
        createdAt: "2026-01-01T00:00:04.000Z",
      });
      return;
    }

    await route.fulfill({
      body: JSON.stringify({
        error: {
          code: "E2E_ROUTE_NOT_MOCKED",
          message: `${request.method()} ${url.pathname} is not mocked.`,
          requestId: "e2e-unmocked",
          retryable: false,
        },
      }),
      headers: corsHeaders(),
      status: 404,
      contentType: "application/json",
    });
  });

  return state;
}

async function expandAnalysisOptions(toggle: Locator): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await toggle.getAttribute("aria-expanded")) === "true") return;
    await toggle.click();
    try {
      await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
      return;
    } catch {
      // A first interaction can land while the development page is still hydrating.
    }
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

test("analyzes a repository and explores its evidence-backed result", async ({ context, page }) => {
  const state = await installMockApi(context);

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Understand any codebase as a map, not a maze/ }),
  ).toBeVisible();
  await page.getByPlaceholder("https://github.com/owner/repository").fill(repository.canonicalUrl);
  await page.getByRole("button", { name: "Explore repository" }).click();

  await expect(page).toHaveURL(/\/repositories\/new\?url=/);
  await expect(page.getByLabel("Public GitHub repository")).toHaveValue(repository.canonicalUrl);
  await expandAnalysisOptions(page.getByRole("button", { name: "Analysis options" }));
  await page.getByLabel("Branch, tag, or commit").fill("main");
  await page.getByLabel("Ignored paths").fill("dist\ngenerated");
  await page.getByRole("button", { name: "Analyze repository" }).click();

  await expect(page).toHaveURL(new RegExp(`/jobs/${jobId}`));
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page).toHaveURL(`${webOrigin}/repositories/${repositoryId}`, { timeout: 12_000 });
  expect(state.importRequests).toEqual([
    { url: repository.canonicalUrl, ref: "main", ignore: ["dist", "generated"] },
  ]);

  await expect(
    page.getByRole("heading", { name: "See the system before reading every file." }),
  ).toBeVisible();
  await expect(page.getByText("2", { exact: true }).first()).toBeVisible();
  await page.getByTitle("src/server.ts").click();
  await expect(page.getByText("src/server.ts", { exact: true }).last()).toBeVisible();
  await expect(page.locator(".source-code")).toContainText("export async function start");
  await page.getByRole("button", { name: "Close source" }).click();

  await page.getByRole("button", { name: "Architecture map" }).click();
  await page.getByRole("button", { name: "file", exact: true }).click();
  await expect(page.getByText("2 nodes · 1 edges")).toBeVisible();
  await expect.poll(() => state.mapLevels).toContain("file");

  await page.getByRole("button", { name: "Ask repository" }).click();
  await page.getByRole("button", { name: "Where does this application start?" }).click();
  await page.getByRole("button", { name: "Ask with evidence" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Requests enter through start() and are handed to the configured router.",
    }),
  ).toBeVisible();
  await expect(page.getByText("src/server.ts:3-10")).toBeVisible();
  expect(state.questions).toEqual([
    {
      question: "Where does this application start?",
      snapshotId,
    },
  ]);
  await page.getByRole("button", { name: /src\/server\.ts:3-10/ }).click();
  await expect(page.getByText("Evidence lines 3-10")).toBeVisible();

  if (process.env.REPOVISTA_CAPTURE_README === "1") {
    await page.screenshot({
      path: "../../docs/assets/repovista-explorer.png",
      fullPage: true,
    });
  }

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Share tour" }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(`${webOrigin}/share/acme-signal-hub-tour`);
  await expect(
    popup.getByRole("heading", { name: "acme/signal-hub architecture tour" }),
  ).toBeVisible();
  await expect(popup.getByText("Read the repository in this order.")).toBeVisible();
  expect(state.shareRequests).toEqual([{ snapshotId, title: "acme/signal-hub architecture tour" }]);
});

test("lists existing repositories and opens an immutable snapshot", async ({ context, page }) => {
  await installMockApi(context);

  await page.goto("/repositories");

  await expect(page.getByRole("heading", { name: "Indexed repositories" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "signal-hub" })).toBeVisible();
  await expect(page.getByText("ready", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: /acme signal-hub/ }).click();
  await expect(page).toHaveURL(`${webOrigin}/repositories/${repositoryId}`);
  await expect(page.getByText("main · 0123456")).toBeVisible();
});

test("shows structured API failures with a request ID", async ({ context, page }) => {
  await installMockApi(context, { importFailure: true });

  await page.goto("/repositories/new");
  await page.getByLabel("Public GitHub repository").fill(repository.canonicalUrl);
  await page.getByRole("button", { name: "Analyze repository" }).click();

  const alert = page.locator('.form-error[role="alert"]');
  await expect(alert).toContainText("This Git host is not enabled by the server.");
  await expect(alert).toContainText("Request ID: e2e-import-failure");
  await expect(page).toHaveURL(`${webOrigin}/repositories/new`);
});
