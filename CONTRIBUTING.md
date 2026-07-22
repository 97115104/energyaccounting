# Contributing

Thanks for looking at EAJ. This document covers getting a local copy running, the checks a change must pass, and the conventions the codebase already follows. For the system tour, including the encryption boundary that most decisions here trace back to, read [ARCHITECTURE.md](ARCHITECTURE.md) first. Community expectations live in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Vulnerability reports belong in [SECURITY.md](SECURITY.md), and not in public issues before a fix exists.

## Getting it running

The only prerequisite is [Bun](https://bun.sh). One script installs dependencies, starts the API on port 3000 and the Vite UI on port 5173, waits for health checks, and opens the browser:

```bash
./deploy-locally.sh
```

The pieces can also run separately when that suits your workflow better:

```bash
bun install
bun run dev       # API with watch reload
bun run dev:web   # Vite dev server
```

Data lands in `./data` by default (`DATA_DIR` overrides it), and the SQLite file is created on first run with lightweight `ALTER TABLE` migrations applied automatically.

## Checks a change must pass

| Command | What it verifies |
|---------|------------------|
| `bun run typecheck` | TypeScript across `packages/shared`, `apps/server`, and `apps/web` |
| `bun test` | Shared balance math, server tests, and web `src/lib` tests |
| `bun run build` | The shared package and the production web bundle compile |

Run all three before opening a pull request. A change that adds pure logic, in the pattern of `packages/shared/src/balance.ts` or `apps/web/src/lib/insights.ts`, should ship with a Bun test next to it, because pure modules are the cheapest place in this codebase to lock behavior down.

## Conventions

The balance math in `packages/shared` is the single source of truth for energy arithmetic, and both the server and the client import it so their numbers agree by construction. New calculations about balances, capacity, or Attwood totals belong there, and never inline in a route or a component.

The encryption boundary is the load-bearing constraint of the whole design. Task labels, journal text, and task details cross the network only as AES-GCM ciphertext, and the server must never gain a code path that expects to read them. Features that analyze user history work from the plaintext numeric columns (costs, balances, completion flags, feel ratings), and any feature that needs the actual text must do its work in the browser after the session DEK unlocks. When in doubt about which side of the line a field sits on, the encryption-boundary section and mermaid diagram in [ARCHITECTURE.md](ARCHITECTURE.md) are the reference.

Schema changes follow the existing pattern in `apps/server/src/db/`: add the column to the Drizzle table in `schema.ts`, add a guarded `ALTER TABLE` near the top of `index.ts` so existing databases upgrade in place, and add the column to the `CREATE TABLE IF NOT EXISTS` block so fresh databases match. Profile fields additionally thread through the PATCH schema in `routes/auth.ts`, every place the user object is returned, and the `UserProfile` type in `apps/web/src/App.tsx`.

UI work matches the existing `panel`, `btn`, and `field` classes in `apps/web/src/styles.css`, respects the `prefers-reduced-motion` block, and keeps copy in the app's voice, namely warm, dry, and never shaming. The app is built for neurodivergent users, so motion stays gentle, hints stay dismissible, and nothing nags.

## Commits and attestation

Keep commits focused and describe the why in the message body when it is not obvious from the diff. The project records AI collaboration openly, in the pattern of the attestation link in the README footer, so note substantial AI-generated work in your pull request description. Do not commit anything from `data/`, and never commit credentials, tokens, or the operator `invite-codes.md` checklist.
