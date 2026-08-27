import { createHash } from "node:crypto";
import {
  FakeModelProvider,
  GUARDRAIL_EXPLANATION_PROMPT_VERSION,
  guardrailExplanationQuestion,
  verifyModelAnswer,
} from "@repovista/ai";
import { getConfig } from "@repovista/config";
import { BUNDLED_DEMO_REPOSITORY, PARSER_VERSION, type Snapshot } from "@repovista/contracts";
import {
  createDatabasePool,
  migrateDatabase,
  RepoVistaStore,
  type SearchEvidenceRecord,
} from "@repovista/database";
import { type BundledDemoVersion, loadBundledDemoVersions } from "@repovista/demo";
import { DomainError, PUBLIC_WORKSPACE_ID } from "@repovista/domain";
import { createWorkspace, removeWorkspace } from "@repovista/git";
import { linkParsedImports } from "@repovista/graph";
import {
  BUILT_IN_GUARDRAIL_PROFILE,
  buildGuardrailReport,
  guardrailFindingSubjectKey,
} from "@repovista/guardrails";
import { parseRepository } from "@repovista/parser";
import { executeIndexJob } from "./indexer.js";

function forceRequested(): boolean {
  return process.argv.includes("--force");
}

async function existingReadySnapshot(
  store: RepoVistaStore,
  repositoryId: string,
  commitSha: string,
): Promise<Snapshot | null> {
  const snapshots = await store.listSnapshots(repositoryId);
  return (
    snapshots.find(
      (snapshot) =>
        snapshot.status === "ready" &&
        snapshot.commitSha === commitSha &&
        snapshot.parserVersion === PARSER_VERSION,
    ) ?? null
  );
}

async function indexVersion(
  store: RepoVistaStore,
  version: BundledDemoVersion,
  config: ReturnType<typeof getConfig>,
): Promise<Snapshot> {
  const repositories = await store.listRepositories(PUBLIC_WORKSPACE_ID);
  const current = repositories.find(
    (repository) => repository.canonicalUrl === BUNDLED_DEMO_REPOSITORY.canonicalUrl,
  );
  if (current) {
    if (
      current.owner !== BUNDLED_DEMO_REPOSITORY.owner ||
      current.name !== BUNDLED_DEMO_REPOSITORY.name ||
      current.visibility === "private"
    ) {
      throw new DomainError(
        "DEMO_REPOSITORY_CONFLICT",
        "The bundled demo repository identity is occupied by incompatible data.",
      );
    }
    const ready = await existingReadySnapshot(store, current.id, version.commitSha);
    if (ready) return ready;
  }

  const imported = await store.createRepositoryImport({
    workspaceId: PUBLIC_WORKSPACE_ID,
    identity: BUNDLED_DEMO_REPOSITORY,
    visibility: "public",
    defaultBranch: BUNDLED_DEMO_REPOSITORY.defaultBranch,
    actorUserId: null,
    actorKind: "system",
    requestedRef: version.requestedRef,
    ignore: [],
    parserVersion: PARSER_VERSION,
  });
  const workerId = `demo-seed-${version.key}`;
  const claimed = await store.claimIndexJob(workerId, config.JOB_LEASE_SECONDS, imported.jobId);
  if (!claimed) {
    const ready = await existingReadySnapshot(store, imported.repositoryId, version.commitSha);
    if (ready) return ready;
    throw new DomainError(
      "DEMO_JOB_UNAVAILABLE",
      `The bundled demo ${version.key} job could not be claimed safely.`,
    );
  }
  const outcome = await executeIndexJob(
    store,
    claimed,
    { ...config, WORKER_ID: workerId },
    {
      cloneRepository: async () => ({ commitSha: version.commitSha, branch: version.branch }),
      createWorkspace,
      linkParsedImports,
      parseRepository,
      removeWorkspace,
      scanWorkspace: async () => version.files,
      installationToken: async () => {
        throw new DomainError(
          "DEMO_CREDENTIAL_FORBIDDEN",
          "The bundled public demo never requests installation credentials.",
        );
      },
    },
  );
  if (outcome !== "succeeded") {
    throw new DomainError(
      "DEMO_INDEX_FAILED",
      `The bundled demo ${version.key} index finished with outcome ${outcome}.`,
    );
  }
  const snapshot = await store.getSnapshot(imported.snapshotId);
  if (!snapshot || snapshot.status !== "ready" || snapshot.commitSha !== version.commitSha) {
    throw new DomainError(
      "DEMO_INDEX_INCOMPLETE",
      `The bundled demo ${version.key} snapshot was not published as Ready.`,
    );
  }
  return snapshot;
}

async function loadDemoGuardrails(store: RepoVistaStore, snapshotId: string) {
  const graph = await store.getSnapshotGraphData(snapshotId);
  if (!graph || graph.snapshot.status !== "ready" || !graph.snapshot.commitSha) {
    throw new DomainError("DEMO_SNAPSHOT_NOT_READY", "The bundled demo snapshot is unavailable.");
  }
  return buildGuardrailReport({
    snapshot: {
      id: graph.snapshot.id,
      commitSha: graph.snapshot.commitSha,
      parserVersion: graph.snapshot.parserVersion,
      requestedAt: graph.snapshot.requestedAt,
      readyAt: graph.snapshot.readyAt,
    },
    files: graph.files,
    symbols: graph.symbols,
    edges: graph.edges,
    profile: BUILT_IN_GUARDRAIL_PROFILE,
  });
}

