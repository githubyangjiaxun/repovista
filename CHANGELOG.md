# Changelog

All notable RepoVista changes are documented here. The project follows Semantic Versioning and the
Keep a Changelog structure.

## [Unreleased]

No unreleased changes.

## [1.2.0] - 2026-08-28

### Added

- Workspace-scoped human Guardrail reviews with bounded notes, role/CSRF protection, Demo read-only
  behavior, and audit events.
- SARIF review properties and a separate deterministic/review JSON export.
- Web controls and CLI `guardrails reviews list/set/clear` commands.
- Forward migration `0009_guardrail_reviews.sql` and complete contract/API/OpenAPI documentation.

### Security and trust boundary

- Review metadata never changes deterministic Finding severity, report status, CI exit codes, or model
  verification. Notes are plain text, are not sent to providers, and are omitted from audit bodies.
- Private review responses use `no-store`; cross-Workspace and foreign Finding access is denied.

See the [v1.2 acceptance record](docs/releases/v1.2-验收记录.md) for reproducible quality gates,
isolated PostgreSQL evidence, export invariants, and the explicit external-integration boundary.

## [1.1.0] - 2026-08-27

### Added

- A reviewable two-revision TypeScript/Python/Go fixture in `@repovista/demo`, indexed through the
  production Scanner, Tree-sitter Parser, Graph, incremental planner, Worker lease, Store, and
  Guardrails paths.
- An idempotent offline `demo-seed` pipeline and `pnpm demo:smoke` API journey. The Base is a Full
  Snapshot and the Head is a real Incremental Snapshot with changed/reused/parsed/deleted stats.
- Deterministic Fake Provider explanations with verified citations on both revisions, making the
  existing Explanation History and structural Comparison workflow available without model keys.
- Homepage and Repository UI entry points with explicit synthetic-revision labels and safe capability
  boundaries for the bundled fixture.
- Hardened Compose overlay, contributor instructions, CI Demo job, and release documentation.

### Security and trust boundary

- The fixture identity uses an RFC 6761 `.invalid` hostname and never represents a GitHub-hosted
  repository or commit. The Fake Provider demonstrates evidence/citation plumbing only; it makes no
  claim about external model quality.
- Production-shaped Compose requires HTTPS origins, Secure Cookies, an explicit database password,
  disables Demo Seed, removes the PostgreSQL host port, and applies read-only/no-new-privileges
  container settings.

### Verification

- OpenAPI 61/61, Biome 184 files, TypeScript 23/23, all workspace test tasks, Chromium 10/10, Store
  PostgreSQL integration 12/12, deterministic benchmark, three image builds, Compose Demo Smoke,
  hardened configuration, `git diff --check`, credential scan, and `git fsck --full` passed.
- Real private GitHub App and external model quality remain environment-dependent and are not claimed
  by this release.

## [1.0.0] - 2026-08-25

### Added

- Cross-Snapshot Verified Guardrail Explanation history, entered through a server-recomputed current
  Finding and scoped to the same Workspace, Repository, and deterministic logical subject.
- Stable SHA-256 `subjectKey` generation shared with Guardrails baseline pairing, plus migration
  `0008_guardrail_explanation_history.sql` to backfill existing v0.9 explanations.
- Cursor-paginated history summaries and deterministic comparison of two saved explanations across
  provenance, Finding, and Answer fields.
- CLI `guardrails explanations history/compare` commands and a lazy Web history/compare panel with
  Viewer read access, pagination, stale-response protection, and Base/Head Snapshot evidence links.

### Trust boundary

- History and comparison never call an AI provider, edit an explanation, write an audit creation
  event, or infer model/code quality. Comparison states are only `same` and `changed`.
- Clients cannot submit `subjectKey`, Finding JSON, Repository identity, or comparison conclusions.
  Cross-Workspace, cross-Repository, missing, and different-subject records are rejected without
  leaking inaccessible records.

### Verification

- OpenAPI contains 61 operations. Full lint, typecheck, unit/API/CLI/Web tests, production builds,
  Chromium E2E, benchmark, isolated PostgreSQL integration, Compose configuration/images, and Git
  integrity are recorded in the [v1.0 acceptance record](docs/releases/v1.0-验收记录.md).

## [0.9.0] - 2026-08-25

### Added

- Verified Guardrail Explanations for server-selected deterministic Findings, using fixed bounded
  source evidence and the existing citation verifier.
- Immutable explanation provenance for Snapshot, Commit, parser, Guardrails algorithm, Profile
  fingerprint, Finding fingerprint, provider/model, and prompt version.
- Two explanation API operations, CLI `guardrails explain`, and an accessible Web explanation panel
  with fixed citation navigation.
