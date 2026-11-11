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
function positiveNumber(value, min = 0.001, max = 100000) {
  const n = Number(value);
  return !Number.isNaN(n) && Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 10000) / 10000 : null;
}
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
  const startParam = params.get('start_param') || null;
  return { id: String(user.id), first_name: str(user.first_name, 1, 120) || 'Telegram user', username: str(user.username, 1, 120) || null, start_param: startParam };
}

function devAllowed(request, env) {
  const hostname = new URL(request.url).hostname;
  return env.ENVIRONMENT === 'development' && (hostname === 'localhost' || hostname === '127.0.0.1') && !!env.LOCAL_DEV_KEY;
}
async function authenticate(request, env) {
  // A development-only login mechanism. No public deployment can use this
  // unless it is intentionally misconfigured as development WITH a dev secret.
  if (devAllowed(request, env) && request.headers.get('x-local-dev-key') === env.LOCAL_DEV_KEY) {
    const id = request.headers.get('x-local-user-id') || '10001';
    return { id, first_name: id === '90001' ? 'Demo Admin' : `Tester ${id}`, username: null };
  }
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('tma ')) throw new AppError('Open this app inside Telegram to sign in.', 401, 'auth_required');
  const authUser = await verifyTelegramInitData(header.slice(4), env.BOT_TOKEN);
  if (authUser.start_param && env.DB) {
    void recordReferral(env.DB, authUser.start_param, authUser.id, env.BOT_TOKEN).catch(() => {});
  }
  return authUser;
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
    (SELECT COUNT(*) FROM submissions s WHERE s.campaign_id = c.id AND s.status = 'approved') AS completed_count,
    (SELECT s.status FROM submissions s WHERE s.campaign_id = c.id AND s.user_id = ?) AS my_status
    FROM campaigns c WHERE c.status = 'active' ORDER BY c.created_at DESC, c.id DESC`)
    .bind(userId).all();
  return rows.results || [];
}
async function recordReferral(db, inviterId, referredUserId, botToken) {
  if (!inviterId || !referredUserId) return false;
  const cleanInviter = String(inviterId).replace(/^ref_/, '').trim();
  const cleanReferred = String(referredUserId).replace(/^ref_/, '').trim();
  if (!cleanInviter || !cleanReferred || cleanInviter === cleanReferred) return false;

  await db.prepare('INSERT OR IGNORE INTO users (id, first_name) VALUES (?, ?)').bind(cleanInviter, 'Telegram User').run();
  await db.prepare('INSERT OR IGNORE INTO users (id, first_name) VALUES (?, ?)').bind(cleanReferred, 'Telegram User').run();

  try {
    const res = await db.prepare(`INSERT INTO referrals (id, inviter_id, referred_user_id)
      VALUES (?, ?, ?) ON CONFLICT(referred_user_id) DO NOTHING`)
      .bind(crypto.randomUUID(), cleanInviter, cleanReferred).run();
    const inserted = (res.meta?.changes || 0) > 0;
    if (inserted && botToken) {
      const inviteCount = await db.prepare('SELECT COUNT(*) AS total FROM referrals WHERE inviter_id = ?').bind(cleanInviter).first();
      void notifyReferralInviter(cleanInviter, inviteCount?.total || 1, botToken);
    }
    return inserted;
  } catch {
    return false;
  }
}

async function notifyReferralInviter(inviterId, count, botToken) {
  if (!botToken || !inviterId) return;
  try {
    const isUnlocked = count >= 10;
    const text = isUnlocked
      ? `🚀 <b>Congratulations!</b>\n\nA new friend joined TaskKit using your invite link!\n\nYou now have <b>${count} lifetime invites</b>! USDT withdrawals are now permanently <b>UNLOCKED</b> for your account! 🎉`
      : `🎉 <b>New Referral!</b>\n\nA friend joined TaskKit using your link!\n\nProgress: <b>${count} / 10 lifetime invites</b>.\n${10 - count} more invite(s) to unlock USDT withdrawals.`;
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: inviterId, text, parse_mode: 'HTML' })
    });
  } catch {}
}

async function notifyAdminNewWithdrawal(env, user, amount, network, wallet) {
  if (!env?.BOT_TOKEN || !env?.ADMIN_TELEGRAM_IDS) return;
  const adminIds = String(env.ADMIN_TELEGRAM_IDS).split(',').map(s => s.trim()).filter(Boolean);
  const uName = user.username ? '@' + String(user.username).replace(/[<>&]/g, '') : user.id;
  const fName = String(user.first_name || 'Tester').replace(/[<>&]/g, '');
  const text = `🔔 <b>New USDT Withdrawal Request!</b>\n\n• <b>User:</b> ${fName} (${uName})\n• <b>Amount:</b> <b>${amount.toFixed(2)} USDT</b>\n• <b>Network:</b> <b>${network}</b>\n• <b>Wallet Address:</b>\n<code>${wallet}</code>\n\n👉 <b>Action:</b> Send ${amount.toFixed(2)} USDT (${network}) to the address above, then mark Paid with the TxID in TaskKit Admin Studio.`;

  for (const adminId of adminIds) {
    try {
      await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: adminId, text, parse_mode: 'HTML' })
      });
    } catch {}
  }
}

async function notifyUserWithdrawalStatus(botToken, userId, amount, network, decision, note) {
  if (!botToken || !userId) return;
  let text = '';
  const cleanTx = (note || '').trim().replace(/^TX:\s*/i, '');
  const isTx = /^0x[a-fA-F0-9]{64}$/i.test(cleanTx);
  if (decision === 'completed') {
    const txLink = isTx && network === 'BEP20'
      ? `\n\n🔗 <b>Verify on BscScan:</b>\nhttps://bscscan.com/tx/${cleanTx}`
      : (note ? `\n\n<b>Transaction Note / Ref:</b> <code>${String(note).replace(/[<>&]/g, '')}</code>` : '');
    text = `💸 <b>Withdrawal Successful!</b>\n\nYour withdrawal of <b>${amount.toFixed(2)} USDT</b> (${network}) has been processed and sent to your wallet!${txLink}\n\nThank you for testing with TaskKit! 🚀`;
  } else {
    text = `⚠️ <b>Withdrawal Update</b>\n\nYour withdrawal request for <b>${amount.toFixed(2)} USDT</b> could not be processed.\n\n<b>Reason:</b> ${String(note || 'No reason provided.').replace(/[<>&]/g, '')}\n\nThe funds have been restored to your available TaskKit balance.`;
  }
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: userId, text, parse_mode: 'HTML' })
    });
  } catch {}
}

