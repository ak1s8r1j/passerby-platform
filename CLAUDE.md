# Passerby Platform

TypeScript monorepo: `apps/web` (React + Vite), `apps/api` (Express 5 + ws + Prisma 7 + Postgres), `packages/shared` (Zod schemas for the WebSocket protocol and API responses). Read `README.md` and `docs/architecture.md` first.

## Commands

- `npm run check` runs lint, format check, types, tests and build. Run it before saying work is done.
- `npm test` (fast, no database), `npm run test:integration` (starts a throwaway Postgres).
- `npm run db:embedded` starts a local Postgres with no Docker; `npm run db:migrate` after editing `apps/api/prisma/schema.prisma`.
- `npm run dev` runs API (:3000) and web (:5173).

## Rules

- The wire format lives only in `packages/shared`. Add messages to the Zod unions there; never hand-write a message shape in the API or web.
- Parse everything from a browser with a schema before using it. Settings are parsed in `apps/api/src/config.ts`.
- Never log or store message text, passwords, emails or raw IP addresses. Visitors are short scrambled IDs.
- Schema changes go through a Prisma migration, committed with the code that needs it.
- No `console.log` in the API or web source; use the pino logger in the API. ESLint enforces this.
- Import local files with a `.js` extension (`./foo.js`), as the existing code does.
- Chat rules go in `apps/api/src/chat/engine.ts` (no sockets, no database); the socket hub stays a thin adapter. Test rules with the fake-clock helpers in `apps/api/test/chat-helpers.ts`.
- The chat screen is `apps/web/src/chat/state.ts` (pure reducer) plus `pages/Chat.tsx`; add behaviour to the reducer first.
- Video: WebRTC logic lives in `apps/web/src/video/call.ts` (testable, fake peer in `src/test/fake-media.ts`); relay rules live in the engine (`signal`). Never relay a setup message that has not passed the `Signal` schema in `packages/shared`.
- `e2e/video_flow.py` needs Chromium's fake camera flags; `e2e/chat_flow.py` drives real browsers; it files real bans and reports, so run it only against a throwaway database.
- Add tests with each change, including the cases that must be refused.
- The original single-file app lives in the separate `passerby` repo. Its `tests/protocol.test.ts` and `tests/api.test.ts` describe the behaviour to port in phases 1 to 5 (see `docs/roadmap.md`).
