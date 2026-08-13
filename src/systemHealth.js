// systemHealth — the App Health probes. Pure async checks plus their catalog;
// no JSX, which is why this is a domain module rather than a view.
// Extracted from App.js (strangle the monolith, step 25).
import React from 'react';
import { supabase } from './dataService';
import { Icon } from './icons';

export const SYS_RANK = { down: 4, degraded: 3, unknown: 2, unconfigured: 1, healthy: 0 };

export const DEADLINE_DEFS = [
  { kind:'inspection', field:'inspection_deadline', label:'Inspection / due-diligence deadline' },
  { kind:'financing',  field:'financing_deadline',  label:'Financing contingency deadline' },
  { kind:'appraisal',  field:'appraisal_deadline',  label:'Appraisal contingency deadline' },
  { kind:'closing',    field:'closing_date',        label:'Closing date' },
];




// Rule-based cross-document consistency: flags fields that disagree across documents' extracted terms.



/* ===================== BROKERAGE: AGENTS & PAY PLANS (admin) ===================== */

export function sysFmtAgo(ts) {
  if (!ts) return null;
  const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function sysFmtUntil(ts) {
  if (!ts) return null;
  const s = Math.round((new Date(ts).getTime() - Date.now()) / 1000);
  if (s <= 0) return 'expired';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export async function sysCheckGmailAccount(email) {
  const { data, error } = await supabase.from('email_accounts')
    .select('email_address, last_sync_at, last_sync_error, is_active')
    .eq('email_address', email)
    .maybeSingle();
  if (error) return { status: 'down', detail: error.message };
  if (!data) return { status: 'unconfigured', detail: 'Account not connected' };
  // Sync is driven by a 5-min cron, so freshness is the heartbeat.
  const FRESH_MS = 15 * 60 * 1000;
  const STALE_MS = 24 * 60 * 60 * 1000;
  const agoTxt = sysFmtAgo(data.last_sync_at);
  let status = 'healthy', detail = agoTxt ? `Synced ${agoTxt}` : 'Synced';
  if (data.is_active === false) {
    status = 'down'; detail = 'Inactive';
  } else if (!data.last_sync_at) {
    status = 'down'; detail = 'Never synced';
  } else {
    const age = Date.now() - new Date(data.last_sync_at).getTime();
    if (age > STALE_MS) { status = 'down'; detail = `Stalled · last synced ${agoTxt}`; }
    else if (age > FRESH_MS) { status = 'degraded'; detail = `Stale · last synced ${agoTxt}`; }
  }
  if (data.last_sync_error) {
    if (status === 'healthy') status = 'degraded';
    detail += ` · error: ${String(data.last_sync_error).slice(0, 80)}`;
  }
  return { status, detail };
}

export async function sysCheckCalendarSync() {
  // 1. There must be an active google account flagged for calendar use.
  //    The calendar-sync function picks by purposes @> ['calendar']; we
  //    mirror that here.
  const { data: accounts, error: aErr } = await supabase
    .from('email_accounts')
    .select('email_address, purposes, scopes, last_sync_at, last_sync_error')
    .eq('provider', 'google').eq('is_active', true);
  if (aErr) return { status: 'unknown', detail: aErr.message };
  const calAccts = (accounts || []).filter(a => (a.purposes || []).includes('calendar'));
  if (calAccts.length === 0) {
    return { status: 'down', detail: 'No Google account connected for calendar. Open Settings → Connect Calendar Account.' };
  }
  // 2. Every calendar-tagged account must actually have the calendar scope.
  //    If purposes says 'calendar' but scopes don't include 'calendar', some
  //    other OAuth flow silently stripped the permission — this is the bug
  //    that kept hitting Dara before the merge fix landed.
  const broken = calAccts.filter(a => !((a.scopes || []).some(s => s.includes('calendar'))));
  if (broken.length > 0) {
    return {
      status: 'down',
      detail: `${broken[0].email_address}: purposes says calendar, but the OAuth token has no calendar scope. Reconnect via Settings → Connect Calendar.`,
    };
  }
  // 3. Check sync recency. last_sync_at is updated by gmail-sync, not
  //    calendar-sync directly, but the same refresh path covers both — if
  //    it hasn't run in over an hour something is wrong.
  const stalest = calAccts.reduce((acc, a) =>
    !acc || (a.last_sync_at && a.last_sync_at < acc.last_sync_at) ? a : acc, null);
  if (stalest && stalest.last_sync_at) {
    const ageMin = (Date.now() - new Date(stalest.last_sync_at).getTime()) / 60000;
    if (ageMin > 60) {
      return { status: 'degraded', detail: `Last token refresh ${Math.round(ageMin)}min ago on ${stalest.email_address}` };
    }
  }
  // 4. Pending-push queue depth (the original check)
  const { count, error } = await supabase.from('events').select('id', { count: 'exact', head: true }).eq('sync_status', 'pending_push');
  if (error) return { status: 'unknown', detail: error.message };
  if (count > 25) return { status: 'degraded', detail: `${count} events queued to push to Google` };
  const acctList = calAccts.map(a => a.email_address).join(', ');
  return { status: 'healthy', detail: `Calendar on ${acctList}${count > 0 ? ` · ${count} queued` : ''}` };
}

export async function sysCheckPush() {
  const { data, error } = await supabase.from('email_accounts')
    .select('email_address, watch_expires_at, is_active');
  if (error) return { status: 'down', detail: error.message };
  const active = (data || []).filter(a => a.is_active);
  if (!active.length) return { status: 'unconfigured', detail: 'No active accounts' };
  const now = Date.now();
  const accounts = active.map(a => {
    let st = 'healthy', issue = 'Armed';
    if (!a.watch_expires_at) { st = 'down'; issue = 'Not armed'; }
    else {
      const ms = new Date(a.watch_expires_at).getTime() - now;
      if (ms <= 0) { st = 'down'; issue = 'Watch expired'; }
      else if (ms < 24 * 60 * 60 * 1000) { st = 'degraded'; issue = `Armed · ${sysFmtUntil(a.watch_expires_at)} left`; }
      else { issue = `Armed · ${sysFmtUntil(a.watch_expires_at)} left`; }
    }
    return { email: a.email_address, st, issue };
  });
  const worst = accounts.reduce((w, a) => SYS_RANK[a.st] > SYS_RANK[w] ? a.st : w, 'healthy');
  const bad = accounts.filter(a => a.st !== 'healthy').length;
  const detail = bad
    ? `${bad} of ${accounts.length} watch(es) need attention`
    : `Live push armed on ${accounts.length} account${accounts.length !== 1 ? 's' : ''} · renews daily`;
  return { status: worst, detail, meta: { accounts } };
}

export async function sysCheckQuo() {
  // Quo (OpenPhone) API key lives server-side in the quo-status edge function (never in this public bundle).
  const { data, error } = await supabase.functions.invoke('quo-status');
  if (error) return { status: 'down', detail: error.message || 'quo-status unreachable' };
  if (!data || data.ok === false) return { status: 'down', detail: data?.error || 'Quo check failed' };
  const bits = [];
  if (typeof data.number_count === 'number') bits.push(`${data.number_count} number${data.number_count !== 1 ? 's' : ''} live`);
  if (typeof data.latency_ms === 'number') bits.push(`${data.latency_ms}ms`);
  return { status: 'healthy', detail: bits.length ? bits.join(' · ') : 'Quo API reachable', meta: { numbers: data.numbers } };
}

export async function sysCheckAnthropic() {
  // API key lives server-side in the anthropic-status edge function (never in this public bundle).
  const { data, error } = await supabase.functions.invoke('anthropic-status');
  if (error) return { status: 'down', detail: error.message || 'anthropic-status unreachable' };
  if (!data || data.ok === false) return { status: 'down', detail: data?.message || data?.error || 'Anthropic check failed' };
  const bits = [];
  if (typeof data.model_count === 'number') bits.push(`${data.model_count} models available`);
  if (typeof data.latency_ms === 'number') bits.push(`${data.latency_ms}ms`);
  return { status: 'healthy', detail: bits.length ? bits.join(' · ') : 'API reachable' };
}

export async function sysCheckDatabase() {
  const t0 = performance.now();
  const { error } = await supabase.from('user_settings').select('user_id', { count: 'exact', head: true });
  const ms = Math.round(performance.now() - t0);
  if (error) return { status: 'down', detail: error.message };
  return { status: ms > 1500 ? 'degraded' : 'healthy', detail: `Postgres responded in ${ms}ms` };
}

export async function sysCheckAuth() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session) return { status: 'down', detail: 'No active session' };
  const exp = data.session.expires_at ? new Date(data.session.expires_at * 1000) : null;
  return { status: 'healthy', detail: exp ? `Token valid until ${exp.toLocaleTimeString()}` : 'Session active' };
}

