const tg = window.Telegram?.WebApp;
try { tg?.ready(); tg?.expand(); } catch { /* Regular browser preview */ }

const $ = (selector) => document.querySelector(selector);
const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const smallText = (value, n=140) => String(value ?? '').length > n ? String(value).slice(0,n-1)+'…' : String(value ?? '');
const state = { view: 'home', me: null, campaigns: [], adminCampaigns: [], reviews: [], appeals: [], adminWithdrawals: [], analytics: null, adminTab: 'campaigns', localKey: null, localUser: '10001', selectedCampaign: null, loading: false };
let toastTimeout;

function formatUsdt(amount) {
  const n = Number(amount || 0);
  if (Number.isNaN(n)) return '0.00';
  if (n % 1 !== 0) {
    const s = n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    const decimals = s.split('.')[1] || '';
    return decimals.length < 2 ? n.toFixed(2) : s;
  }
  return n.toFixed(2);
}

function toast(message, failed = false) {
  const node = $('#toast'); node.textContent = message; node.className = failed ? 'toast error' : 'toast';
  clearTimeout(toastTimeout); toastTimeout = setTimeout(() => node.classList.add('hidden'), 4200);
}
function statusLabel(status, points = 0) {
  if (status === 'pending') return '<span class="pill pending">⏳ Under Review</span>';
  if (status === 'approved') return `<span class="pill approved">✓ Approved (+${formatUsdt(points)} USDT)</span>`;
  if (status === 'completed') return `<span class="pill approved">✓ Paid</span>`;
  if (status === 'rejected') return '<span class="pill rejected">✕ Rejected</span>';
  return `<span class="pill ${safe(status)}">${safe(status)}</span>`;
}
function timeLabel(date) {
  if (!date) return '—';
  const x = new Date(String(date).replace(' ', 'T') + 'Z');
  return Number.isNaN(x.getTime()) ? '—' : x.toLocaleDateString(undefined, {month:'short',day:'numeric',year:'numeric'});
}
async function api(path, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}) };
  if (state.localKey) {
    headers['x-local-dev-key'] = state.localKey;
    headers['x-local-user-id'] = state.localUser;
  } else if (tg?.initData) {
    headers.Authorization = `tma ${tg.initData}`;
  }
  const res = await fetch(`/api/${path}`, { method: options.method || 'GET', headers, cache: 'no-store', ...(options.body ? {body:JSON.stringify(options.body)} : {}) });
  let body;
  try { body = await res.json(); } catch { body = {}; }
  if (!res.ok) throw new Error(body.message || `Request failed (${res.status})`);
  return body;
}
async function refresh() {
  const [me, tasks] = await Promise.all([api('me'), api('campaigns')]);
  state.me = me;
  state.campaigns = tasks.campaigns;
  if (state.selectedCampaign) state.selectedCampaign = state.campaigns.find(c => c.id===state.selectedCampaign.id) || null;
  if (me.user.admin) await refreshAdmin();
  render();
}
async function refreshAdmin() {
  const [campaigns, reviews, appeals, analytics, withdrawals] = await Promise.all([
    api('admin/campaigns'), api('admin/submissions'), api('admin/appeals'), api('admin/analytics'), api('admin/withdrawals')
  ]);
  state.adminCampaigns = campaigns.campaigns;
  state.reviews = reviews.submissions;
  state.appeals = appeals.appeals;
  state.analytics = analytics;
  state.adminWithdrawals = withdrawals.withdrawals || [];
}
function pageHead(title, subtitle, right='') {
  return `<div class="section-head"><div><h2 class="section-title">${safe(title)}</h2><p class="section-sub">${safe(subtitle)}</p></div>${right}</div>`;
}
function taskCard(task) {
  const remaining = Math.max(0, task.capacity - (task.reserved || 0));
  const doneCount = task.completed_count || 0;
  const completed = !!task.my_status;
  let actionButton = '';
  if (completed) {
    actionButton = statusLabel(task.my_status, task.reward_points);
  } else if (remaining <= 0) {
    actionButton = '<span class="pill draft">Slots Full</span>';
  } else {
    actionButton = `<button class="primary-btn" data-open="${safe(task.id)}" style="padding:8px 14px;font-size:11px;">Start Task & Earn ${formatUsdt(task.reward_points)} USDT →</button>`;
  }
  return `<article class="task-card">
    <div class="task-top"><span class="task-icon">📱</span><span class="points-tag" style="background:#e6f8f2;color:#13795b;border:1px solid #a3e6d2;font-size:12px;font-weight:800;">₮ ${formatUsdt(task.reward_points)} USDT</span></div>
    <h3>${safe(task.title)}</h3><p>${safe(smallText(task.description, 175))}</p>
    <div class="task-meta">
      <span>👥 <strong>${doneCount}</strong> completed</span>
      <span>⚡ <strong>${remaining}</strong> / ${task.capacity} slots left</span>
    </div>
    <div class="task-card-footer">
      <span class="task-slots" style="color:#13795b;font-weight:700;">Reward: ${formatUsdt(task.reward_points)} USDT</span>
      ${actionButton}
    </div>
  </article>`;
}
function activityTable(rows) {
  if (!rows?.length) return '<div class="empty-state"><h3>No tasks submitted yet</h3><p>Select any available task from the catalog, test the app, and submit your report to earn real USDT rewards.</p></div>';
  return `<div class="paper table-wrap"><table class="compact-table"><thead><tr><th>Campaign / Task</th><th>Submitted</th><th>Review Status</th><th>Earned</th></tr></thead><tbody>
    ${rows.map(s => {
      let earnedHtml = '—';
      if (s.status === 'approved') earnedHtml = `<strong style="color:#059669;font-size:13px;">+${formatUsdt(s.reward_points)} USDT</strong>`;
      else if (s.status === 'pending') earnedHtml = `<span style="color:#d97706;font-size:12px;">⏳ ${formatUsdt(s.reward_points)} USDT (Pending)</span>`;
      else earnedHtml = `<span style="color:#9ca3af;font-size:12px;">0.00 USDT</span>`;
      return `<tr>
        <td>
          <div class="mini-title">${safe(s.title)}</div>
          ${s.review_note ? `<div class="help-text" style="color:#4b5563;">Review Note: ${safe(s.review_note)}</div>`:''}
          ${s.appeal_status ? `<div class="help-text" style="color:#6b7280;">Appeal: ${safe(s.appeal_status)}${s.appeal_reply ? ` · Admin Reply: ${safe(s.appeal_reply)}`:''}</div>`:''}
          ${s.status==='rejected' && !s.appeal_status ? `<button type="button" class="flat-link" data-appeal-for="${safe(s.id)}" style="color:#dc2626;font-size:11px;font-weight:700;">Appeal rejection →</button>`:''}
        </td>
        <td>${timeLabel(s.created_at)}</td>
        <td>${statusLabel(s.status, s.reward_points)}</td>
        <td>${earnedHtml}</td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`;
}
function partnerSpotlight() {
  return `<div class="partner-card">
    <div class="partner-badge">⭐ FEATURED PARTNER PROJECT</div>
    <div class="partner-content">
      <div class="partner-icon">🎮</div>
      <div style="flex:1;">
        <h3 style="margin:0 0 4px;font-size:16px;color:#ffffff;letter-spacing:-0.2px;">MergeStake Earn (@mergestakeearn_bot)</h3>
        <p style="margin:0 0 14px;font-size:12px;color:#c4b5fd;line-height:1.6;max-width:620px;">
          Play our official partner project to merge game assets, stake crypto tokens, and earn extra money daily directly inside Telegram!
        </p>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
          <button type="button" class="btn-partner-launch" data-tg-link="https://t.me/mergestakeearn_bot">
            <span>🎮 Play @mergestakeearn_bot ↗</span>
          </button>
          <span style="font-size:11px;color:#ddd6fe;font-weight:700;">⚡ Instant Play • Free Web3 Rewards</span>
        </div>
      </div>
    </div>
  </div>`;
}

function homeView() {
  const n = state.me.stats || { total: 0, pending: 0, approved: 0, rejected: 0 };
  const available = state.campaigns.filter(c => !c.my_status && c.capacity > (c.reserved || 0));
  return `<section class="hero"><div class="hero-content"><div class="hero-kicker">₮ VERIFIED MOBILE TESTING & USDT REWARDS</div><h1>Test Client Apps.<br/>Earn Real USDT Rewards.</h1>
    <p>Help top tech startups and global companies test their apps, games, and web services. Complete structured usability tests, share honest feedback reports, and earn USDT for every approved test.</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
      <button class="primary-btn" data-nav="tasks">Browse Available Tasks <span>↗</span></button>
      <button class="btn-withdraw-premium" data-nav="withdraw"><span class="coin-icon">₮</span> Withdraw USDT (${formatUsdt(state.me.available_balance)}) →</button>
    </div></div><div class="hero-shape" aria-hidden="true"></div></section>
    <div class="stats-grid cols-4">
      <div class="stat"><div class="stat-icon" style="background:#e6f8f2;color:#13795b;font-weight:800;font-size:18px;">₮</div><div class="stat-number">${formatUsdt(state.me.available_balance)} USDT</div><div class="stat-label">Available for Withdrawal</div></div>
      <div class="stat"><div class="stat-icon orange" style="background:#e6f8f2;color:#13795b;">✓</div><div class="stat-number">${n.approved || 0}</div><div class="stat-label">Tasks Completed & Paid</div></div>
      <div class="stat"><div class="stat-icon blue">◷</div><div class="stat-number">${n.pending || 0}</div><div class="stat-label">Reports Under Review</div></div>
      <div class="stat"><div class="stat-icon orange">▦</div><div class="stat-number">${available.length}</div><div class="stat-label">Tasks Available to Earn</div></div>
    </div>
    ${partnerSpotlight()}
    ${pageHead('Available Testing Tasks', 'Choose a client project, test the application, and submit your report.', '<button class="section-link" data-nav="tasks">View all tasks →</button>')}
    ${available.length ? `<div class="task-grid">${available.slice(0,4).map(taskCard).join('')}</div>` : '<div class="empty-state"><h3>All Tasks Currently Filled</h3><p>You have tested all available apps or slots are reserved. New client campaigns are added regularly!</p></div>'}
    ${pageHead('Recent Activity & Submissions', 'Your recent test reports and payout status.', '<button class="section-link" data-nav="activity">Full history →</button>')}
    ${activityTable(state.me.activity.slice(0,5))}
    <div class="helper-note" style="margin-top:20px;border-color:#26a17b;background:#e6f8f2;color:#0f5132;"><strong>Guaranteed USDT Rewards:</strong> Every approved test report earns real USDT. Payouts are verified against honest, thoughtful feedback. Follow all instructions carefully to guarantee approval.</div>`;
}
function tasksView() {
  return `${pageHead('Available Testing Tasks', 'Each campaign has a limited user quota. Test according to instructions and submit your report to earn USDT.')}
    ${partnerSpotlight()}
    ${state.campaigns.length ? `<div class="task-grid">${state.campaigns.map(taskCard).join('')}</div>` : '<div class="empty-state"><h3>No active tasks available right now</h3><p>Check back shortly as new client testing campaigns go live.</p></div>'}
    <div class="helper-note" style="margin-top:20px;border-color:#3b82f6;background:#eff6ff;color:#1e40af;"><strong>How It Works:</strong> 1. Click \'Start Task\'. 2. Open the destination app/link and test it thoroughly. 3. Return to submit your structured feedback. 4. Once reviewed and approved, USDT reward is credited directly to your balance.</div>`;
}
function activityView() {
  const s = state.me.stats || { total: 0, pending: 0, approved: 0, rejected: 0 };
  return `${pageHead('My Earnings & Task History', 'Full breakdown of your completed tasks, pending reviews, and earned USDT.', '<button class="btn-withdraw-premium" data-nav="withdraw"><span class="coin-icon">₮</span> Withdraw Funds (' + formatUsdt(state.me.available_balance) + ' USDT) →</button>')}
  <div class="stats-grid" style="margin-bottom:20px">
    <div class="stat"><div class="stat-icon" style="background:#e6f8f2;color:#13795b;font-weight:800;font-size:18px;">₮</div><div class="stat-number">${formatUsdt(state.me.available_balance)} USDT</div><div class="stat-label">Available for Withdrawal</div></div>
    <div class="stat"><div class="stat-icon orange" style="background:#e6f8f2;color:#13795b;">✓</div><div class="stat-number">${s.approved || 0}</div><div class="stat-label">Completed & Paid Tasks</div></div>
    <div class="stat"><div class="stat-icon blue">◷</div><div class="stat-number">${s.pending || 0}</div><div class="stat-label">Reports Under Review</div></div>
  </div>
  ${activityTable(state.me.activity)}
  <div class="helper-note" style="margin-top:20px;border-color:#26a17b;background:#e6f8f2;color:#0f5132;">Rewards are credited in USDT immediately upon review approval. Minimum withdrawal is 10.00 USDT.</div>`;
}

