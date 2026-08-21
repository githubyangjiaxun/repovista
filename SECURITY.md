# Security Policy

## Supported versions

Until v1.0, only the latest released RepoVista version receives security fixes.

## Reporting a vulnerability

Do not open a public issue for suspected code execution, source disclosure, authentication bypass,
SSRF, path traversal, citation forgery, or secret leakage.

Use GitHub private vulnerability reporting after the repository is published. Before that feature
is available, contact the repository owner through a private channel. Do not include private source
code or live credentials unless the owner explicitly provides a secure transfer method.

Include the affected version or commit, reproduction steps, impact, and any suggested mitigation.

## Current security boundary (v0.5)

RepoVista keeps an anonymous public demo and also supports authenticated team Workspaces. Private
repositories are available only through a connected GitHub App installation and an authenticated
Workspace member. A GitHub password or Personal Access Token is never accepted as a clone credential.

Browser authentication uses a random HttpOnly session cookie plus a readable CSRF cookie. The database
stores only SHA-256 hashes of session/API/OAuth secrets. CLI authentication uses a revocable `rv_`
API token bound to one Workspace; the raw token is shown once and stored only in the user's local
`0600` CLI configuration. Bearer requests cannot enumerate the creator's other Workspaces.

GitHub App private keys come from deployment secrets. Installation access tokens are minted in memory,
cached only until shortly before expiry, and are never stored in PostgreSQL, URLs, command arguments,
job events, audit metadata, or logs. Private clones use a temporary AskPass file that is removed in a
`finally` path. Installation suspension, removal, or disconnect stops new private work while retaining
historical snapshots for authorized Workspace members.

Every repository-derived resource (Snapshot, Job, PR Analysis, Source, Export, Answer, and Share) is
checked against the Principal's Workspace before the business query. Cross-Workspace IDs return a
stable Not Found response. Private Share reports require Workspace membership and are marked
`noindex`/`noarchive` by the Web app.

Imported repositories are hostile input. The implementation must not:

- execute repository scripts, hooks, binaries, or package-manager lifecycle commands;
- accept credentials inside repository URLs or follow paths outside the temporary workspace;
- follow symbolic links from the analyzed tree;
- write secrets, model keys, or full source contents to application logs;
- trust instructions embedded in repository text;
- return a model citation that cannot be rebuilt from indexed evidence at the selected commit.

The current scanner skips `.env*`, `.pem`, and `.key` files and enforces file, byte, and timeout
limits. These controls reduce risk but do not turn the Worker into a hardened multi-tenant sandbox.
For production deployments, use HTTPS for both Web/API origins and set `AUTH_COOKIE_SECURE=true`; the
configuration loader rejects insecure production authentication settings. Local Compose uses a
development environment by default for localhost testing and must not be exposed directly to the
internet. Run internet-facing deployments with container, network, database, and operating-system
isolation.