async function findingEvidence(
  store: RepoVistaStore,
  snapshot: Snapshot,
  finding: Awaited<ReturnType<typeof loadDemoGuardrails>>["findings"][number],
): Promise<SearchEvidenceRecord[]> {
  if (!snapshot.commitSha) return [];
  const records: SearchEvidenceRecord[] = [];
  const seen = new Set<string>();
  for (const [index, item] of finding.evidence.slice(0, 20).entries()) {
    const key = `${item.path}:${item.startLine}:${item.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const source = await store.getSourceFile(
      snapshot.id,
      item.path,
      item.startLine,
      Math.min(item.endLine, item.startLine + 399),
    );
    if (!source || source.commitSha !== snapshot.commitSha || source.content.length === 0) continue;
    records.push({
      id: `bundled-demo-evidence:${finding.fingerprint.slice(-16)}:${index + 1}`,
      snapshotId: snapshot.id,
      commitSha: snapshot.commitSha,
      fileId: source.id,
      path: source.path,
      symbolId: null,
      symbol: null,
      startLine: source.startLine,
      endLine: source.startLine + Math.max(0, source.content.split(/\r?\n/).length - 1),
      content: source.content,
      contentHash: `sha256:${createHash("sha256").update(source.content).digest("hex")}`,
      score: 1 - index / 100,
    });
  }
  return records;
}

async function seedExplanation(
  store: RepoVistaStore,
  snapshot: Snapshot,
  report: Awaited<ReturnType<typeof loadDemoGuardrails>>,
): Promise<string> {
  const finding = report.findings.find((item) => item.ruleId === "dependency_cycle");
  if (!finding || !snapshot.commitSha) {
    throw new DomainError(
      "DEMO_FINDING_MISSING",
      "The bundled demo dependency-cycle Finding is unavailable.",
    );
  }
  const provider = new FakeModelProvider();
  const existing = await store.findGuardrailExplanation(
    snapshot.id,
    PUBLIC_WORKSPACE_ID,
    finding.fingerprint,
    provider.id,
    provider.defaultModel,
    GUARDRAIL_EXPLANATION_PROMPT_VERSION,
  );
  if (existing) return existing.id;
  const evidence = await findingEvidence(store, snapshot, finding);
  if (evidence.length === 0) {
    throw new DomainError(
      "DEMO_EVIDENCE_MISSING",
      "The bundled demo Finding has no readable source evidence.",
    );
  }
  const draft = await provider.generate({
    question: guardrailExplanationQuestion(finding),
    evidence,
    model: provider.defaultModel,
  });
  const answer = verifyModelAnswer(draft, evidence, provider.id, provider.defaultModel);
  const saved = await store.createGuardrailExplanation({
    workspaceId: PUBLIC_WORKSPACE_ID,
    snapshotId: snapshot.id,
    finding,
    answer,
    profile: BUILT_IN_GUARDRAIL_PROFILE,
    commitSha: snapshot.commitSha,
    parserVersion: report.snapshot.parserVersion,
    algorithmVersion: report.algorithmVersion,
    provider: provider.id,
    model: provider.defaultModel,
    promptVersion: GUARDRAIL_EXPLANATION_PROMPT_VERSION,
    actorUserId: null,
    actorKind: "system",
    profileFingerprint: BUILT_IN_GUARDRAIL_PROFILE.fingerprint,
  });
  return saved.explanation.id;
}

async function main(): Promise<void> {
  const config = getConfig();
  if (!config.DEMO_SEED_ENABLED && !forceRequested()) {
    console.log("Bundled demo seed is disabled.");
    return;
  }
  const pool = createDatabasePool(config.DATABASE_URL, config.DATABASE_MAX_CONNECTIONS);
  try {
    await migrateDatabase(pool);
    const store = new RepoVistaStore(pool);
    const versions = await loadBundledDemoVersions();
    const base = await indexVersion(store, versions.base, config);
    const head = await indexVersion(store, versions.head, config);
    if (head.baseSnapshotId !== base.id || head.indexMode !== "incremental") {
      throw new DomainError(
        "DEMO_INCREMENTAL_INVALID",
        "The bundled demo Head did not use the Base as its incremental Snapshot.",
      );
    }
    const [baseReport, headReport] = await Promise.all([
      loadDemoGuardrails(store, base.id),
      loadDemoGuardrails(store, head.id),
    ]);
    const baseFinding = baseReport.findings.find((item) => item.ruleId === "dependency_cycle");
    const headFinding = headReport.findings.find((item) => item.ruleId === "dependency_cycle");
    if (
      !baseFinding ||
      !headFinding ||
      guardrailFindingSubjectKey(baseFinding) !== guardrailFindingSubjectKey(headFinding)
    ) {
      throw new DomainError(
        "DEMO_HISTORY_INVALID",
        "The bundled demo Findings do not form one deterministic history subject.",
      );
    }
    const [baseExplanationId, headExplanationId] = await Promise.all([
      seedExplanation(store, base, baseReport),
      seedExplanation(store, head, headReport),
    ]);
    console.log(
      JSON.stringify({
        repository: BUNDLED_DEMO_REPOSITORY.canonicalUrl,
        base: {
          snapshotId: base.id,
          revision: base.commitSha,
          mode: base.indexMode,
          stats: base.stats.indexing,
          explanationId: baseExplanationId,
        },
        head: {
          snapshotId: head.id,
          revision: head.commitSha,
          mode: head.indexMode,
          stats: head.stats.indexing,
          explanationId: headExplanationId,
        },
        provider: "fake",
      }),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Bundled demo seed failed.");
  process.exitCode = 1;
});
