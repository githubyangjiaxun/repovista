# RepoVista

> Understand any codebase as a map, not a maze.

RepoVista is an evidence-first repository explorer for public GitHub projects and securely connected
private repositories. It clones a fixed snapshot, extracts files and symbols with Tree-sitter, builds
package/file/symbol graphs, and lets you ask questions whose answers are tied back to exact source
ranges.

**AI explains the code. The code provides the evidence.**

![RepoVista repository explorer](./docs/assets/repovista-explorer.png)

## Why RepoVista

Most repository chat tools start with a model and hope the answer is right. RepoVista starts with
an immutable commit and a deterministic index:

| Layer | What it does | Trust property |
|---|---|---|
| Git snapshot | Resolves and shallow-clones a public repository | Every result is pinned to one commit |
| Static analysis | Extracts modules, declarations, imports, calls, and cross-language relations | Repeatable without a model |
| Evidence retrieval | Ranks source chunks and symbols | Always returns paths and line ranges |
| AI explanation | Turns retrieved evidence into an answer | Unsupported citations are removed |

The map, source browser, search, reading path, and share reports remain useful without a model API
key. The default `fake` provider is a transparent deterministic evidence summarizer, so the full
workflow can be evaluated locally before connecting Ollama or an OpenAI-compatible endpoint.

## What v1.2 adds

- Reviewable Guardrails metadata with `acknowledged`, `accepted_risk`, and `false_positive` states,
  Workspace isolation, CSRF/role checks, and append-only audit events.
- Deterministic SARIF and JSON exports that keep human review metadata separate from the
  `pass`/`warn`/`fail` analysis and CI decision.
- Web review controls and CLI `guardrails reviews list/set/clear` workflows. Review notes are bounded
  plain text and never sent to a model or used to alter findings.
- Forward migration `0009_guardrail_reviews.sql`; the bundled Demo remains read-only for reviews.

The review layer is collaboration metadata, not an AI quality score. See the [v1.2 plan](docs/releases/v1.2-开发计划.md),
[backend contract](docs/backend/v1.2后端开发文档.md), [AI trust boundary](docs/ai/v1.2人审与AI可信边界.md),
and [acceptance record](docs/releases/v1.2-验收记录.md).

## What v1.1 adds

- A bundled, reviewable two-revision TypeScript/Python/Go fixture that is indexed through the same
  Scanner, Tree-sitter, Graph, Worker lease, Store, Guardrails, and citation paths as normal data.
- One-command Compose startup with an idempotent offline seed: no GitHub account, model key, Ollama,
  or external repository is needed to open a Ready architecture workspace.
- A Full Base and real Incremental Head with visible changed/reused/parsed/deleted counters, plus
  deterministic Fake Provider explanations and cross-Snapshot history for one stable Finding.
- A homepage shortcut, API smoke command, contributor workflow, and an opt-in hardened Compose
  overlay that disables demo data for production deployments.

The fixture revisions are synthetic content-manifest hashes, not GitHub-hosted commits. The Fake
Provider proves evidence and citation plumbing; it is not a claim about external model quality.

## What v1.0 includes

- Cursor-paginated history for verified Guardrail explanations across immutable Snapshots of the
  same Repository and logical Finding.
- A server-owned SHA-256 `subjectKey` shared with deterministic Guardrails pairing rules; clients
  cannot submit or override the logical Finding identity.
- Pure structural comparison of two saved explanations across provenance, Finding, and Answer
  fields. Results are only `same` or `changed` and never claim a winner, improvement, or regression.
- CLI `guardrails explanations history/compare` workflows and an accessible Web history panel with
  lazy loading, pagination, Viewer read access, race protection, and Base/Head fixed-source links.
- Forward migration `0008_guardrail_explanation_history.sql`, including v0.9 record backfill and a
  stable `(workspace_id, subject_key, created_at DESC, id DESC)` history index.

