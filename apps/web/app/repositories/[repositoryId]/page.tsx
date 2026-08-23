import type { RetrievalMode } from "@repovista/contracts";
import { RepositoryExplorer } from "@/components/repository-explorer";

const retrievalModes = new Set<RetrievalMode>(["text", "symbol", "semantic", "hybrid"]);
const workspaceTabs = new Set(["overview", "map", "guardrails", "search", "ask"]);

function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function RepositoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ repositoryId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ repositoryId }, query] = await Promise.all([params, searchParams]);
  const tab = one(query.tab);
  const mode = one(query.mode);
  const rawLimit = Number.parseInt(one(query.limit) ?? "20", 10);
  return (
    <RepositoryExplorer
      initialSearchLimit={Number.isInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 20}
      initialSearchMode={
        mode && retrievalModes.has(mode as RetrievalMode) ? (mode as RetrievalMode) : "hybrid"
      }
      initialSearchQuery={one(query.q) ?? ""}
      initialTab={
        tab && workspaceTabs.has(tab)
          ? (tab as "overview" | "map" | "guardrails" | "search" | "ask")
          : "overview"
      }
      repositoryId={repositoryId}
      snapshotId={typeof query.snapshotId === "string" ? query.snapshotId : undefined}
    />
  );
}
