# Security Policy

## Supported versions

Only the latest released RepoVista version receives security fixes.

## Reporting a vulnerability

Do not open a public issue for suspected code execution, source disclosure, authentication bypass,
SSRF, path traversal, citation forgery, or secret leakage.

Use GitHub private vulnerability reporting after the repository is published. Before that feature
is available, contact the repository owner through a private channel. Do not include private source
code or live credentials unless the owner explicitly provides a secure transfer method.

Include the affected version or commit, reproduction steps, impact, and any suggested mitigation.

## Current security boundary (v1.3)

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

Guardrail human reviews are separate Workspace metadata. Only authenticated Editor/Owner principals
or scoped write Tokens can set/clear them, browser Sessions require CSRF verification, and the bundled
Demo is read-only. The server recomputes the current Finding and subject key; clients cannot submit
severity, thresholds, metrics, or provenance. Review notes are bounded plain text, are not sent to AI
providers, and are not copied into append-only audit metadata. SARIF/JSON exports label deterministic
analysis separately from review metadata; reviews never alter CI status or exit codes.

Review history is an append-only projection containing only status transitions, bounded note lengths,
and actor summaries. Notification Webhooks are Workspace-scoped and signed with an endpoint-derived HMAC
secret. Secrets are shown once, never stored in PostgreSQL, and are not written to URLs, logs, audit
metadata, or payload bodies. Outbound delivery is asynchronous and bounded by an idempotent outbox,
lease ownership, retry limits, request timeouts, `redirect: error`, and DNS/IP checks that reject loopback,
private, link-local, and cloud-metadata addresses. Payloads omit review note text, source code, model
prompts/answers, and credentials. Operators must still provide egress filtering and network isolation;
DNS checks alone do not replace a hardened production network.

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
isolation. The bundled deterministic demo is enabled only by the local Compose configuration;
production deployments must disable `DEMO_SEED_ENABLED` and should apply the documented hardened
Compose overlay. Fixture revisions are synthetic content hashes and the Fake Provider is not an
external AI quality claim.
