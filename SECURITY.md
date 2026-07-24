# Security policy

## Supported versions

Security fixes are applied to the latest revision on the default branch.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use the
repository's private **Report a vulnerability** feature when available. If
private reporting is unavailable, contact the maintainer privately through
their GitHub profile.

Do not include real Hookdeck secrets, source URLs intended to remain private,
request payloads containing sensitive data, or local `.env` contents in a
report.

The dashboard and manual command endpoint are designed to bind to localhost by
default. Anyone exposing them to another network is responsible for adding
appropriate authentication, TLS, and network access controls.