- PostgreSQL migration `0007_guardrail_explanations.sql`, pre-model idempotent lookup, concurrent
  `ON CONFLICT` convergence, and append-only audit events.

### Security

- Client requests cannot submit source, Finding JSON, arbitrary prompts, rules, severity, or
  provenance. Unknown request fields are rejected.
- Invalid evidence IDs and unsupported model statements are removed; answers without valid citations
  are forced to `refused`.
- Raw model responses and complete source files are not persisted. Stored citation quotes are bounded,
  server-selected excerpts with verified Snapshot paths and line ranges.

### Verification

- OpenAPI contained 59 operations. AI, API, CLI, Web, database migration/concurrency, Chromium E2E,
  full workspace checks, benchmark, Compose images, and Git integrity are recorded in the
  [v0.9 acceptance record](docs/releases/v0.9-验收记录.md).

## [0.8.0] - 2026-08-24

### Added

- Immutable, Workspace-scoped Guardrails Policy Profiles with threshold-only inputs; arbitrary rules,
  scripts, prompts, and model configuration are rejected by the contract boundary.
- Idempotent profile creation, monotonic per-key versions, stable SHA-256 fingerprints, audit events,
  repository assignment, and Snapshot policy provenance.
- Profile-aware Guardrails JSON/SARIF reports, baseline fingerprint compatibility checks, CLI profile
  management, and Web assignment/read-only workflows.

### Verification

- OpenAPI, Biome, TypeScript, unit/API/CLI/Web tests, production builds, Chromium E2E, benchmark,
  Compose configuration, and all three Compose image builds passed. PostgreSQL integration passed
  11/11 on an isolated PostgreSQL 17 + pgvector database; the default test run explicitly skips those
  integration cases when `DATABASE_TEST_URL` is absent.
- AI remains optional and never decides Guardrails findings or mutates policy profiles. Full evidence is
  in the [v0.8 acceptance record](docs/releases/v0.8-验收记录.md).

## [0.7.0] - 2026-08-23

### Added

- Deterministic Guardrails Snapshot baseline comparison for two same-Repository Ready Snapshots.
- Stable `added`, `resolved`, `unchanged`, and `changed` Finding pairs with severity-aware
  `regressed`, `improved`, and `unchanged` summaries.
- API comparison endpoint, CLI `guardrails compare` (`--json`, regression exit code `2`), and Web
  historical Snapshot selection with Base/Head evidence navigation.
- Compatibility gates for Workspace, Repository, Ready status, Parser Version, algorithm profile,
  and thresholds; public/private comparison cache policy and source-free response tests.

### Verification

- Guardrails unit, API boundary, CLI, Web component, and Chromium E2E coverage includes duplicate
  findings, severity changes, race-safe baseline switching, dual evidence, and request IDs.
- OpenAPI now contains 52 operations and all workspace package/CLI/OpenAPI versions are `0.7.0`.
- Database integration tests remain explicitly marked Skip when `DATABASE_TEST_URL` is not set.

## [0.6.0] - 2026-08-23

### Added

- Deterministic Architecture Guardrails for immutable Snapshots: package dependency cycles, large
  files, large symbols, high fan-in symbols, unresolved imports, and parse failures.
- Shared Guardrail contracts and a pure `@repovista/guardrails` implementation with stable findings,
  thresholds, evidence, fingerprints, and `architecture-guardrails-v1` provenance.
- Snapshot JSON and SARIF 2.1.0 exports, including Workspace authorization and private `no-store`
  cache headers.
- CLI `guardrails` workflow with human-readable/JSON output, safe SARIF file writing, and exit code
  `2` when error-level findings are present.
- Web Guardrails workspace with status summary, threshold display, evidence navigation, and SARIF
  download.

### Verification

- OpenAPI, Biome, TypeScript, unit/API/CLI/Web tests, production builds, Compose configuration and
  image checks, benchmark, and Git integrity gates are recorded in the [v0.6 acceptance record](docs/releases/v0.6-验收记录.md).
- Guardrails do not use an AI model for rule decisions; findings are recomputed from the selected
  immutable Snapshot and remain reproducible.

## [0.5.0] - 2026-08-22

### Added

- GitHub OAuth sessions with HttpOnly cookies, CSRF/origin checks, Workspace switching, member roles,
  API token lifecycle, and append-only audit events.
- GitHub App installation support for private repositories, installation-aware webhooks, short-lived
  in-memory credentials, and temporary AskPass cloning without credential-bearing URLs or job events.
- Workspace authorization for repository-derived resources, private share reports, Web Settings, and
  CLI `auth`, `workspace`, `github`, and private-installation analysis commands.
- OpenAPI security schemes and contracts for all 49 API operations, plus API/CLI/Web security tests.

### Security

- Cross-Workspace resource IDs resolve to stable Not Found responses; Bearer workspace discovery is
  limited to the token's bound Workspace.
