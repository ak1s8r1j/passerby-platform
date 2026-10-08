# Passerby Platform

Random text and video chat with strangers. A TypeScript monorepo: a React web app, a Node API with WebSockets, and Postgres.

| Part   | What it is                                                                                   | Where                                |
| ------ | -------------------------------------------------------------------------------------------- | ------------------------------------ |
| Web    | React 19, Vite, React Router                                                                 | [`apps/web`](apps/web)               |
| API    | Node 22, Express 5, `ws`, Prisma 7, Postgres                                                 | [`apps/api`](apps/api)               |
| Shared | The WebSocket protocol and API response shapes, written once with Zod and used by both sides | [`packages/shared`](packages/shared) |

In production one service runs everything: the API also serves the built web app. See [docs/architecture.md](docs/architecture.md).

## Start in five minutes

You need **Node 22+** and a Postgres database. Pick one way to get Postgres:

```bash
npm install
cp .env.example .env              # Windows PowerShell: Copy-Item .env.example .env

# Postgres, option A: no Docker needed (leave this running in its own terminal)
npm run db:embedded
# Postgres, option B: Docker
npm run db:up

npm run db:migrate                # create the tables
npm run dev                       # API on :3000, web on http://localhost:5173
```

Open http://localhost:5173. The live count in the header and the chat page's connection both come from the API.

## Everyday commands

| Command                       | What it does                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `npm run dev`                 | API and web with live reload                                                        |
| `npm run check`               | Everything CI runs: lint, formatting, types, tests, build. Run this before you push |
| `npm test`                    | Fast tests, no database needed                                                      |
| `npm run test:integration`    | Database tests. Starts a throwaway Postgres by itself                               |
| `npm run db:migrate`          | After editing `apps/api/prisma/schema.prisma`, creates and applies a migration      |
| `npm run db:studio`           | Browse the data in a browser                                                        |
| `npm run format`              | Fix formatting                                                                      |
| `npm run build` / `npm start` | Production build and run (needs `WEB_DIST=apps/web/dist`)                           |

## If something is stuck

| You see                                                                           | Cause and fix                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page says "Connecting…" or "Reconnecting…" and the header has no "here now" count | The API isn't running. Look at the `[api]` lines in the `npm run dev` terminal. The page retries by itself, so once the API is up it reconnects without a refresh                                             |
| `npm run dev` stops straight away with "Port 3000 (or 5173) is already in use"    | An old copy is still running (common on Windows after closing a terminal window instead of pressing Ctrl+C). The message names the process and the command to stop it, for example `taskkill /PID 1234 /T /F` |
| `database ... down` at `/healthz`, or the API can't reach Postgres                | Start the database: `npm run db:embedded` (own terminal) or `npm run db:up`                                                                                                                                   |
| Tables missing                                                                    | Run `npm run db:migrate`                                                                                                                                                                                      |

Always stop `npm run dev` with **Ctrl+C**, not by closing the window.

## Settings

All settings are environment variables, checked once at start-up. A bad or missing one stops the server with a message that names it. See [`.env.example`](.env.example) for the list with explanations. The only required ones are `DATABASE_URL` and `SESSION_SECRET`.

## Repo layout

```
apps/
  api/        server: routes, WebSocket hub, database, tests
    prisma/     schema and migrations
  web/        browser app: pages, hooks, tests
packages/
  shared/     protocol + API types used by both
docs/         architecture, roadmap, decisions
.github/      CI and pull request template
```

## Deploying to Railway

1. Push this repo to GitHub. In Railway: New Project, Deploy from GitHub repo.
2. Add the **Postgres** plugin to the project. Railway fills in `DATABASE_URL`; reference it in the app service as `${{Postgres.DATABASE_URL}}`.
3. Set `SESSION_SECRET` (a long random string) and `PUBLIC_URL` (your domain, with `https://`).
4. Generate a domain under Settings, Networking.

[`railway.json`](railway.json) tells Railway to build the [`Dockerfile`](Dockerfile), run the migrations before each release, and check `/healthz`. Run one instance for now: matching is held in memory (see the roadmap).

## Testing approach

- **Shared:** the protocol and interest cleaning, including what must be refused (missing 18+ flag, bad languages, garbage).
- **Chat rules** (`apps/api/test/engine.test.ts`, `matching.test.ts`, `age.test.ts`): the engine runs with a fake clock and no sockets or database, so every rule is tested in milliseconds: matching, the four-second fallback, no instant rematch, the skip cool-down, flood limits, the under-18 removal with its report and ban.
- **API:** HTTP behaviour with supertest, the WebSocket hub with real sockets (two clients actually chatting), and the database with a real Postgres. No mocks of Postgres.
- **Web:** the chat state machine as pure functions, and the pages with Testing Library and a fake WebSocket.
- **End to end:** `e2e/chat_flow.py` drives real browsers through a whole chat (needs Python + Playwright, and a throwaway database because it files real reports and bans). See the file's header.

```bash
npm run dev        # in one terminal, with `npm run db:embedded` running
BASE_URL=http://localhost:5173 python e2e/chat_flow.py
```

## Known limits

- Text chat works end to end. Video, accounts, the admin area, reports from visitors, and payments are on the [roadmap](docs/roadmap.md) in the order they should be built.
- In development every browser on your machine is the same "visitor" (same address), so a ban or an under-18 removal applies to all your tabs. The end-to-end script gives each test browser its own made-up address to avoid this.
- The web app is a single-page app, so search engines see a thin page until the public pages are pre-rendered (roadmap, phase 7).
- `npm audit` reports problems in developer tooling (Prisma's local dev server, the test runner). The production path (`pg`, Prisma client, Express, ws) is clean. CI fails only on critical findings in production dependencies.
