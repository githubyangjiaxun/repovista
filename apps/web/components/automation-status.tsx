import { AlertCircle, CheckCircle2, Github, Link2, Webhook } from "lucide-react";
import Link from "next/link";
import type { GitHubIntegrationStatus, RepositorySummary } from "@/lib/api";

export function AutomationStatus({
  repository,
  integration,
  unavailable = false,
}: {
  repository: RepositorySummary;
  integration: GitHubIntegrationStatus | null;
  unavailable?: boolean;
}) {
  const serverEnabled = integration?.enabled ?? false;
  const connected = repository.autoUpdateEnabled;
  const lastWebhook = repository.lastWebhookAt
    ? new Date(repository.lastWebhookAt).toLocaleString()
    : null;

  return (
    <article className="panel automation-panel" aria-labelledby="automation-status-title">
      <div className="panel-heading">
        <div>
          <span id="automation-status-title">GitHub automation</span>
          <small>Signed updates for the selected public repository</small>
        </div>
        <Webhook size={18} aria-hidden />
      </div>
      {unavailable ? (
        <output className="automation-unavailable">
          <AlertCircle size={17} aria-hidden />
          <span>Integration status unavailable. The workspace remains usable.</span>
        </output>
      ) : (
        <div className="automation-body">
          <div className="automation-row">
            <span>
              <Webhook size={15} aria-hidden /> Server webhook
            </span>
            <strong className={serverEnabled ? "status-positive" : "status-muted"}>
              <CheckCircle2 size={14} aria-hidden /> {serverEnabled ? "Enabled" : "Disabled"}
            </strong>
          </div>
          <div className="automation-row">
            <span>
              <Link2 size={15} aria-hidden /> This repository
            </span>
            <strong className={connected ? "status-positive" : "status-muted"}>
              <Github size={14} aria-hidden /> {connected ? "Connected" : "Not connected"}
            </strong>
          </div>
          <div className="automation-row">
            <span>Last valid webhook</span>
            <strong>{lastWebhook ?? "Not received"}</strong>
          </div>
          <p className="automation-note">
            Public repositories only · push events on the default branch · HMAC-SHA256 verified.
            {integration ? ` Events: ${integration.events.join(", ")}.` : ""}
          </p>
          <Link className="text-link" href="/docs">
            Read automation docs →
          </Link>
        </div>
      )}
    </article>
  );
}
