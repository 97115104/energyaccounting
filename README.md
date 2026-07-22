<img src="apps/web/public/icon-512.png" alt="EAJ icon" width="128" height="128" />

# EAJ (Energy Accounting Journal)

EAJ is for neurodivergent productivity and pride. An open-source, end-to-end encrypted energy accounting journal that is also a social identity tool.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-1.x-black?logo=bun&logoColor=white)](https://bun.sh)
[![React](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Attested](https://img.shields.io/badge/attested-verify-brightgreen?logo=npm&logoColor=white)](https://attest.97115104.com/s/zn6mxj9z)

EAJ is for neurodivergent productivity and pride. You start an energy day when you're ready and work against a finite 100 points of daily energy: restorative activities add points, demanding ones use them, completing tasks frees their reserved capacity, and the day closes when you decide it is done, and not when the clock hits midnight. Calendar midnight is not a reliable personal day boundary for many neurodivergent people; there is no missed-day penalty and energy never carries to the next day. Closed energy days appear under **Previous days** on the Dashboard and open read-only. You can explicitly amend a record without reopening its lifecycle, or request permanent deletion and confirm the irreversible action. Activity labels, journal text, and task details stay encrypted on the device before they reach the server.

EAJ is also a social tool. Every person has a butterfly, the app's symbol of becoming: it starts from one of eight wing families chosen in onboarding, its wings beat with the day's energy, and its colors mean whatever their person says they mean. On the **You** page each butterfly is personalized further through composable wing traits (edge, tail, pattern, and visual detail), because neurodivergent people are as varied as butterflies. The You page also holds an explainable view of what the journal shows and an encrypted "how to work with me" profile. That profile can draft itself from your own tasks and journal (each line explained and yours to accept, edit, or dismiss) or be written from scratch, and journal text, task details, and You-profile fields can be dictated. It exports as an image or print-quality document, or as a revocable share link. See [BUTTERFLY.md](BUTTERFLY.md) for the full design.

Host target `eaj.97115104.com` (see [host.txt](host.txt)).

## Conceptual sources

Energy Accounting as described by Maja Toudal and Dr. Tony Attwood ([energyaccounting.com](https://energyaccounting.com/)). Iceberg-aware neurodivergent framing informed by Dr. Samantha Hiew’s *Tip of the ADHD Iceberg*. Play suggestions that add energy follow Stuart Brown and National Institute for Play styles. Weather from [Open-Meteo](https://open-meteo.com/) (CC BY 4.0).

## Stack

Bun, Elysia, React, Drizzle, `bun:sqlite`. One self-hosted SQLite file under `DATA_DIR`. Optional TOTP. Browser speech recognition dictates journal text, task details, and You-profile fields as text, so no audio is ever stored. In-browser Transformers.js embeddings suggest costs from your personal catalog when available. The day/dawn/dusk/night sky theme follows the device's current timezone (and coordinates when granted), so it matches where you actually are.

## Local development

```bash
./deploy-locally.sh
```

This installs dependencies if needed, starts the API on port 3000 and the Vite UI on port 5173, waits for health checks, and opens the browser. Press Ctrl+C to stop.

| Variable | Default | Purpose |
|----------|---------|---------|
| `PRIMARY_URL` | `http://localhost:5173` | URL opened in the browser |
| `HEALTH_TIMEOUT` | `60` | Seconds to wait for readiness |
| `PORT` | `3000` | API port |
| `DATA_DIR` | `./data` | SQLite database |

Typing and browser dictation both work without any extra binaries.

## Production notes

```bash
bun install
bun run build
DATA_DIR=$HOME/.local/share/eaj PORT=3000 COOKIE_SECURE=1 bun run start
```

Serve behind TLS at `eaj.97115104.com`. The server serves `apps/web/dist` when present. Production hosting via `./run-service.sh` uses the same `DATA_DIR` default (overridable).

## Invite codes

Account creation requires a one-time invite code. To request one, email [eaj@97115104.com](mailto:eaj@97115104.com). Operators generate more with:

```bash
bun run generate-more-invite-codes        # 50 codes (default)
bun run generate-more-invite-codes 10     # custom count
```

Codes are 128-bit random values. The database (resolved via `DATA_DIR`, same as
the server) stores only SHA-256 hashes; the plaintext codes are appended — never
replaced — to a gitignored `invite-codes.md` checklist so you can check them off
as they are handed out or used. Registration consumes a code atomically, so each
code admits exactly one account.

## Security model

Password verified with Argon2id on the server. A data encryption key (DEK) is generated in the browser, wrapped with a password-derived KEK, and stored as ciphertext. Activity labels, journal text, and task details are AES-GCM encrypted client-side. Dictation converts speech to text in the browser, so no audio leaves the device. Numeric energy costs and balances stay clear so dashboards can chart without reading activity names. A SHA-256 of the normalized label is stored so recurring suggestions can dedupe without decrypting. It is a correlation handle, and not plaintext.

## Training corpus export

Settings includes a corpus download. After unlock, the client fetches your encrypted days, decrypts labels and journals with the session DEK, and saves a JSON file with schema version, user identity, days, lines, journals, catalog, and decrypted You profile. The format is intended for optional personal model training later.

## License

MIT. See [LICENSE](LICENSE).

---

[attested](https://attest.97115104.com/s/zn6mxj9z) · collab · cursor (auto)

## Scripts

- `bun test` runs shared balance math, server, and web `src/lib` tests
- `bun run typecheck` runs TypeScript checks across packages
- `bun run build` builds the production web app
- `bun run generate-more-invite-codes [count]` mints signup invite codes (see above)
