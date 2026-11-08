import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, createHmac } from 'node:crypto';
import { verifyTelegramInitData } from '../src/worker.mjs';

const project = path.resolve(import.meta.dirname, '..');
const temp = mkdtempSync(path.join(os.tmpdir(), 'tasklab-test-'));
const port = 23000 + Math.floor(Math.random() * 15000);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['scripts/local-server.mjs'], {
  cwd: project, env: { ...process.env, PORT: String(port), TASKLAB_DATA_DIR: temp }, stdio: ['ignore', 'pipe', 'pipe']
});
let output='';
server.stderr.on('data', c => { output+=c.toString(); });
server.stdout.on('data', c => { output+=c.toString(); });

async function ready() {
  for (let i=0; i<60; i++) {
    if (server.exitCode !== null) throw new Error(`Server exited:\n${output}`);
    try { const r=await fetch(`${base}/api/health`);if(r.ok)return; } catch {}
    await new Promise(ok=>setTimeout(ok,100));
  }
  throw new Error(`Server failed to start:\n${output}`);
}
async function request(route, id='10001', body, key) {
  const response = await fetch(`${base}/api/${route}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-local-user-id':id, 'x-local-dev-key':key,
      ...(body ? {'Content-Type':'application/json'} : {}) },
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
  return { status: response.status, body: await response.json() };
}

test('Telegram HMAC authentication checks authenticity and expiry', async () => {
  const token='5768337691:AAH5YkoiEuPk8-FZa32hStHTqXiLPtAEhx8';
  const raw='query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A279058397%2C%22first_name%22%3A%22Vladislav%22%2C%22last_name%22%3A%22Kibenko%22%2C%22username%22%3A%22vdkfrost%22%2C%22language_code%22%3A%22ru%22%2C%22is_premium%22%3Atrue%7D&auth_date=1662771648&hash=c501b71e775f74ce10e377dea85a7ea24ecd640b223ea86dfe453e0eaed2e2b2';
  const verified=await verifyTelegramInitData(raw,token,1662771649);
  assert.equal(verified.id,'279058397');
  await assert.rejects(() => verifyTelegramInitData(raw,token,1662771648+4000), /expired/);
  await assert.rejects(() => verifyTelegramInitData(raw.replace('Vladislav','Imposter'),token,1662771649), /Invalid Telegram signature/);
  const other=new URLSearchParams(raw);other.set('auth_date','1662771649');
  await assert.rejects(() => verifyTelegramInitData(other.toString(),token,1662771649), /Invalid Telegram signature/);
});

test('Complete manual approval flow; enforce access, capacity, unique claims and ledger idempotency', async () => {
  await ready();
  const local=await(await fetch(`${base}/__local_session`)).json();
  const key=local.devKey;
  const health=await request('me','10001',undefined,'wrong');
  assert.equal(health.status,401);
  let admin=await request('admin/campaigns','10001',undefined,key);
  assert.equal(admin.status,403,'tester cannot view admin campaigns');
  const seeded=await request('campaigns','10001',undefined,key);
  assert.equal(seeded.status,200);
  assert.ok(seeded.body.campaigns.length>=1);

  const bad=await request('admin/campaigns','90001',{
    title:'Unsafe task', description:'Test app for 5 minutes and explain your feedback.',game_url:'javascript:alert(1)',
    instructions:'Visit the site and follow the steps.', questions:['Question with detail?','Question about onboarding?','Question about design?'],capacity:2,reward_points:25,
  },key);
  assert.equal(bad.status,400);

  const created=await request('admin/campaigns','90001',{
    title:'Independent demo game test',description:'Complete a structured usability evaluation of the attached app.',
    game_url:'https://core.telegram.org/bots/webapps',instructions:'Read the landing page. Note confusing elements and report what you learned.',
    questions:['Was launching the example intuitive?','Which step caused the most confusion?','What would you improve for beginners?'],
    capacity:1,reward_points:37,
  },key);
  assert.equal(created.status,201,JSON.stringify(created.body));
  const id=created.body.id;
  assert.equal(created.body.status,'draft');
  const draftList=await request('campaigns','10001',undefined,key);
  assert.equal(draftList.body.campaigns.some(c=>c.id===id),false,'draft not public');
  const activate=await request(`admin/campaigns/${id}/status`,'90001',{status:'active'},key);
  assert.equal(activate.status,200);
  const feedback={device:'Android phone',answer1:'I found the example after navigating through two menus.',
    answer2:'The navigation was unclear, especially the menu label.',answer3:'Show an onboarding hint on the first visit.'};
  const submitted=await request(`campaigns/${id}/submissions`,'10001',feedback,key);
  assert.equal(submitted.status,201,JSON.stringify(submitted.body));
  const duplicate=await request(`campaigns/${id}/submissions`,'10001',feedback,key);
  assert.equal(duplicate.status,409,'one submission per campaign');
  const profilePending=await request('me','10001',undefined,key);
  assert.equal(profilePending.body.points,0);
  assert.ok(profilePending.body.stats.pending>=1);
  const status=await request('campaigns','90001',undefined,key);
  assert.equal(status.body.campaigns.find(c=>c.id===id).reserved,1);
  const noSlot=await request(`campaigns/${id}/submissions`,'90001',feedback,key);
  assert.equal(noSlot.status,409,'database trigger enforces slot limit');
  const reviewList=await request('admin/submissions','90001',undefined,key);
  const review=reviewList.body.submissions.find(s=>s.campaign_id===id);
  assert.ok(review);
  const reviewerForbidden=await request(`admin/submissions/${review.id}/review`,'10001',{decision:'approved'},key);
  assert.equal(reviewerForbidden.status,403);
  const approved=await request(`admin/submissions/${review.id}/review`,'90001',{decision:'approved',note:'Thoughtful report.'},key);
  assert.equal(approved.status,200);
  const again=await request(`admin/submissions/${review.id}/review`,'90001',{decision:'approved'},key);
  assert.equal(again.status,409,'double approval must fail');
  const profileApproved=await request('me','10001',undefined,key);
  assert.equal(profileApproved.body.points,37,'points credited exactly once');
  assert.ok(profileApproved.body.activity.some(s=>s.status==='approved'&&s.campaign_id===id));
  // Rejection does not award points, and it frees the campaign's reserved slot.
  const other=seeded.body.campaigns[0].id;
  const secondSubmission=await request(`campaigns/${other}/submissions`,'10001',feedback,key);
  assert.equal(secondSubmission.status,201);
  const reviewTwo=await request('admin/submissions','90001',undefined,key);
  const otherReport=reviewTwo.body.submissions.find(s=>s.campaign_id===other&&s.user_id==='10001');
  const reject=await request(`admin/submissions/${otherReport.id}/review`,'90001',{decision:'rejected',note:'Feedback did not cover the instructed flow.'},key);
  assert.equal(reject.status,200);
  const afterReject=await request('me','10001',undefined,key);
  assert.equal(afterReject.body.points,37,'rejection must not create a credit');
  assert.ok(afterReject.body.activity.some(s=>s.campaign_id===other&&s.status==='rejected'));
  const pause=await request(`admin/campaigns/${id}/status`,'90001',{status:'paused'},key);
  assert.equal(pause.status,200);
  const paused=await request('campaigns','10001',undefined,key);
  assert.equal(paused.body.campaigns.some(c=>c.id===id),false);
});

test('Quality warnings, appeals, analytics and CSV report are protected and work end to end', async () => {
  const key=(await (await fetch(`${base}/__local_session`)).json()).devKey;
  const created=await request('admin/campaigns','90001',{
    title:'Quality and reporting validation',
    description:'A controlled example to test dashboard reports and dispute responses.',
    game_url:'https://core.telegram.org/bots/webapps',
    instructions:'Read the official documentation and report three independent observations.',
    questions:['Which part did you understand easily?','Where did you become confused?','What would make the flow clearer?'],
    capacity:4,reward_points:19,
  },key);
  assert.equal(created.status,201,JSON.stringify(created.body));
  const id=created.body.id;
  assert.equal((await request(`admin/campaigns/${id}/status`,'90001',{status:'active'},key)).status,200);
  assert.equal((await request('admin/analytics','10001',undefined,key)).status,403);
  assert.equal((await request('admin/appeals','10001',undefined,key)).status,403);
  assert.equal((await request(`campaigns/${id}/launch`,'10001',{},'invalid')).status,401);
  assert.equal((await request(`campaigns/${id}/launch`,'10001',{},key)).status,200);
  assert.equal((await request(`campaigns/${id}/launch`,'10001',{},key)).status,200,'multiple clicks allowed');
  const feedback={
    device:'Android phone',
    answer1:'=2+5 this answer is deliberately structured as a spreadsheet formula',
    answer2:'Finding the app documentation required two separate navigation steps.',
    answer3:'Add a first-time use checklist explaining the expected user flow.',
  };
  const first=await request(`campaigns/${id}/submissions`,'10001',feedback,key);
  assert.equal(first.status,201,JSON.stringify(first.body));
  const second=await request(`campaigns/${id}/submissions`,'90001',feedback,key);
  assert.equal(second.status,201);
  const review=await request('admin/submissions','90001',undefined,key);
  const firstReport=review.body.submissions.find(s=>s.id===first.body.id);
  const secondReport=review.body.submissions.find(s=>s.id===second.body.id);
  assert.ok(firstReport.risk_flags.includes('submitted_under_90_seconds'), 'fast click-to-submit should be a warning');
  assert.ok(secondReport.risk_flags.includes('no_launch_record'), 'missing launch should be a warning');
  assert.ok(secondReport.risk_flags.includes('identical_feedback'), 'exact duplicate text should be a warning');
  assert.equal((await request(`admin/submissions/${first.body.id}/review`,'90001',{
    decision:'rejected',note:'Report missed some requested detail.'},key)).status,200);
  assert.equal((await request(`submissions/${first.body.id}/appeal`,'90001',{
    reason:'I disagree with the review of this test and request a second look.'},key)).status,404);
  const appeal=await request(`submissions/${first.body.id}/appeal`,'10001',{
    reason:'I completed the steps and described the confusion in detail; please reconsider.'},key);
  assert.equal(appeal.status,201,JSON.stringify(appeal.body));
  assert.equal((await request(`submissions/${first.body.id}/appeal`,'10001',{
    reason:'Another attempt to appeal this same rejected report.'},key)).status,409);
  const pendingAppeals=await request('admin/appeals','90001',undefined,key);
  assert.ok(pendingAppeals.body.appeals.some(a=>a.id===appeal.body.id&&a.status==='open'));
  const responded=await request(`admin/appeals/${appeal.body.id}/answer`,'90001',{
    reply:'We checked your answers, but the missing requested step explains the rejection.'},key);
  assert.equal(responded.status,200);
  assert.equal((await request(`admin/appeals/${appeal.body.id}/answer`,'90001',{
    reply:'The appeal has already been answered.'},key)).status,409);
  const me=await request('me','10001',undefined,key);
  const item=me.body.activity.find(a=>a.id===first.body.id);
  assert.equal(item.appeal_status,'answered');
  assert.ok(item.appeal_reply.includes('requested step'));
  const analytics=await request('admin/analytics','90001',undefined,key);
  assert.equal(analytics.status,200);
  assert.ok(analytics.body.flagged>=2);
  assert.ok(analytics.body.campaigns.some(c=>c.id===id&&c.submitted===2));
  assert.equal((await request(`admin/submissions/${second.body.id}/review`,'90001',{decision:'approved',note:'Useful independent report.'},key)).status,200);
  const url=`${base}/api/admin/campaigns/${id}/report.csv`;
  const anon=await fetch(url,{headers:{'x-local-user-id':'10001','x-local-dev-key':key}});
  assert.equal(anon.status,403,'tester cannot download report');
  const csv=await fetch(url,{headers:{'x-local-user-id':'90001','x-local-dev-key':key}});
  assert.equal(csv.status,200);
  assert.match(csv.headers.get('content-type'),/text\/csv/);
  const content=await csv.text();
  assert.match(content,/submitted_utc/);
  assert.ok(!content.includes('quality_flags')&&!content.includes('review_note'),'approved report omits internal review metadata');
  assert.ok(content.includes("'\=2+5") || content.includes("'=2+5"), 'potential spreadsheet formulas must be escaped');
  assert.ok(!content.includes('10001'), 'report should not expose Telegram account identifiers');
  const internal=await fetch(url+'?scope=internal',{headers:{'x-local-user-id':'90001','x-local-dev-key':key}});
  assert.equal(internal.status,200);
  const internalCsv=await internal.text();
  assert.ok(internalCsv.includes('quality_flags')&&internalCsv.includes('review_note'));
  assert.ok(internalCsv.includes('rejected')&&internalCsv.includes('approved')); 
});

test.after(() => { server.kill('SIGTERM');rmSync(temp,{recursive:true,force:true}); });
