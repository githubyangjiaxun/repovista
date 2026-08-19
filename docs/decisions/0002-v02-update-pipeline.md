# ADR 0002: v0.2 update pipeline

Date: 2026-08-20  
Status: accepted

## Context

RepoVista v0.1 rebuilds every snapshot with one TS/JS parser. v0.2 needs Python, automatic GitHub updates and deterministic exports without weakening immutable evidence or introducing a second persistence system.

## Decision

- Keep each Ready Snapshot complete and independently queryable.
- Use content hashes to reuse unchanged ParsedFile values from the latest compatible Ready Snapshot.
- Re-run cross-file linking over the complete merged ParsedFile set.
- Version the parser as one composite capability boundary; incompatible versions force a full index.
- Add Python through a Tree-sitter adapter that emits the existing domain model.
- Accept signed GitHub `ping` and default-branch public `push` webhooks; use the delivery ID as the database idempotency boundary.
- Do not use GitHub credentials in v0.2. Automatic updates clone public HTTPS repositories using the existing hardened Git path.
- Generate Markdown and SVG synchronously from immutable database data through a framework-independent exporter package.
- Keep PostgreSQL as the only persistent dependency.

## Consequences

- Incremental indexing reduces parsing work, but v0.2 still scans the checked-out tree and persists a complete snapshot-local graph.
- The first index after the parser-version upgrade is full; later compatible snapshots can be incremental.
- GitHub App support means signed update events, not private-repository installation authentication.
- Exports are reproducible and simple to operate, but large persistent artifact histories remain deferred.
- No Redis, graph database, object storage or additional service is required.
