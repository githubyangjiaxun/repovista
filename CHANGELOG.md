# Changelog

All notable RepoVista changes are documented here. The project follows Semantic Versioning and the
Keep a Changelog structure.

## [Unreleased]

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