History and comparison do not call an AI provider. They only read explanations that already passed
the v0.9 citation verifier. See the [v1.0 acceptance record](docs/releases/v1.0-验收记录.md) for the
reproducible database, API, CLI, Web, Chromium, Compose, and Git evidence.

## What v0.9 includes

- Optional Verified Guardrail Explanations for a server-selected Finding. AI never chooses the rule,
  severity, fingerprint, policy, Commit, or source location.
- Fixed `guardrail-explanation-v1` prompts and bounded same-Snapshot source evidence. Unknown model
  citations are removed; an answer with no valid citation becomes `refused`.
- Immutable, Workspace-scoped explanation records with explicit Snapshot/Commit/parser/algorithm,
  Profile fingerprint, Finding fingerprint, provider/model, and prompt provenance.
- API, CLI `guardrails explain`, and Web “Explain with AI” workflows with citation navigation and
  idempotent reuse before another model request is made.
- Concurrent requests converge on one database record. Raw model responses and complete source files
  are not stored; only verifier-approved bounded citation excerpts may be retained.

The deterministic Guardrails report and SARIF remain the only CI decision source. Explanations are a
reviewable aid, not a security proof or an automatic fix. See the [v0.9 acceptance record](docs/releases/v0.9-验收记录.md)
for reproducible release evidence and explicit external-provider limitations.

## What v0.7 includes

- Deterministic Guardrails Snapshot baseline comparison for two Ready Snapshots from the same
  Repository, with `added`, `resolved`, `unchanged`, and `changed` Finding states.
- Overall `regressed`, `improved`, or `unchanged` summaries that compare severity changes without
  allowing AI, mutable policy, or current-repository pointers to influence the result.
- HTTP, CLI, and Web workflows for baseline comparison, including `--json`, CI exit code `2` on
  regressions, historical Ready Snapshot selection, and Base/Head commit-pinned evidence buttons.
- Compatibility and privacy gates for Workspace, Repository, Ready status, Parser Version, algorithm
  profile, thresholds, and public/private cache behavior; comparison responses never contain source
  contents.

The v0.7 implementation details and reproducible gates are in the [v0.7 acceptance record](docs/releases/v0.7-验收记录.md).

## What v0.8 includes

- Immutable, Workspace-scoped Guardrails Policy Profiles. Profiles can adjust only the existing
  deterministic thresholds; users cannot upload rules, scripts, prompts, or model configuration.
- Idempotent profile creation: an identical latest request reuses its immutable version, while a
  changed name, description, algorithm, or threshold set creates the next version with a new UUID and
  SHA-256 fingerprint.
- Repository-level profile assignment for future Snapshots, with the selected profile ID copied into
  each new Snapshot. Historical reports continue to use their own policy snapshot, and legacy NULL
  values resolve to the built-in `default` profile.
- Profile provenance in Guardrails JSON/SARIF reports, CLI profile management, and Web profile
  visibility/assignment with Workspace authorization. Baseline comparison rejects differing policy
  fingerprints with HTTP 409.

AI remains an optional explanation layer. It never decides Guardrails findings, changes thresholds,
executes repository-provided code, or edits a policy profile. See the [v0.8 acceptance record](docs/releases/v0.8-验收记录.md)
for reproducible gates and the explicit PostgreSQL/GitHub fixture boundaries.

## What v0.6 includes

- Deterministic Architecture Guardrails evaluated from one immutable Snapshot: dependency cycles,
  oversized files/symbols, high fan-in, unresolved imports, and parse failures.
- Commit-pinned findings with stable fingerprints, source/relationship evidence, fixed thresholds,
  and algorithm provenance (`architecture-guardrails-v1`).
- JSON and SARIF 2.1.0 HTTP exports with the same Workspace access checks and private no-store
  response policy as other Snapshot artifacts.
- CLI `guardrails <snapshot-id>` with human-readable, JSON, and SARIF modes; error findings return
  exit code `2` for CI integration.
