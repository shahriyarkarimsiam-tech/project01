const tg = window.Telegram?.WebApp;
try { tg?.ready(); tg?.expand(); } catch { /* Regular browser preview */ }

const $ = (selector) => document.querySelector(selector);
const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const smallText = (value, n=140) => String(value ?? '').length > n ? String(value).slice(0,n-1)+'…' : String(value ?? '');
const state = { view: 'home', me: null, campaigns: [], adminCampaigns: [], reviews: [], appeals: [], analytics: null, adminTab: 'campaigns', localKey: null, localUser: '10001', selectedCampaign: null, loading: false };
let toastTimeout;
function toast(message, failed = false) {
  const node = $('#toast'); node.textContent = message; node.className = failed ? 'toast error' : 'toast';
  clearTimeout(toastTimeout); toastTimeout = setTimeout(() => node.classList.add('hidden'), 4200);
}
function statusLabel(status, points = 0) {
  if (status === 'pending') return '<span class="pill pending">⏳ Under Review</span>';
  if (status === 'approved') return `<span class="pill approved">✓ Approved (+৳${points || 5} BDT)</span>`;
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
  const [campaigns, reviews, appeals, analytics] = await Promise.all([api('admin/campaigns'), api('admin/submissions'), api('admin/appeals'), api('admin/analytics')]);
  state.adminCampaigns = campaigns.campaigns; state.reviews = reviews.submissions; state.appeals = appeals.appeals; state.analytics=analytics;
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
    actionButton = `<button class="primary-btn" data-open="${safe(task.id)}" style="padding:8px 14px;font-size:11px;">Start Task & Earn ৳${task.reward_points} →</button>`;
  }
  return `<article class="task-card">
    <div class="task-top"><span class="task-icon">📱</span><span class="points-tag" style="background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;font-size:12px;font-weight:800;">৳ ${task.reward_points} BDT</span></div>
    <h3>${safe(task.title)}</h3><p>${safe(smallText(task.description, 175))}</p>
    <div class="task-meta">
      <span>👥 <strong>${doneCount}</strong> completed</span>
      <span>⚡ <strong>${remaining}</strong> / ${task.capacity} slots left</span>
    </div>
    <div class="task-card-footer">
      <span class="task-slots" style="color:#059669;font-weight:700;">Reward: ৳${task.reward_points} BDT</span>
      ${actionButton}
    </div>
  </article>`;
}
function activityTable(rows) {
  if (!rows?.length) return '<div class="empty-state"><h3>No tasks submitted yet</h3><p>Select any available task from the catalog, test the app, and submit your report to earn real BDT rewards.</p></div>';
  return `<div class="paper table-wrap"><table class="compact-table"><thead><tr><th>Campaign / Task</th><th>Submitted</th><th>Review Status</th><th>Earned</th></tr></thead><tbody>
    ${rows.map(s => {
      let earnedHtml = '—';
      if (s.status === 'approved') earnedHtml = `<strong style="color:#059669;font-size:13px;">+৳ ${s.reward_points} BDT</strong>`;
      else if (s.status === 'pending') earnedHtml = `<span style="color:#d97706;font-size:12px;">⏳ ৳ ${s.reward_points} (Pending)</span>`;
      else earnedHtml = `<span style="color:#9ca3af;font-size:12px;">৳ 0 BDT</span>`;
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
function homeView() {
  const n = state.me.stats || { total: 0, pending: 0, approved: 0, rejected: 0 };
  const available = state.campaigns.filter(c => !c.my_status && c.capacity > (c.reserved || 0));
  return `<section class="hero"><div class="hero-content"><div class="hero-kicker">৳ VERIFIED MOBILE TESTING & MICRO-REWARDS</div><h1>Test Client Apps.<br/>Earn Real BDT Rewards.</h1>
    <p>Help top tech startups and companies in Bangladesh test their apps and websites. Complete structured usability tests, share honest feedback reports, and earn BDT for every approved test.</p>
    <button class="primary-btn" data-nav="tasks">Browse Available Tasks <span>↗</span></button></div><div class="hero-shape" aria-hidden="true"></div></section>
    <div class="stats-grid cols-4">
      <div class="stat"><div class="stat-icon" style="background:#ecfdf5;color:#059669;font-weight:800;">৳</div><div class="stat-number">৳ ${state.me.points}</div><div class="stat-label">Total Real Earnings (BDT)</div></div>
      <div class="stat"><div class="stat-icon orange" style="background:#ecfdf5;color:#059669;">✓</div><div class="stat-number">${n.approved || 0}</div><div class="stat-label">Tasks Completed & Paid</div></div>
      <div class="stat"><div class="stat-icon blue">◷</div><div class="stat-number">${n.pending || 0}</div><div class="stat-label">Reports Under Review</div></div>
      <div class="stat"><div class="stat-icon orange">▦</div><div class="stat-number">${available.length}</div><div class="stat-label">Tasks Available to Earn</div></div>
    </div>
    ${pageHead('Available Testing Tasks', 'Choose a client project, test the application, and submit your report.', '<button class="section-link" data-nav="tasks">View all tasks →</button>')}
    ${available.length ? `<div class="task-grid">${available.slice(0,4).map(taskCard).join('')}</div>` : '<div class="empty-state"><h3>All Tasks Currently Filled</h3><p>You have tested all available apps or slots are reserved. New client campaigns are added regularly!</p></div>'}
    ${pageHead('Recent Activity & Submissions', 'Your recent test reports and payout status.', '<button class="section-link" data-nav="activity">Full history →</button>')}
    ${activityTable(state.me.activity.slice(0,5))}
    <div class="helper-note" style="margin-top:20px;border-color:#10b981;background:#ecfdf5;color:#065f46;"><strong>Guaranteed Micro-Rewards:</strong> Every approved test report earns real BDT. Payouts are verified against honest, thoughtful feedback. Follow all instructions carefully to guarantee approval.</div>`;
}
function tasksView() {
  return `${pageHead('Available Testing Tasks', 'Each campaign has a limited user quota. Test according to instructions and submit your report to earn BDT.')}
    ${state.campaigns.length ? `<div class="task-grid">${state.campaigns.map(taskCard).join('')}</div>` : '<div class="empty-state"><h3>No active tasks available right now</h3><p>Check back shortly as new advertiser and startup testing campaigns go live.</p></div>'}
    <div class="helper-note" style="margin-top:20px;border-color:#3b82f6;background:#eff6ff;color:#1e40af;"><strong>How It Works:</strong> 1. Click 'Start Task'. 2. Open the destination app/link and test it thoroughly. 3. Return to submit your structured feedback. 4. Once reviewed and approved, ৳5 BDT is credited to your balance.</div>`;
}
function activityView() {
  const s = state.me.stats || { total: 0, pending: 0, approved: 0, rejected: 0 };
  return `${pageHead('My Earnings & Task History', 'Full breakdown of your completed tasks, pending reviews, and earned money.')}
  <div class="stats-grid" style="margin-bottom:20px">
    <div class="stat"><div class="stat-icon" style="background:#ecfdf5;color:#059669;font-weight:800;">৳</div><div class="stat-number">৳ ${state.me.points}</div><div class="stat-label">Total Earned (BDT)</div></div>
    <div class="stat"><div class="stat-icon orange" style="background:#ecfdf5;color:#059669;">✓</div><div class="stat-number">${s.approved || 0}</div><div class="stat-label">Completed & Paid Tasks</div></div>
    <div class="stat"><div class="stat-icon blue">◷</div><div class="stat-number">${s.pending || 0}</div><div class="stat-label">Reports Under Review</div></div>
  </div>
  ${activityTable(state.me.activity)}
  <div class="helper-note" style="margin-top:20px;border-color:#10b981;background:#ecfdf5;color:#065f46;">Rewards are credited in Bangladeshi Taka (BDT) immediately upon review approval. If a report is rejected due to lack of detail, you can submit an appeal explaining your testing steps.</div>`;
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
    ${t.my_status === 'approved' ? `<div class="helper-note" style="border-color:#10b981;background:#ecfdf5;color:#065f46;padding:16px;"><strong>✓ Task Completed & Approved!</strong> You have successfully completed this test and earned <strong>৳ ${t.reward_points} BDT</strong>.</div>` :
      t.my_status === 'pending' ? `<div class="helper-note" style="border-color:#f59e0b;background:#fffbeb;color:#92400e;padding:16px;"><strong>⏳ Report Under Review:</strong> Your feedback report has been received and is currently being evaluated. Your <strong>৳ ${t.reward_points} BDT</strong> reward will be credited upon approval.</div>` :
      t.my_status === 'rejected' ? `<div class="helper-note" style="border-color:#ef4444;background:#fef2f2;color:#991b1b;padding:16px;"><strong>✕ Report Rejected:</strong> Your report did not meet the required details. You may file an appeal from your Earnings & History tab.</div>` :
      remaining === 0 ? '<div class="helper-note" style="border-color:#6b7280;background:#f3f4f6;color:#374151;padding:16px;"><strong>Task Quota Full:</strong> All testing slots for this campaign are currently reserved.</div>' :
    `<form id="feedback-form"><div class="field"><label for="device">Device Used for Testing</label><select id="device" required><option value="">Choose your device...</option><option>Android phone</option><option>iPhone</option><option>Desktop browser / PC</option><option>Mac / iPad</option><option>Other device</option></select></div>
     ${[t.question1,t.question2,t.question3].map((q,i)=>`<div class="field"><label for="answer${i+1}">${i+1}. ${safe(q)}</label><textarea id="answer${i+1}" minlength="15" maxlength="1000" required placeholder="Describe what you observed, what worked well, and what had issues..."></textarea></div>`).join('')}
     <div class="action-bar"><button class="primary-btn" type="submit" style="background:#10b981;color:#fff;font-size:13px;padding:12px 20px;">Submit Report & Earn ৳${t.reward_points} BDT →</button><span class="help-text">Reviewed by quality team within 24h</span></div></form>`}
   </div><aside class="paper details-side"><h3>Task Brief & Reward</h3>
    <div class="info-row"><span>Tester Reward</span><b style="color:#059669;font-size:14px;">৳ ${t.reward_points} BDT</b></div>
    <div class="info-row"><span>Completed So Far</span><b>${doneCount} testers</b></div>
    <div class="info-row"><span>Slots Available</span><b>${remaining} of ${t.capacity} open</b></div>
    <div class="info-row"><span>Verification</span><b>Quality Review (24h)</b></div>
    <div class="info-row"><span>Payout</span><b>Direct to Balance</b></div>
    <p style="margin-top:16px;font-size:11px;color:#6b7280;line-height:1.6;">Please test genuinely and provide thoughtful feedback. Spam or one-word submissions will be rejected to protect client quality.</p></aside></div>`;
}
function adminCampaignRow(c) {
  const next = c.status === 'active' ? 'paused' : 'active';
  return `<tr><td><div class="mini-title">${safe(c.title)}</div><div class="help-text">${safe(c.game_url)}</div></td><td>${statusLabel(c.status)}</td><td><strong>${c.approved || 0}</strong> approved / ${c.capacity} total capacity (${c.reserved || 0} reserved)</td><td>৳ ${c.reward_points} BDT</td>
  <td><button type="button" class="secondary-btn" data-status-id="${safe(c.id)}" data-status-to="${next}">${next === 'active'?'Activate':'Pause'}</button> <button type="button" class="secondary-btn" data-export-id="${safe(c.id)}">Client CSV (Approved)</button> <button type="button" class="secondary-btn" data-export-id="${safe(c.id)}" data-export-scope="internal">Internal CSV</button></td></tr>`;
}
function adminCampaignView() {
  return `<div class="paper table-wrap"><h3>Client Campaign Manager</h3><p>Manage advertiser & client testing campaigns. Export approved tester feedback CSV for client delivery.</p>
  ${state.adminCampaigns.length ? `<table class="compact-table"><thead><tr><th>Campaign</th><th>Status</th><th>Completed / Capacity</th><th>Payout</th><th>Actions</th></tr></thead><tbody>${state.adminCampaigns.map(adminCampaignRow).join('')}</tbody></table>` : '<div class="empty-state">No campaigns created yet.</div>'}</div>
  <div class="paper" style="margin-top:20px"><h3>Create a New Client Campaign</h3><p>Integrate a client app or website test. Set the capacity and tester reward (e.g. 1000 users at 5 BDT per approved test).</p>
  <form id="campaign-form"><div class="form-grid">
  <div class="field"><label for="campaign-title">Campaign Title / Project Name</label><input id="campaign-title" required minlength="5" maxlength="100" placeholder="e.g. Test Pathao New Checkout & Payment Flow" /></div>
  <div class="field"><label for="campaign-url">App / Website / Bot Link</label><input id="campaign-url" type="url" required placeholder="https://example.com or https://t.me/app_bot" /></div>
  <div class="field form-full"><label for="campaign-description">Short Project Description</label><textarea id="campaign-description" required minlength="20" maxlength="600" placeholder="Explain what the app is, who the target audience is, and what needs testing..."></textarea></div>
  <div class="field form-full"><label for="campaign-instructions">Step-by-Step Testing Instructions</label><textarea id="campaign-instructions" required minlength="20" maxlength="1200" placeholder="1. Open the application\n2. Complete onboarding\n3. Try searching or ordering\n4. Report any errors, UI glitches, or confusing steps..."></textarea></div>
  <div class="field form-full"><label for="question1">Feedback Question 1</label><input id="question1" required minlength="10" maxlength="200" placeholder="e.g. Did you encounter any bugs, crashes, or lag during use?" /></div>
  <div class="field form-full"><label for="question2">Feedback Question 2</label><input id="question2" required minlength="10" maxlength="200" placeholder="e.g. How intuitive was the design and navigation?" /></div>
  <div class="field form-full"><label for="question3">Feedback Question 3</label><input id="question3" required minlength="10" maxlength="200" placeholder="e.g. What is the single biggest improvement the team should make?" /></div>
  <div class="field"><label for="capacity">Target Tester Capacity (e.g. 1000)</label><input id="capacity" type="number" min="1" max="100000" value="1000" required /></div>
  <div class="field"><label for="reward-points">Tester Payout per Approved Report (BDT)</label><input id="reward-points" type="number" min="1" max="1000" value="5" required /></div>
  </div><div class="action-bar"><button type="submit" class="primary-btn dark">Create Campaign →</button></div></form></div>`;
}
function adminReviewView() {
  if (!state.reviews.length) return '<div class="empty-state">No tester feedback reports submitted yet.</div>';
  return state.reviews.map(r => `<div class="review-card"><div class="review-head"><div><div class="review-header">${safe(r.campaign_title)} <span style="color:#778fa1;font-weight:500"> · Tester: ${safe(r.tester_name)}</span></div><div class="review-sub">${timeLabel(r.created_at)} · Device: ${safe(r.device)} · Payout: ৳${r.reward_points} BDT</div></div>${statusLabel(r.status, r.reward_points)}</div>
  ${r.risk_flags&&r.risk_flags!=='[]'?`<div class="quality-warning">⚑ Review signals: ${safe(JSON.parse(r.risk_flags).map(f=>f.replaceAll('_',' ')).join(' · '))}</div>`:'<div class="quality-clear">✓ Quality signals clear · Ready for evaluation</div>'}
  ${[r.answer1,r.answer2,r.answer3].map((answer,i)=>`<div class="review-label">Question ${i+1}</div><div class="review-answer">${safe(answer)}</div>`).join('')}
  ${r.status === 'pending' ? `<div class="review-actions"><input id="note-${r.id}" maxlength="400" placeholder="Optional approval note; rejection reason required" aria-label="Review note" /><button type="button" class="primary-btn" style="background:#10b981;" data-review-id="${safe(r.id)}" data-review-as="approved">Approve & Pay ৳${r.reward_points} BDT</button><button type="button" class="danger-btn" data-review-id="${safe(r.id)}" data-review-as="rejected">Reject</button></div>` : `<div class="help-text">Review note: ${safe(r.review_note || 'None')}</div>`}</div>`).join('');
}
function adminAnalyticsView() {
  const a = state.analytics || {overall:{},campaigns:[],flagged:0,open_appeals:0};
  const n = a.overall || {};
  return `<div class="stats-grid cols-4"><div class="stat"><div class="stat-icon">♙</div><div class="stat-number">${n.total_users||0}</div><div class="stat-label">Registered Testers</div></div>
   <div class="stat"><div class="stat-icon" style="background:#ecfdf5;color:#059669;font-weight:800;">৳</div><div class="stat-number">৳ ${n.total_paid_bdt||0}</div><div class="stat-label">Total Paid to Testers (BDT)</div></div>
   <div class="stat"><div class="stat-icon orange">◷</div><div class="stat-number">${n.submitted||0}</div><div class="stat-label">Reports Submitted</div></div>
   <div class="stat"><div class="stat-icon" style="background:#ecfdf5;color:#059669;">✓</div><div class="stat-number">${n.approved||0}</div><div class="stat-label">Approved & Paid Reports</div></div></div>
   <div class="paper table-wrap" style="margin-top:20px"><h3>Campaign Performance & Client Export</h3><p>Export clean, client-ready CSV reports containing all approved tester feedback for their applications.</p>
   <table class="compact-table"><thead><tr><th>Campaign</th><th>Submitted</th><th>Approved</th><th>Pending</th><th>Rejected</th><th>Approval Rate</th><th>Client Export</th></tr></thead><tbody>
   ${(a.campaigns||[]).map(c=>`<tr><td class="mini-title">${safe(c.title)}</td><td>${c.submitted}</td><td>${c.approved}</td><td>${c.pending}</td><td>${c.rejected}</td><td>${c.approved+c.rejected?Math.round(100*c.approved/(c.approved+c.rejected))+'%':'—'}</td><td><button class="secondary-btn" data-export-id="${safe(c.id)}">Download CSV</button></td></tr>`).join('')||'<tr><td colspan="7">No campaigns yet.</td></tr>'}
   </tbody></table></div>
   <div class="helper-note" style="margin-top:18px">${a.flagged||0} reports have automated review signals and ${a.open_appeals||0} appeals need attention. A total of ৳ ${n.total_paid_bdt||0} BDT in micro-rewards has been disbursed.</div>`;
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
  return `${pageHead('Admin Studio', 'Manage client testing campaigns, review tester feedback, and analyze metrics.')}
    <div class="stats-grid"><div class="stat"><div class="stat-icon">▦</div><div class="stat-number">${state.adminCampaigns.length}</div><div class="stat-label">Active Campaigns</div></div><div class="stat"><div class="stat-icon blue">◷</div><div class="stat-number">${pending}</div><div class="stat-label">Awaiting Review</div></div><div class="stat"><div class="stat-icon orange" style="background:#ecfdf5;color:#059669;">✓</div><div class="stat-number">${state.reviews.filter(r=>r.status==='approved').length}</div><div class="stat-label">Approved & Paid Reports</div></div></div>
    <div class="admin-tabs"><button class="admin-tab ${state.adminTab==='campaigns'?'active':''}" data-admin-tab="campaigns">Campaigns</button><button class="admin-tab ${state.adminTab==='reviews'?'active':''}" data-admin-tab="reviews">Feedback Reviews (${pending})</button><button class="admin-tab ${state.adminTab==='analytics'?'active':''}" data-admin-tab="analytics">Analytics & Reports</button><button class="admin-tab ${state.adminTab==='appeals'?'active':''}" data-admin-tab="appeals">Appeals (${state.appeals.filter(a=>a.status==='open').length})</button></div>
    ${state.adminTab==='campaigns'?adminCampaignView():state.adminTab==='reviews'?adminReviewView():state.adminTab==='analytics'?adminAnalyticsView():adminAppealsView()}`;
}
function appealView() {
  const item=state.me.activity.find(r=>r.id===state.appealFor&&r.status==='rejected'&&!r.appeal_status);
  if(!item)return '<div class="empty-state">This report is not eligible for an appeal.</div>';
  return `<button class="breadcrumb-button" data-nav="activity">← Back to activity</button><div class="paper"><h3>Appeal Rejected Report</h3><p>${safe(item.title)} · Explain the steps you took to test the application. Our team will review your explanation.</p><form id="appeal-form"><div class="field"><label for="appeal-reason">Why should this report be reconsidered?</label><textarea id="appeal-reason" required minlength="20" maxlength="1000" placeholder="Explain the specific steps you completed and why you believe the rejection was mistaken..."></textarea></div><div class="action-bar"><button type="submit" class="primary-btn">Submit Appeal →</button></div></form></div>`;
}
function render() {
  if (!state.me) return;
  const labels={home:'Dashboard',tasks:'Available Tasks',activity:'Earnings & History',admin:'Admin Studio',detail:'Task Details',appeal:'Appeal Report'};
  const page=labels[state.view] || 'Dashboard';
  $('#breadcrumb').textContent=`WORKSPACE / ${page.toUpperCase()}`;
  $('#page-label').textContent=state.view==='home' ? `Welcome, ${state.me.user.first_name}` : page;
  $('#header-points').textContent=state.me.points;
  $('#avatar').textContent=state.me.user.first_name.charAt(0).toUpperCase();
  document.querySelectorAll('.admin-nav').forEach(el=>el.classList.toggle('hidden',!state.me.user.admin));
  document.querySelectorAll('[data-nav]').forEach(el=>el.classList.toggle('active',el.dataset.nav===state.view||(state.view==='detail'&&el.dataset.nav==='tasks')));
  const views={home:homeView,tasks:tasksView,activity:activityView,detail:detailView,admin:adminView,appeal:appealView};
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
    await refresh();
  }catch(error){
    $('#app-view').innerHTML=`<div class="empty-state"><h2>Cannot load the application</h2><p>${safe(error.message)}</p><p>Check your connection, Telegram session, and database configuration.</p><div style="margin-top:18px"><button type="button" class="primary-btn" id="retry-btn">↻ Retry / Reload</button></div></div>`;
    $('#retry-btn')?.addEventListener('click', () => { location.reload(); });
  }
}
boot();