function withdrawView() {
  const canWithdraw = state.me.can_withdraw;
  const invites = state.me.lifetime_invites || 0;
  const needed = Math.max(0, 10 - invites);
  const percent = Math.min(100, Math.round((invites / 10) * 100));
  const botLink = `https://t.me/taskkitio_bot?start=ref_${state.me.user.id}`;
  const halfBalance = (Math.floor(state.me.available_balance * 0.5 * 100) / 100).toFixed(2);

  return `<button class="breadcrumb-button" data-nav="activity">← Back to Earnings</button>
  ${pageHead('Withdraw USDT', 'Request payouts to your verified BEP-20 crypto wallet.')}

  <!-- 1. HERO WALLET BALANCE CARD -->
  <div class="withdraw-hero">
    <div class="withdraw-hero-top">
      <div class="wallet-label">Live Wallet Balance</div>
      <div class="network-pill-tag">🟡 BNB Smart Chain (BEP-20)</div>
    </div>
    <div class="withdraw-hero-amount">
      <span class="usdt-sym">₮</span>
      <span class="big-num">${formatUsdt(state.me.available_balance)}</span>
      <span class="curr-code">USDT</span>
    </div>
    <div class="withdraw-hero-stats">
      <div class="hero-mini-stat">
        <span class="sub-lbl">Minimum Withdrawal</span>
        <span class="sub-val">10.00 USDT</span>
      </div>
      <div class="hero-mini-stat">
        <span class="sub-lbl">Estimated Gas Fee</span>
        <span class="sub-val" style="color:#6ee7b7;">0.00 USDT (Sponsored)</span>
      </div>
      <div class="hero-mini-stat">
        <span class="sub-lbl">Lifetime Qualification</span>
        <span class="sub-val" style="color:${canWithdraw ? '#6ee7b7' : '#fde68a'};">${canWithdraw ? '✓ Active & Unlocked' : `${invites}/10 Invites`}</span>
      </div>
    </div>
  </div>

  <!-- 2. LIFETIME INVITE QUEST CARD (LOCKED) OR VERIFIED BANNER (UNLOCKED) -->
  ${!canWithdraw ? `
    <div class="unlock-quest-card">
      <div class="quest-badge">🔒 Withdrawal Locked</div>
      <h3 class="quest-title">Complete 10 Lifetime Invites to Unlock Withdrawals</h3>
      <p class="quest-desc">
        To qualify for withdrawals, invite at least <strong>10 friends</strong> to TaskKit using your Telegram invite link.
        <strong>This is a one-time lifetime requirement:</strong> once unlocked, your account is permanently qualified for all your 1st, 2nd, and future withdrawals without ever inviting again!
      </p>

      <div class="progress-card">
        <div class="progress-header">
          <span>Invite Progress</span>
          <span style="color:#d97706;font-size:13px;font-weight:850;">${invites} / 10 Friends (${percent}%)</span>
        </div>
        <div class="progress-track-premium">
          <div class="progress-fill-premium" style="width:${percent}%;"></div>
        </div>
        <div class="progress-footer">
          <span>⚡ Need ${needed} more friend(s) to unlock payouts forever</span>
          <span>Lifetime access</span>
        </div>
      </div>

      <div class="share-box-premium">
        <div class="share-box-label">Your Personal Telegram Invite Link</div>
        <div class="share-controls-row">
          <input id="ref-link-input" type="text" readonly value="${botLink}" class="share-link-input" />
          <button type="button" class="btn-copy-ref" id="copy-ref-btn">📋 Copy Link</button>
          <button type="button" class="btn-share-tg" id="share-ref-btn">🚀 Share on Telegram</button>
        </div>
        <div class="perks-list">
          <div class="perk-item"><span>✓</span> Friends click Start in @taskkitio_bot</div>
          <div class="perk-item"><span>✓</span> Instant Telegram alert for each invite</div>
          <div class="perk-item"><span>✓</span> 100% lifetime unlock</div>
        </div>
      </div>
    </div>
  ` : `
    <div class="unlocked-banner">
      <div class="unlocked-shield">✓</div>
      <div>
        <h3 class="unlocked-title">✓ Lifetime Withdrawal Qualification Active</h3>
        <p class="unlocked-desc">You have invited <strong>${invites} friends</strong> (minimum 10 required). Withdrawals are permanently unlocked for your account for all future requests!</p>
      </div>
    </div>
  `}

  <!-- 3. PAYOUT REQUEST FORM -->
  <div class="payout-form-card">
    <h3>Request USDT Withdrawal</h3>
    <div class="form-subtitle">Withdrawals are processed directly to your BEP-20 crypto wallet within 24–48 hours with full BscScan on-chain proof.</div>

    ${canWithdraw ? `
      <form id="withdraw-form">
        <div class="form-grid">
          <div class="field">
            <label for="withdraw-amount">Payout Amount (USDT)</label>
            <div class="input-with-action">
              <input id="withdraw-amount" type="number" step="0.01" min="10" max="${state.me.available_balance}" placeholder="Enter amount (min 10.00 USDT)" required />
              <span class="input-inside-btn" style="pointer-events:none;">USDT</span>
            </div>
            <div class="quick-fill-chips">
              <button type="button" class="quick-chip" data-fill="10">Min (10 USDT)</button>
              ${state.me.available_balance > 10 ? `<button type="button" class="quick-chip" data-fill="${halfBalance}">50% (${halfBalance})</button>` : ''}
              <button type="button" class="quick-chip" data-fill="${state.me.available_balance}">Max (${formatUsdt(state.me.available_balance)} USDT)</button>
            </div>
          </div>

          <div class="field">
            <label for="withdraw-network">Payout Network</label>
            <select id="withdraw-network" required>
              <option value="BEP20" selected>USDT (BEP-20) - BNB Smart Chain (Recommended)</option>
              <option value="TRC20">USDT (TRC-20) - Tron Network</option>
              <option value="TON">USDT (TON) - Telegram Open Network</option>
            </select>
            <div class="network-info-pill">
              <span>🟡</span>
              <div><strong>BNB Smart Chain (BEP-20):</strong> Fastest settlement with network fees sponsored by TaskKit.</div>
            </div>
          </div>

          <div class="field form-full">
            <label for="withdraw-wallet">USDT Wallet Address (BEP-20)</label>
            <div class="input-with-action">
              <input id="withdraw-wallet" type="text" required minlength="15" maxlength="120" placeholder="0x... (Your BEP-20 / EVM address)" />
              <button type="button" class="input-inside-btn" id="paste-wallet-btn">📋 Paste</button>
            </div>
            <div class="help-text">BEP-20 addresses must start with <code>0x</code> and be 42 characters long. Please verify your address carefully.</div>
          </div>
        </div>

        <div class="action-bar" style="margin-top:24px;">
          <button type="submit" class="btn-submit-payout">Submit Withdrawal Request 💸 →</button>
        </div>
      </form>
    ` : `
      <div class="empty-state" style="padding:28px 20px;border-color:#fde68a;background:#fffdf7;">
        <div style="font-size:32px;margin-bottom:8px;">🔒</div>
        <h4 style="margin:0 0 6px;color:#92400e;font-size:15px;font-weight:850;">Withdrawal Form Locked</h4>
        <p style="margin:0;color:#b45309;font-size:12px;line-height:1.6;max-width:440px;margin:0 auto;">
          The payout form will automatically unlock once you complete your 10 lifetime friend invites above.
        </p>
      </div>
    `}
  </div>

  <!-- 4. TRUST & SECURITY CARDS -->
  <div class="trust-grid">
    <div class="trust-card">
      <div class="trust-icon">🛡️</div>
      <div>
        <div class="trust-title">Secure & Validated</div>
        <p class="trust-sub">BEP-20 addresses are validated before submission to prevent loss of funds.</p>
      </div>
    </div>
    <div class="trust-card">
      <div class="trust-icon">⚡</div>
      <div>
        <div class="trust-title">Fast Processing</div>
        <p class="trust-sub">Reviewed by admins and sent to your wallet within 24–48 hours.</p>
      </div>
    </div>
    <div class="trust-card">
      <div class="trust-icon">🔗</div>
      <div>
        <div class="trust-title">On-Chain Proof</div>
        <p class="trust-sub">Each paid withdrawal includes a verifiable BscScan transaction hash.</p>
      </div>
    </div>
  </div>

  <!-- 5. WITHDRAWAL HISTORY -->
  <div class="paper table-wrap">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
      <h3 style="margin:0;">Withdrawal History</h3>
      <span class="help-text">${state.me.withdrawals?.length || 0} total request(s)</span>
    </div>
    ${state.me.withdrawals?.length ? `
      <table class="compact-table">
        <thead><tr><th>Date</th><th>Amount</th><th>Network</th><th>Wallet Address</th><th>Status</th><th>Verification / TX</th></tr></thead>
        <tbody>
          ${state.me.withdrawals.map(w => {
            const cleanNote = (w.admin_note || '').trim();
            const txMatch = cleanNote.match(/(?:TX:\s*)?(0x[a-fA-F0-9]{64})/i);
            let noteHtml = safe(w.admin_note || '—');
            if (txMatch) {
              const hash = txMatch[1];
              const explorerUrl = w.network === 'BEP20'
                ? `https://bscscan.com/tx/${hash}`
                : (w.network === 'TRC20' ? `https://tronscan.org/#/transaction/${hash}` : `https://tonscan.org/tx/${hash}`);
              noteHtml = `<a href="${explorerUrl}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;font-weight:700;text-decoration:underline;">🔗 View on BscScan ↗</a>`;
            }
            const statusBadge = w.status === 'pending'
              ? '<span class="pill pending pulse-pending">⏳ In Review</span>'
              : (w.status === 'completed'
                ? '<span class="pill approved">✓ Paid</span>'
                : '<span class="pill rejected">✕ Rejected</span>');
            return `
            <tr>
              <td>${timeLabel(w.created_at)}</td>
              <td><strong style="color:#059669;font-size:13px;">${formatUsdt(w.amount)} USDT</strong></td>
              <td><span class="pill active" style="font-weight:700;">${safe(w.network)}</span></td>
              <td><code>${safe(w.wallet_address.slice(0,8))}...${safe(w.wallet_address.slice(-6))}</code></td>
              <td>${statusBadge}</td>
              <td>${noteHtml}</td>
            </tr>
          `;}).join('')}
        </tbody>
      </table>
    ` : '<div class="empty-state">No withdrawal requests submitted yet.</div>'}
  </div>`;
}

