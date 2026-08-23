# RepoVista Roadmap

## v0.1 — Evidence-first TypeScript repository explorer

- Import a public GitHub repository at a fixed commit.
- Parse TypeScript and JavaScript files.
- Display package, file, and symbol maps.
- Browse source evidence at exact line ranges.
- Ask repository questions with verified citations.
- Generate a commit-pinned public share page.
- Run locally with Docker Compose and optional Ollama.

## v0.2 — Continuous, multi-language snapshot maps (implemented 2026-08-20)

- [Done](./docs/releases/v0.2-开发计划.md) Incremental indexing with immutable, self-contained snapshots.
- [Done](./docs/releases/v0.2-开发计划.md) Python parser adapter and cross-language graph support.
- [Done](./docs/releases/v0.2-开发计划.md) Signed GitHub push updates for public repositories.
- [Done](./docs/releases/v0.2-开发计划.md) Deterministic Markdown and SVG exports.

## v0.3 — Pull-request impact workspace (implemented 2026-08-20)

- [Done](./docs/releases/v0.3-开发计划.md) Go parser adapter and module-path import linking.
- [Done](./docs/releases/v0.3-开发计划.md) Pull request impact analysis with immutable dual snapshots, bounded deterministic BFS, risk decomposition, paths, and evidence.
- [Done](./docs/releases/v0.3-开发计划.md) Web Impact Workspace and fixed evidence links.
- [Done](./docs/releases/v0.3-开发计划.md) Independently versioned VS Code extension with read-only mapping, security boundaries, tests, and `.vsix` packaging.

## v0.4 — Transparent semantic retrieval and architecture stories (implemented 2026-08-20)

- [Done](./docs/releases/v0.4-开发计划.md) Versioned Ollama/OpenAI-compatible embedding indexes attached to immutable snapshots.
- [Done](./docs/releases/v0.4-开发计划.md) Explainable text, symbol, semantic, and RRF hybrid retrieval with explicit degradation.
- [Done](./docs/releases/v0.4-开发计划.md) Evidence Retrieval Lab, shared grounded-Ask trace, and CLI search/index workflows.
- [Done](./docs/releases/v0.4-开发计划.md) Commit-pinned Architecture Story v2 with deterministic hotspots, reading paths, evidence, and provenance.

## v0.5 — Private GitHub App access and team Workspaces (implemented 2026-08-22)

- [Done](./docs/releases/v0.5-开发计划.md) GitHub OAuth, HttpOnly sessions, CSRF, Workspace roles, API tokens, and audit events.
- [Done](./docs/releases/v0.5-开发计划.md) GitHub App installation flow, short-lived in-memory installation credentials, and private repository import/clone.
- [Done](./docs/releases/v0.5-开发计划.md) Workspace-aware access checks for repository-derived resources, private shares, and signed private webhooks.
- [Done](./docs/releases/v0.5-开发计划.md) Web Settings/Import flows and CLI authentication, Workspace, Installation, and private analysis workflows.

## v0.6 — Deterministic architecture quality guardrails (implemented 2026-08-23)

- [Done](./docs/releases/v0.6-开发计划.md) Snapshot-scoped dependency-cycle, size, fan-in, unresolved-import, and parse-failure rules.
- [Done](./docs/releases/v0.6-开发计划.md) Stable evidence-backed findings, thresholds, fingerprints, and algorithm provenance.
- [Done](./docs/releases/v0.6-开发计划.md) JSON/SARIF API exports with public/private access behavior and no source leakage.
- [Done](./docs/releases/v0.6-开发计划.md) CLI CI workflow and Web Guardrails workspace with fixed evidence navigation.

## Next candidates

- Baseline comparison: compare two immutable Snapshots and report newly introduced or resolved findings.
- Repository policy profiles: versioned, reviewable threshold profiles without allowing model-driven rules.
- Optional verified explanations: let an AI summarize an existing finding while preserving its rule,
  fingerprint, Commit, and evidence boundaries.

Roadmap ordering may change based on measured usage and contributor feedback.
