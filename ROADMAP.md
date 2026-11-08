# TaskLab — Roadmap With Commercial Gates

**Verdict:** UNPROVEN. **Operating rule:** Build quality infrastructure only as it helps validate buyers and testers. No premature cash or crypto features.

| Phase | Main work | Measurable gate | Current state |
|---|---|---|---|
| 0 — Research | Competitor review, task category choice, risks | First value proposition identified | Completed as hypothesis, demand unverified |
| 1 — v0.1 prototype | Tester/admin flows, Telegram auth, test points | Core backend regression tests pass | Done locally |
| 1.5 — v0.2 quality | Launch-click record, fraud warnings, report export, analytics, appeals | Regression tests and security/permission checks pass | Done locally |
| 2 — Private hosting | Cloudflare Worker/D1 + independent Telegram bot | Two real Telegram users sign in; non-admin blocked; exactly-once reward logic | Not started; account setup needed |
| 3 — Audience pilot | 20–30 consented testers, one authorized demo game | At least 10 completed tests; measure quality, completion rate, review time, repeated answers, failures | Not started |
| 4 — Advertiser demand | 15 qualified developer leads, buyer requirements and real quotes | 2 meaningful pricing discussions and 1 conditional paid-pilot commitment | Not started |
| 5 — Verified pilot integration | Developer backend callback with signed, replay-resistant events; campaign-specific attempts; slot TTL | Verification passes forged/replayed/duplicate-event tests | Dependent on first interested game partner |
| 6 — Legal/finance | Confirm permissible advertiser billing, tester payouts, disclosures, privacy and funding | Compliance review plus positive per-accepted-test contribution with real quoted prices | Unresolved |
| 7 — First commercial batch | 10–30 legitimately verified, advertiser-approved reports | Paid buyer, accepted deliverables, tracked costs and no unauthorized payout promises | Blocked |
| 8 — More task categories | Surveys / app onboarding / other verified tasks | Multiple repeat advertisers and positive margins | Future only |

## Recommended three-sided product after validated demand

### Testers
- Mobile-first discovery, eligibility, task briefs, progress, feedback and quality history.
- Task-specific secure session/attempt tokens; the partner must actually integrate to verify its own events.
- Disputes, support, language accessibility, privacy/consent and honest reward terms.
- Withdrawal only with compliant payment rails; never implied by demo points.

### Advertisers
- Application/onboarding and moderated campaign proposals, no untrusted instant publication.
- Define verifiable events, target user eligibility, sample sizes, test questions and quality standards.
- Preview, approval, anonymized approved reports, issue categories, campaign metrics and tracking integration.
- Invoice/contract and prepaid budgets only once payment and platform requirements are confirmed.

### Admin and risk operations
- Controlled campaign approval, internal quality flags, issue review, dispute handling and export logs.
- Audit, access control, capacity/expiry management, event replay prevention and operational monitoring.
- Financial settlement, refund reserves, fraud-loss reserves and payout reconciliation only after compliance approval.

## Most important unresolved product issue

A launch-click record and written feedback do not prove gameplay. A verified completion requires a trusted developer-side event tied to a tester-specific, expiring attempt ID. Build this with the first cooperative advertiser; do not construct a generic verification SDK without real integration requirements.

## Measurable pilot dashboard

- `launch_click_users` = distinct testers with first launch-click record (not verified plays)
- `reports_submitted` = unique submitted reports
- `reviewed_approved` / `reviewed_rejected` = verified *feedback quality* decisions, not gameplay confirmation
- `approval_rate` = approved ÷ (approved + rejected), excluding pending
- `review_minutes_per_approved_report` = recorded admin work ÷ approved reports (must measure manually initially)
- `buyer_price_per_accepted_report` = written price from real buyer
- `contribution_per_accepted_report` = buyer price − tester reward − review costs − payment costs − expected refund/fraud losses

**Stop rule:** No scaling just because the app works. Require measurable buyer satisfaction, positive contribution and valid payment operations.