- A Web Guardrails workspace that links every finding back to immutable source evidence without
  exposing private source to anonymous downloads.

Guardrails are intentionally deterministic and do not use AI to decide whether a rule fires. AI may
later explain an already verified finding, but it cannot create findings or change their evidence.
The v0.6 guardrail checks and known boundaries remain in the [v0.6 acceptance record](docs/releases/v0.6-验收记录.md).

## What v0.5 includes

- GitHub OAuth login with HttpOnly sessions, CSRF protection, explicit Workspace switching, audited
  member administration, and revocable Workspace-bound CLI API tokens.
- GitHub App installation flow for selected private repositories. Installation and clone credentials
  are short-lived, held only in server memory, and never placed in URLs, job events, logs, or the
  database.
- Workspace-aware authorization for repositories, snapshots, jobs, PR analyses, exports, answers,
  and share reports. Private shares are members-only and marked `noindex`.
- Authenticated Markdown/SVG Blob downloads for private snapshots, with private non-cacheable API
  responses even when Web and API use different origins.
- Web and CLI private-repository workflows: `auth login/status/logout`, `workspace list/use`,
  `github installations/repos`, and `analyze --installation <id>`.
- Signed installation, repository-grant, push, and pull-request webhook boundaries with audit events
  and safe handling of disconnects or suspended installations.

The public anonymous demo remains available. To enable login or private repositories, configure the
GitHub OAuth/App values in `.env` and keep the repository private until you are ready to publish it.
The reproducible automated release evidence and the explicitly pending real GitHub fixture are in
the [v0.5 acceptance record](docs/releases/v0.5-验收记录.md).

## What v0.4 includes

- Versioned, immutable-Snapshot embedding indexes through real Ollama or OpenAI-compatible
  `/embeddings` endpoints, with resumable leased jobs and validated variable-dimension vectors.
- Transparent `text`, `symbol`, `semantic`, and RRF `hybrid` retrieval. Every result exposes its
  channel ranks and raw scores; Hybrid reports explicit degradation instead of pretending that
  semantic retrieval succeeded.
- An Evidence Retrieval Lab in the Web workspace, shared retrieval traces for grounded Ask, and
  CLI workflows for building indexes and searching fixed snapshots.
- Deterministic Architecture Story v2 reports with metrics, package maps, key modules, reading
  paths, source evidence, and complete Commit/parser/algorithm provenance.

The release was exercised against `go-chi/chi` at
`8b258c7bb28f97a5f2a856ff7ef962578fec9215`: 97 files, 644 symbols, 3,120 graph edges, and 663
source chunks were indexed with Ollama `nomic-embed-text` into 663 validated 768-dimensional
vectors. Hybrid search stayed available when Ollama was stopped, while semantic-only search
returned an explicit upstream-unavailable error. Commands, ranks, SQL plans, machine details, and
limitations are in the [v0.4 acceptance record](docs/releases/v0.4-验收记录.md).

## What v0.3 includes

- Go Tree-sitter indexing with module-path import linking, struct embedding, interface implementation, methods, calls, and incremental snapshots.
- Deterministic public GitHub pull-request impact analysis across immutable base/head snapshots, with direct/transitive/unknown results, bounded reverse BFS, risk breakdown, shortest paths, and fixed evidence.
- A Web Impact Workspace with progress polling, changed-file/symbol summaries, stable cursor pagination, filters, evidence drawer, GitHub links, and read-only VS Code links.
- An independently versioned VS Code extension (`extensions/vscode`) with repository mapping, immutable snapshot selection, TreeView/Webview impact inspection, nonce CSP, schema-validated messages, offline cache, path/Origin/Commit guards, and `.vsix` packaging.

The reproducible real-repository and pull-request verification details are recorded in [docs/releases/v0.3-验收记录.md](docs/releases/v0.3-验收记录.md).

