# Roadmap

The repo today is the **foundation**: a working web app, API, database and WebSocket with tests, CI and deployment. This is the order to build the rest. Each phase ends with something you can use and test.

## What exists now

- **Text chat (phase 1, done):** interests, language, and a "Talk to: Both / Male / Female" filter (matching needs both people to be happy with each other, and it is never relaxed by waiting; in phase 5 it becomes a premium filter); matching with a four-second fallback; no instant rematch; skip cool-down; messages, typing, Next and Stop; flood limits; automatic removal (24 hours, with a report for moderators) when someone says they are under 18; bans kept in Postgres; the chat page reconnects by itself
- **Video chat (phase 2, done):** camera and microphone only after Start; a direct browser-to-browser call set up through the server (offer, answer and candidates, strictly validated and only relayed between two video partners); mute and camera-off buttons; Next closes the call, Stop turns the camera off; a blocked camera is explained; `VIDEO_ENABLED` and `TURN_*` settings; the home page hides video when it is off
- **Accounts (phase 3, done):** optional sign-up with an 18+ confirmation, sign-in, sign-out, change password (which signs out every other browser), download my data, delete my account; argon2id passwords, a signed HttpOnly 30-day cookie, lock-outs against guessing, protection against requests from other websites; the header shows who is signed in; Rules, Terms and Privacy pages; the activity log records account events without emails, passwords or addresses
- **Moderation and admin (phase 4, done):** a Report button in chat (during, or for a few minutes after); reports saved with the conversation; three different reporters in a day pause someone for 24 hours; the owner's admin area at `/admin` (live overview and hour-by-hour chart, report queue with ban lengths and Undo, bans, users with suspend and password reset, activity log with filters and CSV, system page); hourly counters; automatic clean-up of old logs and reports
- **Sign in with Google (done):** optional "Continue with Google" (authorization code with PKCE, tokens verified against Google's keys), connect and disconnect on the account page, set a password on a Google-only account; no automatic joining by email; 18+ confirmation for new Google accounts. Proven against a stand-in Google in unit, database and real-browser tests; real Google needs your credentials (README: Sign in with Google)
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
| 3   | **Accounts** (done)               | Register, sign in, sign out, change password, export and delete my data. argon2id, cookie sessions, rate limits                                                    |
| 4   | **Moderation and admin** (done)   | Reports with transcripts, automatic pauses, bans, admin sign-in, dashboard (live, activity log, users, bans, system), CSV export                                   |
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

## Known loose ends, and where they belong

- **Forgot password:** needs an email service. The admin password reset (phase 4) is the stop-gap.
- **More than one moderator:** there is a single owner login. Moderator accounts with their own sign-ins (and an audit of who did what by name) would be a small follow-up if more people need access.
- **Manual bans:** bans come from reports and age checks. Banning someone who has not been reported (say, from the activity log) is not built.
- **Admin sign-ins and rate limits** are per instance (in memory): move to Redis in phase 8.

## Quality bars for every phase

- `npm run check` passes and CI is green
- New behaviour has tests, including the cases that must be refused
- No message text, passwords, emails or raw IPs in logs or events
- Migrations are reversible by a follow-up migration, and tested with `npm run test:integration`
