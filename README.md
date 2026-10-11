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

All settings are environment variables, checked once at start-up. A bad or missing one stops the server with a message that names it. See [`.env.example`](.env.example) for the list with explanations. The only required ones are `DATABASE_URL` and `SESSION_SECRET`. `SITE_NAME` and `CONTACT_EMAIL` are shown on the pages and the Rules, Terms and Privacy pages. **`SESSION_SECRET` also signs the sign-in cookie, so keep it long, random and private: changing it signs everyone out.** "Continue with Google" switches on when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are both set (see [Sign in with Google](#sign-in-with-google)). `ADMIN_KEY` (with `ADMIN_USER`) switches on the [admin area](#reports-and-the-admin-area), and `EVENT_RETENTION_DAYS` and `REPORT_RETENTION_DAYS` say how long logs and reports are kept. Video has two optional settings: `VIDEO_ENABLED=false` switches video chat off for everyone, and `TURN_URL`, `TURN_USER`, `TURN_PASS` add a relay server so video works on strict networks (the username and password are sent to every visitor, so use an account made only for this).

## Sign in with Google

"Continue with Google" is built in but stays hidden until you give the server a Google client ID and secret. You make them once, in Google's console (free, about ten minutes):

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create or pick a project.
2. **APIs & Services, OAuth consent screen:** choose External, give the app a name and your support email, and save. Leave it in "Testing" while you try it (only test users you list can sign in), then **Publish** it. Only the basic scopes (`openid`, `email`, `profile`) are used, so Google does not need to review it.
3. **APIs & Services, Credentials, Create credentials, OAuth client ID:** type **Web application**. Under **Authorized redirect URIs** add exactly your `PUBLIC_URL` followed by `/api/v1/auth/google/callback`:
   - on your machine: `http://localhost:5173/api/v1/auth/google/callback`
   - on Railway: `https://your-domain/api/v1/auth/google/callback`
4. Copy the **client ID** and **client secret** into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (in `.env`, or as Railway service variables) and restart. The button appears on the account page.

`PUBLIC_URL` must match the address people use, character for character (including `https://`), or Google refuses the return trip with `redirect_uri_mismatch`. The secret is private like `SESSION_SECRET`: never commit it.

How it behaves:

- **Standard and checked.** It uses the authorization-code flow with PKCE. The server checks Google's signature on the login token, who it is for, who issued it, when it expires, and that it answers this very request. A forged or replayed token is refused.
- **New accounts need the 18+ tick.** On the Create account tab, tick the box first; the Google button won't go until you do. A new person using the plain Sign in tab is told to do that.
- **No automatic joining by email.** If a password account already uses the same email, signing in with Google is refused rather than merged, since otherwise anyone controlling a Google account with that address could take over the account. The owner signs in with their password and presses **Connect Google** on the account page.
- **Match filter.** The "Smart Match" pill under the chat opens a panel with Country, Language and Preferences tabs. Country is a real filter: the server works out where each connection comes from using a list kept on the server itself (nothing is sent to another company), and only matches people known to be from the countries you chose. Someone whose country can't be worked out (a local or private address) is never guessed at, so they are not matched when a country is chosen. Each person is told, as a country only, where the other is connecting from. Language is a preference; "Talk to" and "I am" sit under Preferences. A visitor's country is not stored.
- **The header's Sign in link is hidden by default** (`ACCOUNT_LINK=false`). Accounts still work at `/account`; set `ACCOUNT_LINK=true` to show the link again. There is no premium offer in the interface yet.
- **Sign-up asks how you identify** (Male or Female; it must be answered). It is kept on the account, can be changed on the account page (which is also where someone who signed up with Google, or had an account before this was asked, chooses theirs), and fills in "I am" when a signed-in person chats. It is never written to the activity log. People who chat without an account can still leave "I am" as "Rather not say".
- **Google-only accounts** have no password. They can set one on the account page (which then lets them disconnect Google), and they confirm deletion by typing their email.
- **Switching it off:** blank the two settings. A Google-only account can't sign in while they are blank, so people who matter should set a password first.

### Trying it without Google

`e2e/fake-google.mjs` is a stand-in that signs real tokens, so you can see the whole flow locally with no credentials. Use a throwaway database (see the header of [`e2e/google_flow.py`](e2e/google_flow.py)):

```bash
node e2e/fake-google.mjs                                            # port 3300
# API (port 3200), pointed at the stand-in:
PORT=3200 PUBLIC_URL=http://localhost:5200 GOOGLE_CLIENT_ID=test-client GOOGLE_CLIENT_SECRET=test-secret \
  GOOGLE_AUTH_URL=http://localhost:3300/authorize GOOGLE_TOKEN_URL=http://localhost:3300/token \
  GOOGLE_JWKS_URL=http://localhost:3300/jwks GOOGLE_ISSUER=http://localhost:3300 npm run dev -w apps/api
# web app on 5200, pointed at that API:
cd apps/web && API_URL=http://localhost:3200 npx vite --port 5200
BASE_URL=http://localhost:5200 python e2e/google_flow.py
```

This proves the app's side. It cannot prove Google's own pages or your console settings, so do one real sign-in after you set it up.

## Reports and the admin area

**Reporting.** During a chat, or for a few minutes after it ends, a visitor can press **Report** and pick a reason. The chat ends, they are never matched with that person again, and the last messages are saved with the report. **Three different people reporting the same person within 24 hours pauses that person for 24 hours automatically.** Reports from the reported person's own address, and automatic ones, don't count towards that.

**The admin area** is at `/admin` (for example `http://localhost:5173/admin`). It is switched off until you set a key:

```
ADMIN_USER=admin
ADMIN_KEY=a-long-random-key-of-12-or-more-characters
```

Restart the server, open `/admin` and sign in. It is a single owner login, separate from visitor accounts, and nothing on the public site links to it.

| Screen   | What it is for                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overview | Who is online now (text, video, searching), the last 24 hours, an hour-by-hour chart, and what needs attention. Refreshes every few seconds                                    |
| Reports  | The queue, with the saved conversation. Ban for 24 hours, 7 days, 30 days or a year, or dismiss. Each is undoable for a few seconds, and Undo puts back exactly what was there |
| Bans     | Who is blocked right now and for how long. Lift one early (with Undo)                                                                                                          |
| Users    | Search accounts. Suspend (signs them out everywhere at once) or restore, and reset a password (a new random one is shown once; they are signed out everywhere)                 |
| Activity | Sign-ups, sign-ins, reports, bans and what the server did, with filters, search and a **CSV download**                                                                         |
| System   | Database health, uptime, settings (never secrets), row counts and recent server errors                                                                                         |

Things worth knowing:

- **Safety of the sign-in.** The key is compared in constant time, 8 wrong tries lock an address out for 15 minutes (40 across all addresses), the cookie is HttpOnly and `SameSite=Strict` and only sent to the admin API, a sign-in lasts 12 hours, and signing out ends it for real (a copied cookie stops working). Restarting the server signs the owner out. Requests from other websites are refused.
- **People are shown as 8 characters** (a scrambled ID, the same label the activity log uses), never as an address. Saved chat text is shown as plain text, never as markup.
- **What is kept, and for how long.** The activity log: `EVENT_RETENTION_DAYS` (default 30). Reports with their saved messages: `REPORT_RETENTION_DAYS` (default 90). Hourly counters: about 13 months. Bans that ended: a week. A job removes them at start-up and every six hours. The privacy page says so.
- **The CSV** holds the activity log only: never emails, passwords or what anyone said. Cells that could run as a spreadsheet formula are defused.
- **Look and feel.** It follows the system light or dark setting, works on a phone, and respects reduced motion, reduced transparency and increased contrast. Details open in a sheet you can drag away (it follows your finger, can be flicked, and can be caught again mid-motion).

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
- **Video:** the WebRTC logic is a plain class (`apps/web/src/video/call.ts`) tested with a fake peer connection: who makes the offer, candidates that arrive early, stale connections, failures. Switching camera or microphone mid-call (`replaceTrack`), Flip camera, and the virtual-camera name check (`video/virtual.ts`) are tested the same way. The relay rules (video partners only, size and rate limits, extra fields stripped) are tested in the engine and over real sockets.
- **Accounts:** the rules (duplicates and races, lock-outs, what a password change does) are tested in `accounts.test.ts` with in-memory parts and a fake hasher, so hundreds of cases run in milliseconds. The real argon2 is tested on its own (`passwords.test.ts`). The cookie, rate limiter and HTTP routes (including cross-site requests) have their own tests, and `auth.int.test.ts` runs the same flows against real Postgres, including two sign-ups racing for one email.
- **Google sign-in:** `google.test.ts` checks the login token against a local stand-in that signs real tokens, including every forgery (wrong key, audience, issuer, nonce, expiry, `alg: none`, HS256). `google-routes.test.ts` and `accounts-google.test.ts` cover the trip and the rules (no joining by email, the 18+ rule, two sign-ins racing), and `auth-google.int.test.ts` runs them against real Postgres.
- **Reports and admin:** the report rules (during or after a chat, once per chat, the automatic pause and what does not count towards it) are tested in `report.test.ts` with a fake clock. `admin.int.test.ts` runs the whole admin API against real Postgres: every list and page marker, filters and search (including search text that looks like a database pattern), bans, suspensions and password resets (checked by really signing in), the CSV, and the clean-up job. `admin-routes.test.ts` proves nothing is reachable without signing in, and that guessing is locked out. On the web side, the sheet's drag, flick, rubber-band and catch-it-mid-flight behaviour, the spring maths, and every admin screen are tested.
- **End to end:** `e2e/chat_flow.py` (text), `e2e/video_flow.py` (video, with Chromium's fake camera) and `e2e/account_flow.py` (accounts, with two browsers, real cookies and the real database) drive real browsers through whole journeys. They need Python + Playwright. They create real bans, reports and accounts, so run them against a throwaway database. See each file's header.

```bash
npm run dev        # in one terminal, with `npm run db:embedded` running
BASE_URL=http://localhost:5173 python e2e/chat_flow.py
BASE_URL=http://localhost:5173 python e2e/video_flow.py
BASE_URL=http://localhost:5173 python e2e/account_flow.py
BASE_URL=http://localhost:5173 python e2e/games_flow.py
BASE_URL=http://localhost:5173 python e2e/admin_flow.py     # needs ADMIN_KEY, see below
# e2e/google_flow.py needs the stand-in Google: see "Sign in with Google"
```

### Running the browser tests safely

The scripts in `e2e/` create and delete real accounts, reports and bans, so never point them at your own data. `npm run db:e2e` starts a throwaway Postgres on port **54330** with every migration applied (Ctrl+C deletes it). Then start the API against it, with the web app pointed at that API, and run a script:

```bash
npm run db:e2e                                   # terminal 1: the throwaway database
# terminal 2: the API (note the different port and an admin key)
PORT=3200 DATABASE_URL=postgresql://e2e:e2e@localhost:54330/passerby_e2e SESSION_SECRET=e2e-secret-1234567890 \
  PUBLIC_URL=http://localhost:5200 ADMIN_USER=owner ADMIN_KEY=e2e-admin-key-98765 npm run dev -w apps/api
cd apps/web && API_URL=http://localhost:3200 npx vite --port 5200      # terminal 3: the web app
BASE_URL=http://localhost:5200 python e2e/admin_flow.py                 # terminal 4
```

`admin_flow.py` expects an empty database: stop and restart `db:e2e` and the API between runs.

## Known limits

- Text chat, video chat and accounts work end to end. The admin area, reports from visitors, and payments are on the [roadmap](docs/roadmap.md) in the order they should be built.
- There is no "forgot password" yet: it needs an email service. Until then the owner can reset a password from the admin area (Users).
- Google sign-in has only been tried against a stand-in, not the real Google, because that needs your credentials. Do one real sign-in after you set it up.
- Admin sign-ins are held in memory, so each server instance has its own, and a restart signs the owner out. Fine for one instance; see the roadmap.
- Rate limits and lock-outs are counted in memory, so each server instance counts for itself. That is fine for one instance, and is on the roadmap for when there are more.
- Browsers only allow the camera on `https://` pages or `localhost`. Railway gives you https; a plain `http://` address on your network will say the camera is blocked.
- Without a TURN relay, a small share of video pairs (strict company or mobile networks) cannot connect and see "Video couldn't connect with this person". Add `TURN_*` settings to fix that.
- Quick reactions (six fixed emoji that float up the other person's screen) are relayed by the server, no faster than one every quarter of a second each and up to 150 per chat; nothing is stored.
- Games (would you rather, rock paper scissors, tic-tac-toe, Connect 4, trivia, two truths and a lie) are played by invitation, in text and video chats. The server only passes the small moves between the two people, spaces invitations out (one every 15 seconds each), caps how many a chat can send, and stores nothing. The rules run in each browser, so a determined cheater could cheat; it is a casual feature, not a competition.
- Video is direct between the two browsers, which lets each person's IP address be seen by the other. The video page says so.
- Virtual-camera detection is a guess from the camera's name (OBS, ManyCam, Snap Camera, DroidCam and similar). Software can use an ordinary name, and names only show once camera permission is given. The notice the other person sees is sent by the sender's own browser, so someone determined can hide it. Treat it as a signal, not proof.
- In development every browser on your machine is the same "visitor" (same address), so a ban or an under-18 removal applies to all your tabs. The end-to-end script gives each test browser its own made-up address to avoid this.
- The web app is a single-page app, so search engines see a thin page until the public pages are pre-rendered (roadmap, phase 7).
- `npm audit` reports problems in developer tooling (Prisma's local dev server, the test runner). The production path (`pg`, Prisma client, Express, ws) is clean. CI fails only on critical findings in production dependencies.
