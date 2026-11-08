# TaskLab — Telegram Sponsored Testing MVP (v0.2)

**Status:** Runnable local prototype; Cloudflare/Telegram deployment NOT completed. Commercial viability NOT proven. **All points are simulated, non-redeemable and cannot be withdrawn. No real-money integrations.**

This is an **independent** Telegram sponsored game/Mini App feedback product. It does not integrate with any other bot, site or Telegram business.

## v0.2 upgrades

- Records per-campaign launch **clicks**, without claiming gameplay was verified.
- Flags missing launch records, unusually fast feedback (under 90 seconds), and exact duplicate text for **manual** review only. No automatic rejection.
- Admin analytics for campaigns and task-review outcomes.
- Two CSV report options: *Approved CSV* (approved reports only, anonymized tester labels, no internal notes), and *Internal CSV* (all report statuses, quality flags, review notes). Exports are admin-only and protect against spreadsheet formula injection.
- One appeal allowed for a rejected report; admin can respond, and tester can read the response. Appeals do not automatically change review decisions or grant points.
- Second numbered migration; original v0.1 local SQLite databases are upgraded automatically by the standalone local server.

## What works now

- Responsive mobile-first frontend with user dashboard, available tests, testing brief and feedback form
- Server-verified Telegram Mini App `initData` authentication (HMAC SHA-256, 1-hour expiry)
- Admin allowlist enforced in backend
- Admin create/activate/pause campaigns; tester submit three meaningful feedback answers
- Capacity enforcement inside SQLite/D1 via trigger; one submission per Telegram ID per campaign
- Manual approval/rejection and auditable action log
- Approval awards *test points* once via unique and append-only ledger row
- User activity, points and pending status
- Local development server with SQLite and separate mock admin/tester profiles; no npm install required for local preview
- Automated backend and authentication tests

## Local preview (no credentials needed)

Requirements: Node.js 22.13+ (built-in `node:sqlite`, available experimentally in current Node 22).

```bash
cd telegram-task-lab-mvp
npm start
```

Open **http://127.0.0.1:8787**. The demo selector lets you switch between **Demo Tester** and **Demo Admin**. In the admin view, open **Analytics** or **Appeals** tabs; campaign rows include CSV exports. A sample non-sponsored campaign is preloaded. Test points have no cash value. The local SQLite database persists in `local-dev-data/` (not included in the downloadable package).

Run the automated tests:

```bash
npm test
```

To reset the local preview, stop the server, delete `local-dev-data/`, and restart.

**Local login safety:** Local development login works only when `ENVIRONMENT=development`, a local-only secret is present, and the hostname is `localhost` or `127.0.0.1`. The Cloudflare production configuration forces `ENVIRONMENT=production` and does not contain the development secret. Never set `ENVIRONMENT=development` for a public deployment.

## Cloudflare deployment (requires your accounts and real configuration)

Official references: [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/), [D1 migrations](https://developers.cloudflare.com/d1/wrangler-commands/), [Telegram Mini Apps](https://core.telegram.org/bots/webapps).

1. Create an **independent** Telegram bot in [@BotFather](https://t.me/BotFather). Keep its token secret.
2. Install dependencies on a computer with Node.js, npm and internet access:

   ```bash
   npm install
   npx wrangler login
   ```

3. Create D1:

   ```bash
   npx wrangler d1 create telegram-task-lab-db
   ```

   Copy the returned `database_id` into the **uncommented** `[[d1_databases]]` section of `wrangler.toml`, with `binding = "DB"` and `database_name = "telegram-task-lab-db"`.

4. Apply **both numbered migrations** to the remote D1 database (Wrangler tracks which files are already applied):

   ```bash
   npx wrangler d1 migrations apply telegram-task-lab-db --remote
   ```

5. Add secrets via Wrangler's secure prompt (do **not** paste tokens into chat or GitHub):

   ```bash
   npx wrangler secret put BOT_TOKEN
   npx wrangler secret put ADMIN_TELEGRAM_IDS
   ```

   `ADMIN_TELEGRAM_IDS` must be your own numeric Telegram user ID, or comma-separated IDs. Avoid treating the bot's username as its admin ID.

6. Deploy:

   ```bash
   npx wrangler deploy
   ```

   Wrangler will display an HTTPS `workers.dev` URL. The production database begins **empty**; the example campaigns exist only in the local development database.

7. Configure the **Menu Button** or **Main Mini App** URL in @BotFather to point to that HTTPS URL. Open it inside Telegram. Admins can then create a test campaign.

8. Test a separate Telegram tester account before inviting others. Confirm unauthorized admin requests receive HTTP 403, duplicate submissions receive HTTP 409, and approval credits once.

There is no deployment in this deliverable because no Cloudflare binding, account authorization, bot token, or admin ID were supplied.

## Technical architecture

```
Telegram (signed initData)
       ↓ HTTPS
Cloudflare Worker (src/worker.mjs)
       ├── /api/me                 user status + point ledger sum
       ├── /api/campaigns          active campaigns + slot count
       ├── /api/campaigns/:id/submissions
       └── /api/admin/*            allowlisted admin actions
       ↓
Cloudflare D1 (migrations/0001_initial.sql)

Cloudflare static assets (public/*) -- same HTTPS origin
```

Using one Worker rather than separate Pages and Workers removes cross-origin authorization complexity, while retaining the Cloudflare free-tier approach.

## Major limitations (intentional)

- **No automatic gameplay verification:** an administrator reads feedback; completion of gameplay is not cryptographically confirmed. Do not advertise this as fraud-proof. A real game developer callback/instrumentation is a later integration.
- **No advertiser checkout, budget accounting, cash rewards, withdrawal function, or referral system.** Do not collect advertiser money or promise payouts through this build.
- **No verified compliance for Bangladesh BDT disbursement** or Telegram digital-goods payment terms.
- **No production anti-abuse stack** beyond verified Telegram identity, one submission per Telegram ID/campaign, capacity checks and manual review. Multi-account abuse and AI-generated feedback remain possible.
- D1 stores feedback and Telegram user IDs; a privacy notice, retention policy, deletion process and applicable legal assessment are needed before a public launch.
- No payment, email, messaging or third-party analytics integrations. The in-app admin analytics are first-party SQL summaries.
- No continuous integration, observability/alerting or load testing yet.

## Repository structure

```text
public/                   Browser UI (no build step)
src/worker.mjs            Worker API; D1-backed business logic
migrations/0001_initial.sql  Original database schema
migrations/0002_quality_reporting.sql  Launch records, quality flags, appeals
scripts/local-server.mjs  Local SQLite test server (no Cloudflare account)
tests/app.test.mjs       Automated auth/API/quality/report/appeal regression tests
ROADMAP.md                Phase gates and acceptance criteria
HANDOFF.md                Current status and next actions
CHANGELOG.md              v0.2 additions and caveats
```

No secret keys, test database content, tokens or production user data are included.

## Important limitations for pilots

- Open destination clicks are not independent proof of gameplay or an integration with the advertised game. A real paid pilot needs a signed server-to-server integration with that game's operator.
- Slots are counted at submission rather than reserved at launch. For a popular test this could inconvenience participants; time-bounded reservations are a future requirement.
- Quality warnings are not fraud verdicts; they guide an administrator's review. Appeals currently provide explanations, not reversal of the original decision.
- Updated frontend screens have not been tested inside a real Telegram client or via browser automation in this environment. These remain deployment test requirements.
