# Security

EAJ encrypts sensitive journal text end to end in the browser. Activity labels, free-form task details, journal entries, and the You profile are sealed with AES-GCM under a data encryption key that never leaves the person's device in plaintext. The server stores ciphertext and IVs. Operators of the hosted instance at [https://eaj.97115104.com/](https://eaj.97115104.com/), and operators of a self-hosted clone, cannot read those fields from the database. Numeric costs, balances, completion flags, feel ratings, weather metadata, and the butterfly identity config stay plaintext by design so dashboards and seals can render without the DEK. Share links freeze chosen plaintext under a revocable token. For the full boundary, including the DEK convenience cache in the browser profile, read [ARCHITECTURE.md](ARCHITECTURE.md).

## Hosted service and self-hosting

The maintainers run the app and its SQLite database for invitees at [https://eaj.97115104.com/](https://eaj.97115104.com/). Anyone may also clone this repository and self-host with `./run-service.sh` or the production commands in the [README](README.md). On the hosted service, end-to-end encryption still applies: the host can see account metadata and plaintext energy numbers, and cannot decrypt labels, journals, task details, or You profile content without the person's password-derived keys.

## Reporting a vulnerability

Please report security issues privately by email to [eaj@97115104.com](mailto:eaj@97115104.com). Do not open a public GitHub issue for an unfixed vulnerability. Include enough detail to reproduce the problem, including affected version or commit when you know it, and steps or a minimal proof of concept when that is practical.

Maintainers aim to acknowledge reports within a few business days and to keep reporters informed while a fix is prepared. Coordinated disclosure is preferred once a patch is available.

## Scope

In scope for private reports:

- Authentication and session handling, including TOTP and recovery codes
- Cross-user data access or privilege mistakes on authenticated API routes
- Breaks of the end-to-end encryption boundary for labels, journals, task details, or You profile content
- Injection, path traversal, or similar issues in the Elysia server or static-file serving
- Issues that would let a host operator recover DEK material or plaintext of encrypted fields without the account password

Out of scope or already documented design choices (still welcome as clarification questions, and not treated as surprise vulns by themselves):

- Plaintext storage of costs, balances, feel ratings, weather fields, and identity JSON
- Share-link disclosure of sections the account holder chose to publish
- Presence of an unlocked DEK in browser storage for at most 24 hours while a session is live
- Issues that require physical access to an unlocked browser profile or to a self-host operator's unlocked machine after that operator has already granted that access
- Denial of service against a single instance without a security boundary break

Self-host operators are responsible for TLS termination, host hardening, and backup of `DATA_DIR`. The production script sets `COOKIE_SECURE=1` and expects TLS at the edge. The hosted service terminates TLS at Cloudflare in front of the Bun process.

## Safe harbor

Good-faith research that stays within this policy, avoids privacy harm to other people's data, and gives maintainers a reasonable chance to fix issues before public discussion is welcome.
