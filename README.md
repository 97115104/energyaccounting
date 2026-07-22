<img src="apps/web/public/readme-marks.gif" alt="EAJ NeuroMe marks rotating through wing families and pride symbols" width="128" height="128" />

# EAJ (Energy Accounting Journal)

EAJ is for neurodivergent productivity and pride. It is an open-source energy accounting journal with end-to-end encryption for sensitive text, and it is also a social identity tool. Activity labels, journal text, task details, and the You profile are encrypted on the device before they reach the server, so operators cannot read them from stored ciphertext. Numeric costs, balances, and the butterfly identity marks stay plaintext so dashboards and seals can render without reading private notes. See [Security model](#security-model) and [ARCHITECTURE.md](ARCHITECTURE.md) for the full boundary.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-1.x-black?logo=bun&logoColor=white)](https://bun.sh)
[![React](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Attested](https://img.shields.io/badge/attested-verify-brightgreen?logo=npm&logoColor=white)](https://attest.97115104.com/s/zn6mxj9z)

You start an energy day when you are ready and work against a finite 100 points of daily energy. Restorative activities add points, demanding ones use them, and completing a use-energy task frees its reserved capacity. The day closes when you decide it is done, and calendar midnight is not a personal day boundary. There is no missed-day penalty, and energy never carries to the next day. Closed energy days appear under **Previous days** on the Dashboard and open read-only. You can explicitly amend a record without reopening its lifecycle, or request permanent deletion and confirm the irreversible action.

EAJ is also a social tool. Every person has a butterfly, the app's symbol of becoming. It starts from one of eight wing families chosen in onboarding, its wings beat with the day's energy, and its colors mean whatever their person says they mean. On the **You** page each butterfly is personalized further through composable wing traits (edge, tail, pattern, and visual detail), because neurodivergent people are as varied as butterflies. The You page also holds an explainable view of what the journal shows and an encrypted "how to work with me" profile. That profile can draft itself from your own tasks and journal, with each line explained and yours to accept, edit, or dismiss, or it can be written from scratch. Journal text, task details, and You-profile fields can be dictated. The profile exports as an image or print-quality document, or as a revocable share link. See [BUTTERFLY.md](BUTTERFLY.md) for the full design.

Hosted for invitees at [https://eaj.97115104.com/](https://eaj.97115104.com/) (see [host.txt](host.txt)), where the maintainers run the app and its SQLite database. You can also clone this repository and self-host. Either way, sensitive text is end-to-end encrypted in the browser, so the people who operate the server cannot read activity labels, journal entries, task details, or You profile content from stored ciphertext. See [SECURITY.md](SECURITY.md).

## Docs

| Document | Role |
|----------|------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System map, encryption boundary, day lifecycle, API and schema |
| [BUTTERFLY.md](BUTTERFLY.md) | Identity system, wing grammar, sharing, motion |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Local setup, checks, conventions |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting and threat-model pointers |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community expectations |
| [LICENSE](LICENSE) | MIT |

## Conceptual sources

Energy Accounting as described by Maja Toudal and Dr. Tony Attwood ([energyaccounting.com](https://energyaccounting.com/)). Iceberg-aware neurodivergent framing informed by Dr. Samantha Hiew’s *Tip of the ADHD Iceberg*. Play suggestions that add energy follow Stuart Brown and National Institute for Play styles. Weather from [Open-Meteo](https://open-meteo.com/) (CC BY 4.0).

## Stack

Bun, Elysia, React, Drizzle, and `bun:sqlite`. One self-hosted SQLite file under `DATA_DIR`. Optional TOTP with recovery codes issued when authenticator setup completes. Browser speech recognition dictates journal text, task details, and You-profile fields as text, so no audio is ever stored. In-browser Transformers.js embeddings suggest costs from your personal catalog when available, and the first suggestion run may download an on-device embedding model from Hugging Face. The day/dawn/dusk/night sky theme follows the device's current timezone, and coordinates when granted, so it matches where you actually are.

## Prerequisites

[Bun](https://bun.sh) is required. The local deploy script also uses ordinary Unix tools such as `curl` and `lsof` for health waits.

## Local development

```bash
./deploy-locally.sh
```

This installs dependencies if needed, starts the API on port 3000 and the Vite UI on port 5173, waits for health checks, and opens the browser. Press Ctrl+C to stop.

The pieces can also run separately:

```bash
bun install
bun run dev       # API with watch reload
bun run dev:web   # Vite dev server
```

| Variable | Default | Purpose |
|----------|---------|---------|
| `PRIMARY_URL` | `http://localhost:5173` | URL opened in the browser |
| `HEALTH_TIMEOUT` | `60` | Seconds to wait for readiness |
| `PORT` | `3000` | API port |
| `DATA_DIR` | `./data` | SQLite database |

Typing and browser dictation both work without any extra binaries.

## Production notes

The maintainers host the public instance at [https://eaj.97115104.com/](https://eaj.97115104.com/). To self-host your own copy:

```bash
bun install
bun run build
DATA_DIR=$HOME/.local/share/eaj PORT=3000 COOKIE_SECURE=1 bun run start
```

Serve behind TLS. The server serves `apps/web/dist` when present. `./run-service.sh` defaults `DATA_DIR` to `$HOME/.local/share/eaj` and `COOKIE_SECURE=1`, then runs install, build, and start. It sources a local `.env` when that file exists.

| Variable | Default in `run-service.sh` | Purpose |
|----------|-----------------------------|---------|
| `DATA_DIR` | `$HOME/.local/share/eaj` | SQLite directory |
| `PORT` | `3000` | API port |
| `COOKIE_SECURE` | `1` | Secure flag on the session cookie |

## Invite codes

Account creation requires a one-time invite code. To request one, email [eaj@97115104.com](mailto:eaj@97115104.com). Operators generate more with:

```bash
bun run generate-more-invite-codes        # 50 codes (default)
bun run generate-more-invite-codes 10     # custom count
```

Codes are 128-bit random values. The database (resolved via `DATA_DIR`, same as the server) stores only SHA-256 hashes. The plaintext codes are appended, never replaced, to a gitignored `invite-codes.md` checklist so operators can check them off as they are handed out or used. Registration consumes a code atomically, so each code admits exactly one account.

### Before making the repo public

1. Confirm `invite-codes.md` remains gitignored and is not included in the public working tree.
2. Scrub git history of the previously committed `invite-codes.md` (for example with `git filter-repo` or BFG) before the first public push. The file was committed and later removed in commit `912e800`.
3. Rotate exposure: mark any historically leaked unused codes as used or invalid in the operator database, or regenerate and discard the leaked plaintext list.
4. Do not publish operator checklists that contain live codes.

## Security model

Sensitive fields are end-to-end encrypted. A data encryption key (DEK) is generated in the browser, wrapped with a password-derived KEK (Argon2id), and stored only as ciphertext. Activity labels, journal text, task details, and the You profile are AES-GCM encrypted on the device before upload. The hosted operators at [https://eaj.97115104.com/](https://eaj.97115104.com/), and any self-host operator, can store and serve that ciphertext and cannot decrypt it without the person's password. Password verification on the server also uses Argon2id and never needs the DEK. Dictation converts speech to text in the browser, so no audio leaves the device. Numeric energy costs and balances stay clear so dashboards can chart without reading activity names. A SHA-256 of the normalized label is stored so recurring suggestions can dedupe without decrypting. Optional TOTP issues one-time recovery codes at enable time. Those codes are accepted on login and on sensitive settings actions when the authenticator is enabled. See [SECURITY.md](SECURITY.md) for reporting and the hosted-versus-self-host boundary.

## Training corpus export

Settings includes a corpus download. After unlock, the client fetches your encrypted days, decrypts labels and journals with the session DEK, and saves a JSON file with schema version, user identity, days, lines, journals, catalog, and decrypted You profile. The format is intended for optional personal model training later.

## Scripts

- `bun run dev` starts the API with watch reload
- `bun run dev:web` starts the Vite UI
- `bun test` runs shared balance math, server, and web `src/lib` tests
- `bun run typecheck` runs TypeScript checks across packages
- `bun run build` builds the production web app
- `bun run icons` regenerates PWA and touch icon assets
- `bun run readme-marks` regenerates the animated NeuroMe header GIF (needs ImageMagick `convert`)
- `bun run generate-more-invite-codes [count]` mints signup invite codes (see above)

## License

MIT. See [LICENSE](LICENSE).

[attested](https://attest.97115104.com/s/zn6mxj9z) · collab · cursor (auto)
