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

## v0.7 — Guardrails Snapshot baseline comparison (implemented 2026-08-23)

- [Done](./docs/releases/v0.7-开发计划.md) Deterministic comparison of two same-Repository Ready Snapshots.
- [Done](./docs/releases/v0.7-开发计划.md) Added/resolved/unchanged/changed Finding states with severity-aware regression summaries.
- [Done](./docs/releases/v0.7-开发计划.md) API, CLI, Web baseline selection, dual evidence navigation, compatibility gates, and privacy headers.

## v0.8 — Guardrails Policy Profiles（implemented 2026-08-24）

- [Done](./docs/releases/v0.8-开发计划.md) Workspace-scoped immutable profiles with deterministic threshold-only policy changes.
- [Done](./docs/releases/v0.8-开发计划.md) Snapshot policy provenance, idempotent creation, versioning, and fingerprint compatibility gates.
- [Done](./docs/releases/v0.8-开发计划.md) API, CLI, Web assignment workflows, audit events, migration, and release evidence.

## v0.9 — Verified Guardrail Explanations（implemented 2026-08-25）

- [Done](./docs/releases/v0.9-开发计划.md) Fixed server-owned prompts and bounded same-Snapshot evidence for deterministic Findings.
- [Done](./docs/releases/v0.9-开发计划.md) Citation verification, evidence-only refusal, immutable provenance, and concurrent idempotent persistence.
- [Done](./docs/releases/v0.9-开发计划.md) API, CLI, Web explanation workflows, migration, E2E, and release evidence.

## v1.0 — Guardrail Explanation History and Comparison（implemented 2026-08-25）

- [Done](./docs/releases/v1.0-开发计划.md) Deterministic logical Finding identity and v0.9 explanation backfill.
- [Done](./docs/releases/v1.0-开发计划.md) Cursor-paginated same-Repository explanation history with Workspace isolation.
- [Done](./docs/releases/v1.0-开发计划.md) Pure structural comparison, CLI/Web workflows, fixed dual-Snapshot evidence, and release evidence.

## v1.1 — Reproducible demo and contributor deployment experience（implemented 2026-08-27）

- [Done](./docs/releases/v1.1-开发计划.md) Bundled two-revision polyglot fixture and idempotent offline seed.
- [Done](./docs/releases/v1.1-开发计划.md) One-command Compose demo, homepage entry, and API smoke verification.
- [Done](./docs/releases/v1.1-开发计划.md) Contributor workflow and documented hardened deployment overlay.

## v1.2 — Reviewable Guardrails（implemented 2026-08-28）

- [Done](./docs/releases/v1.2-开发计划.md) Workspace-scoped human review labels, bounded notes, and
  append-only audit events with Viewer/Editor/Owner and CSRF boundaries.
- [Done](./docs/releases/v1.2-开发计划.md) Deterministic SARIF/JSON exports carrying review metadata
  without changing Finding severity, report status, or CI decisions.
- [Done](./docs/releases/v1.2-开发计划.md) Web and CLI review workflows, migration `0009`, tests, and
  release evidence.

## v1.3 — Review Timeline and Signed Notifications（implemented 2026-08-28）

- [Done](./docs/releases/v1.3-开发计划.md) Append-only, cursor-paginated Review history projected from
  audit events with Workspace/Finding subject isolation.
- [Done](./docs/releases/v1.3-开发计划.md) Signed Workspace Webhook endpoints, one-time secret display,
  event subscriptions, test delivery, and delivery history.
- [Done](./docs/releases/v1.3-开发计划.md) Durable outbox with per-endpoint idempotency, leases, bounded
  exponential retry, DNS/IP SSRF checks, timeout, redirect rejection, API/CLI/Web/OpenAPI, migration `0010`,
  tests, and release evidence.

## v1.4 — Batch Review and provider-specific notification adapters（implemented 2026-08-29）

- [Done](./docs/releases/v1.4-开发计划.md) Atomic batch Review actions for 1–50 Findings with server-owned
  subject keys, request hashing, idempotent replay, and conflict detection.
- [Done](./docs/releases/v1.4-开发计划.md) Generic/Slack notification adapters with official Slack HTTPS
  host policy, adapter snapshots, bounded payload rendering, and no note/source/model/credential leakage.
- [Done](./docs/releases/v1.4-开发计划.md) API, CLI, Web, OpenAPI, Migration `0011`, PostgreSQL upgrade checks,
  tests, and release evidence.

## Next candidates

- Additional provider adapters after a separately reviewed protocol and operational threat model.

Roadmap ordering may change based on measured usage and contributor feedback.