async function getMe(db, user, admin) {
  const [balance, stats, activity, invites, withdrawals] = await db.batch([
    db.prepare('SELECT ROUND(COALESCE(SUM(points), 0), 4) AS points FROM reward_ledger WHERE user_id = ?').bind(user.id),
    db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(status='pending'),0) AS pending,
      COALESCE(SUM(status='approved'),0) AS approved,
      COALESCE(SUM(status='rejected'),0) AS rejected
      FROM submissions WHERE user_id = ?`).bind(user.id),
    db.prepare(`SELECT s.id, s.created_at, s.status, s.review_note, s.campaign_id,
      c.title, c.reward_points, a.status AS appeal_status, a.admin_reply AS appeal_reply FROM submissions s JOIN campaigns c ON c.id=s.campaign_id LEFT JOIN appeals a ON a.submission_id=s.id
      WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 50`).bind(user.id),
    db.prepare('SELECT COUNT(*) AS total FROM referrals WHERE inviter_id = ?').bind(user.id),
    db.prepare(`SELECT id, amount, wallet_address, network, status, admin_note, created_at, processed_at
      FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`).bind(user.id),
  ]);
  const totalEarned = balance.results?.[0]?.points || 0;
  const lifetimeInvites = invites.results?.[0]?.total || 0;
  const userWithdrawals = withdrawals.results || [];
  const reservedWithdrawals = userWithdrawals
    .filter(w => w.status === 'pending' || w.status === 'completed')
    .reduce((sum, w) => sum + Number(w.amount || 0), 0);
  const availableBalance = Math.max(0, Math.round((totalEarned - reservedWithdrawals) * 10000) / 10000);
  const canWithdraw = lifetimeInvites >= 10;

  return {
    user: { ...user, admin },
    points: totalEarned,
    balance_usdt: totalEarned,
    available_balance: availableBalance,
    currency: 'USDT',
    lifetime_invites: lifetimeInvites,
    can_withdraw: canWithdraw,
    invites_needed: Math.max(0, 10 - lifetimeInvites),
    stats: stats.results?.[0] || { total: 0, pending: 0, approved: 0, rejected: 0 },
    activity: activity.results || [],
    withdrawals: userWithdrawals,
    is_demo: false
  };
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
  return { id, status: 'pending', message: 'Report submitted successfully! Your submission is under review and your reward will be credited once approved.' };
}
function campaignData(body) {
  const title = str(body.title, 5, 100);
  const description = str(body.description, 20, 600);
  const gameUrl = str(body.game_url, 10, 500);
  const instructions = str(body.instructions, 20, 1200);
  const questions = Array.isArray(body.questions) && body.questions.length === 3 ? body.questions.map(q => str(q, 10, 200)) : [];
  const capacity = integer(body.capacity, 1, 100000);
  const rewardPoints = positiveNumber(body.reward_points, 0.001, 100000);
  if (!title || !description || !gameUrl || !validHttps(gameUrl) || !instructions || questions.length !== 3 || questions.some(q => !q) || !capacity || rewardPoints === null) {
    throw new AppError('Campaign needs a valid HTTPS game URL, title, description, instructions, three questions, capacity and USDT reward.', 400, 'invalid_campaign');
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
      (SELECT ROUND(COALESCE(SUM(points),0), 4) FROM reward_ledger) AS total_paid_usdt,
      (SELECT ROUND(COALESCE(SUM(points),0), 4) FROM reward_ledger) AS total_paid_bdt,
      (SELECT ROUND(COALESCE(SUM(points),0), 4) FROM reward_ledger) AS demo_points_issued`),
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

async function requestWithdrawal(db, user, body, env) {
  const amount = positiveNumber(body.amount, 10, 1000000);
  if (!amount || amount < 10) throw new AppError('Minimum withdrawal amount is 10 USDT.', 400, 'min_withdrawal');
  const walletAddress = str(body.wallet_address, 15, 120);
  if (!walletAddress) throw new AppError('Enter a valid USDT wallet address (15–120 characters).', 400, 'invalid_wallet');
  const network = (str(body.network, 3, 20) || 'BEP20').toUpperCase();
  if (!['TRC20', 'TON', 'BEP20'].includes(network)) {
    throw new AppError('Supported networks are BEP20 (recommended), TRC20, and TON.', 400, 'invalid_network');
  }

  // If BEP20, validate standard 0x EVM format (42 chars hex)
  if (network === 'BEP20' && !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    throw new AppError('Invalid BEP-20 address. BEP-20 (BNB Smart Chain) addresses must start with 0x and be 42 characters long.', 400, 'invalid_bep20_address');
  }

  // 1. Verify lifetime invite requirement: at least 10 invites required
  const inviteRow = await db.prepare('SELECT COUNT(*) AS total FROM referrals WHERE inviter_id = ?').bind(user.id).first();
  const lifetimeInvites = inviteRow?.total || 0;
  if (lifetimeInvites < 10) {
    throw new AppError(`Withdrawals require at least 10 lifetime invited friends. You currently have ${lifetimeInvites}/10 invites.`, 403, 'invites_required');
  }

  // 2. Check available balance
  const [balanceRow, reservedRow] = await db.batch([
    db.prepare('SELECT ROUND(COALESCE(SUM(points), 0), 4) AS points FROM reward_ledger WHERE user_id = ?').bind(user.id),
    db.prepare("SELECT ROUND(COALESCE(SUM(amount), 0), 4) AS reserved FROM withdrawals WHERE user_id = ? AND status IN ('pending', 'completed')").bind(user.id)
  ]);
  const totalEarned = balanceRow.results?.[0]?.points || 0;
  const reserved = reservedRow.results?.[0]?.reserved || 0;
  const available = Math.max(0, Math.round((totalEarned - reserved) * 10000) / 10000);

  if (available < amount) {
    throw new AppError(`Insufficient available balance. You have ${available.toFixed(2)} USDT available.`, 400, 'insufficient_balance');
  }

  // 3. Insert withdrawal request
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO withdrawals (id, user_id, amount, wallet_address, network, status)
    VALUES (?, ?, ?, ?, ?, 'pending')`).bind(id, user.id, amount, walletAddress, network).run();

  await audit(db, user.id, 'withdrawal.request', id, { amount, wallet: walletAddress, network });
  if (env) {
    void notifyAdminNewWithdrawal(env, user, amount, network, walletAddress).catch(() => {});
  }
  return {
    id,
    amount,
    network,
    wallet_address: walletAddress,
    status: 'pending',
    message: `Withdrawal request for ${amount.toFixed(2)} USDT (${network}) submitted successfully! Processing time: 24–48 hours.`
  };
}

async function getAdminWithdrawals(db) {
  const rows = await db.prepare(`SELECT w.*, u.first_name AS tester_name, u.username,
    (SELECT COUNT(*) FROM referrals r WHERE r.inviter_id = w.user_id) AS lifetime_invites
    FROM withdrawals w JOIN users u ON u.id = w.user_id
    ORDER BY CASE WHEN w.status = 'pending' THEN 0 ELSE 1 END, w.created_at DESC LIMIT 100`).all();
  return rows.results || [];
}

async function reviewWithdrawal(db, actor, id, body, env) {
  const decision = body.decision;
  if (decision !== 'completed' && decision !== 'rejected') {
    throw new AppError('Decision must be completed or rejected.', 400, 'bad_decision');
  }
  const note = str(body.note || '', 0, 400) || '';
  if (decision === 'rejected' && note.length < 5) {
    throw new AppError('Provide a rejection reason for the user.', 400, 'note_required');
  }
  const existing = await db.prepare('SELECT id, status, user_id, amount, network FROM withdrawals WHERE id = ?').bind(id).first();
  if (!existing) throw new AppError('Withdrawal not found.', 404, 'not_found');
  if (existing.status !== 'pending') throw new AppError('Withdrawal already processed.', 409, 'already_processed');

  await db.prepare(`UPDATE withdrawals SET status = ?, admin_note = ?, processed_by = ?, processed_at = datetime('now')
    WHERE id = ? AND status = 'pending'`).bind(decision, note, actor, id).run();

  await audit(db, actor, `withdrawal.${decision}`, id, { note, amount: existing.amount, user_id: existing.user_id });
  if (env?.BOT_TOKEN) {
    void notifyUserWithdrawalStatus(env.BOT_TOKEN, existing.user_id, existing.amount, existing.network, decision, note).catch(() => {});
  }
  return { id, status: decision, message: `Withdrawal ${decision}.` };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : error('not_found', 'Not found.', 404);
    if (request.method === 'OPTIONS') return error('method_not_allowed', 'Not allowed.', 405);
    if ((request.method === 'GET' || request.method === 'HEAD') && path === '/api/health') return respond({ ok: true, version: '1.0.0', platform: 'TaskKit', currency: 'USDT', reward_type: 'usdt_micro_rewards' });
    if (path === '/api/telegram-webhook' && request.method === 'POST') {
      try {
        const update = await request.json();
        if (update?.message?.chat?.id && env.BOT_TOKEN) {
          const chatId = update.message.chat.id;
          const text = update.message.text || '';
          const host = url.origin || 'https://telegram-task-lab-mvp.shahriyarkarimsiam.workers.dev';
          const fromUser = update.message.from;
          if (fromUser && env.DB) {
            await ensureUser(env.DB, { id: String(fromUser.id), first_name: fromUser.first_name || 'User', username: fromUser.username || null });
            const refMatch = text.match(/^\/start\s+(?:ref_)?([0-9a-zA-Z_-]+)/);
            if (refMatch) {
              const inviterId = refMatch[1];
              await recordReferral(env.DB, inviterId, String(fromUser.id), env.BOT_TOKEN);
            }
          }
          let replyText = '👋 <b>Welcome to TaskKit!</b>\n\nTest mobile apps, games, and web services and earn real USDT rewards.\n\n🎮 <b>Featured Project:</b> Play our partner game <b>@mergestakeearn_bot</b> to merge, stake, and earn more daily!\n\nTap below to start earning:';
          let btnText = '🚀 Open TaskKit (Test & Earn USDT)';

          if (text.startsWith('/help')) {
            replyText = 'ℹ️ <b>TaskKit Tester Guidelines</b>\n\n1. Open the Mini App to browse active campaigns.\n2. Follow instructions and test the app/game on your mobile device.\n3. Answer the 3 quality questions with genuine feedback.\n4. Rewards are credited in real USDT upon admin review.\n5. Minimum withdrawal is 10.00 USDT (BEP-20 BNB Smart Chain).\n6. 10 lifetime invites unlock withdrawals permanently!\n\n🎮 <b>Partner Project:</b> Check out <b>@mergestakeearn_bot</b> to merge &amp; stake tokens!\n\nNeed support? Email: trade09siam@gmail.com';
            btnText = '📱 Open TaskKit App';
          } else if (text.startsWith('/tasks')) {
            replyText = '📱 <b>Active Testing Campaigns</b>\n\nNew QA testing slots are available! Test mobile apps, websites, and Web3 games like <b>@mergestakeearn_bot</b> to earn USDT.\n\nTap below to view available tasks:';
            btnText = '📱 View Available Tasks';
          } else if (text.startsWith('/withdraw')) {
            replyText = '💸 <b>USDT Withdrawals (BEP-20)</b>\n\n• Minimum payout: <b>10.00 USDT</b>\n• Network: <b>BNB Smart Chain (BEP-20)</b>\n• Qualification: <b>10 lifetime friends invited</b>\n• Processing: Direct to your 0x... wallet\n\nTap below to check your balance and withdraw:';
            btnText = '💸 Open Withdrawals Page';
          } else if (text.startsWith('/mergestake') || text.startsWith('/game') || text.startsWith('/partner')) {
            replyText = '🎮 <b>MergeStake Earn (@mergestakeearn_bot)</b>\n\nMergeStake is our official partner gaming project where you can:\n\n• 🧩 Merge game assets to level up\n• 💎 Stake crypto tokens for daily yield\n• 💸 Earn and withdraw real money directly in Telegram\n\nTap below to play now:';
            btnText = '🚀 Open TaskKit Hub';
          }

          const tgSendRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: replyText,
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: btnText, web_app: { url: host } }],
                  [{ text: '🎮 Play MergeStake & Earn Money ↗', url: 'https://t.me/mergestakeearn_bot' }]
                ]
              }
            })
          });
          if (!tgSendRes.ok) {
            const errBody = await tgSendRes.text();
            console.error('Telegram sendMessage error:', tgSendRes.status, errBody);
          }
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
      if (request.method === 'POST' && path === '/api/referrals/track') {
        const body = await jsonBody(request);
        const inviterId = body.inviter_id || body.ref;
        const tracked = await recordReferral(env.DB, inviterId, user.id, env.BOT_TOKEN);
        return respond({ ok: true, tracked });
      }
      if (request.method === 'POST' && path === '/api/withdrawals') {
        return respond(await requestWithdrawal(env.DB, user, await jsonBody(request), env), 201);
      }
      if (request.method === 'GET' && path === '/api/withdrawals') {
        const list = await env.DB.prepare(`SELECT id, amount, wallet_address, network, status, admin_note, created_at, processed_at
          FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`).bind(user.id).all();
        return respond({ withdrawals: list.results || [] });
      }
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
        if (request.method === 'GET' && path === '/api/admin/withdrawals') return respond({ withdrawals: await getAdminWithdrawals(env.DB) });
        if (request.method === 'GET' && path === '/api/admin/analytics') return respond(await getAdminAnalytics(env.DB));
        if (request.method === 'GET' && path === '/api/admin/appeals') return respond({ appeals: await getAdminAppeals(env.DB) });
        match = path.match(/^\/api\/admin\/withdrawals\/([a-f0-9-]{36})\/review$/);
        if (match && request.method === 'POST') return respond(await reviewWithdrawal(env.DB, user.id, match[1], await jsonBody(request), env));
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
