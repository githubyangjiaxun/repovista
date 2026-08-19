# ADR 0001: RepoVista v0.1 implementation baseline

Date: 2026-08-19  
Status: accepted

## Decision

- TypeScript across Web, API, Worker, and shared packages.
- pnpm workspace with Turborepo task orchestration.
- Next.js and React for Web.
- React Flow through a local graph adapter.
- Fastify with Zod contracts for HTTP services.
- PostgreSQL 17 with pgvector, trigram, and full-text search.
- PostgreSQL-backed leased jobs for v0.1.
- Tree-sitter for TypeScript and JavaScript parsing.
- Fake, Ollama, and OpenAI-compatible model providers.
- Apache-2.0 license.
- Public repositories only in v0.1; private repository support is deferred.
- English product interface with English and Chinese documentation.

## Consequences

The first release can run without Redis, a graph database, Kubernetes, or a model API key. Static
analysis remains useful when AI is disabled. Private repository authentication and hosted billing
are intentionally outside the v0.1 scope.
