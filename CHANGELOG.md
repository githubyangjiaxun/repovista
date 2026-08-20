# Changelog

All notable RepoVista changes are documented here. The project follows Semantic Versioning and the
Keep a Changelog structure.

## [Unreleased]

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
