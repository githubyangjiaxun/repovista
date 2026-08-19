# Security Policy

## Supported versions

Until v1.0, only the latest released version receives security fixes.

## Reporting a vulnerability

Do not open a public issue for vulnerabilities involving code execution, private source disclosure,
authentication bypass, SSRF, path traversal, or secret leakage.

Use GitHub private vulnerability reporting when the public repository is available. Until then,
contact the repository owner privately.

Please include:

- affected version or commit;
- reproduction steps;
- impact;
- any suggested mitigation.

## Security boundaries

RepoVista treats imported repositories as hostile input. It must not execute repository scripts,
follow paths outside its isolated workspace, or send private source to an external model without
explicit configuration.
