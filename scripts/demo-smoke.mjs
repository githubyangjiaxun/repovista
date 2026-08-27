const apiOrigin = (process.env.API_ORIGIN ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
const demoUrl = process.env.DEMO_REPOSITORY_URL ?? "https://repovista-demo.invalid/polyglot-demo";

async function request(path) {
  const response = await fetch(`${apiOrigin}${path}`, {
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `${path} returned ${response.status}: ${payload?.error?.code ?? "request_failed"}`,
    );
  }
  if (!payload || !("data" in payload)) throw new Error(`${path} returned an invalid envelope`);
  return payload.data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const health = await fetch(`${apiOrigin}/v1/health/ready`);
assert(health.ok, "API is not ready");
const repositories = await request("/v1/repositories");
const repository = repositories.find((item) => item.canonicalUrl === demoUrl);
assert(repository, "Bundled demo repository is missing");
assert(repository.latestSnapshotId, "Bundled demo has no latest Ready Snapshot");

const snapshots = await request(`/v1/repositories/${encodeURIComponent(repository.id)}/snapshots`);
const ready = snapshots.filter((item) => item.status === "ready");
const head = ready.find((item) => item.id === repository.latestSnapshotId);
const base = ready.find((item) => item.id === head?.baseSnapshotId);
assert(head && base, "Bundled demo Base/Head snapshots are incomplete");
assert(head.indexMode === "incremental", "Bundled demo Head is not incremental");
assert(head.baseSnapshotId === base.id, "Bundled demo Head points at the wrong Base");
assert((head.stats.indexing?.reusedFiles ?? 0) > 0, "Bundled demo did not reuse a file");
assert((head.stats.indexing?.deletedFiles ?? 0) > 0, "Bundled demo did not record a deletion");

const graph = await request(`/v1/snapshots/${encodeURIComponent(head.id)}/map?level=package`);
assert(graph.nodes.length > 0 && graph.edges.length > 0, "Bundled demo map is empty");
const source = await request(
  `/v1/snapshots/${encodeURIComponent(head.id)}/source?path=src/core/service.ts`,
);
assert(source.commitSha === head.commitSha, "Source is not pinned to the Head revision");
const search = await request(
  `/v1/snapshots/${encodeURIComponent(head.id)}/search?q=normalizeAccountId&mode=text&limit=5`,
);
assert(search.results?.length > 0, "Bundled demo search did not find the changed symbol");
const report = await request(`/v1/snapshots/${encodeURIComponent(head.id)}/guardrails`);
const finding = report.findings.find((item) => item.ruleId === "dependency_cycle");
assert(finding, "Bundled demo dependency-cycle Finding is missing");
const history = await request(
  `/v1/snapshots/${encodeURIComponent(head.id)}/guardrails/explanations?findingId=${encodeURIComponent(finding.id)}&limit=50`,
);
assert(history.explanations.length >= 2, "Bundled demo explanation history is incomplete");
const baseExplanation = history.explanations.find((item) => item.snapshot.id === base.id);
const headExplanation = history.explanations.find((item) => item.snapshot.id === head.id);
assert(baseExplanation && headExplanation, "Bundled demo history lacks Base or Head explanation");
const comparison = await request(
  `/v1/repositories/${encodeURIComponent(repository.id)}/guardrails/explanations/compare?baseExplanationId=${encodeURIComponent(baseExplanation.id)}&headExplanationId=${encodeURIComponent(headExplanation.id)}`,
);
assert(comparison.base && comparison.head, "Bundled demo explanation comparison is incomplete");
assert(
  comparison.subjectKey === history.subjectKey,
  "Bundled demo comparison changed the deterministic history subject",
);
assert(
  typeof comparison.changed === "boolean" && comparison.differences,
  "Bundled demo comparison did not return structural differences",
);
console.log(
  JSON.stringify({
    repositoryId: repository.id,
    baseSnapshotId: base.id,
    headSnapshotId: head.id,
    baseRevision: base.commitSha,
    headRevision: head.commitSha,
    historyCount: history.explanations.length,
    changed: comparison.changed,
  }),
);
