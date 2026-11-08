# TaskLab Handoff — November 9, 2026

## Purpose

An **independent** Telegram game and Mini App usability-testing platform for a Bangladesh-based audience. The commercial idea is **UNPROVEN**. The current product is a private testing prototype, **not** a cash-rewards service. All points are non-redeemable and do not create financial entitlement. Do not combine with any other Telegram project.

## Technical status

- MVP v0.2 implemented locally: D1/SQLite, Cloudflare Worker API, static mobile-friendly frontend.
- Telegram `initData` validated server-side via HMAC, with expiring signed sessions.
- Admin IDs checked server-side; capacity trigger; one submission per Telegram account/campaign; unique append-only test-point ledger; audit log.
- v0.2 additions: launch-click record, quality-warning flags, admin analytics, two CSV export scopes, appeals and admin responses.
- 3 automated regression suites passed, including authorization and CSV formula safety.
- Live Telegram/client test and Cloudflare D1 deployment NOT performed.
- Browser GUI automation blocked in local execution environment; UI needs hands-on testing.

## Files

- `src/worker.mjs`: Worker API
- `public/*`: frontend
- `migrations/0001_initial.sql`, `migrations/0002_quality_reporting.sql`: schema
- `scripts/local-server.mjs`: local Node/SQLite preview, auto-upgrades existing local DBs from v0.1
- `tests/app.test.mjs`: automated test suites
- `README.md`: local development/deployment instructions
- `ROADMAP.md`: milestone acceptance criteria and next work
- `CHANGELOG.md`: scope and caveats

## Important business facts vs assumptions

- Existing competitors and broader game-testing purchases exist, but no advertiser has been secured for these testers.
- No validated advertising rate, tester compensation rate, payout partner approval or compliance route exists.
- Development is approved; **no paid commitments, advertiser outreach, withdrawals or funds collection** have been authorized.

## Next action

1. Ask user to review the working local version. Secure new, independent Telegram bot and Cloudflare account setup; do not ask for token pasted into chat.
2. Deploy privately to Workers/D1 and test signed Telegram sessions with at least two real accounts.
3. Collect 20–30 consented users' feedback and compare task launch → submissions → accepted reports → admin review time.
4. Validate demand through advertiser conversations only after user approves outreach.
5. Add developer-to-developer server events, explicit test-start session tokens, and bounded slot reservations for a **specific** willing pilot advertiser.
6. Resolve Bangladesh payment, consumer disclosure, data privacy, and Telegram platform issues before any money-related features.

## Safety requirements

- No false claims about verified gameplay or actual rewards.
- Production must not enable local developer authentication; `ENVIRONMENT=production` required.
- Validate partner links, secure secrets in Wrangler, test rate limits/abuse and add data retention/deletion workflow before public launch.
- Approved CSV contains reports but no Telegram numeric user IDs; only send under an appropriate privacy notice and client agreement.
