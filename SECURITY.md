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

## Current security boundary (v0.2)

RepoVista v0.2 imports public HTTPS GitHub repositories only. It has no private-repository token or
authentication flow. Signed GitHub Push automation is limited to public default-branch events and
does not add private-repository access. Deployment operators should not expose a local instance to
untrusted users without adding network access controls because the public workspace and
share-report endpoints are anonymous by design.

Imported repositories are hostile input. The implementation must not:

- execute repository scripts, hooks, binaries, or package-manager lifecycle commands;
- accept credentials inside repository URLs or follow paths outside the temporary workspace;
- follow symbolic links from the analyzed tree;
- write secrets, model keys, or full source contents to application logs;
- trust instructions embedded in repository text;
- return a model citation that cannot be rebuilt from indexed evidence at the selected commit.

The current scanner skips `.env*`, `.pem`, and `.key` files and enforces file, byte, and timeout
limits. These controls reduce risk but do not turn the Worker into a hardened multi-tenant sandbox.
Run internet-facing deployments with container, network, database, and operating-system isolation.
