# Contributing to RepoVista

Thank you for helping make unfamiliar codebases easier to understand.

## Development

1. Install Node.js 22+, pnpm, Docker, and Git.
2. Copy the environment example to a local environment file.
3. Start PostgreSQL and MinIO with Docker Compose.
4. Run pnpm install.
5. Run pnpm db:migrate.
6. Run pnpm dev.

## Before opening a pull request

Run:

~~~bash
pnpm check
~~~

Parser changes must include or update a reviewed Golden Test. AI changes must document evidence,
failure, privacy, and evaluation behavior.

## Commit style

Use concise Conventional Commit messages such as:

- feat(parser): extract TypeScript call edges
- fix(api): reject repository path traversal
- docs: explain local AI privacy mode

## Pull requests

- Keep changes focused.
- Explain user-visible behavior and trade-offs.
- Include tests proportional to risk.
- Document API, migration, or security impact.
- Do not include secrets or private source code.