export async function sysCheckStorage() {
  const { error } = await supabase.storage.from('receipts').list('', { limit: 1 });
  if (error) return { status: 'down', detail: error.message };
  return { status: 'healthy', detail: 'Receipts bucket reachable' };
}

export async function sysCheckGitHub() {
  // PAT lives server-side in the github-status edge function (never in this public bundle).
  const { data, error } = await supabase.functions.invoke('github-status');
  if (error) return { status: 'down', detail: error.message || 'github-status unreachable' };
  if (!data || data.ok === false) return { status: 'down', detail: data?.message || data?.error || 'GitHub check failed' };
  const pushTxt = data.pushed_at ? sysFmtAgo(data.pushed_at) : null;
  const ps = data.pages?.status;
  if (ps === 'errored') return { status: 'down', detail: `Pages build errored${data.pages?.error ? ' — ' + data.pages.error : ''}` };
  if (ps === 'building') return { status: 'degraded', detail: 'Pages build in progress' };
  const bits = [];
  if (ps === 'built') bits.push('Pages built');
  if (pushTxt) bits.push(`last push ${pushTxt}`);
  return { status: 'healthy', detail: bits.length ? bits.join(' · ') : 'Repo reachable' };
}

export const SYSTEMS = [
  { id: 'github',    icon: <Icon name="code" size={18} />, name: 'GitHub',          category: 'Deployment',  description: 'Repo & GitHub Pages hosting for darasapp.com', check: sysCheckGitHub },
  { id: 'supabase',  icon: <Icon name="zap" size={18} />, name: 'Supabase',        category: 'Backend',     description: 'Postgres database, auth & storage',            check: sysCheckDatabase },
  { id: 'gmail_dara',  icon: <Icon name="mail" size={18} />, name: 'Gmail (dara@brokerdara.com)', category: 'Integration', description: 'Google email account & sync', check: () => sysCheckGmailAccount('dara@brokerdara.com') },
  { id: 'gmail_khoyi', icon: <Icon name="mail" size={18} />, name: 'Gmail (khoyi1234@gmail.com)', category: 'Integration', description: 'Google email + calendar account & sync', check: () => sysCheckGmailAccount('khoyi1234@gmail.com') },
  { id: 'push',        icon: <Icon name="signal" size={18} />, name: 'Live Sync (Push)', category: 'Real-time', description: 'Gmail push notifications → instant sync (watch auto-renews daily)', check: sysCheckPush },
  { id: 'gcal',      icon: <Icon name="calendar" size={18} />, name: 'Google Calendar', category: 'Integration', description: 'Calendar event sync to Google',                 check: sysCheckCalendarSync },
  { id: 'anthropic', icon: <Icon name="sparkles" size={18} />,  name: 'Anthropic API',   category: 'AI',          description: 'Powers Ari, email triage & receipt parsing',   check: sysCheckAnthropic },
  { id: 'quo',       icon: <Icon name="quo" size={18} />, name: 'Quo (OpenPhone)', category: 'Integration', description: 'Business calling & texting — SMS via API, call logs, recordings & transcripts', check: sysCheckQuo },
];

// ─────────────────────────────────────────────────────────────────────────
// QUO (OpenPhone) — business calling & texting hub.
// All Quo API traffic goes through the quo-proxy edge function; the API key
// lives only as a server-side secret and never enters this public bundle.
// ─────────────────────────────────────────────────────────────────────────







// Compact, self-loading live feed of Quo activity (messages + calls), used both
// inside the Quo module and on the Systems board. Subscribes to realtime so new
// texts and calls appear the instant the webhook lands.


// ─── FinanceView — root component ────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════
// PROSPECTING — top-level tab. The daily money-making engine: gamified
// "Today" board, the activated lead-gen systems, and the 85-system library.
// ═══════════════════════════════════════════════════════════════════════
