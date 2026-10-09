# Architecture

## The picture

```
Browser ──HTTPS──▶  API service (Node)  ──▶  Postgres
   │                 │  Express: /api/v1/*, /healthz, static web app
   └──WebSocket────▶ │  ws hub:  /ws  (chat, matching, live count)
   ▲                 └─ serves apps/web/dist for every other path
   └── video goes browser to browser (WebRTC); the server only passes the setup messages
```

One deployable unit: the API process. It serves the built React app, the JSON API and the WebSocket. This keeps cookies same-origin (no CORS), means one service to pay for and monitor, and makes the browser and the API deploy together so they can never disagree about the protocol.

## Modules

| Module                                                     | Responsibility                                                                                                                                                                                                        | Depends on            |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `packages/shared`                                          | Zod schemas for every WebSocket message and API response                                                                                                                                                              | `zod` only            |
| `apps/api/src/config.ts`                                   | Read and validate settings once                                                                                                                                                                                       | `zod`                 |
| `apps/api/src/app.ts`                                      | Express app: security headers, JSON API, static web app, error handling. Takes its dependencies as arguments, so tests pass stand-ins                                                                                 | shared                |
| `apps/api/src/chat/engine.ts`                              | **All the rules of the chat**: who is looking, who is paired, what is relayed, who is removed. No sockets or database inside; the outside world (sending, bans, reports) is passed in                                 | shared                |
| `apps/api/src/chat/matching.ts`                            | Pure scoring: shared interests, language, text vs video, no instant rematch, blocked pairs                                                                                                                            | shared                |
| `apps/api/src/chat/age.ts`                                 | Spots "im 14" without flagging "im 15 minutes late"                                                                                                                                                                   | none                  |
| `apps/api/src/chat/stores.ts`                              | Bans and reports in Postgres                                                                                                                                                                                          | Prisma                |
| `apps/api/src/ws/hub.ts`                                   | The socket side only: origin check, per-address and per-socket limits, heartbeat, parsing, handling each connection's messages in order, the live count. Hands everything else to the engine                          | engine, shared        |
| `apps/api/src/db.ts`                                       | Prisma client over the `pg` driver                                                                                                                                                                                    | Prisma                |
| `apps/api/src/auth/service.ts`                             | **All the rules about accounts**: sign-up (duplicates, races, hourly limit), sign-in (lock-outs, same answer for "wrong password" and "no such email"), password change, deletion, export. No HTTP or database inside | store, hasher, events |
| `apps/api/src/auth/routes.ts`                              | The HTTP side: checks requests, refuses other websites, sets and reads the cookie, turns rule errors into plain messages                                                                                              | service               |
| `apps/api/src/auth/google.ts`, `oauth-state.ts`            | The Google client (authorization code with PKCE, token checking) and the signed one-time cookie that carries state and nonce across the trip                                                                          | jose                  |
| `apps/api/src/auth/session.ts`                             | The sign-in cookie: signed, expiring, carrying the account's session version                                                                                                                                          | none                  |
| `apps/api/src/auth/passwords.ts`, `limiter.ts`, `store.ts` | argon2id hashing; counting recent attempts; where accounts live (Postgres, or memory in tests)                                                                                                                        | argon2, Prisma        |
| `apps/api/src/events.ts`                                   | The activity log: never an email, password, message or full address                                                                                                                                                   | Prisma                |
| `apps/web/src/chat/state.ts`                               | The chat screen as a pure state machine (idle, cooldown, searching, chatting, ended, banned)                                                                                                                          | shared                |
| `apps/web/src/auth/AuthContext.tsx`                        | Who is signed in, for the whole site, so the header and the account page always agree                                                                                                                                 | api                   |
| `apps/web/src/video/call.ts`                               | One video connection (WebRTC) to one person: who makes the offer, queuing early candidates, ignoring stale connections, failure notes. Plain class, tested with a fake peer                                           | shared                |
| `apps/web/src/hooks/useVideoCall.ts`                       | The visitor's camera and microphone plus the `Call`; the chat screen decides when to start, answer and hang up                                                                                                        | call                  |
| `apps/web`                                                 | Pages and hooks. Talks to the API only through `api.ts` and the socket hook, both checked against shared schemas. The socket hook reconnects by itself and stops once the server has removed the visitor              | shared                |

