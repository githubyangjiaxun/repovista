# Contributing to RepoVista

Thank you for helping make unfamiliar codebases easier to understand. RepoVista favors changes
that improve verifiability, safety, or the path from a repository URL to useful source evidence.

## Prerequisites

- Node.js 22 or newer (the repository pins the major version in `.nvmrc`).
- pnpm 10.30.3 through Corepack.
- Docker with Compose.
- Git.
- Chromium installed through Playwright when changing browser journeys.

## Development setup

```bash
corepack enable
pnpm install --frozen-lockfile
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

The Web runs at <http://localhost:3000> and the API at <http://localhost:4000>. Copy
`.env.example` to `.env` only when overriding the defaults; `pnpm dev` loads the root file.

## Quality gates

Run the complete code gate before opening a pull request:

```bash
pnpm check
```

For browser-facing changes:

```bash
pnpm --filter @repovista/web exec playwright install chromium
pnpm test:e2e
```

For PostgreSQL integration tests, provide a disposable database with pgvector, `pg_trgm`, and
`citext` available:

```bash
DATABASE_TEST_URL=postgresql://repovista:repovista@localhost:5432/repovista_test \
pnpm --filter @repovista/database test
```

Do not point `DATABASE_TEST_URL` at a database containing important data. The test creates and
removes its own RepoVista records, but it also applies the repository migrations.

## Change expectations

- Parser changes need reviewed fixture or assertion updates that prove files, symbols, and edges.
- API changes must update `openapi/openapi.json`; `pnpm openapi:check` rejects route drift.
- Schema changes use a new forward-only SQL migration. Never rewrite a migration already released.
- AI changes must document evidence, refusal, privacy, provider, and malformed-output behavior.
- Security-sensitive Git/path changes need adversarial tests.
- UI changes affecting a critical journey need unit or Playwright coverage.
- Performance claims need the dataset, machine, Node version, and measured result.

## Commit style

Use concise Conventional Commit messages, for example:

```text
feat(parser): extract TypeScript call edges
fix(api): reject repository path traversal
test(web): cover share report failures
docs: explain local model privacy
```

## Pull requests

- Keep the change focused and explain the user-visible outcome.
- State API, migration, privacy, and security impact, even when the answer is “none”.
- Include tests proportional to risk and paste the commands you ran.
- Avoid committing credentials, private source, generated build output, Playwright reports, or
  `next-env.d.ts`.
- Preserve the rule that imported repository code is read but never executed.