- Private share pages send `noindex`/`noarchive` metadata, and installation disconnect/suspension
  preserves historical snapshots while stopping new credentialed work.
- Authenticated snapshot exports use credentialed Blob downloads across origins and mark private
  artifacts `private, no-store`.

### Verification

- Final gates passed 21/21 typecheck tasks, 37/37 test tasks, 10/10 PostgreSQL integration tests,
  6/6 Playwright journeys, the deterministic benchmark, all three Compose image builds, and Git
  integrity checks. Real GitHub Private Fixture verification remains explicitly pending; details
  are in [the v0.5 acceptance record](docs/releases/v0.5-验收记录.md).

## [0.4.0] - 2026-08-20

### Added

- Real Ollama and OpenAI-compatible embedding adapters with bounded versioned inputs, strict
  vector validation, and independently configured chat/embedding providers.
- Snapshot-scoped embedding profiles, resumable leased jobs, partial-batch reuse, variable
  dimensions, explicit lifecycle/error states, and exact pgvector search.
- Transparent text, symbol, semantic, and RRF hybrid retrieval with per-channel rank/score traces,
  stable ordering, and explicit Hybrid degradation when semantic retrieval is unavailable.
- Web Evidence Retrieval Lab, semantic-index status and build controls, grounded-Ask retrieval
  summaries, and deterministic public Architecture Story v2 pages.
- CLI `search` and `embed --wait` workflows plus a deterministic test-only retrieval-quality
  benchmark that reports Recall@1/3/5, MRR@10, candidate counts, and Hybrid/Text deltas.

### Changed

- Grounded Ask now uses the same hybrid retrieval pipeline as Search while retaining server-side
  citation verification and evidence-only refusal behavior.
- Semantic SQL ranks and limits vectors inside one fixed embedding profile before joining source
  metadata, avoiding an all-metadata distance sort.
- Root and workspace package versions, CLI user agent, and the OpenAPI contract are now `0.4.0`;
  the checked API contains 29 operations.

### Fixed

- Job completion now schedules repository navigation only once even when polling and SSE observe
  the same terminal status, preventing duplicate RSC navigations during a cold dynamic-page load.

### Verification

- `go-chi/chi@8b258c7bb28f97a5f2a856ff7ef962578fec9215` produced 97 files, 644
  symbols, 3,120 edges, and 663 chunks; Ollama `nomic-embed-text` produced 663/663 validated
  768-dimensional vectors in 73.02 seconds, and restart reuse returned the same Profile/Job.
- With Ollama stopped, Hybrid returned HTTP 200 with lexical evidence and
  `provider_unavailable`; semantic-only returned HTTP 503 `EMBEDDING_UPSTREAM_UNAVAILABLE`.
- Optimized semantic SQL measured 41.772 ms cold and 2.5–3.1 ms warm in the documented temporary
  tmpfs PostgreSQL plan audit; 20 real Hybrid requests measured p50 56 ms and p95 69 ms after
  warm-up. Full context and limitations are in [the v0.4 acceptance record](docs/releases/v0.4-验收记录.md).
- Final release gates passed 19/19 typecheck and build tasks, 155 tests with real PostgreSQL, 6/6
  Playwright journeys, all three Compose image builds, and full Git integrity checks.

## [0.3.0] - 2026-08-20

### Added

- Go parser adapter with module-path import linking, struct embedding, interface implementation, methods, calls, and parser-version compatibility boundaries.
- Public GitHub pull-request impact pipeline with immutable base/head snapshots, idempotent revisions, bounded deterministic reverse BFS, risk decomposition, stable cursor pagination, shortest paths, unknown evidence, and rate-limit-safe upstream handling.
- Web Impact Workspace for progress, changed files/symbols, risk and impact filters, evidence drawer, fixed GitHub links, VS Code evidence links, truncation warnings, and revision reruns.
- Independently versioned `extensions/vscode` project with read-only repository mapping, fixed-commit navigation, TreeView/Webview, nonce CSP, Zod message validation, offline cache, security tests, and reproducible `.vsix` packaging.

### Verification

- Root OpenAPI contract: 27 operations; root lint, typecheck, unit/integration tests, and production builds pass.
- Web: 15 Vitest tests, PR Impact Chromium route-mocked journey, and production build pass.
- Extension: 13 tests, TypeScript check, compiled bundle, and `repovista-0.3.0.vsix` package audit pass; the VSIX contains only manifest, documentation, icon, and bundled runtime.
- Real Go, PR fixture, PostgreSQL migration/compatibility, idempotency/rerun, and container-build evidence is recorded in [the v0.3 acceptance record](docs/releases/v0.3-验收记录.md).

## [0.2.0] - 2026-08-20

