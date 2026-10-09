# Roadmap

The repo today is the **foundation**: a working web app, API, database and WebSocket with tests, CI and deployment. This is the order to build the rest. Each phase ends with something you can use and test.

## What exists now

- **Text chat (phase 1, done):** interests, language and gender choice; matching with a four-second fallback; no instant rematch; skip cool-down; messages, typing, Next and Stop; flood limits; automatic removal (24 hours, with a report for moderators) when someone says they are under 18; bans kept in Postgres; the chat page reconnects by itself
- **Video chat (phase 2, done):** camera and microphone only after Start; a direct browser-to-browser call set up through the server (offer, answer and candidates, strictly validated and only relayed between two video partners); mute and camera-off buttons; Next closes the call, Stop turns the camera off; a blocked camera is explained; `VIDEO_ENABLED` and `TURN_*` settings; the home page hides video when it is off
- Home page, 18+ gate, live "people here now" count (the header and the chat connection show the same number)
- Shared protocol and API types, validated on both sides
- Database schema and first migration (users, passes, bans, reports, events, hourly stats)
- Health check, security headers, rate limits, graceful shutdown, structured logs
- CI, Dockerfile, Railway config

## Phases

| #   | Phase                             | Delivers                                                                                                                                                           |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Matching and text chat** (done) | Queue, interest matching, 4-second fallback, messages, typing, Next/Stop, flood limits, the under-18 filter. Ported from the original app; its rules are now tests |
| 2   | **Video** (done)                  | WebRTC signalling over the socket, camera/mic controls, TURN setting                                                                                               |
| 3   | **Accounts**                      | Register, sign in, sign out, change password, export and delete my data. argon2id, cookie sessions, rate limits                                                    |
| 4   | **Moderation and admin**          | Reports with transcripts, automatic pauses, bans, admin sign-in, dashboard (live, activity log, users, bans, system), CSV export                                   |
| 5   | **Premium**                       | Stripe Checkout, pass claims saved to accounts, filters by gender, interest and language                                                                           |
| 6   | **Money**                         | See below                                                                                                                                                          |
| 7   | **Search and polish**             | Pre-render public pages, sitemap and robots, cookie consent, move `e2e/chat_flow.py` to Playwright Test (TypeScript) and run it in CI, accessibility pass          |
| 8   | **Scale**                         | Redis for the queue and pairings, more than one API instance, metrics and alerts                                                                                   |

## Making money (phase 6)

Ordered by effort against likely return. Decide after phase 5, when real usage shows what people do.

1. **One-day pass** (built in phase 5). Turn on first; it needs only Stripe.
2. **Subscription** (weekly or monthly). Steadier income once people buy the day pass repeatedly. Needs Stripe subscriptions and a cancel button.
3. **Extra premium features.** Country choice, saved interests, ad-free week.
4. **Ads.** Google AdSense often refuses or later bans random-chat sites, so apply with the site live and have a second network ready. Pays a few dollars per 1,000 page views, so it matters only with real traffic. Needs a cookie-consent banner in the EU and UK.
5. **Affiliate or sponsor links, donations.** Small, easy, low priority.

Risks to plan for: payment companies and ad networks are strict about random-chat sites. Strong reporting, moderation and a clear contact and refund page help, but approval is never guaranteed.

## Quality bars for every phase

- `npm run check` passes and CI is green
- New behaviour has tests, including the cases that must be refused
- No message text, passwords, emails or raw IPs in logs or events
- Migrations are reversible by a follow-up migration, and tested with `npm run test:integration`