## What v0.2 includes

- Public GitHub repository import with branch, tag, or commit selection.
- Security-constrained shallow clones; repository scripts are never installed or executed.
- TypeScript, TSX, JavaScript, JSX, MJS, CJS, and Python indexing with Tree-sitter (Go support is documented above for v0.3).
- Package-, file-, and symbol-level architecture maps with source navigation.
- Immutable source browsing and full-text/symbol evidence search.
- PostgreSQL-backed jobs with leases, progress events, cancellation, retries, and crash recovery.
- Grounded questions through deterministic, Ollama, or OpenAI-compatible providers.
- Citation verification that drops model references not present in retrieved evidence.
- Commit-pinned public architecture tours.
- Web UI, JSON HTTP API, and scriptable CLI.
- Reproducible API, Worker, and Web containers plus Docker Compose.
- Content-hash incremental indexing with immutable, self-contained snapshots and explicit
  parsed/reused/changed/deleted counters.
- Signed GitHub `ping`/`push` webhook updates for public default-branch repositories with delivery
  idempotency and HMAC-SHA256 verification.
- Deterministic Markdown architecture reports and CSP-protected SVG maps for every ready snapshot.

Public imports still accept `https://github.com/owner/repository` URLs. Private imports require a
connected GitHub App installation and an authenticated Workspace member; users never paste a GitHub
password or PAT into RepoVista. AI remains an optional explanation layer: the map, source browser,
search, and exports work without a model key.

## Quick start

Requirements: Docker with Compose and outbound access to GitHub.

```bash
docker compose up --build -d
```

Then open:

- Web: <http://localhost:3000>
- API readiness: <http://localhost:4000/v1/health/ready>

The first start seeds a bundled offline Demo and then starts the normal Worker. Open the homepage and
choose **Open the bundled demo**, or verify the whole public API path with:

```bash
pnpm install --frozen-lockfile
pnpm demo:smoke
```

Paste a public GitHub URL, wait for the Worker to finish, and explore the resulting immutable
snapshot. Follow progress or stop the stack with:

```bash
docker compose logs -f worker
docker compose down
```

`docker compose down` preserves the PostgreSQL volume. Use `docker compose down -v` only when you
explicitly want to delete RepoVista's local database.

Set `DEMO_SEED_ENABLED=false` to skip bundled data. For an internet-facing deployment, use the
[hardened deployment profile](docs/operations/生产部署加固.md); the default Compose file is a local
evaluation configuration and must not be exposed directly to the internet.

## CLI

The CLI talks to a running RepoVista API. Until it is published as a package, run it from the
workspace:

```bash
pnpm install --frozen-lockfile
pnpm --filter @repovista/cli dev doctor
pnpm --filter @repovista/cli dev analyze https://github.com/octocat/Hello-World --wait
pnpm --filter @repovista/cli dev repositories
```

After `analyze`, use the printed repository ID:

```bash
pnpm --filter @repovista/cli dev show <repository-id>
pnpm --filter @repovista/cli dev ask <repository-id> "Where does this application start?"
```

For a Ready Snapshot, inspect retrieval, build a configured semantic index, and search it:

```bash
pnpm --filter @repovista/cli dev embed <snapshot-id> --wait
pnpm --filter @repovista/cli dev search <snapshot-id> \
  "where is response compression configured" --mode hybrid --limit 10
pnpm --filter @repovista/cli dev guardrails compare <base-snapshot-id> <head-snapshot-id>
pnpm --filter @repovista/cli dev guardrails explain <snapshot-id> <finding-id>
pnpm --filter @repovista/cli dev guardrails explanations history <snapshot-id> <finding-id>
pnpm --filter @repovista/cli dev guardrails explanations compare \
  <repository-id> <base-explanation-id> <head-explanation-id>
```

Every command supports `--json`; `--api-url` points the CLI at a different API origin. Run
`pnpm --filter @repovista/cli dev --help` for the complete command reference.

