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

| Module                               | Responsibility                                                                                                                                                                                           | Depends on     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `packages/shared`                    | Zod schemas for every WebSocket message and API response                                                                                                                                                 | `zod` only     |
| `apps/api/src/config.ts`             | Read and validate settings once                                                                                                                                                                          | `zod`          |
| `apps/api/src/app.ts`                | Express app: security headers, JSON API, static web app, error handling. Takes its dependencies as arguments, so tests pass stand-ins                                                                    | shared         |
| `apps/api/src/chat/engine.ts`        | **All the rules of the chat**: who is looking, who is paired, what is relayed, who is removed. No sockets or database inside; the outside world (sending, bans, reports) is passed in                    | shared         |
| `apps/api/src/chat/matching.ts`      | Pure scoring: shared interests, language, text vs video, no instant rematch, blocked pairs                                                                                                               | shared         |
| `apps/api/src/chat/age.ts`           | Spots "im 14" without flagging "im 15 minutes late"                                                                                                                                                      | none           |
| `apps/api/src/chat/stores.ts`        | Bans and reports in Postgres                                                                                                                                                                             | Prisma         |
| `apps/api/src/ws/hub.ts`             | The socket side only: origin check, per-address and per-socket limits, heartbeat, parsing, handling each connection's messages in order, the live count. Hands everything else to the engine             | engine, shared |
| `apps/api/src/db.ts`                 | Prisma client over the `pg` driver                                                                                                                                                                       | Prisma         |
| `apps/web/src/chat/state.ts`         | The chat screen as a pure state machine (idle, cooldown, searching, chatting, ended, banned)                                                                                                             | shared         |
| `apps/web/src/video/call.ts`         | One video connection (WebRTC) to one person: who makes the offer, queuing early candidates, ignoring stale connections, failure notes. Plain class, tested with a fake peer                              | shared         |
| `apps/web/src/hooks/useVideoCall.ts` | The visitor's camera and microphone plus the `Call`; the chat screen decides when to start, answer and hang up                                                                                           | call           |
| `apps/web`                           | Pages and hooks. Talks to the API only through `api.ts` and the socket hook, both checked against shared schemas. The socket hook reconnects by itself and stops once the server has removed the visitor | shared         |

## How video works

The server never sees video. It only carries the setup messages two browsers swap to find a direct path:

1. Both people press Start. The browser asks for the camera and microphone, then the server pairs them as in text chat. The match message says which of the two is the `init` (initiator).
2. The initiator makes an **offer** and sends it as `sig`. The other makes an **answer**. Both then send **candidates** (possible network routes). Candidates that arrive before the other side's description are held until it is in.
3. The server relays `sig` only while two _video_ people are in a chat together. The payload is validated against a strict schema (size limits, unknown fields stripped), and a chat can relay at most 300 of them, so the channel cannot be used to send anything else.
4. A STUN server helps each browser learn its public address. If no direct path works, a TURN relay (optional, `TURN_*` settings) carries the video instead.

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