## How video works

The server never sees video. It only carries the setup messages two browsers swap to find a direct path:

1. Both people press Start. The browser asks for the camera and microphone, then the server pairs them as in text chat. The match message says which of the two is the `init` (initiator).
2. The initiator makes an **offer** and sends it as `sig`. The other makes an **answer**. Both then send **candidates** (possible network routes). Candidates that arrive before the other side's description are held until it is in.
3. The server relays `sig` only while two _video_ people are in a chat together. The payload is validated against a strict schema (size limits, unknown fields stripped), and a chat can relay at most 300 of them, so the channel cannot be used to send anything else.
4. A STUN server helps each browser learn its public address. If no direct path works, a TURN relay (optional, `TURN_*` settings) carries the video instead.

## How accounts work

- **Optional.** Chatting never needs one, and strangers never see anyone's account.
- **Passwords** are stored only as argon2id hashes (19 MiB, 2 passes). Sign-in does the same amount of work whether or not the email exists, so response time does not reveal which emails have accounts.
- **The cookie** (`pb_sess`) is `id.expiry.version.signature`, signed with `SESSION_SECRET`, HttpOnly, SameSite=Lax, Secure on https, 30 days. Each account has a `sessionVersion`; the cookie only works while its version matches. Changing the password, or a moderator suspending the account, raises the version and so ends every sign-in at once, with no session table to keep tidy.
- **Guessing is limited** per connection (10 failures in 15 minutes) and per account (6 failures from anywhere), and sensitive actions (change password, delete) ask for the password again with their own limit.
- **Other websites** cannot make a visitor's browser change their account: every POST is checked against the site's own address, and the cookie is SameSite=Lax.
- **Google sign-in** (optional, on when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set): the server sends the visitor to Google with a one-time `state`, `nonce` and PKCE challenge, kept in a signed 10-minute cookie (`pb_oauth`) that is cleared on return. On return it checks the state in constant time, swaps the code for a login token using the secret, verifies the token's RS256 signature against Google's published keys (`jose`), and checks audience, issuer, expiry and nonce. Accounts are matched by Google's permanent `sub`, **never by email**: an existing password account with the same email is not joined automatically (that would let anyone who controls a Google account with that address take it over); the owner connects Google while signed in. A new Google account needs the 18+ confirmation and passes the ban check. Google accounts have no password hash, which password sign-in refuses outright. Results go back to the browser as a fixed set of codes in `/account?google=<code>`, never free text.
- **Everything about me:** `GET /api/v1/auth/export` downloads it; deleting the account removes it (a paid pass record is kept, no longer tied to anyone).

## Rules that keep it healthy

1. **The wire format lives in `packages/shared`.** To add a message, add it to the Zod union there. TypeScript then points at every place that must handle it.
2. **Validate at the edge, trust inside.** Anything from a browser (HTTP body, WebSocket frame) is parsed with a schema before use. Settings are parsed at start-up.
3. **No secrets in logs or events.** The logger redacts cookies and passwords. The `events` table never stores message text, passwords, emails or raw IP addresses; visitors are short scrambled IDs.
4. **Dependencies are passed in.** `createApp` and `createHub` receive what they need, which is why most tests need no database.
5. **Migrations are the only way the schema changes.** Edit `schema.prisma`, run `npm run db:migrate`, commit the generated folder. Railway applies them before each release.

## Data

Defined in [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma): `users`, `pass_claims` (one row per paid Stripe session, so a pass can only be claimed once), `bans`, `reports` (with the last messages for moderators), `events` (the activity and system log) and `hourly_stats` (dashboard counters).

## Scaling honestly

Matching state (who is waiting, who is paired) is held in the API's memory. That is simple and fast, and it means **one instance only**. When one instance is not enough, the next step is to move the waiting queue and pairings to Redis and fan messages out through it. Nothing else needs to change. Until then, scale up (a bigger instance) rather than out.

## Search engines

Vite builds a single-page app: the HTML a crawler first receives is a shell. The public pages (home, rules, terms, privacy) need to be pre-rendered at build time so crawlers get real content, titles and descriptions per page. This is planned in phase 7 of the roadmap. The chat and admin screens do not need it.
