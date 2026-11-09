/**
 * Telegram Sponsored Tasks MVP v0.2 - Cloudflare Worker API.
 * All rewards are NON-REDEEMABLE TEST POINTS. No cash or payment features.
 * No npm dependencies; database is Cloudflare D1.
 */
const encoder = new TextEncoder();
const corslessHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

function respond(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corslessHeaders });
}
function error(code, message, status) { return respond({ error: code, message }, status); }
function str(value, min = 1, max = 1000) {
  return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max ? value.trim() : null;
}
function integer(value, min, max) { return Number.isInteger(value) && value >= min && value <= max ? value : null; }
function validHttps(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password && u.href.length <= 500 && !['localhost', '127.0.0.1'].includes(u.hostname); }
  catch { return false; }
}
async function jsonBody(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AppError('Content-Type must be application/json.', 415, 'bad_content_type');
  const body = await request.text();
  if (body.length > 10000) throw new AppError('Request body too large.', 413, 'body_too_large');
  try { const result = JSON.parse(body); if (!result || typeof result !== 'object' || Array.isArray(result)) throw 0; return result; }
  catch { throw new AppError('Invalid JSON object.', 400, 'bad_json'); }
}
class AppError extends Error {
  constructor(message, status = 400, code = 'bad_request') { super(message); this.status = status; this.code = code; }
}

async function hmac(key, message) {
  const cryptoKey = await crypto.subtle.importKey('raw', typeof key === 'string' ? encoder.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
}
function toHex(bytes) { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }
function constantHexEqual(a, b) {
  if (!/^[0-9a-f]{64}$/i.test(a || '') || !/^[0-9a-f]{64}$/i.test(b || '')) return false;
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= a.toLowerCase().charCodeAt(i) ^ b.toLowerCase().charCodeAt(i);
  return difference === 0;
}

/** Exported for regression tests. Avoid displaying or logging raw init data. */
export async function verifyTelegramInitData(raw, botToken, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!raw || raw.length > 8192 || !botToken) throw new AppError('Telegram session not available.', 401, 'auth_required');
  const params = new URLSearchParams(raw);
  const unique = new Set();
  for (const [key] of params) {
    if (unique.has(key)) throw new AppError('Malformed Telegram session.', 401, 'bad_auth');
    unique.add(key);
  }
  const hash = params.get('hash') || '';
  const authDate = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(authDate) || authDate > nowSeconds + 60 || nowSeconds - authDate > 3600) {
    throw new AppError('Telegram session expired. Close and reopen the app.', 401, 'expired_auth');
  }
  const pairsWithoutHash = [...params.entries()].filter(([key]) => key !== 'hash');
  const pairsWithoutHashAndSig = pairsWithoutHash.filter(([key]) => key !== 'signature');

  pairsWithoutHash.sort(([a], [b]) => a.localeCompare(b));
  pairsWithoutHashAndSig.sort(([a], [b]) => a.localeCompare(b));

  const checkString1 = pairsWithoutHash.map(([k, v]) => `${k}=${v}`).join('\n');
  const checkString2 = pairsWithoutHashAndSig.map(([k, v]) => `${k}=${v}`).join('\n');

  const secret = await hmac('WebAppData', (botToken || '').trim());
  const computed1 = toHex(await hmac(secret, checkString1));
  const computed2 = toHex(await hmac(secret, checkString2));

  if (!constantHexEqual(hash, computed1) && !constantHexEqual(hash, computed2)) {
    console.log('INIT_DATA_DEBUG:', JSON.stringify({
      keys: [...params.keys()],
      hash,
      computed1,
      computed2,
      checkString1,
      checkString2
    }));
    throw new AppError('Invalid Telegram signature.', 401, 'bad_auth');
  }
  let user;
  try { user = JSON.parse(params.get('user') || 'null'); } catch { /* no user */ }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) throw new AppError('Telegram user unavailable.', 401, 'bad_auth');
  return { id: String(user.id), first_name: str(user.first_name, 1, 120) || 'Telegram user', username: str(user.username, 1, 120) || null };
}

