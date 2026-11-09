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
function statusLabel(status) {
  return `<span class="pill ${safe(status)}">${safe(status === 'pending' ? 'Awaiting review' : status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : status)}</span>`;
}
function timeLabel(date) { if (!date) return '—'; const x = new Date(String(date).replace(' ', 'T') + 'Z'); return Number.isNaN(x.getTime()) ? '—' : x.toLocaleDateString(undefined, {month:'short',day:'numeric',year:'numeric'}); }
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
  const remaining = Math.max(0, task.capacity - task.reserved);
  const completed = !!task.my_status;
  const button = completed ? statusLabel(task.my_status) : remaining ? `<button class="flat-link" data-open="${safe(task.id)}">View test →</button>` : '<span class="pill draft">Fully booked</span>';
  return `<article class="task-card">
    <div class="task-top"><span class="task-icon">🎮</span><span class="points-tag">✧ ${task.reward_points} points</span></div>
    <h3>${safe(task.title)}</h3><p>${safe(smallText(task.description, 185))}</p>
    <div class="task-meta"><span>◷ Manual review</span><span>⌘ Three questions</span></div>
    <div class="task-card-footer"><span class="task-slots">${remaining}/${task.capacity} slots open</span>${button}</div>
  </article>`;
}
function activityTable(rows) {
  if (!rows?.length) return '<div class="empty-state">You have not submitted any tests yet. Available tasks will appear here when you participate.</div>';
  return `<div class="paper table-wrap"><table class="compact-table"><thead><tr><th>Campaign</th><th>Submitted</th><th>Status</th><th>Points</th></tr></thead><tbody>
    ${rows.map(s => `<tr><td><div class="mini-title">${safe(s.title)}</div>${s.review_note ? `<div class="help-text">Review: ${safe(s.review_note)}</div>`:''}${s.appeal_status?`<div class="help-text">Appeal: ${safe(s.appeal_status)}${s.appeal_reply?` · Reply: ${safe(s.appeal_reply)}`:''}</div>`:''}${s.status==='rejected'&&!s.appeal_status?`<button type="button" class="flat-link" data-appeal-for="${safe(s.id)}">Appeal rejection →</button>`:''}</td><td>${timeLabel(s.created_at)}</td><td>${statusLabel(s.status)}</td><td><strong>${s.status === 'approved' ? `+${s.reward_points}` : '—'}</strong></td></tr>`).join('')}
    </tbody></table></div>`;
}
function homeView() {
  const n = state.me.stats;
  const available = state.campaigns.filter(c => !c.my_status && c.capacity > c.reserved);
  return `<section class="hero"><div class="hero-content"><div class="hero-kicker">✦ QUALITY TESTING, REAL FEEDBACK</div><h1>Explore. Test.<br/>Make things better.</h1>
    <p>Help improve Telegram games and Mini Apps. Complete guided testing tasks and submit thoughtful feedback to earn demo points.</p>
    <button class="primary-btn" data-nav="tasks">Explore available tests <span>↗</span></button></div><div class="hero-shape" aria-hidden="true"></div></section>
    <div class="stats-grid"><div class="stat"><div class="stat-icon">✧</div><div class="stat-number">${state.me.points}</div><div class="stat-label">Approved test points</div></div>
    <div class="stat"><div class="stat-icon blue">◷</div><div class="stat-number">${n.pending}</div><div class="stat-label">Awaiting review</div></div>
    <div class="stat"><div class="stat-icon orange">▦</div><div class="stat-number">${available.length}</div><div class="stat-label">Tests available</div></div></div>
    ${pageHead('Featured testing tasks', 'Try a task and share actionable feedback.', '<button class="section-link" data-nav="tasks">See all tests →</button>')}
    ${available.length ? `<div class="task-grid">${available.slice(0,4).map(taskCard).join('')}</div>` : '<div class="empty-state">No available testing tasks right now.</div>'}
    ${pageHead('Recent activity', 'What happened with your submitted reports.', '<button class="section-link" data-nav="activity">Full activity →</button>')}
    ${activityTable(state.me.activity.slice(0,5))}
    <div class="helper-note" style="margin-top:20px">This is a prototype. Points have no monetary value and cannot be withdrawn. Test submissions are reviewed manually; never provide sensitive personal data in feedback.</div>`;
}
function tasksView() {
  return `${pageHead('Available game tests', 'Each campaign has limited slots. Reports are checked before any test points are recorded.')}
    ${state.campaigns.length ? `<div class="task-grid">${state.campaigns.map(taskCard).join('')}</div>` : '<div class="empty-state">There are no active campaigns. Check back after an administrator publishes a task.</div>'}
    <div class="helper-note" style="margin-top:20px">All tasks in the local demo are examples. Real advertiser campaigns will only be published after authorization and testing.</div>`;
}
function activityView() {
  const s=state.me.stats;
  return `${pageHead('Your testing activity', 'Track the status of your feedback and non-redeemable test points.')}
  <div class="stats-grid" style="margin-bottom:20px"><div class="stat"><div class="stat-icon">✧</div><div class="stat-number">${state.me.points}</div><div class="stat-label">Approved points</div></div><div class="stat"><div class="stat-icon blue">◷</div><div class="stat-number">${s.pending}</div><div class="stat-label">Pending reports</div></div><div class="stat"><div class="stat-icon orange">✓</div><div class="stat-number">${s.approved}</div><div class="stat-label">Approved reports</div></div></div>
  ${activityTable(state.me.activity)}<div class="helper-note" style="margin-top:20px">Approved points are a record of simulated testing activity only. No payment account, cash wallet or withdrawal functionality exists.</div>`;
}
function detailView() {
  const t=state.selectedCampaign;
  if (!t) { state.view='tasks'; return tasksView(); }
  const remaining = Math.max(0,t.capacity-t.reserved);
  return `<button class="breadcrumb-button" data-nav="tasks">← Back to tests</button>
   <div class="task-detail"><div class="paper"><div class="detail-head"><div class="task-icon">🎮</div><div><h2>${safe(t.title)}</h2><p>${safe(t.description)}</p></div></div>
    <h3>Testing instructions</h3><div class="instructions">${safe(t.instructions)}</div>
    <div class="action-bar"><button type="button" class="secondary-btn" data-launch="${safe(t.id)}" ${t.my_status?'disabled':''}>↗ Open test destination</button></div><p class="help-text">We record when you select Open. That click is not proof of gameplay; your feedback is still reviewed.</p>
    <h3 style="margin-top:28px">Submit your feedback</h3><p>Finish the requested steps before answering. Give specific observations rather than one-word answers.</p>
    ${t.my_status ? `<div class="helper-note">Already submitted: ${safe(t.my_status)}. Each tester may submit once per campaign.</div>` : remaining===0 ? '<div class="helper-note">No testing slots are available.</div>' :
    `<form id="feedback-form"><div class="field"><label for="device">Device used</label><select id="device" required><option value="">Choose a device</option><option>Android phone</option><option>iPhone</option><option>Desktop browser</option><option>Other device</option></select></div>
     ${[t.question1,t.question2,t.question3].map((q,i)=>`<div class="field"><label for="answer${i+1}">${i+1}. ${safe(q)}</label><textarea id="answer${i+1}" minlength="15" maxlength="1000" required placeholder="Write what happened and what could be improved..."></textarea></div>`).join('')}
     <div class="action-bar"><button class="primary-btn" type="submit">Submit for review →</button><span class="help-text">Approval is not automatic.</span></div></form>`}
   </div><aside class="paper details-side"><h3>Testing brief</h3><div class="info-row"><span>Test reward</span><b>✧ ${t.reward_points} points</b></div><div class="info-row"><span>Available places</span><b>${remaining} of ${t.capacity}</b></div><div class="info-row"><span>Verification</span><b>Manual feedback review</b></div><div class="info-row"><span>Payouts</span><b>Not available</b></div><p>Do not enter payment details, passwords or other private information during a test. Only open a destination you recognize and trust.</p></aside></div>`;
}
function adminCampaignRow(c) {
  const next = c.status === 'active' ? 'paused' : 'active';
  return `<tr><td><div class="mini-title">${safe(c.title)}</div><div class="help-text">${safe(c.game_url)}</div></td><td>${statusLabel(c.status)}</td><td>${c.reserved} / ${c.capacity}</td><td>${c.reward_points} pts</td>
  <td><button type="button" class="secondary-btn" data-status-id="${safe(c.id)}" data-status-to="${next}">${next === 'active'?'Activate':'Pause'}</button> <button type="button" class="secondary-btn" data-export-id="${safe(c.id)}">Approved CSV</button> <button type="button" class="secondary-btn" data-export-id="${safe(c.id)}" data-export-scope="internal">Internal CSV</button></td></tr>`;
}
function adminCampaignView() {
  return `<div class="paper table-wrap"><h3>Campaign manager</h3><p>Only an authorized administrator can publish tests. The default campaign status is draft.</p>
  ${state.adminCampaigns.length ? `<table class="compact-table"><thead><tr><th>Campaign</th><th>Status</th><th>Reserved</th><th>Points</th><th>Action</th></tr></thead><tbody>${state.adminCampaigns.map(adminCampaignRow).join('')}</tbody></table>` : '<div class="empty-state">No campaigns created.</div>'}</div>
  <div class="paper" style="margin-top:20px"><h3>Create a test campaign</h3><p>Use a real HTTPS destination that you own or are authorized to test. Campaigns must be manually activated.</p>
  <form id="campaign-form"><div class="form-grid">
  <div class="field"><label for="campaign-title">Campaign title</label><input id="campaign-title" required minlength="5" maxlength="100" placeholder="Test the first 5 minutes of the game" /></div>
  <div class="field"><label for="campaign-url">Game / Mini App link</label><input id="campaign-url" type="url" required placeholder="https://t.me/your_game_bot" /></div>
  <div class="field form-full"><label for="campaign-description">Short description</label><textarea id="campaign-description" required minlength="20" maxlength="600" placeholder="Explain what testers will do and who the experience is designed for..."></textarea></div>
  <div class="field form-full"><label for="campaign-instructions">Step-by-step testing instructions</label><textarea id="campaign-instructions" required minlength="20" maxlength="1200" placeholder="1. Launch the game\n2. Complete onboarding\n3. Report any confusing steps..."></textarea></div>
  ${[1,2,3].map(n=>`<div class="field form-full"><label for="question${n}">Feedback question ${n}</label><input id="question${n}" required minlength="10" maxlength="200" placeholder="What did you notice?" /></div>`).join('')}
  <div class="field"><label for="capacity">Maximum reserved slots</label><input id="capacity" type="number" min="1" max="1000" value="20" required /></div>
  <div class="field"><label for="reward-points">Simulated points / approved report</label><input id="reward-points" type="number" min="1" max="1000" value="25" required /></div>
  </div><div class="action-bar"><button type="submit" class="primary-btn dark">Create draft campaign →</button></div></form></div>`;
}
function adminReviewView() {
  if (!state.reviews.length) return '<div class="empty-state">No tester feedback has been submitted.</div>';
  return state.reviews.map(r => `<div class="review-card"><div class="review-head"><div><div class="review-header">${safe(r.campaign_title)} <span style="color:#778fa1;font-weight:500"> · ${safe(r.tester_name)}</span></div><div class="review-sub">${timeLabel(r.created_at)} · ${safe(r.device)} · ${r.reward_points} test points</div></div>${statusLabel(r.status)}</div>
  ${r.risk_flags&&r.risk_flags!=='[]'?`<div class="quality-warning">⚑ Review signals (not proof of fraud): ${safe(JSON.parse(r.risk_flags).map(f=>f.replaceAll('_',' ')).join(' · '))}</div>`:'<div class="quality-clear">No automated review signals · Manual checking still required</div>'}
  ${[r.answer1,r.answer2,r.answer3].map((answer,i)=>`<div class="review-label">Question ${i+1}</div><div class="review-answer">${safe(answer)}</div>`).join('')}
  ${r.status === 'pending' ? `<div class="review-actions"><input id="note-${r.id}" maxlength="400" placeholder="Optional approval note; rejection reason required" aria-label="Review note" /><button type="button" class="primary-btn" data-review-id="${safe(r.id)}" data-review-as="approved">Approve</button><button type="button" class="danger-btn" data-review-id="${safe(r.id)}" data-review-as="rejected">Reject</button></div>` : `<div class="help-text">Review note: ${safe(r.review_note || 'None')}</div>`}</div>`).join('');
}
function adminAnalyticsView() {
  const a=state.analytics || {overall:{},campaigns:[],flagged:0,open_appeals:0};
  const n=a.overall || {};
  return `<div class="stats-grid"><div class="stat"><div class="stat-icon">♙</div><div class="stat-number">${n.total_users||0}</div><div class="stat-label">Registered testers</div></div>
   <div class="stat"><div class="stat-icon blue">↗</div><div class="stat-number">${n.launch_records||0}</div><div class="stat-label">Launch-click records</div></div>
   <div class="stat"><div class="stat-icon orange">◷</div><div class="stat-number">${n.submitted||0}</div><div class="stat-label">Submitted reports</div></div></div>
   <div class="paper table-wrap" style="margin-top:20px"><h3>Campaign performance</h3><p>Counts reflect reports, not independently confirmed plays, paid conversions, or revenue.</p>
   <table class="compact-table"><thead><tr><th>Campaign</th><th>Submitted</th><th>Approved</th><th>Pending</th><th>Rejected</th><th>Approval rate</th><th>Export</th></tr></thead><tbody>
   ${(a.campaigns||[]).map(c=>`<tr><td class="mini-title">${safe(c.title)}</td><td>${c.submitted}</td><td>${c.approved}</td><td>${c.pending}</td><td>${c.rejected}</td><td>${c.approved+c.rejected?Math.round(100*c.approved/(c.approved+c.rejected))+'%':'—'}</td><td><button class="secondary-btn" data-export-id="${safe(c.id)}">CSV</button></td></tr>`).join('')||'<tr><td colspan="7">No campaigns yet.</td></tr>'}
   </tbody></table></div>
   <div class="helper-note" style="margin-top:18px">${a.flagged||0} reports have automated review signals and ${a.open_appeals||0} appeals need attention. Signals are advisory, never an automatic fraud verdict. ${n.demo_points_issued||0} non-redeemable points have been issued.</div>`;
}
function adminAppealsView() {
  if (!state.appeals.length) return '<div class="empty-state">No report disputes yet.</div>';
  return state.appeals.map(a=>`<div class="review-card"><div class="review-head"><div><div class="review-header">${safe(a.campaign_title)}</div><div class="review-sub">${safe(a.tester_name)} · ${timeLabel(a.created_at)}</div></div>${statusLabel(a.status)}</div>
  <div class="review-label">Tester explanation</div><div class="review-answer">${safe(a.reason)}</div>
  ${a.status==='open'?`<div class="review-actions"><input id="appeal-reply-${safe(a.id)}" maxlength="800" placeholder="Explain your decision (10–800 characters)"/><button type="button" class="primary-btn" data-answer-appeal="${safe(a.id)}">Send reply</button></div>`:`<div class="review-label">Admin response</div><div class="review-answer">${safe(a.admin_reply||'')}</div>`}</div>`).join('');
}
function adminView() {
  if (!state.me.user.admin) { state.view='home';return homeView(); }
  const pending=state.reviews.filter(r=>r.status==='pending').length;
  return `${pageHead('Admin studio', 'Create controlled testing campaigns and manually review submitted reports.')}
    <div class="stats-grid"><div class="stat"><div class="stat-icon">▦</div><div class="stat-number">${state.adminCampaigns.length}</div><div class="stat-label">Campaigns</div></div><div class="stat"><div class="stat-icon blue">◷</div><div class="stat-number">${pending}</div><div class="stat-label">Awaiting approval</div></div><div class="stat"><div class="stat-icon orange">✓</div><div class="stat-number">${state.reviews.filter(r=>r.status==='approved').length}</div><div class="stat-label">Accepted reports</div></div></div>
    <div class="admin-tabs"><button class="admin-tab ${state.adminTab==='campaigns'?'active':''}" data-admin-tab="campaigns">Campaigns</button><button class="admin-tab ${state.adminTab==='reviews'?'active':''}" data-admin-tab="reviews">Feedback (${pending})</button><button class="admin-tab ${state.adminTab==='analytics'?'active':''}" data-admin-tab="analytics">Analytics</button><button class="admin-tab ${state.adminTab==='appeals'?'active':''}" data-admin-tab="appeals">Appeals (${state.appeals.filter(a=>a.status==='open').length})</button></div>
    ${state.adminTab==='campaigns'?adminCampaignView():state.adminTab==='reviews'?adminReviewView():state.adminTab==='analytics'?adminAnalyticsView():adminAppealsView()}`;
}
function appealView() {
  const item=state.me.activity.find(r=>r.id===state.appealFor&&r.status==='rejected'&&!r.appeal_status);
  if(!item)return '<div class="empty-state">This report is not eligible for an appeal.</div>';
  return `<button class="breadcrumb-button" data-nav="activity">← Back to activity</button><div class="paper"><h3>Appeal rejected report</h3><p>${safe(item.title)} · We will review your explanation. This does not automatically change the original decision.</p><form id="appeal-form"><div class="field"><label for="appeal-reason">Why should this report be reconsidered?</label><textarea id="appeal-reason" required minlength="20" maxlength="1000" placeholder="Explain the specific steps you completed and why you believe the rejection was mistaken..."></textarea></div><div class="action-bar"><button type="submit" class="primary-btn">Send appeal →</button></div></form></div>`;
}
function render() {
  if (!state.me) return;
  const labels={home:'Overview',tasks:'Available tests',activity:'My activity',admin:'Admin studio',detail:'Task details',appeal:'Appeal report'};
  const page=labels[state.view] || 'Overview';
  $('#breadcrumb').textContent=`WORKSPACE / ${page.toUpperCase()}`;
  $('#page-label').textContent=state.view==='home' ? `Hello, ${state.me.user.first_name}` : page;
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
  // Launch is not verified gameplay. Record the click without delaying Telegram's link-open gesture.
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
    if (status==='active' && !confirm('Activate this test for real Telegram visitors? Rewards remain simulated.')) return;
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
    },'Your feedback was submitted for review.');
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
    await mutate('admin/campaigns',body,'Draft campaign created. Activate it when ready.');
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