### Added

- Immutable content-hash incremental snapshots with parser-compatible baselines and explicit
  full/incremental delta metadata.
- Python Tree-sitter analysis for modules, classes, functions, methods, variables, imports, calls,
  and inheritance in the shared evidence graph.
- HMAC-SHA256 GitHub webhook automation for public default-branch pushes, including delivery
  idempotency, payload conflicts, and safe ping/unsupported-event handling.
- Deterministic Markdown and SVG exports with complete provenance, safe filenames, XML escaping,
  CSP, ETag, and bounded graph output.
- Web panels for Snapshot Delta, GitHub Automation, Python source navigation, job progress
  messages, and fixed-snapshot downloads.

### Verification

- A new `repovista_release_v02` database applied exactly `0001_initial.sql` and
  `0002_incremental_github.sql`; a second migration run was a no-op.
- `DATABASE_TEST_URL=postgresql://repovista:repovista@127.0.0.1:65432/repovista_release_v02 pnpm check`
  passed: 21 OpenAPI operations, Biome, 16 typecheck tasks, 27 test tasks, real PostgreSQL
  integration, and every production build.
- Chromium Playwright passed 4/4 with import/progress/source/map/Ask/share regression and real
  Markdown/SVG download assertions.
- ARM64 Compose built and ran API, Worker, and Web. Public `pypa/sampleproject` commits
  `8603eaf898a2db2c89c36ad6b302f2994700ad6a` →
  `621e4974ca25ce531773def586ba3ed8e736b3fc` produced Full → Incremental snapshots; the latter
  reported 3 changed, 4 reused, 1 parsed, and 0 deleted files.
- Public `unjs/defu` at `82632b66f5914e9946edce300e10633a3d5c0cb7` passed the TS/JS map,
  source, search, and grounded-answer regression in the same clean database.
- Real API checks covered Python source/search/fake Ask, byte-identical repeated exports, SVG XML
  parsing, and webhook valid/duplicate/conflict/invalid-signature/non-default/deleted cases.

## [0.1.0] - 2026-08-20

### Added

- Next.js repository explorer with import, progress, repository list, overview, architecture map,
  immutable source viewer, grounded question, and public share-report journeys.
- Fastify API with 17 OpenAPI-checked operations, request IDs, CORS, rate limits, structured errors,
  health checks, job SSE, repository/snapshot reads, search, answers, and share reports.
- PostgreSQL 17 schema using pgvector, trigram, full-text search, content-addressed source blobs,
  immutable snapshots, leased jobs, event streams, answer citations, and share reports.
- Security-constrained public GitHub cloning with size limits, ignored secret files, disabled hooks,
  no credential prompts, symlink rejection, and workspace cleanup.
- Tree-sitter TypeScript/JavaScript parsing for modules, declarations, imports, and call evidence.
- Package, file, and symbol graph construction with source ranges and deterministic importance.
- Deterministic fake, Ollama, and OpenAI-compatible answer providers with citation verification and
  evidence-only refusal behavior.
- CLI commands for API health, analysis, waiting, status, repository listing, snapshots, questions,
  timeouts, structured failures, and JSON output.
- Reproducible API, Worker, and Web Docker images; a four-service Compose stack; and automated
  database migration on container startup.
- CI quality, PostgreSQL integration, container build, OpenAPI drift, and Chromium Playwright gates.
- Apache-2.0 license, security policy, contribution guide, issue templates, and pull request template.

### Changed

- Product and engineering documentation now describes the implemented v0.1 baseline rather than
  the earlier multi-tenant/object-storage proposal.
- The release audit now records immutable Snapshot navigation, lease-owner guarded terminal writes,
  file-plus-symbol evidence chunks, collision-resistant share slugs, and complete-SHA fetch/
  detached-checkout behavior.
- External imports remain visible as unresolved graph edges; JavaScript imports can resolve back to
  TypeScript sources. Network/timeout provider failures are retryable, while malformed provider
  output is reported as invalid output.

### Verification

- `pnpm check`: OpenAPI, Biome, 15 TypeScript tasks, 25 test tasks, PostgreSQL integration (2
  tests), and production builds passed.
- A clean local checkout installed with `pnpm install --frozen-lockfile`; Playwright passed 3/3;
  an independent Compose audit built all three application images, migrated an empty database, and
  verified `unjs/defu` at commit `82632b66f5914e9946edce300e10633a3d5c0cb7`.
- The audit exercised package/file/symbol maps, source ranges, full-text and symbol search, fake
  and refused answers, local Ollama/OpenAI-compatible protocol mocks, and Commit-pinned sharing.

### Security

- Model prompts treat repository content as untrusted data and returned citations are rebuilt only
  from evidence IDs that exist in the retrieved immutable snapshot.
