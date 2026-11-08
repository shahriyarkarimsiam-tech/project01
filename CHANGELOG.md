# TaskLab Changelog

## v0.2.0 — Quality & Reporting Upgrade — November 9, 2026

**Still a local prototype.** The point ledger is for non-redeemable test points only. No advertiser payments, cash wallets, withdrawals, commissions, Telegram Stars or cryptocurrency are supported.

### Added
- Records the first time a tester clicks "Open test destination" and subsequent launch clicks by campaign/account. Does **not** prove gameplay.
- Detects three **advisory** review signals: no recorded launch, feedback submitted within 90 seconds of first launch, and exact-copy answers from another account on the same campaign. None automatically rejects a user.
- Admin analytics: users, launch-click records, submissions, approvals, rejections, pending reports, flags, appeals, demo points and campaign approval rates.
- Admin CSV export per campaign: default **approved reports only** without internal risk or review notes; optional **internal audit** export with all statuses and review metadata. Escapes formula-like cell content to reduce spreadsheet injection risk.
- Appeal system: rejected testers may send one appeal per submission; an authorized administrator can respond once. Tester sees the response in activity.
- Migration `0002_quality_reporting.sql`, preserving original schema and migrated data.
- Regression tests covering all new backend functions and authorization controls.

### Major caveats
- A recorded click is not developer-side evidence of an actual game session.
- Heuristic warning flags cannot establish fraud; manual investigation required.
- An appeal reply does not reverse the rejection or create points; changing review outcomes safely would require a separate, auditable workflow.
- Campaign slots are **reserved at submission**, not on launch. With popular campaigns, a tester could start but find no slot by the time they submit. A future reservation TTL is needed.
- Reports are exported by the admin manually; no advertiser account/portal yet.
- Browser GUI automation was unavailable in the local execution environment; API regressions passed, but updated screens still need human browser testing.

### Build status
- All 3 Node test suites passed locally.
- Live Telegram and Cloudflare deployment have not been performed.
