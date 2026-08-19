// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GitHubIntegrationStatus, RepositorySummary } from "@/lib/api";
import { AutomationStatus } from "./automation-status";

const repository: RepositorySummary = {
  id: "01900000-0000-7000-8000-000000000001",
  owner: "acme",
  name: "signal-hub",
  canonicalUrl: "https://github.com/acme/signal-hub",
  defaultBranch: "main",
  latestSnapshotId: "01900000-0000-7000-8000-000000000002",
  latestSnapshotStatus: "ready",
  latestCommitSha: "0123456789abcdef0123456789abcdef01234567",
  autoUpdateEnabled: true,
  lastWebhookAt: "2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const integration: GitHubIntegrationStatus = {
  enabled: true,
  appSlug: "repovista-demo",
  events: ["ping", "push"],
  scope: "public-repositories",
};

afterEach(cleanup);

describe("AutomationStatus", () => {
  it("separates server enablement from repository connection", () => {
    render(<AutomationStatus integration={integration} repository={repository} />);

    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText(/Public repositories only/)).toBeInTheDocument();
  });

  it("renders disabled and not connected as explicit text", () => {
    render(
      <AutomationStatus
        integration={{ ...integration, enabled: false }}
        repository={{ ...repository, autoUpdateEnabled: false, lastWebhookAt: null }}
      />,
    );

    expect(screen.getByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByText("Not received")).toBeInTheDocument();
  });

  it("does not block the workspace when integration status is unavailable", () => {
    render(<AutomationStatus integration={null} repository={repository} unavailable />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Integration status unavailable. The workspace remains usable.",
    );
  });
});