function detailView() {
  const t = state.selectedCampaign;
  if (!t) { state.view='tasks'; return tasksView(); }
  const remaining = Math.max(0, t.capacity - (t.reserved || 0));
  const doneCount = t.completed_count || 0;
  return `<button class="breadcrumb-button" data-nav="tasks">← Back to Available Tasks</button>
   <div class="task-detail"><div class="paper"><div class="detail-head"><div class="task-icon">📱</div><div><h2>${safe(t.title)}</h2><p>${safe(t.description)}</p></div></div>
    <h3>Step-by-Step Testing Instructions</h3><div class="instructions">${safe(t.instructions)}</div>
    <div class="action-bar"><button type="button" class="primary-btn" data-launch="${safe(t.id)}" ${t.my_status ? 'disabled' : ''} style="background:#2563eb;color:#fff;">↗ Open Application / Website to Test</button></div>
    <p class="help-text">Clicking above records your test launch and opens the client app. Complete the required steps before submitting your feedback report.</p>
    <h3 style="margin-top:28px">Submit Your Feedback Report</h3>
    <p>Answer the client's questions thoroughly based on your real experience. Specific observations ensure quick approval.</p>
    ${t.my_status === 'approved' ? `<div class="helper-note" style="border-color:#26a17b;background:#e6f8f2;color:#0f5132;padding:16px;"><strong>✓ Task Completed & Approved!</strong> You have successfully completed this test and earned <strong>${formatUsdt(t.reward_points)} USDT</strong>.</div>` :
      t.my_status === 'pending' ? `<div class="helper-note" style="border-color:#f59e0b;background:#fffbeb;color:#92400e;padding:16px;"><strong>⏳ Report Under Review:</strong> Your feedback report has been received and is currently being evaluated. Your <strong>${formatUsdt(t.reward_points)} USDT</strong> reward will be credited upon approval.</div>` :
      t.my_status === 'rejected' ? `<div class="helper-note" style="border-color:#ef4444;background:#fef2f2;color:#991b1b;padding:16px;"><strong>✕ Report Rejected:</strong> Your report did not meet the required details. You may file an appeal from your Earnings & History tab.</div>` :
      remaining === 0 ? '<div class="helper-note" style="border-color:#6b7280;background:#f3f4f6;color:#374151;padding:16px;"><strong>Task Quota Full:</strong> All testing slots for this campaign are currently reserved.</div>' :
    `<form id="feedback-form"><div class="field"><label for="device">Device Used for Testing</label><select id="device" required><option value="">Choose your device...</option><option>Android phone</option><option>iPhone</option><option>Desktop browser / PC</option><option>Mac / iPad</option><option>Other device</option></select></div>
     ${[t.question1,t.question2,t.question3].map((q,i)=>`<div class="field"><label for="answer${i+1}">${i+1}. ${safe(q)}</label><textarea id="answer${i+1}" minlength="15" maxlength="1000" required placeholder="Describe what you observed, what worked well, and what had issues..."></textarea></div>`).join('')}
     <div class="action-bar"><button class="primary-btn" type="submit" style="background:#26a17b;color:#fff;font-size:13px;padding:12px 20px;">Submit Report & Earn ${formatUsdt(t.reward_points)} USDT →</button><span class="help-text">Reviewed by quality team within 24h</span></div></form>`}
   </div><aside class="paper details-side"><h3>Task Brief & Reward</h3>
    <div class="info-row"><span>Tester Reward</span><b style="color:#13795b;font-size:14px;">₮ ${formatUsdt(t.reward_points)} USDT</b></div>
    <div class="info-row"><span>Completed So Far</span><b>${doneCount} testers</b></div>
    <div class="info-row"><span>Slots Available</span><b>${remaining} of ${t.capacity} open</b></div>
    <div class="info-row"><span>Verification</span><b>Quality Review (24h)</b></div>
    <div class="info-row"><span>Payout</span><b>Direct to USDT Balance</b></div>
    <p style="margin-top:16px;font-size:11px;color:#6b7280;line-height:1.6;">Please test genuinely and provide thoughtful feedback. Spam or one-word submissions will be rejected to protect client quality.</p></aside></div>`;
}
function adminCampaignRow(c) {
  const next = c.status === 'active' ? 'paused' : 'active';
  return `<tr><td><div class="mini-title">${safe(c.title)}</div><div class="help-text">${safe(c.game_url)}</div></td><td>${statusLabel(c.status)}</td><td><strong>${c.approved || 0}</strong> approved / ${c.capacity} total capacity (${c.reserved || 0} reserved)</td><td>${formatUsdt(c.reward_points)} USDT</td>
  <td><button type="button" class="secondary-btn" data-status-id="${safe(c.id)}" data-status-to="${next}">${next === 'active'?'Activate':'Pause'}</button> <button type="button" class="secondary-btn" data-export-id="${safe(c.id)}">Client CSV (Approved)</button> <button type="button" class="secondary-btn" data-export-id="${safe(c.id)}" data-export-scope="internal">Internal CSV</button></td></tr>`;
}
function adminCampaignView() {
  return `<div class="paper table-wrap"><h3>Client Campaign Manager</h3><p>Manage advertiser & client testing campaigns. Export approved tester feedback CSV for client delivery.</p>
  ${state.adminCampaigns.length ? `<table class="compact-table"><thead><tr><th>Campaign</th><th>Status</th><th>Completed / Capacity</th><th>Payout</th><th>Actions</th></tr></thead><tbody>${state.adminCampaigns.map(adminCampaignRow).join('')}</tbody></table>` : '<div class="empty-state">No campaigns created yet.</div>'}</div>
  <div class="paper" style="margin-top:20px"><h3>Create a New Client Campaign</h3><p>Integrate a client app or website test. Set the capacity and tester reward in USDT (e.g. 1000 users at 0.05 USDT or 1 USDT per approved test).</p>
  <form id="campaign-form"><div class="form-grid">
  <div class="field"><label for="campaign-title">Campaign Title / Project Name</label><input id="campaign-title" required minlength="5" maxlength="100" placeholder="e.g. Test Pathao New Checkout & Payment Flow" /></div>
  <div class="field"><label for="campaign-url">App / Website / Bot Link</label><input id="campaign-url" type="url" required placeholder="https://example.com or https://t.me/app_bot" /></div>
  <div class="field form-full"><label for="campaign-description">Short Project Description</label><textarea id="campaign-description" required minlength="20" maxlength="600" placeholder="Explain what the app is, who the target audience is, and what needs testing..."></textarea></div>
  <div class="field form-full"><label for="campaign-instructions">Step-by-Step Testing Instructions</label><textarea id="campaign-instructions" required minlength="20" maxlength="1200" placeholder="1. Open the application\n2. Complete onboarding\n3. Try searching or ordering\n4. Report any errors, UI glitches, or confusing steps..."></textarea></div>
  <div class="field form-full"><label for="question1">Feedback Question 1</label><input id="question1" required minlength="10" maxlength="200" placeholder="e.g. Did you encounter any bugs, crashes, or lag during use?" /></div>
  <div class="field form-full"><label for="question2">Feedback Question 2</label><input id="question2" required minlength="10" maxlength="200" placeholder="e.g. How intuitive was the design and navigation?" /></div>
  <div class="field form-full"><label for="question3">Feedback Question 3</label><input id="question3" required minlength="10" maxlength="200" placeholder="e.g. What is the single biggest improvement the team should make?" /></div>
  <div class="field"><label for="capacity">Target Tester Capacity (e.g. 1000)</label><input id="capacity" type="number" min="1" max="100000" value="1000" required /></div>
  <div class="field"><label for="reward-points">Tester Payout per Approved Report (USDT)</label><input id="reward-points" type="number" step="0.01" min="0.001" max="100000" value="0.05" required /></div>
  </div><div class="action-bar"><button type="submit" class="primary-btn dark">Create Campaign →</button></div></form></div>`;
}
function adminReviewView() {
  if (!state.reviews.length) return '<div class="empty-state">No tester feedback reports submitted yet.</div>';
  return state.reviews.map(r => `<div class="review-card"><div class="review-head"><div><div class="review-header">${safe(r.campaign_title)} <span style="color:#778fa1;font-weight:500"> · Tester: ${safe(r.tester_name)}</span></div><div class="review-sub">${timeLabel(r.created_at)} · Device: ${safe(r.device)} · Payout: ₮${formatUsdt(r.reward_points)} USDT</div></div>${statusLabel(r.status, r.reward_points)}</div>
  ${r.risk_flags&&r.risk_flags!=='[]'?`<div class="quality-warning">⚑ Review signals: ${safe(JSON.parse(r.risk_flags).map(f=>f.replaceAll('_',' ')).join(' · '))}</div>`:'<div class="quality-clear">✓ Quality signals clear · Ready for evaluation</div>'}
  ${[r.answer1,r.answer2,r.answer3].map((answer,i)=>`<div class="review-label">Question ${i+1}</div><div class="review-answer">${safe(answer)}</div>`).join('')}
  ${r.status === 'pending' ? `<div class="review-actions"><input id="note-${r.id}" maxlength="400" placeholder="Optional approval note; rejection reason required" aria-label="Review note" /><button type="button" class="primary-btn" style="background:#26a17b;" data-review-id="${safe(r.id)}" data-review-as="approved">Approve & Pay ${formatUsdt(r.reward_points)} USDT</button><button type="button" class="danger-btn" data-review-id="${safe(r.id)}" data-review-as="rejected">Reject</button></div>` : `<div class="help-text">Review note: ${safe(r.review_note || 'None')}</div>`}</div>`).join('');
}
function adminWithdrawalView() {
  const gsheetBtn = `<a href="https://docs.google.com/spreadsheets/d/1KTT9hVkFs1ar1TUrAuN8ImzsDwhHOT_9eqDL_wClXJs/edit" target="_blank" rel="noopener noreferrer" class="primary-btn" style="background:#137333;color:#fff;text-decoration:none;font-size:12px;padding:7px 12px;border-radius:6px;display:inline-flex;align-items:center;gap:6px;">📊 Open Google Verification Sheet ↗</a>`;
  if (!state.adminWithdrawals.length) {
    return `<div class="paper"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><h3>USDT Withdrawal Requests</h3>${gsheetBtn}</div><div class="empty-state">No withdrawal requests submitted yet.</div></div>`;
  }
  return `<div class="paper table-wrap">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
      <h3 style="margin:0;">USDT Withdrawal Requests</h3>
      ${gsheetBtn}
    </div>
    <table class="compact-table">
      <thead><tr><th>Tester</th><th>Lifetime Invites</th><th>Amount</th><th>Network & Wallet</th><th>Date</th><th>Status</th><th>Action / TX Note</th></tr></thead>
      <tbody>
        ${state.adminWithdrawals.map(w => {
          const isBep20 = w.network === 'BEP20';
          const explorerAddrUrl = isBep20
            ? `https://bscscan.com/address/${w.wallet_address}`
            : (w.network === 'TRC20' ? `https://tronscan.org/#/address/${w.wallet_address}` : `https://tonscan.org/address/${w.wallet_address}`);
          return `
          <tr>
            <td><strong>${safe(w.tester_name || 'Tester')}</strong><div class="help-text">${w.username ? '@' + safe(w.username) : safe(w.user_id)}</div></td>
            <td><span class="pill ${w.lifetime_invites >= 10 ? 'approved' : 'rejected'}">${w.lifetime_invites} invites</span></td>
            <td><strong style="color:#059669;font-size:13px;">${formatUsdt(w.amount)} USDT</strong></td>
            <td>
              <span class="pill active">${safe(w.network)}</span>
              <div style="font-size:11px;word-break:break-all;margin-top:4px;"><code>${safe(w.wallet_address)}</code></div>
              <div style="display:flex;gap:6px;align-items:center;margin-top:4px;">
                <button type="button" class="flat-link" data-copy-addr="${safe(w.wallet_address)}" style="font-size:10px;padding:2px 6px;">📋 Copy</button>
                <a href="${explorerAddrUrl}" target="_blank" rel="noopener noreferrer" style="font-size:10px;color:#2563eb;text-decoration:underline;">↗ Explorer</a>
              </div>
            </td>
            <td>${timeLabel(w.created_at)}</td>
            <td>${statusLabel(w.status)}</td>
            <td>
              ${w.status === 'pending' ? `
                <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                  <input id="w-note-${w.id}" placeholder="Paste TxID (0x...) or reason" style="padding:6px 8px;font-size:11px;min-width:140px;" />
                  <button type="button" class="primary-btn" style="background:#26a17b;padding:6px 12px;font-size:11px;" data-w-id="${safe(w.id)}" data-w-as="completed">Mark Paid</button>
                  <button type="button" class="danger-btn" style="padding:6px 10px;font-size:11px;" data-w-id="${safe(w.id)}" data-w-as="rejected">Reject</button>
                </div>
              ` : `<span class="help-text">${safe(w.admin_note || 'Processed')}</span>`}
            </td>
          </tr>
        `;}).join('')}
      </tbody>
    </table>
  </div>`;
}
function adminAnalyticsView() {
  const a = state.analytics || {overall:{},campaigns:[],flagged:0,open_appeals:0};
  const n = a.overall || {};
  return `<div class="stats-grid cols-4"><div class="stat"><div class="stat-icon">♙</div><div class="stat-number">${n.total_users||0}</div><div class="stat-label">Registered Testers</div></div>
   <div class="stat"><div class="stat-icon" style="background:#e6f8f2;color:#13795b;font-weight:800;font-size:18px;">₮</div><div class="stat-number">${formatUsdt(n.total_paid_usdt||0)} USDT</div><div class="stat-label">Total Paid to Testers (USDT)</div></div>
   <div class="stat"><div class="stat-icon orange">◷</div><div class="stat-number">${n.submitted||0}</div><div class="stat-label">Reports Submitted</div></div>
   <div class="stat"><div class="stat-icon" style="background:#e6f8f2;color:#13795b;">✓</div><div class="stat-number">${n.approved||0}</div><div class="stat-label">Approved & Paid Reports</div></div></div>
   <div class="paper table-wrap" style="margin-top:20px"><h3>Campaign Performance & Client Export</h3><p>Export clean, client-ready CSV reports containing all approved tester feedback for their applications.</p>
   <table class="compact-table"><thead><tr><th>Campaign</th><th>Submitted</th><th>Approved</th><th>Pending</th><th>Rejected</th><th>Approval Rate</th><th>Client Export</th></tr></thead><tbody>
   ${(a.campaigns||[]).map(c=>`<tr><td class="mini-title">${safe(c.title)}</td><td>${c.submitted}</td><td>${c.approved}</td><td>${c.pending}</td><td>${c.rejected}</td><td>${c.approved+c.rejected?Math.round(100*c.approved/(c.approved+c.rejected))+'%':'—'}</td><td><button class="secondary-btn" data-export-id="${safe(c.id)}">Download CSV</button></td></tr>`).join('')||'<tr><td colspan="7">No campaigns yet.</td></tr>'}
   </tbody></table></div>
   <div class="helper-note" style="margin-top:18px">${a.flagged||0} reports have automated review signals and ${a.open_appeals||0} appeals need attention. A total of ${formatUsdt(n.total_paid_usdt||0)} USDT in micro-rewards has been disbursed.</div>`;
}
function adminAppealsView() {
  if (!state.appeals.length) return '<div class="empty-state">No report disputes or appeals yet.</div>';
  return state.appeals.map(a=>`<div class="review-card"><div class="review-head"><div><div class="review-header">${safe(a.campaign_title)}</div><div class="review-sub">Tester: ${safe(a.tester_name)} · ${timeLabel(a.created_at)}</div></div>${statusLabel(a.status)}</div>
  <div class="review-label">Tester explanation</div><div class="review-answer">${safe(a.reason)}</div>
  ${a.status==='open'?`<div class="review-actions"><input id="appeal-reply-${safe(a.id)}" maxlength="800" placeholder="Explain your decision (10–800 characters)"/><button type="button" class="primary-btn" data-answer-appeal="${safe(a.id)}">Send reply</button></div>`:`<div class="review-label">Admin response</div><div class="review-answer">${safe(a.admin_reply||'')}</div>`}</div>`).join('');
}
function adminView() {
  if (!state.me.user.admin) { state.view='home';return homeView(); }
  const pending=state.reviews.filter(r=>r.status==='pending').length;
  const pendingWithdrawals=state.adminWithdrawals.filter(w=>w.status==='pending').length;
  return `${pageHead('Admin Studio', 'Manage client testing campaigns, review tester feedback, and analyze metrics.')}
    <div class="stats-grid"><div class="stat"><div class="stat-icon">▦</div><div class="stat-number">${state.adminCampaigns.length}</div><div class="stat-label">Active Campaigns</div></div><div class="stat"><div class="stat-icon blue">◷</div><div class="stat-number">${pending}</div><div class="stat-label">Awaiting Review</div></div><div class="stat"><div class="stat-icon orange" style="background:#e6f8f2;color:#13795b;">₮</div><div class="stat-number">${pendingWithdrawals}</div><div class="stat-label">Pending Withdrawals</div></div></div>
    <div class="admin-tabs"><button class="admin-tab ${state.adminTab==='campaigns'?'active':''}" data-admin-tab="campaigns">Campaigns</button><button class="admin-tab ${state.adminTab==='reviews'?'active':''}" data-admin-tab="reviews">Feedback Reviews (${pending})</button><button class="admin-tab ${state.adminTab==='withdrawals'?'active':''}" data-admin-tab="withdrawals">Withdrawals (${pendingWithdrawals})</button><button class="admin-tab ${state.adminTab==='analytics'?'active':''}" data-admin-tab="analytics">Analytics & Reports</button><button class="admin-tab ${state.adminTab==='appeals'?'active':''}" data-admin-tab="appeals">Appeals (${state.appeals.filter(a=>a.status==='open').length})</button></div>
    ${state.adminTab==='campaigns'?adminCampaignView():state.adminTab==='reviews'?adminReviewView():state.adminTab==='withdrawals'?adminWithdrawalView():state.adminTab==='analytics'?adminAnalyticsView():adminAppealsView()}`;
}
function appealView() {
  const item=state.me.activity.find(r=>r.id===state.appealFor&&r.status==='rejected'&&!r.appeal_status);
  if(!item)return '<div class="empty-state">This report is not eligible for an appeal.</div>';
  return `<button class="breadcrumb-button" data-nav="activity">← Back to activity</button><div class="paper"><h3>Appeal Rejected Report</h3><p>${safe(item.title)} · Explain the steps you took to test the application. Our team will review your explanation.</p><form id="appeal-form"><div class="field"><label for="appeal-reason">Why should this report be reconsidered?</label><textarea id="appeal-reason" required minlength="20" maxlength="1000" placeholder="Explain the specific steps you completed and why you believe the rejection was mistaken..."></textarea></div><div class="action-bar"><button type="submit" class="primary-btn">Submit Appeal →</button></div></form></div>`;
}
function render() {
  if (!state.me) return;
  const labels={home:'Dashboard',tasks:'Available Tasks',activity:'Earnings & History',withdraw:'Withdraw USDT',admin:'Admin Studio',detail:'Task Details',appeal:'Appeal Report'};
  const page=labels[state.view] || 'Dashboard';
  $('#breadcrumb').textContent=`WORKSPACE / ${page.toUpperCase()}`;
  $('#page-label').textContent=state.view==='home' ? `Welcome, ${state.me.user.first_name}` : page;
  $('#header-points').textContent=formatUsdt(state.me.available_balance ?? state.me.points);
  $('#avatar').textContent=state.me.user.first_name.charAt(0).toUpperCase();
  document.querySelectorAll('.admin-nav').forEach(el=>el.classList.toggle('hidden',!state.me.user.admin));
  document.querySelectorAll('[data-nav]').forEach(el=>el.classList.toggle('active',el.dataset.nav===state.view||(state.view==='detail'&&el.dataset.nav==='tasks')||(state.view==='withdraw'&&el.dataset.nav==='activity')));
  const views={home:homeView,tasks:tasksView,activity:activityView,withdraw:withdrawView,detail:detailView,admin:adminView,appeal:appealView};
  $('#app-view').innerHTML=(views[state.view]||homeView)();
}
function navigate(view) { if (view==='admin' && !state.me.user.admin) return; state.view=view; render(); window.scrollTo({top:0,behavior:'instant'}); }
function openTest(id) { state.selectedCampaign=state.campaigns.find(c=>c.id===id); if(state.selectedCampaign){state.view='detail';render();window.scrollTo(0,0);} }
function launchLink(id) {
  const task=state.campaigns.find(c=>c.id===id);
  if (!task) return;
  let url; try { url = new URL(task.game_url); } catch { return; }
  if (url.protocol!=='https:') return;
  void api(`campaigns/${id}/launch`,{method:'POST',body:{}}).catch(e=>toast('Could not record launch: '+e.message,true));
  try {
    if (tg && url.hostname==='t.me') tg.openTelegramLink(url.href);
    else if (tg?.openLink) tg.openLink(url.href);
    else window.open(url.href,'_blank','noopener,noreferrer');
  } catch { window.open(url.href,'_blank','noopener,noreferrer'); }
}
async function downloadCampaignCsv(id, scope = 'approved') {
  try {
    const headers = {};
    if (state.localKey) { headers['x-local-dev-key']=state.localKey;headers['x-local-user-id']=state.localUser; }
    else if (tg?.initData) headers.Authorization=`tma ${tg.initData}`;
    const response=await fetch(`/api/admin/campaigns/${id}/report.csv${scope==='internal'?'?scope=internal':''}`,{headers,cache:'no-store'});
    if(!response.ok){ const err=await response.json();throw new Error(err.message || 'Export failed'); }
    const blob=await response.blob(), url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url;a.download=`taskkit-${id}-${scope}.csv`;document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  } catch(error){toast(error.message,true);}
}
async function mutate(path, body, success, method='POST') {
  if (state.loading) return;
  state.loading=true;
  try { await api(path,{method,body});await refresh();toast(success);return true; }
  catch(e){toast(e.message,true);return false;} finally{state.loading=false;}
}

document.addEventListener('click', async (e)=>{
  const button=e.target.closest('button');if(!button)return;
  if(button.dataset.nav){navigate(button.dataset.nav);return;}
  if(button.dataset.open){openTest(button.dataset.open);return;}
  if(button.dataset.launch){launchLink(button.dataset.launch);return;}
  if(button.dataset.tgLink){
    const link = button.dataset.tgLink;
    try {
      if (tg?.openTelegramLink) tg.openTelegramLink(link);
      else window.open(link, '_blank');
    } catch { window.open(link, '_blank'); }
    return;
  }
  if(button.dataset.fill){
    const input = $('#withdraw-amount');
    if (input) input.value = button.dataset.fill;
    return;
  }
  if(button.id === 'copy-ref-btn'){
    const input = $('#ref-link-input');
    if (input) {
      input.select();
      navigator.clipboard?.writeText(input.value);
      toast('Invite link copied to clipboard!');
    }
    return;
  }
  if(button.id === 'paste-wallet-btn'){
    if (navigator.clipboard?.readText) {
      navigator.clipboard.readText().then(text => {
        const walletInput = $('#withdraw-wallet');
        if (walletInput && text) {
          walletInput.value = text.trim();
          toast('Wallet address pasted!');
        }
      }).catch(() => toast('Please paste your address manually.', true));
    } else {
      toast('Please paste your address manually.', true);
    }
    return;
  }
  if(button.dataset.copyAddr){
    const addr = button.dataset.copyAddr;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(addr).then(() => toast('Wallet address copied!')).catch(() => toast(`Address: ${addr}`));
    } else {
      toast(`Address: ${addr}`);
    }
    return;
  }
  if(button.id === 'share-ref-btn'){
    const link = `https://t.me/taskkitio_bot?start=ref_${state.me.user.id}`;
    const text = `Join me on TaskKit and earn real USDT by testing apps & games! 💸`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    try {
      if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl);
      else window.open(shareUrl, '_blank');
    } catch { window.open(shareUrl, '_blank'); }
    return;
  }
  if(button.dataset.exportId){await downloadCampaignCsv(button.dataset.exportId,button.dataset.exportScope || 'approved');return;}
  if(button.dataset.appealFor){state.appealFor=button.dataset.appealFor;state.view='appeal';render();return;}
  if(button.dataset.answerAppeal){const id=button.dataset.answerAppeal,reply=$(`#appeal-reply-${id}`)?.value||'';await mutate(`admin/appeals/${id}/answer`,{reply},'Reply saved and shown to tester.');return;}
  if(button.dataset.adminTab){state.adminTab=button.dataset.adminTab;render();return;}
  if(button.dataset.statusId){
    const id=button.dataset.statusId, status=button.dataset.statusTo;
    if (status==='active' && !confirm('Activate this client campaign for testers?')) return;
    await mutate(`admin/campaigns/${id}/status`,{status},'Campaign updated.');return;
  }
  if(button.dataset.reviewId){
    const id=button.dataset.reviewId, decision=button.dataset.reviewAs;
    const note=document.getElementById(`note-${id}`)?.value.trim()||'';
    if(decision==='rejected'&&note.length<8){toast('Enter a clear rejection reason (at least 8 characters).',true);return;}
    await mutate(`admin/submissions/${id}/review`,{decision,note},`Report ${decision}.`);return;
  }
  if(button.dataset.wId){
    const id=button.dataset.wId, decision=button.dataset.wAs;
    const note=document.getElementById(`w-note-${id}`)?.value.trim()||'';
    if(decision==='rejected'&&note.length<5){toast('Enter a rejection reason for the user.',true);return;}
    await mutate(`admin/withdrawals/${id}/review`,{decision,note},`Withdrawal ${decision}.`);return;
  }
});
document.addEventListener('submit',async(e)=>{
  if(e.target.id==='feedback-form'){
    e.preventDefault();if(!state.selectedCampaign)return;
    const id=state.selectedCampaign.id;
    await mutate(`campaigns/${id}/submissions`,{
      device:$('#device').value,answer1:$('#answer1').value,answer2:$('#answer2').value,answer3:$('#answer3').value,
    },'Feedback report submitted successfully! Awaiting review.');
    const replacement=state.campaigns.find(c=>c.id===id);state.selectedCampaign=replacement;if(state.view==='detail')render();
  }
  if(e.target.id==='appeal-form'){
    e.preventDefault();const saved=await mutate(`submissions/${state.appealFor}/appeal`,{reason:$('#appeal-reason').value},'Your appeal has been sent.');if(saved){state.view='activity';render();}return;
  }
  if(e.target.id==='withdraw-form'){
    e.preventDefault();
    const amount = Number($('#withdraw-amount').value);
    const network = $('#withdraw-network').value;
    const wallet_address = $('#withdraw-wallet').value.trim();
    const ok = await mutate('withdrawals', { amount, network, wallet_address }, 'Withdrawal request submitted! Processing time: 24–48 hours.');
    if (ok) { state.view = 'withdraw'; render(); }
    return;
  }
  if(e.target.id==='campaign-form'){
    e.preventDefault();
    const body={title:$('#campaign-title').value,game_url:$('#campaign-url').value,
      description:$('#campaign-description').value,instructions:$('#campaign-instructions').value,
      questions:[1,2,3].map(n=>$(`#question${n}`).value),capacity:Number($('#capacity').value),reward_points:Number($('#reward-points').value)};
    await mutate('admin/campaigns',body,'Campaign created. Activate it when ready.');
  }
});
$('#demo-user-select').addEventListener('change',async e=>{
  state.localUser=e.target.value;state.view='home';state.selectedCampaign=null;
  try{await refresh();}catch(err){toast(err.message,true);}
});

