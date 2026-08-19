# RepoVista

> Understand any codebase as a map, not a maze.

RepoVista is an evidence-first repository explorer for public GitHub projects. It clones a fixed
snapshot, extracts files and symbols with Tree-sitter, builds package/file/symbol graphs, and lets
you ask questions whose answers are tied back to exact source ranges.

**AI explains the code. The code provides the evidence.**

![RepoVista repository explorer](./docs/assets/repovista-explorer.png)

## Why RepoVista

Most repository chat tools start with a model and hope the answer is right. RepoVista starts with
an immutable commit and a deterministic index:

| Layer | What it does | Trust property |
|---|---|---|
| Git snapshot | Resolves and shallow-clones a public repository | Every result is pinned to one commit |
| Static analysis | Extracts modules, declarations, imports, and calls | Repeatable without a model |
| Evidence retrieval | Ranks source chunks and symbols | Always returns paths and line ranges |
| AI explanation | Turns retrieved evidence into an answer | Unsupported citations are removed |

The map, source browser, search, reading path, and share reports remain useful without a model API
key. The default `fake` provider is a transparent deterministic evidence summarizer, so the full
workflow can be evaluated locally before connecting Ollama or an OpenAI-compatible endpoint.

## What v0.2 includes

- Public GitHub repository import with branch, tag, or commit selection.
- Security-constrained shallow clones; repository scripts are never installed or executed.
- TypeScript, TSX, JavaScript, JSX, MJS, CJS, and Python indexing with Tree-sitter.
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

Current scope is intentionally narrow: RepoVista accepts public
`https://github.com/owner/repository` URLs. Private repositories, installation tokens, OAuth, and
additional language adapters remain out of scope. AI is an optional explanation layer; the map,
source browser, search, and exports work without a model key.

## Quick start

Requirements: Docker with Compose and outbound access to GitHub.

```bash
docker compose up --build -d
```

Then open:

- Web: <http://localhost:3000>
- API readiness: <http://localhost:4000/v1/health/ready>

Paste a public GitHub URL, wait for the Worker to finish, and explore the resulting immutable
snapshot. Follow progress or stop the stack with:

```bash
docker compose logs -f worker
docker compose down
```

`docker compose down` preserves the PostgreSQL volume. Use `docker compose down -v` only when you
explicitly want to delete RepoVista's local database.

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

## Architecture

```mermaid
flowchart LR
    Browser[Next.js Web] --> API[Fastify API]
    CLI[RepoVista CLI] --> API
    GitHub[Signed GitHub webhook] --> API
    API --> PG[(PostgreSQL 17 + pgvector)]
    API --> Model[Fake / Ollama / OpenAI-compatible]
    API --> Export[Deterministic Markdown / SVG]
    Worker[Index Worker] --> PG
    Worker --> Git[Safe shallow Git clone]
    Git --> Plan[Content-hash incremental plan]
    Plan --> Parser[Tree-sitter TS / JS / Python]
    Parser --> Graph[Complete package / file / symbol graph]
    Graph --> PG
```

This is a modular TypeScript monorepo:

```text
apps/web       Next.js repository explorer
apps/api       Fastify HTTP API and grounded-answer orchestration
apps/worker    leased full/incremental indexing worker
apps/cli       command-line client
packages/*     contracts, database, Git, parser, graph, retrieval, AI, exporter, UI
openapi/       checked API contract
benchmarks/    parser benchmark harness
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

`pnpm check` validates the 21-operation OpenAPI contract, formatting/lint rules, TypeScript,
unit/integration tests that have their required environment, and production builds. Playwright
covers import, incremental progress, Python source navigation, map/source exploration, grounded
answers, sharing, repository listing, deterministic Markdown/SVG downloads, and structured
failures with deterministic network mocks.

## Security model

Imported repositories are hostile input. RepoVista:

- accepts only public HTTPS GitHub URLs in the current release;
- disables Git hooks and interactive credential prompts;
- never installs dependencies or executes repository code;
- rejects symbolic links and repository-relative path traversal;
- skips secrets such as `.env`, PEM, and key files during scanning;
- enforces file count, total byte, individual file, and job-time limits;
- treats repository text as data, not model instructions;
- validates every model evidence ID against retrieved source before returning citations.

Read [SECURITY.md](./SECURITY.md) before reporting a vulnerability.

## Documentation

- [Documentation map](./docs/README.md)
- [System architecture](./docs/architecture/系统架构.md)
- [API contract guide](./docs/backend/API接口契约.md)
- [Database design](./docs/database/数据库设计.md)
- [Trusted AI design](./docs/ai/AI可信问答设计.md)
- [Local development and deployment](./docs/operations/本地开发与部署.md)
- [Testing and release gates](./docs/operations/测试与质量.md)
- [Roadmap](./ROADMAP.md)

The machine-readable API source of truth is [openapi/openapi.json](./openapi/openapi.json).

## Contributing

Issues and focused pull requests are welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md), and
include tests for parser, contract, database, security, or user-visible behavior changes.

RepoVista is licensed under the [Apache License 2.0](./LICENSE).
