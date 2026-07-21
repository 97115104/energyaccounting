<img src="apps/web/public/icon-512.png" alt="EAJ icon" width="128" height="128" />

# EAJ (Energy Accounting Journal)

EAJ is for neurodivergent productivity 💖 An open-source, end-to-end encrypted energy accounting journal.

[![License: MIT](https://img.shields.io/github/license/97115104/energyaccounting?color=blue)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-1.x-black?logo=bun&logoColor=white)](https://bun.sh)
[![React](https://img.shields.io/badge/React-19-149eca?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Attested](https://img.shields.io/badge/attested-verify-brightgreen?logo=npm&logoColor=white)](https://attest.97115104.com/s/zn6mxj9z)

EAJ is for neurodivergent productivity 💖 You plan deposits and withdrawals each morning, complete tasks to free reserved capacity during the day, audit how the day actually felt in the evening, and carry the closing balance into tomorrow. Activity labels, journal text, and task details stay encrypted on the device before they reach the server.

Host target `eaj.97115104.com` (see [host.txt](host.txt)).

## Conceptual sources

Energy Accounting as described by Maja Toudal and Dr. Tony Attwood ([energyaccounting.com](https://energyaccounting.com/)). Iceberg-aware neurodivergent framing informed by Dr. Samantha Hiew’s *Tip of the ADHD Iceberg*. Play-category deposit suggestions follow Stuart Brown and National Institute for Play styles. Weather from [Open-Meteo](https://open-meteo.com/) (CC BY 4.0).

## Stack

Bun, Elysia, React, Drizzle, `bun:sqlite`. One self-hosted SQLite file under `DATA_DIR`. Optional TOTP. Browser speech recognition dictates journals and task details as text, so no audio is ever stored. In-browser Transformers.js embeddings suggest costs from your personal catalog when available.

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
DATA_DIR=/var/lib/eaj PORT=3000 COOKIE_SECURE=1 bun run start
```

Serve behind TLS at `eaj.97115104.com`. The server serves `apps/web/dist` when present.

## Security model

Password verified with Argon2id on the server. A data encryption key (DEK) is generated in the browser, wrapped with a password-derived KEK, and stored as ciphertext. Activity labels, journal text, and task details are AES-GCM encrypted client-side. Dictation converts speech to text in the browser, so no audio leaves the device. Numeric energy costs and balances stay clear so dashboards can chart without reading activity names. A SHA-256 of the normalized label is stored so recurring suggestions can dedupe without decrypting. It is a correlation handle, and not plaintext.

## Training corpus export

Settings includes a corpus download. After unlock, the client fetches your encrypted days, decrypts labels and journals with the session DEK, and saves a JSON file with schema version, days, lines, journals, and catalog. The format is intended for optional personal model training later.

## License

MIT. See [LICENSE](LICENSE).

---

[attested](https://attest.97115104.com/s/zn6mxj9z) · collab · cursor (auto)

## Scripts

- `bun test` runs shared balance math tests
- `bun run typecheck` runs TypeScript checks across packages
- `bun run build` builds the production web app