async function boot() {
  try{
    if (['localhost','127.0.0.1'].includes(location.hostname)) {
      const result=await fetch('/__local_session',{cache:'no-store'});
      if(result.ok){const local=await result.json();if(local.devKey){state.localKey=local.devKey;$('#local-controls').classList.remove('hidden');}}
    }
    if(!state.localKey && !tg?.initData){
      $('#app-view').innerHTML='<div class="empty-state"><h2>Open TaskKit inside Telegram</h2><p>This application is a Telegram Mini App and requires a signed Telegram session.</p><div style="margin-top:20px"><a href="https://t.me/taskkitio_bot" class="primary-btn" style="display:inline-block;text-decoration:none;padding:12px 24px;color:#fff;background:#2563eb;border-radius:8px;font-weight:600;">Open @taskkitio_bot in Telegram ↗</a></div></div>';
      return;
    }
    // Track referral deep link if launched via startapp=ref_...
    if (tg?.initDataUnsafe?.start_param) {
      void api('referrals/track', { method: 'POST', body: { ref: tg.initDataUnsafe.start_param } }).catch(() => {});
    }
    await refresh();
  }catch(error){
    $('#app-view').innerHTML=`<div class="empty-state"><h2>Cannot load the application</h2><p>${safe(error.message)}</p><p>Check your connection, Telegram session, and database configuration.</p><div style="margin-top:18px"><button type="button" class="primary-btn" id="retry-btn">↻ Retry / Reload</button></div></div>`;
    $('#retry-btn')?.addEventListener('click', () => { location.reload(); });
  }
}
boot();
