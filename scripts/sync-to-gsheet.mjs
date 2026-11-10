#!/usr/bin/env node
/**
 * Synchronizes Cloudflare D1 Database records (Withdrawals & Submissions)
 * directly into the Google Verification & Audit Spreadsheet.
 * 
 * Spreadsheet ID: 1KTT9hVkFs1ar1TUrAuN8ImzsDwhHOT_9eqDL_wClXJs
 */
import { execSync } from 'node:child_process';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1KTT9hVkFs1ar1TUrAuN8ImzsDwhHOT_9eqDL_wClXJs';

function queryD1(sql) {
  try {
    const raw = execSync(`npx --yes wrangler d1 execute telegram-task-lab-db --remote --json --command="${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' });
    const parsed = JSON.parse(raw);
    return parsed?.[0]?.results || [];
  } catch (err) {
    console.error('Failed to query remote D1:', err.message);
    return [];
  }
}

function escapeCsvCell(val) {
  if (val === null || val === undefined) return '';
  return String(val).replace(/,/g, ' ').replace(/\|/g, ';').replace(/\n/g, ' ').trim();
}

async function sync() {
  console.log(`[Sync] Connecting to TaskKit D1 and Google Sheet: ${SPREADSHEET_ID}...`);

  // 1. Fetch all withdrawals with verification metrics
  const withdrawalsSql = `
    SELECT w.id, w.created_at, u.first_name, u.username, w.user_id,
      (SELECT COUNT(*) FROM referrals r WHERE r.inviter_id = w.user_id) AS lifetime_invites,
      (SELECT COUNT(*) FROM submissions s WHERE s.user_id = w.user_id AND s.status = 'approved') AS tasks_done,
      (SELECT ROUND(COALESCE(SUM(points), 0), 4) FROM reward_ledger rl WHERE rl.user_id = w.user_id) AS total_earned,
      w.amount, w.network, w.wallet_address, w.status, w.admin_note
    FROM withdrawals w
    JOIN users u ON u.id = w.user_id
    ORDER BY w.created_at DESC;
  `;
  const withdrawals = queryD1(withdrawalsSql);
  console.log(`[Sync] Found ${withdrawals.length} withdrawal record(s).`);

  if (withdrawals.length > 0) {
    const rows = withdrawals.map(w => {
      const invites = Number(w.lifetime_invites || 0);
      const invitesMet = invites >= 10 ? `YES (${invites}/10)` : `NO (${invites}/10)`;
      const bscLink = w.network === 'BEP20' ? `https://bscscan.com/address/${w.wallet_address}` : '—';
      const cleanTx = (w.admin_note || '').trim().replace(/^TX:\s*/i, '');
      const txId = /^0x[a-f0-9]{64}$/i.test(cleanTx) ? cleanTx : (w.admin_note || '—');
      const verificationStatus = invites >= 10 ? 'VERIFIED (Invites Met)' : 'PENDING (Invites < 10)';

      return [
        escapeCsvCell(w.id),
        escapeCsvCell(w.created_at),
        escapeCsvCell(w.first_name || 'Tester'),
        escapeCsvCell(w.username ? '@' + w.username : '—'),
        escapeCsvCell(w.user_id),
        escapeCsvCell(invites),
        escapeCsvCell(invitesMet),
        escapeCsvCell(w.tasks_done || 0),
        escapeCsvCell(`${Number(w.total_earned || 0).toFixed(2)} USDT`),
        escapeCsvCell(`${Number(w.amount || 0).toFixed(2)} USDT`),
        escapeCsvCell(w.network),
        escapeCsvCell(w.wallet_address),
        escapeCsvCell(bscLink),
        escapeCsvCell(verificationStatus),
        escapeCsvCell(w.status?.toUpperCase() || 'PENDING'),
        escapeCsvCell(txId),
        escapeCsvCell(w.admin_note || '—')
      ].join(',');
    });

    const csvData = rows.join('|');
    execSync(`gsheets mutate write ${SPREADSHEET_ID} 'Withdrawals_Verification!A2:Q${withdrawals.length + 1}' "${csvData}"`, { stdio: 'inherit' });
    console.log(`[Sync] Updated Withdrawals_Verification tab.`);
  }

  // 2. Fetch all submissions / task audits
  const submissionsSql = `
    SELECT s.id, s.created_at, c.title AS campaign_title, u.first_name, u.username, s.user_id,
      s.device, s.answer1, s.answer2, s.answer3, c.reward_points, s.status, s.review_note
    FROM submissions s
    JOIN campaigns c ON c.id = s.campaign_id
    JOIN users u ON u.id = s.user_id
    ORDER BY s.created_at DESC;
  `;
  const submissions = queryD1(submissionsSql);
  console.log(`[Sync] Found ${submissions.length} submission audit record(s).`);

  if (submissions.length > 0) {
    const subRows = submissions.map(s => {
      const answers = `Q1: ${s.answer1 || ''} ; Q2: ${s.answer2 || ''} ; Q3: ${s.answer3 || ''}`;
      return [
        escapeCsvCell(s.id),
        escapeCsvCell(s.created_at),
        escapeCsvCell(s.campaign_title),
        escapeCsvCell(s.first_name || 'Tester'),
        escapeCsvCell(s.username ? '@' + s.username : '—'),
        escapeCsvCell(s.user_id),
        escapeCsvCell(s.device || 'Mobile'),
        escapeCsvCell(answers),
        escapeCsvCell(`${Number(s.reward_points || 0).toFixed(2)} USDT`),
        escapeCsvCell(s.status?.toUpperCase() || 'PENDING'),
        escapeCsvCell(s.review_note || '—')
      ].join(',');
    });

    const subCsvData = subRows.join('|');
    execSync(`gsheets mutate write ${SPREADSHEET_ID} 'Tester_Task_Audits!A2:K${submissions.length + 1}' "${subCsvData}"`, { stdio: 'inherit' });
    console.log(`[Sync] Updated Tester_Task_Audits tab.`);
  }

  console.log(`[Sync] Done! Google Sheet is fully updated.`);
}

sync().catch(err => {
  console.error('[Sync] Fatal error:', err);
  process.exit(1);
});