function devAllowed(request, env) {
  const hostname = new URL(request.url).hostname;
  return env.ENVIRONMENT === 'development' && (hostname === 'localhost' || hostname === '127.0.0.1') && !!env.LOCAL_DEV_KEY;
}
async function authenticate(request, env) {
  // A development-only login mechanism. No public deployment can use this
  // unless it is intentionally misconfigured as development WITH a dev secret.
  if (devAllowed(request, env) && request.headers.get('x-local-dev-key') === env.LOCAL_DEV_KEY) {
    const id = request.headers.get('x-local-user-id') === '90001' ? '90001' : '10001';
    return { id, first_name: id === '90001' ? 'Demo Admin' : 'Demo Tester', username: null };
  }
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('tma ')) throw new AppError('Open this app inside Telegram to sign in.', 401, 'auth_required');
  return verifyTelegramInitData(header.slice(4), env.BOT_TOKEN);
}
function isAdmin(user, env) {
  return String(env.ADMIN_TELEGRAM_IDS || '').split(',').map(s => s.trim()).filter(Boolean).includes(user.id);
}
async function ensureUser(db, user) {
  await db.prepare(`INSERT INTO users (id, first_name, username) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name,
    username = excluded.username, last_seen_at = datetime('now')`)
    .bind(user.id, user.first_name, user.username).run();
}
async function audit(db, actor, action, target, details) {
  await db.prepare('INSERT INTO audit_log (id, actor_id, action, target_id, details) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), actor, action, target, JSON.stringify(details)).run();
}

async function getCampaigns(db, userId) {
  const rows = await db.prepare(`SELECT c.id, c.title, c.description, c.game_url, c.instructions,
    c.question1, c.question2, c.question3, c.reward_points, c.capacity,
    (SELECT COUNT(*) FROM submissions s WHERE s.campaign_id = c.id AND s.status IN ('pending','approved')) AS reserved,
    (SELECT s.status FROM submissions s WHERE s.campaign_id = c.id AND s.user_id = ?) AS my_status
    FROM campaigns c WHERE c.status = 'active' ORDER BY c.created_at DESC, c.id DESC`)
    .bind(userId).all();
  return rows.results || [];
}
async function getMe(db, user, admin) {
  const [balance, stats, activity] = await db.batch([
    db.prepare('SELECT COALESCE(SUM(points), 0) AS points FROM reward_ledger WHERE user_id = ?').bind(user.id),
    db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(status='pending'),0) AS pending,
      COALESCE(SUM(status='approved'),0) AS approved,
      COALESCE(SUM(status='rejected'),0) AS rejected
      FROM submissions WHERE user_id = ?`).bind(user.id),
    db.prepare(`SELECT s.id, s.created_at, s.status, s.review_note, s.campaign_id,
      c.title, c.reward_points, a.status AS appeal_status, a.admin_reply AS appeal_reply FROM submissions s JOIN campaigns c ON c.id=s.campaign_id LEFT JOIN appeals a ON a.submission_id=s.id
      WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 30`).bind(user.id),
  ]);
  return { user: { ...user, admin }, points: balance.results?.[0]?.points || 0,
    stats: stats.results?.[0] || { total: 0, pending: 0, approved: 0, rejected: 0 },
    activity: activity.results || [], is_demo: true };
}
async function recordTaskLaunch(db, campaignId, user) {
  const campaign = await db.prepare('SELECT status FROM campaigns WHERE id=?').bind(campaignId).first();
  if (!campaign || campaign.status !== 'active') throw new AppError('This campaign is not available.', 404, 'campaign_unavailable');
  const done = await db.prepare('SELECT id FROM submissions WHERE campaign_id=? AND user_id=?')
    .bind(campaignId, user.id).first();
  if (done) throw new AppError('You have already submitted this test.', 409, 'already_submitted');
  await db.prepare(`INSERT INTO task_launches (campaign_id,user_id) VALUES (?,?)
    ON CONFLICT(campaign_id,user_id) DO UPDATE SET
      launch_count=MIN(100, task_launches.launch_count+1), last_launched_at=datetime('now')`)
    .bind(campaignId, user.id).run();
  return { recorded: true, message: 'Launch click recorded. This does not independently prove that gameplay occurred.' };
}

async function feedbackRiskFlags(db, campaignId, user, answers) {
  const flags = [];
  const launch = await db.prepare(`SELECT launch_count,
    unixepoch('now')-unixepoch(started_at) AS elapsed_seconds
    FROM task_launches WHERE campaign_id=? AND user_id=?`).bind(campaignId, user.id).first();
  if (!launch) flags.push('no_launch_record');
  else if (launch.elapsed_seconds !== null && launch.elapsed_seconds < 90) flags.push('submitted_under_90_seconds');
  // Exact matches prompt human review, never automatic rejection. These
  // indicators are deliberately not described as proof of fraud.
  const same = await db.prepare(`SELECT COUNT(*) AS total FROM submissions
    WHERE campaign_id=? AND user_id<>? AND answer1=? AND answer2=? AND answer3=?`)
    .bind(campaignId, user.id, ...answers).first();
  if (same?.total > 0) flags.push('identical_feedback');
  return flags;
}

async function submitAppeal(db, user, submissionId, body) {
  const reason = str(body.reason, 20, 1000);
  if (!reason) throw new AppError('Explain the dispute in 20–1000 characters.', 400, 'invalid_appeal');
  const submission = await db.prepare('SELECT id,status FROM submissions WHERE id=? AND user_id=?')
    .bind(submissionId, user.id).first();
  if (!submission) throw new AppError('Submission not found.', 404, 'not_found');
  if (submission.status !== 'rejected') throw new AppError('Only rejected reports can be appealed.', 409, 'not_rejected');
  const id = crypto.randomUUID();
  try {
    await db.prepare('INSERT INTO appeals (id,submission_id,user_id,reason) VALUES (?,?,?,?)')
      .bind(id, submissionId, user.id, reason).run();
  } catch (e) {
    if (String(e?.message||e).includes('UNIQUE')) throw new AppError('An appeal already exists for this report.', 409, 'duplicate_appeal');
    throw e;
  }
  await audit(db, user.id, 'appeal.submit', submissionId, { appeal_id: id });
  return { id, status: 'open', message: 'Appeal recorded. The administrator will review your explanation.' };
}

async function submitFeedback(db, campaignId, user, body) {
  const answers = [str(body.answer1, 15, 1000), str(body.answer2, 15, 1000), str(body.answer3, 15, 1000)];
  const device = str(body.device, 2, 120);
  if (answers.some(x => !x) || !device) throw new AppError('Provide three meaningful answers (15–1000 characters each) and a device.', 400, 'invalid_feedback');
  const campaign = await db.prepare('SELECT id,status FROM campaigns WHERE id=?').bind(campaignId).first();
  if (!campaign || campaign.status !== 'active') throw new AppError('This campaign is not available.', 404, 'campaign_unavailable');
  const id = crypto.randomUUID();
  const flags = await feedbackRiskFlags(db, campaignId, user, answers);
  try {
    await db.prepare(`INSERT INTO submissions
      (id,campaign_id,user_id,answer1,answer2,answer3,device,risk_flags)
      VALUES (?,?,?,?,?,?,?,?)`).bind(id, campaignId, user.id, ...answers, device, JSON.stringify(flags)).run();
  } catch (cause) {
    const msg = String(cause?.message || cause);
    if (msg.includes('UNIQUE')) throw new AppError('You have already submitted this task.', 409, 'duplicate_submission');
    if (msg.includes('CAMPAIGN_FULL_OR_INACTIVE')) throw new AppError('All testing slots have been reserved.', 409, 'campaign_full');
    throw cause;
  }
  return { id, status: 'pending', message: 'Feedback received. Admin review is required before points are granted.' };
}
function campaignData(body) {
  const title = str(body.title, 5, 100);
  const description = str(body.description, 20, 600);
  const gameUrl = str(body.game_url, 10, 500);
  const instructions = str(body.instructions, 20, 1200);
  const questions = Array.isArray(body.questions) && body.questions.length === 3 ? body.questions.map(q => str(q, 10, 200)) : [];
  const capacity = integer(body.capacity, 1, 1000);
  const rewardPoints = integer(body.reward_points, 1, 1000);
  if (!title || !description || !gameUrl || !validHttps(gameUrl) || !instructions || questions.length !== 3 || questions.some(q => !q) || !capacity || !rewardPoints) {
    throw new AppError('Campaign needs a valid HTTPS game URL, title, description, instructions, three questions, capacity and test points.', 400, 'invalid_campaign');
  }
  return { title, description, gameUrl, instructions, questions, capacity, rewardPoints };
}
async function createCampaign(db, user, body) {
  const v = campaignData(body), id = crypto.randomUUID();
  await db.prepare(`INSERT INTO campaigns
    (id,title,description,game_url,instructions,question1,question2,question3,reward_points,capacity,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, v.title, v.description, v.gameUrl, v.instructions, ...v.questions, v.rewardPoints, v.capacity, user.id).run();
  await audit(db, user.id, 'campaign.create', id, { title: v.title, capacity: v.capacity, reward_points: v.rewardPoints });
  return { id, status: 'draft' };
}
async function getAdminCampaigns(db) {
  const res = await db.prepare(`SELECT c.*,
    (SELECT COUNT(*) FROM submissions s WHERE s.campaign_id=c.id AND s.status IN ('pending','approved')) AS reserved,
    (SELECT COUNT(*) FROM submissions s WHERE s.campaign_id=c.id AND s.status='approved') AS approved
    FROM campaigns c ORDER BY c.created_at DESC, c.id DESC LIMIT 100`).all();
  return res.results || [];
}
async function getAdminSubmissions(db) {
  const res = await db.prepare(`SELECT s.*, c.title AS campaign_title, c.reward_points,
    u.first_name AS tester_name FROM submissions s
    JOIN campaigns c ON c.id=s.campaign_id
    JOIN users u ON u.id=s.user_id
    ORDER BY CASE WHEN s.status='pending' THEN 0 ELSE 1 END, s.created_at DESC LIMIT 100`).all();
  return res.results || [];
}
async function getAdminAnalytics(db) {
  const [overall, campaigns, quality, appeals] = await db.batch([
    db.prepare(`SELECT (SELECT COUNT(*) FROM users) AS total_users,
      (SELECT COUNT(*) FROM task_launches) AS launch_records,
      (SELECT COUNT(*) FROM submissions) AS submitted,
      (SELECT COUNT(*) FROM submissions WHERE status='approved') AS approved,
      (SELECT COUNT(*) FROM submissions WHERE status='rejected') AS rejected,
      (SELECT COUNT(*) FROM submissions WHERE status='pending') AS pending,
      (SELECT COALESCE(SUM(points),0) FROM reward_ledger) AS demo_points_issued`),
    db.prepare(`SELECT c.id,c.title,c.status,c.capacity,
      COUNT(s.id) AS submitted,
      COALESCE(SUM(s.status='approved'),0) AS approved,
      COALESCE(SUM(s.status='pending'),0) AS pending,
      COALESCE(SUM(s.status='rejected'),0) AS rejected
      FROM campaigns c LEFT JOIN submissions s ON s.campaign_id=c.id
      GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100`),
    db.prepare(`SELECT COUNT(*) AS flagged FROM submissions WHERE risk_flags <> '[]'`),
    db.prepare(`SELECT COUNT(*) AS open FROM appeals WHERE status='open'`),
  ]);
  return { overall: overall.results?.[0] || {}, campaigns: campaigns.results || [],
    flagged: quality.results?.[0]?.flagged || 0, open_appeals: appeals.results?.[0]?.open || 0 };
}
async function getAdminAppeals(db) {
  const result = await db.prepare(`SELECT a.id,a.submission_id,a.reason,a.status,a.admin_reply,
    a.created_at,a.responded_at,c.title AS campaign_title,u.first_name AS tester_name
    FROM appeals a JOIN submissions s ON s.id=a.submission_id
    JOIN campaigns c ON c.id=s.campaign_id JOIN users u ON u.id=a.user_id
    ORDER BY CASE WHEN a.status='open' THEN 0 ELSE 1 END, a.created_at DESC LIMIT 100`).all();
  return result.results || [];
}
async function answerAppeal(db, actor, id, body) {
  const reply = str(body.reply, 10, 800);
  if (!reply) throw new AppError('Write a response of 10–800 characters.', 400, 'invalid_reply');
  const result = await db.prepare(`UPDATE appeals SET status='answered',admin_reply=?,responded_by=?,responded_at=datetime('now')
    WHERE id=? AND status='open' RETURNING id`).bind(reply, actor, id).all();
  if (!result.results?.length) throw new AppError('Appeal missing or already answered.', 409, 'appeal_closed');
  await audit(db, actor, 'appeal.answer', id, { reply });
  return { id, status: 'answered' };
}
function safeCsvCell(value) {
  let cell = String(value ?? '');
  // Prevent formula injection when staff open exported tester text in Excel.
  if (/^[\s\x00-\x1f]*[=+@-]/.test(cell)) cell = "'" + cell;
  return '"' + cell.replace(/"/g, '""') + '"';
}
async function exportCampaignReport(db, id, internal = false) {
  const campaign = await db.prepare('SELECT id,title FROM campaigns WHERE id=?').bind(id).first();
  if (!campaign) throw new AppError('Campaign not found.', 404, 'not_found');
  const result = await db.prepare(`SELECT created_at,status,device,answer1,answer2,answer3,
    risk_flags,review_note FROM submissions WHERE campaign_id=?
    AND (?=1 OR status='approved') ORDER BY created_at ASC LIMIT 1000`)
    .bind(id, internal ? 1 : 0).all();
  const header = internal
    ? ['tester_ref','submitted_utc','status','device','quality_flags','answer1','answer2','answer3','review_note']
    : ['tester_ref','submitted_utc','device','answer1','answer2','answer3'];
  const lines = [header.map(safeCsvCell).join(',')];
  for (const [index, r] of (result.results || []).entries()) {
    const values = internal
      ? [`Tester ${index+1}`,r.created_at,r.status,r.device,r.risk_flags,r.answer1,r.answer2,r.answer3,r.review_note]
      : [`Tester ${index+1}`,r.created_at,r.device,r.answer1,r.answer2,r.answer3];
    lines.push(values.map(safeCsvCell).join(','));
  }
  return new Response('\uFEFF'+lines.join('\r\n')+'\r\n', {
    status: 200, headers: {
      'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="campaign-${id}-${internal ? 'internal' : 'approved'}.csv"`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    },
  });
}

async function changeCampaignStatus(db, actor, campaignId, body) {
  const status = body.status;
  if (!['active', 'paused', 'draft'].includes(status)) throw new AppError('Invalid campaign status.', 400, 'bad_status');
  const previous = await db.prepare('SELECT id,status FROM campaigns WHERE id=?').bind(campaignId).first();
  if (!previous) throw new AppError('Campaign not found.', 404, 'not_found');
  await db.prepare("UPDATE campaigns SET status=?,updated_at=datetime('now') WHERE id=?").bind(status, campaignId).run();
  await audit(db, actor, 'campaign.status', campaignId, { from: previous.status, to: status });
  return { id: campaignId, status };
}
async function reviewSubmission(db, actor, submissionId, body) {
  const decision = body.decision;
  if (decision !== 'approved' && decision !== 'rejected') throw new AppError('Review must approve or reject.', 400, 'bad_decision');
  const note = str(body.note || '', 0, 400) || '';
  if (decision === 'rejected' && note.length < 8) throw new AppError('Provide a reason for rejecting the test.', 400, 'note_required');
  const existing = await db.prepare('SELECT status FROM submissions WHERE id=?').bind(submissionId).first();
  if (!existing) throw new AppError('Submission not found.', 404, 'not_found');
  if (existing.status !== 'pending') throw new AppError('Submission has already been reviewed.', 409, 'already_reviewed');
  const update = db.prepare(`UPDATE submissions SET status=?, review_note=?, reviewed_by=?, reviewed_at=datetime('now')
    WHERE id=? AND status='pending' RETURNING id`).bind(decision, note, actor, submissionId);
  let results;
  if (decision === 'approved') {
    // Both operations commit or roll back together. A UNIQUE submission_id in
    // reward_ledger makes duplicate awards impossible even on repeated requests.
    results = await db.batch([
      update,
      db.prepare(`INSERT INTO reward_ledger (id,user_id,campaign_id,submission_id,points,description)
        SELECT ?,s.user_id,s.campaign_id,s.id,c.reward_points,'Approved testing feedback'
        FROM submissions s JOIN campaigns c ON c.id=s.campaign_id
        WHERE s.id=? AND s.status='approved' AND NOT EXISTS
        (SELECT 1 FROM reward_ledger l WHERE l.submission_id=s.id)`)
        .bind(crypto.randomUUID(), submissionId),
    ]);
  } else {
    results = [await update.all()];
  }
  if (!results[0].results?.length) throw new AppError('Submission was reviewed by another administrator.', 409, 'already_reviewed');
  await audit(db, actor, `submission.${decision}`, submissionId, { note });
  return { id: submissionId, status: decision };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : error('not_found', 'Not found.', 404);
    if (request.method === 'OPTIONS') return error('method_not_allowed', 'Not allowed.', 405);
    if (request.method === 'GET' && path === '/api/health') return respond({ ok: true, version: '0.2.0', reward_type: 'demo_points_only' });
    if (path === '/api/telegram-webhook' && request.method === 'POST') {
      try {
        const update = await request.json();
        if (update?.message?.chat?.id && env.BOT_TOKEN) {
          const chatId = update.message.chat.id;
          const host = url.origin || 'https://telegram-task-lab-mvp.shahriyarkarimsiam.workers.dev';
          await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '👋 *Welcome to TaskKit!*\n\nComplete usability testing tasks and earn points.\n\nTap below to launch the Mini App:',
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🚀 Open TaskKit Mini App', web_app: { url: host } }]
                ]
              }
            })
          });
        }
      } catch (err) {
        console.error('Webhook processing error:', err);
      }
      return respond({ ok: true });
    }
    if (!env.DB) return error('not_configured', 'Database binding is missing.', 503);
    try {
      const user = await authenticate(request, env);
      await ensureUser(env.DB, user);
      const admin = isAdmin(user, env);
      if (request.method === 'GET' && path === '/api/me') return respond(await getMe(env.DB, user, admin));
      if (request.method === 'GET' && path === '/api/campaigns') return respond({ campaigns: await getCampaigns(env.DB, user.id) });
      let launchMatch = path.match(/^\/api\/campaigns\/([a-f0-9-]{36})\/launch$/);
      if (launchMatch && request.method === 'POST') return respond(await recordTaskLaunch(env.DB, launchMatch[1], user));
      let appealMatch = path.match(/^\/api\/submissions\/([a-f0-9-]{36})\/appeal$/);
      if (appealMatch && request.method === 'POST') return respond(await submitAppeal(env.DB, user, appealMatch[1], await jsonBody(request)), 201);
      let match = path.match(/^\/api\/campaigns\/([a-f0-9-]{36})\/submissions$/);
      if (match && request.method === 'POST') return respond(await submitFeedback(env.DB, match[1], user, await jsonBody(request)), 201);
      if (path.startsWith('/api/admin/')) {
        if (!admin) return error('forbidden', 'Administrator access required.', 403);
        if (request.method === 'GET' && path === '/api/admin/campaigns') return respond({ campaigns: await getAdminCampaigns(env.DB) });
        if (request.method === 'GET' && path === '/api/admin/submissions') return respond({ submissions: await getAdminSubmissions(env.DB) });
        if (request.method === 'GET' && path === '/api/admin/analytics') return respond(await getAdminAnalytics(env.DB));
        if (request.method === 'GET' && path === '/api/admin/appeals') return respond({ appeals: await getAdminAppeals(env.DB) });
        match = path.match(/^\/api\/admin\/appeals\/([a-f0-9-]{36})\/answer$/);
        if (match && request.method === 'POST') return respond(await answerAppeal(env.DB, user.id, match[1], await jsonBody(request)));
        match = path.match(/^\/api\/admin\/campaigns\/([a-f0-9-]{36})\/report\.csv$/);
        if (match && request.method === 'GET') return await exportCampaignReport(env.DB, match[1], url.searchParams.get('scope') === 'internal');
        if (request.method === 'POST' && path === '/api/admin/campaigns') return respond(await createCampaign(env.DB, user, await jsonBody(request)), 201);
        match = path.match(/^\/api\/admin\/campaigns\/([a-f0-9-]{36})\/status$/);
        if (match && request.method === 'POST') return respond(await changeCampaignStatus(env.DB, user.id, match[1], await jsonBody(request)));
        match = path.match(/^\/api\/admin\/submissions\/([a-f0-9-]{36})\/review$/);
        if (match && request.method === 'POST') return respond(await reviewSubmission(env.DB, user.id, match[1], await jsonBody(request)));
      }
      return error('not_found', 'API route not found.', 404);
    } catch (cause) {
      if (cause instanceof AppError) return error(cause.code, cause.message, cause.status);
      // Never leak SQL errors, credentials, or submitted answers to clients.
      console.error('API failure:', cause?.message || 'unknown');
      return error('server_error', 'Request failed. Please try again.', 500);
    }
  },
};