## Model modes

The Compose default is deterministic and needs no credentials.

| `MODEL_PROVIDER` | Required configuration | Behavior |
|---|---|---|
| `fake` | none | Deterministically summarizes retrieved evidence |
| `none` | none | Uses the same evidence-only fallback for questions |
| `ollama` | `OLLAMA_BASE_URL`, optional `CHAT_MODEL` | Uses Ollama's OpenAI-compatible API |
| `openai-compatible` | `OPENAI_COMPATIBLE_BASE_URL`, optional key/model | Uses `/chat/completions` with JSON output |

Example with a host Ollama instance:

```bash
MODEL_PROVIDER=ollama \
CHAT_MODEL=qwen3:8b \
OLLAMA_BASE_URL=http://host.docker.internal:11434 \
docker compose up --build -d
```

RepoVista sends the retrieved source evidence to the selected model endpoint. Use `fake`, `none`,
or a locally controlled Ollama instance when source must remain on the machine.

Chat and embeddings are configured independently. Semantic retrieval is disabled by default and
is never simulated by `MODEL_PROVIDER=fake`:

| `EMBEDDING_PROVIDER` | Required configuration | Embedding protocol |
|---|---|---|
| `none` | none | Text and symbol search remain available; Hybrid reports `index_not_ready` |
| `ollama` | `EMBEDDING_MODEL`, `OLLAMA_BASE_URL` | `POST /api/embed` |
| `openai-compatible` | `EMBEDDING_MODEL`, `OPENAI_COMPATIBLE_BASE_URL`, optional key | `POST /embeddings` |

Example with host Ollama and the model used for v0.4 acceptance:

```bash
ollama pull nomic-embed-text
EMBEDDING_PROVIDER=ollama \
EMBEDDING_MODEL=nomic-embed-text \
OLLAMA_BASE_URL=http://host.docker.internal:11434 \
docker compose up --build -d
```

API and Worker must use the same provider/model configuration. Embedding input is bounded and
versioned (`code-chunk-v1`); vector count, finite values, non-zero norm, and dimensions are
validated before persistence.

## Architecture

```mermaid
flowchart LR
    Browser[Next.js Web] --> API[Fastify API]
    CLI[RepoVista CLI] --> API
    GitHub[Signed GitHub webhook] --> API
    API --> PG[(PostgreSQL 17 + pgvector)]
    API --> Chat[Fake / Ollama / OpenAI-compatible chat]
    API --> Embed[Ollama / OpenAI-compatible embeddings]
    API --> Export[Deterministic Markdown / SVG]
    API --> Story[Deterministic Architecture Story]
    Worker[Index Worker] --> PG
    Worker --> Embed
    Worker --> Git[Safe shallow Git clone]
    Git --> Plan[Content-hash incremental plan]
    Plan --> Parser[Tree-sitter TS / JS / Python / Go]
    Parser --> Graph[Complete package / file / symbol graph]
    Graph --> Impact[Deterministic PR impact + fixed evidence]
    Impact --> Editor[Web Impact Workspace + VS Code extension]
    Graph --> PG
```

This is a modular TypeScript monorepo:

```text
apps/web       Next.js repository explorer and Evidence Retrieval Lab
apps/api       Fastify HTTP API, retrieval, story, and grounded-answer orchestration
apps/worker    leased source-index and resumable embedding-index worker
apps/cli       command-line client
packages/*     contracts, database, Git, parser, graph, embeddings, retrieval, story, AI, exporter, UI
openapi/       checked API contract
benchmarks/    parser baseline and deterministic retrieval-quality harness
```

The API and Worker coordinate through PostgreSQL rather than Redis. Source blobs are content
addressed and stored inline in PostgreSQL. See the accepted
[implementation baseline](./docs/decisions/0001-implementation-baseline.md) and
[v0.2 update pipeline](./docs/decisions/0002-v02-update-pipeline.md) for the architectural
trade-offs.

