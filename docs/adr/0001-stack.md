# 1. Stack and repo shape

Status: accepted

## Context

Passerby began as one Bun file serving HTML, a WebSocket and a JSON file store. It outgrew that: accounts, an admin area, logs and payments need a real database, a separate front end, and tests that are easy to run. It will be deployed on Railway.

## Decision

- **Monorepo with npm workspaces**: `apps/web`, `apps/api`, `packages/shared`. One repo means one pull request can change the protocol and both sides together.
- **TypeScript everywhere**, with the WebSocket protocol and API shapes written once in `packages/shared` as Zod schemas.
- **React + Vite** for the web app. The team knows it, it has the largest ecosystem, and it deploys as static files.
- **Node 22 + Express 5 + `ws`** for the API. Boring, widely understood, runs on Railway without special handling.
- **Postgres + Prisma** for data. Prisma gives typed queries and migrations. Railway offers Postgres as a plugin with backups.
- **One production service**: the API also serves the built web app. Simpler cookies (same origin), one deploy, one thing to monitor.
- **Vitest** for all tests; supertest for HTTP; real Postgres (embedded, no Docker needed) for database tests.

## Consequences

- The web app is a single-page app, so public pages must be pre-rendered later for search engines (roadmap phase 7).
- Matching state is in memory, so run one instance until phase 8 moves it to Redis.
- Prisma 7 requires a driver adapter (`@prisma/adapter-pg`) and a `prisma.config.ts`; both are in place.
- Developers without Docker can still run everything: `npm run db:embedded`.

## Alternatives considered

- **Keep Bun and split front/back.** Reuses the most code, but Railway needs a Dockerfile for Bun and fewer tools assume it. Rejected for support and hiring reasons, not technical ones.
- **Next.js full stack.** Best for search engines, but real-time chat needs a separate WebSocket server anyway, giving two backends. Rejected for now.