## Local development

Requirements: Node.js 22+, pnpm 10.30.3, Docker, and Git.

```bash
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Root `.env` values are loaded by `pnpm dev`; all settings also have safe local defaults. The main
quality gate is:

```bash
pnpm check
```

Additional release checks:

```bash
pnpm test:e2e
docker compose config --quiet
DATABASE_TEST_URL=postgresql://repovista:repovista@localhost:5432/repovista pnpm test
```

`pnpm check` validates the 61-operation OpenAPI contract, formatting/lint rules, TypeScript,
unit/integration tests that have their required environment, and production builds. Playwright
covers import, incremental progress, Python source navigation, map/source exploration, grounded
answers, sharing, repository listing, deterministic Markdown/SVG downloads, pull-request impact
progress/filters/fixed evidence, Retrieval Lab modes/degradation, Architecture Story v2, the
bundled Demo entry, and structured failures with deterministic network mocks. The independent VS Code project has its own
`pnpm check` and reproducible `vsce package` gate.

## Security model

Imported repositories are hostile input. RepoVista:

- accepts public HTTPS GitHub URLs and private repositories explicitly granted to a connected GitHub App;
- separates browser HttpOnly sessions from revocable Workspace-bound Bearer tokens;
- checks Workspace membership before every repository-derived resource lookup;
- keeps private shares authenticated and sends `noindex` metadata;
- disables Git hooks and interactive credential prompts;
- never installs dependencies or executes repository code;
- rejects symbolic links and repository-relative path traversal;
- skips secrets such as `.env`, PEM, and key files during scanning;
- enforces file count, total byte, individual file, and job-time limits;
- treats repository text as data, not model instructions;
- validates every model evidence ID against retrieved source before returning citations.

Installation tokens and API token/session raw values are never persisted. Read [SECURITY.md](./SECURITY.md)
for the threat model and deployment requirements.

Read [SECURITY.md](./SECURITY.md) before reporting a vulnerability.

## Documentation

- [Documentation map](./docs/README.md)
- [System architecture](./docs/architecture/系统架构.md)
- [API contract guide](./docs/backend/API接口契约.md)
- [Database design](./docs/database/数据库设计.md)
- [Trusted AI design](./docs/ai/AI可信问答设计.md)
- [Local development and deployment](./docs/operations/本地开发与部署.md)
- [Testing and release gates](./docs/operations/测试与质量.md)
- [v0.4 acceptance record](./docs/releases/v0.4-验收记录.md)
- [v0.5 development plan](./docs/releases/v0.5-开发计划.md)
- [v0.5 test and release plan](./docs/operations/v0.5测试与发布计划.md)
- [v0.6 development plan](./docs/releases/v0.6-开发计划.md)
- [v0.6 backend development document](./docs/backend/v0.6后端开发文档.md)
- [v0.6 frontend development document](./docs/frontend/v0.6前端开发文档.md)
- [v0.6 test and release plan](./docs/operations/v0.6测试与发布计划.md)
- [v0.6 acceptance record](./docs/releases/v0.6-验收记录.md)
- [v0.7 development plan](./docs/releases/v0.7-开发计划.md)
- [v0.7 backend development document](./docs/backend/v0.7后端开发文档.md)
- [v0.7 frontend development document](./docs/frontend/v0.7前端开发文档.md)
- [v0.7 test and release plan](./docs/operations/v0.7测试与发布计划.md)
- [v0.7 acceptance record](./docs/releases/v0.7-验收记录.md)
- [Roadmap](./ROADMAP.md)

The machine-readable API source of truth is [openapi/openapi.json](./openapi/openapi.json).

## Contributing

Issues and focused pull requests are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md), and
include tests for parser, contract, database, security, or user-visible behavior changes.

RepoVista is licensed under the [Apache License 2.0](./LICENSE).
