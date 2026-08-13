// SettingsView — the settings hub (account, email, permissions, integrations, etc.).
// Extracted from App.js (strangle). Every child panel is now its own module.
import React, { useState, useEffect, lazy, Suspense } from 'react';
import { supabase } from '../dataService';
import { BUILD_VERSION } from '../version';
import { notify } from '../notify';
import { Icon } from '../icons';
import TipsSetting from './TipsSetting';
import EmailAccountsPanel from './EmailAccountsPanel';
import EmailAliasesPanel from './EmailAliasesPanel';
import WorkingHoursSection from './WorkingHoursSection';
import AriPermissionsPanel from './AriPermissionsPanel';
import CubeACRPanel from './CubeACRPanel';
import BookingsManagerModal from './BookingsManagerModal';
import CoachSettings from './CoachSettings';
import IosSharingSettings from './IosSharingSettings';
import CloudStorageSettings from './CloudStorageSettings';
import AdminLicensingPanel from './AdminLicensingPanel';
import RedeemCodeBox from './RedeemCodeBox';
import SimplifyPanel from './SimplifyPanel';
const QuarterlyTaxBanner = lazy(() => import('./QuarterlyTaxBanner'));

// push-subscription helpers (used only here)
const VAPID_PUBLIC_KEY = 'BF7IbYP2gbqaV5B3-iaX88-r08O9tLutgXxUadjJicDKjl4QU8xxu-Yfdgloej6DeUrtChNcT6gT5HlS4Ze6OJk';
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64); const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export default function SettingsView({ user, priorityPref, onPriorityPrefChange, emailAccounts, setEmailAccounts, emailAliases, setEmailAliases, userId, userSettings, setUserSettings, isAdmin = false, entitlements = null, reloadEntitlements = null, licensingEnforced = false }) {
  const [settingsTab, setSettingsTab] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [displayName, setDisplayName] = useState(user?.user_metadata?.display_name || user?.user_metadata?.full_name?.split(/\s+/)[0] || '');
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState('');
  const [briefEnabled, setBriefEnabled] = useState(false);
  const [briefHour, setBriefHour] = useState(7);
  const [briefMsg, setBriefMsg] = useState('');
  const [savingBrief, setSavingBrief] = useState(false);
  const [briefAcct, setBriefAcct] = useState(null);
  const [pushOn, setPushOn] = useState(false);
  const [pushMsg, setPushMsg] = useState('');
  const [pushBusy, setPushBusy] = useState(false);
  const [prefMsg, setPrefMsg] = useState('');
  const [savingPref, setSavingPref] = useState(false);

  // Pass 2 Batch C/D: "About you" editing + module visibility — all backed by user_settings.
  const [profession, setProfession] = useState(userSettings?.profession || '');
  const [assistantContext, setAssistantContext] = useState(userSettings?.assistant_context || '');
  const [timezone, setTimezone] = useState(userSettings?.timezone || '');
  const [officeAddress, setOfficeAddress] = useState(userSettings?.office_address || '');
  const [zoomLink, setZoomLink] = useState(userSettings?.zoom_link || '');
  const [bookingPhone, setBookingPhone] = useState(userSettings?.booking_phone || '');
  const ALL_MTYPES = [['phone','Phone call'],['zoom','Zoom'],['google_meet','Google Meet'],['office','Office meeting'],['property','Property showing'],['other','Other location']];
  const ALL_DUR = [[30,'30 min'],[60,'1 hour'],[90,'90 min'],[120,'2 hours']];
  const [bkTypes, setBkTypes] = useState(Array.isArray(userSettings?.booking_types) ? userSettings.booking_types : ['phone','zoom','google_meet','office','property','other']);
  const [bkDur, setBkDur] = useState(Array.isArray(userSettings?.booking_durations) ? userSettings.booking_durations : [30,60,90,120]);
  const [minNoticeH, setMinNoticeH] = useState(String(Math.round((userSettings?.booking_min_notice_min ?? 120)/60)));
  const [horizonD, setHorizonD] = useState(String(userSettings?.booking_horizon_days ?? 21));
  const [showBookings, setShowBookings] = useState(false);
  const toggleIn = (arr, val, set) => set(arr.includes(val) ? arr.filter(x=>x!==val) : [...arr, val]);
  const [savingBooking, setSavingBooking] = useState(false);
  const [bookingMsg, setBookingMsg] = useState('');
  const bookingSlug = userSettings?.booking_slug || '';
  const bookingEnabled = userSettings?.booking_enabled === true;
  const bookingUrl = bookingSlug ? `https://darasapp.com/book/${bookingSlug}` : '';
  async function toggleBooking() {
    if (savingBooking) return; setSavingBooking(true); setBookingMsg('');
    const { data, error } = await supabase.from('user_settings').upsert({ user_id: userId, booking_enabled: !bookingEnabled, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }).select().maybeSingle();
    if (error) setBookingMsg('Error: ' + error.message); else if (data) setUserSettings?.(data);
    setSavingBooking(false);
  }
  async function saveBookingSettings() {
    if (savingBooking) return; setSavingBooking(true); setBookingMsg('');
    const { data, error } = await supabase.from('user_settings').upsert({ user_id: userId, zoom_link: zoomLink.trim() || null, booking_phone: bookingPhone.trim() || null, office_address: officeAddress.trim() || null, booking_types: (bkTypes.length?bkTypes:['phone']), booking_durations: (bkDur.length?bkDur:[30]), booking_min_notice_min: Math.max(0, Math.round((parseFloat(minNoticeH)||2)*60)), booking_horizon_days: Math.max(1, Math.min(365, parseInt(horizonD)||21)), updated_at: new Date().toISOString() }, { onConflict: 'user_id' }).select().maybeSingle();
    if (error) setBookingMsg('Error: ' + error.message); else { if (data) setUserSettings?.(data); setBookingMsg('Saved.'); }
    setSavingBooking(false);
  }
  function copyBookingUrl() { try { navigator.clipboard.writeText(bookingUrl); if (window.__notify) window.__notify('Link copied', 'success'); } catch (_) {} }
  const [savingAbout, setSavingAbout] = useState(false);
  const [aboutMsg, setAboutMsg] = useState('');

  // Email/text signatures — how PrismOS signs the messages it drafts for THIS user.
  const [emailSig, setEmailSig] = useState(userSettings?.email_signature ?? '');
  const [textSig, setTextSig] = useState(userSettings?.text_signature ?? '');
  const [savingSig, setSavingSig] = useState(false);
  const [sigMsg, setSigMsg] = useState('');
  const sigNameDefault = displayName || user?.user_metadata?.full_name || (user?.email ? user.email.split('@')[0] : 'your name');
  async function saveSignatures() {
    if (savingSig) return; setSavingSig(true); setSigMsg('');
    const { data, error } = await supabase.from('user_settings').upsert({ user_id: userId, email_signature: emailSig.trim() || null, text_signature: textSig.trim() || null, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }).select().maybeSingle();
    if (error) setSigMsg('Error: ' + error.message); else { if (data) setUserSettings?.(data); setSigMsg('Saved — new drafts will use this.'); }
    setSavingSig(false);
  }

  // Module visibility — both default visible if missing
  const mv = userSettings?.module_visibility || {};
  const propsVisible = mv.properties !== false;
  const invVisible = mv.investments !== false;
  const [moduleMsg, setModuleMsg] = useState('');

  // Sync local state if userSettings prop changes underneath us (e.g. after first
  // onboarding submit + loadData refresh).
  useEffect(() => {
    if (userSettings) {
      setProfession(userSettings.profession || '');
      setAssistantContext(userSettings.assistant_context || '');
      setTimezone(userSettings.timezone || '');
      setOfficeAddress(userSettings.office_address || '');
      setZoomLink(userSettings.zoom_link || '');
      setBookingPhone(userSettings.booking_phone || '');
      setBkTypes(Array.isArray(userSettings.booking_types) ? userSettings.booking_types : ['phone','zoom','google_meet','office','property','other']);
      setBkDur(Array.isArray(userSettings.booking_durations) ? userSettings.booking_durations : [30,60,90,120]);
      setMinNoticeH(String(Math.round((userSettings.booking_min_notice_min ?? 120)/60)));
      setHorizonD(String(userSettings.booking_horizon_days ?? 21));
    }
  }, [userSettings]);

  useEffect(() => { (async () => { try { const { data } = await supabase.from('ari_briefing_prefs').select('enabled,send_hour,delivery_account_id').eq('user_id', userId).maybeSingle(); if (data) { setBriefEnabled(!!data.enabled); setBriefHour(data.send_hour ?? 7); setBriefAcct(data.delivery_account_id ?? null); } } catch(e){} })(); }, []); // eslint-disable-line
  useEffect(() => { (async () => { try { if (!('serviceWorker' in navigator) || !('PushManager' in window)) return; const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub && typeof Notification!=='undefined' && Notification.permission==='granted') { const j=sub.toJSON(); await supabase.from('push_subscriptions').upsert({ user_id: userId, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent }, { onConflict: 'user_id,endpoint' }); setPushOn(true); } else { setPushOn(false); } } catch(e){} })(); }, []); // eslint-disable-line
  async function enablePush() {
    setPushBusy(true); setPushMsg('');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') { setPushMsg('Notifications aren’t supported on this device/browser.'); setPushBusy(false); return; }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setPushMsg('Permission was not granted. On iPhone, add PrismOS to your Home Screen first, then enable.'); setPushBusy(false); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
      const j = sub.toJSON();
      const { error: upErr } = await supabase.from('push_subscriptions').upsert({ user_id: userId, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent }, { onConflict: 'user_id,endpoint' });
      if (upErr) { setPushMsg('Could not save device: ' + upErr.message); setPushBusy(false); return; }
      setPushOn(true); setPushMsg('Notifications enabled on this device.');
    } catch (e) { setPushMsg('Could not enable: ' + (e.message || e)); }
    setPushBusy(false);
  }
  async function testPush() {
    setPushBusy(true); setPushMsg('');
    try {
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub && typeof Notification!=='undefined' && Notification.permission==='granted') sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) });
      if (sub) { const j=sub.toJSON(); await supabase.from('push_subscriptions').upsert({ user_id: userId, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent }, { onConflict: 'user_id,endpoint' }); setPushOn(true); }
    } catch(e){}
    const { data, error } = await supabase.functions.invoke('push-send', { body: { title: 'Ari test ☀️', body: 'Push notifications are working.', url: 'https://darasapp.com' } });
    setPushBusy(false);
    setPushMsg(error || data?.error ? ('Test failed: ' + (error?.message || data?.error)) : (data?.sent ? `Sent to ${data.sent} device(s) — check your phone.` : 'Tap Enable notifications first, then test.'));
  }
  async function saveBrief(nextEnabled, nextHour, nextAcct) {
    setSavingBrief(true); setBriefMsg('');
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'America/New_York';
    const acct = (nextAcct === undefined ? briefAcct : nextAcct) || null;
    const { error } = await supabase.from('ari_briefing_prefs').upsert({ user_id: userId, enabled: nextEnabled, send_hour: nextHour, tz, delivery_account_id: acct, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    setSavingBrief(false);
    setBriefMsg(error ? ('Error: ' + error.message) : 'Saved.');
  }
  async function handleNameSave(e) {
    e.preventDefault(); setSavingName(true); setNameMsg('');
    const { error } = await supabase.auth.updateUser({ data: { display_name: displayName.trim() } });
    if (error) setNameMsg('Error: '+error.message);
    else setNameMsg('Display name updated.');
    setSavingName(false);
  }

  async function handlePriorityPref(value) {
    setSavingPref(true); setPrefMsg('');
    const { error } = await supabase.auth.updateUser({ data: { priority_system: value } });
    if (error) setPrefMsg('Error: '+error.message);
    else { setPrefMsg('Priority system updated.'); onPriorityPrefChange?.(value); }
    setSavingPref(false);
  }

  async function handlePasswordChange(e) {
    e.preventDefault(); setSaving(true); setMsg('');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) setMsg('Error: '+error.message);
    else { setMsg('Password updated.'); setNewPassword(''); }
    setSaving(false);
  }

  async function handleAboutSave(e) {
    e.preventDefault(); setSavingAbout(true); setAboutMsg('');
    const payload = {
      user_id: userId,
      profession: profession.trim() || null,
      assistant_context: assistantContext.trim() || null,
      timezone: timezone.trim() || null,
      office_address: officeAddress.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from('user_settings')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .maybeSingle();
    if (error) {
      setAboutMsg('Error: ' + error.message);
      setSavingAbout(false);
      return;
    }
    if (data) setUserSettings?.(data);
    setAboutMsg('Saved. Your assistant will use this on the next request.');
    setSavingAbout(false);
  }

  async function toggleModule(key, nextValue) {
    setModuleMsg('');
    const newMv = { ...mv, [key]: nextValue };
    const payload = {
      user_id: userId,
      module_visibility: newMv,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from('user_settings')
      .upsert(payload, { onConflict: 'user_id' })
      .select()
      .maybeSingle();
    if (error) {
      setModuleMsg('Error: ' + error.message);
      return;
    }
    if (data) setUserSettings?.(data);
  }

  const autoScheduleOn = userSettings?.auto_schedule_tasks === true; // default OFF
  const [savingAuto, setSavingAuto] = React.useState(false);
  const [autoMsg, setAutoMsg] = React.useState('');
  async function toggleAutoSchedule() {
    if (savingAuto) return;
    const next = !autoScheduleOn;
    setSavingAuto(true); setAutoMsg('');
    const { data, error } = await supabase.from('user_settings')
      .upsert({ user_id: userId, auto_schedule_tasks: next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .select().maybeSingle();
    if (error) { setAutoMsg('Error: ' + error.message); setSavingAuto(false); return; }
    if (data) setUserSettings?.(data);
    // Apply right away so the calendar reflects it without waiting for the cron.
    try { await supabase.functions.invoke('task-autoschedule', { body: {} }); } catch (_) {}
    setAutoMsg(next ? 'On — your tasks will be scheduled onto your calendar.' : 'Off — auto-scheduled blocks removed from your calendar.');
    setSavingAuto(false);
  }

  const researchModel = userSettings?.ai_research_model || 'sonnet';
  const [savingModel, setSavingModel] = React.useState(false);
  const [modelMsg, setModelMsg] = React.useState('');
  async function saveResearchModel(val) {
    setSavingModel(true); setModelMsg('');
    const { data, error } = await supabase.from('user_settings')
      .upsert({ user_id: userId, ai_research_model: val, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .select().maybeSingle();
    if (error) { setModelMsg('Error: ' + error.message); setSavingModel(false); return; }
    if (data) setUserSettings && setUserSettings(data);
    setModelMsg(val === 'opus' ? 'Your deep research now uses Claude Opus 4.8 (deeper, more tokens).' : 'Your deep research now uses Claude Sonnet 4.6 (fast, economical).');
    setSavingModel(false);
  }
  // ── Bring-your-own Claude key (BYOK) ──
  const [aiKey, setAiKey] = React.useState(null);
  const [aiKeyInput, setAiKeyInput] = React.useState('');
  const [aiKeyBusy, setAiKeyBusy] = React.useState(false);
  const [aiKeyMsg, setAiKeyMsg] = React.useState('');
  React.useEffect(() => { (async () => {
    try { const { data } = await supabase.functions.invoke('ai-key-manage', { body: { action: 'status' } }); if (data && data.key) setAiKey(data.key); } catch (_) {}
  })(); }, []);
  async function saveAiKey() {
    if (!aiKeyInput.trim()) return;
    setAiKeyBusy(true); setAiKeyMsg('');
    try {
      const { data, error } = await supabase.functions.invoke('ai-key-manage', { body: { action: 'set', key: aiKeyInput.trim() } });
      let msg = error ? (error.message || 'Failed') : null;
      if (error) { try { const b = await error.context.json(); if (b && b.error) msg = b.error; } catch (_) {} }
      if (msg) { setAiKeyMsg(msg); setAiKeyBusy(false); return; }
      setAiKey({ last4: data.last4, status: 'active' }); setAiKeyInput(''); setAiKeyMsg('Saved — your AI now runs on your own Anthropic key.');
    } catch (e) { setAiKeyMsg(String(e.message || e)); }
    setAiKeyBusy(false);
  }
  async function removeAiKey() {
    setAiKeyBusy(true); setAiKeyMsg('');
    try { await supabase.functions.invoke('ai-key-manage', { body: { action: 'remove' } }); setAiKey(null); setAiKeyMsg('Removed — your AI now runs on the brokerage account.'); } catch (_) {}
    setAiKeyBusy(false);
  }
  // ── Owner: per-agent AI usage this month (EST billing window) ──
  const [usageRows, setUsageRows] = React.useState(null);
  React.useEffect(() => { if (!isAdmin) return; (async () => {
    try {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
      const { data } = await supabase.rpc('ai_usage_rollup', { p_start: start, p_end: end });
      setUsageRows(data || []);
    } catch (_) { setUsageRows([]); }
  })(); }, [isAdmin]);
  return (
    <div className="ww-prism">
      <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 24% at 50% -3%, rgba(203,163,92,.08), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h1,.ww-prism h2,.ww-prism h3{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .btn-add-circle{background:#EBCB82;color:#1a1409;} .ww-prism .form-input,.ww-prism .form-select,.ww-prism .form-textarea{background:#1B1610;border:1px solid rgba(203,163,92,.22);color:#F6F1E7;} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style>
      <div className="page-header"><div><h2 style={{display:'flex',alignItems:'center',gap:'10px',margin:0,fontFamily:'Fraunces, serif',fontWeight:300,fontSize:'30px',letterSpacing:'-0.02em'}}><Icon name="settings" size={24} style={{color:'var(--accent)',flexShrink:0}} />Settings</h2><p>Manage your account</p></div></div>
      <div style={{maxWidth:'480px'}}>
        {settingsTab === null ? (
          <div>
            {[
              { id:'setup', icon:'🔌', label:'App Setup', desc:'Cloud storage, iPhone sharing, email, booking, modules' },
              { id:'prefs', icon:'⚙️', label:'Preferences', desc:'Profile, learning pace, tasks, briefings, tax' },
              { id:'ai', icon:'✦', label:'AI & Usage', desc:'Claude API key, research model, monthly cost' },
              { id:'account', icon:'👤', label:'Account', desc:'Sign-in, password, about' },
            ].map(cat => (
              <button key={cat.id} onClick={()=>setSettingsTab(cat.id)} className="panel" style={{display:'flex',alignItems:'center',gap:'14px',width:'100%',textAlign:'left',padding:'16px 18px',marginBottom:'12px',cursor:'pointer',background:'linear-gradient(180deg,#18130D,#100D09)'}}>
                <span style={{fontSize:'22px'}}>{cat.icon}</span>
                <span style={{flex:1,minWidth:0}}>
                  <span style={{display:'block',fontSize:'15px',fontWeight:700,color:'var(--text-1)',fontFamily:'Fraunces, serif'}}>{cat.label}</span>
                  <span style={{display:'block',fontSize:'12px',color:'var(--text-3)',marginTop:'2px'}}>{cat.desc}</span>
                </span>
                <span style={{color:'var(--accent)',fontSize:'20px'}}>→</span>
              </button>
            ))}
          </div>
        ) : (
          <div>
            <button onClick={()=>setSettingsTab(null)} className="btn btn-ghost btn-sm" style={{marginBottom:'14px'}}>← All settings</button>
            {settingsTab==='setup' && <>
        <CloudStorageSettings userId={userId} />
        <IosSharingSettings userId={userId} />
        <div className="panel" style={{marginBottom:'18px', border:'1px solid var(--accent-dim)'}}>
          <div className="panel-header"><h3>Email &amp; text signatures</h3></div>
          <div className="panel-body">
            <p style={{fontSize:'12.5px', color:'var(--text-2)', lineHeight:1.5, marginTop:0}}>How PrismOS signs the emails and texts it drafts <b>for you</b>. Every draft is signed with <i>your</i> signature — never anyone else's.</p>
            <div className="form-group" style={{marginBottom:'14px'}}>
              <label className="form-label">Email signature</label>
              <textarea className="form-input" rows={4} value={emailSig} onChange={e=>setEmailSig(e.target.value)} placeholder={`${sigNameDefault}\nRealty ONE Group Advantage\n(813) 555-0123`} style={{resize:'vertical', fontFamily:'inherit'}} />
              <div style={{fontSize:'11px', color:'var(--text-3)', marginTop:'4px'}}>Appears at the end of drafted emails. Leave blank to sign with just your name (<b>{sigNameDefault}</b>).</div>
            </div>
            <div className="form-group" style={{marginBottom:'12px'}}>
              <label className="form-label">Text signature</label>
              <input className="form-input" value={textSig} onChange={e=>setTextSig(e.target.value)} placeholder={`\u2013 ${(sigNameDefault||'').split(/\s+/)[0]}`} />
              <div style={{fontSize:'11px', color:'var(--text-3)', marginTop:'4px'}}>Short sign-off for texts. Leave blank to sign with just your first name.</div>
            </div>
            <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
              <button className="btn btn-primary btn-sm" disabled={savingSig} onClick={saveSignatures}>{savingSig ? 'Saving…' : 'Save signatures'}</button>
              {sigMsg && <span style={{fontSize:'12px', color: /error/i.test(sigMsg)?'var(--red)':'var(--green)'}}>{sigMsg}</span>}
            </div>
          </div>
        </div>
        <div className="panel" style={{marginBottom:'18px', border:'1px solid var(--accent-dim)'}}>
          <div className="panel-header"><h3>Booking page</h3></div>
          <div className="panel-body">
            <p style={{fontSize:'12.5px', color:'var(--text-2)', lineHeight:1.5, marginTop:0}}>Let clients book meetings on your calendar from a shareable link. Open times come from your <b>Work Hours</b> minus your Google Calendar and buffers. Google Meet links are created automatically per booking.</p>
            <div style={{display:'flex', alignItems:'center', gap:'14px', margin:'6px 0 14px'}}>
              <div style={{flex:1, minWidth:0}}><b style={{fontSize:'13.5px'}}>Enable my booking page</b></div>
              <button onClick={toggleBooking} role="switch" aria-checked={bookingEnabled} disabled={savingBooking} style={{flexShrink:0, width:48, height:28, borderRadius:999, border:'none', cursor: savingBooking?'wait':'pointer', background: bookingEnabled?'var(--accent)':'var(--border-strong)', position:'relative', transition:'background .15s'}}>
                <span style={{position:'absolute', top:3, left: bookingEnabled?23:3, width:22, height:22, borderRadius:'50%', background:'#fff', transition:'left .15s'}} />
              </button>
            </div>
            {bookingEnabled && bookingUrl && (
              <div style={{marginBottom:'14px'}}>
                <label className="form-label">Your shareable link</label>
                <div style={{display:'flex', gap:'8px', flexWrap:'wrap'}}>
                  <input className="form-input" readOnly value={bookingUrl} style={{flex:'1 1 180px'}} onFocus={e=>e.target.select()} />
                  <button className="btn btn-ghost" onClick={copyBookingUrl}>Copy</button>
                  <a className="btn btn-ghost" href={bookingUrl} target="_blank" rel="noopener noreferrer">Open</a>
                </div>
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Zoom personal link <span style={{color:'var(--text-3)', fontWeight:400}}>(used for Zoom meetings)</span></label>
              <input className="form-input" value={zoomLink} onChange={e=>setZoomLink(e.target.value)} placeholder="https://zoom.us/j/your-personal-room" />
            </div>
            <div className="form-group">
              <label className="form-label">Callback number <span style={{color:'var(--text-3)', fontWeight:400}}>(for phone meetings)</span></label>
              <input className="form-input" value={bookingPhone} onChange={e=>setBookingPhone(e.target.value)} placeholder="e.g. (813) 555-0123" />
            </div>
            <div style={{fontSize:'11.5px', color:'var(--text-3)', marginBottom:'14px', lineHeight:1.5}}>Your <b>office address</b> (for office meetings) is set under “About you” above. Google Meet links are generated automatically.</div>

            <div style={{height:1, background:'var(--border)', margin:'4px 0 14px'}} />
            <label className="form-label">Meeting types you offer</label>
            <div style={{display:'flex', flexWrap:'wrap', gap:'8px', marginBottom:'14px'}}>
              {ALL_MTYPES.map(([id,label])=>{ const on=bkTypes.includes(id); return (
                <button key={id} onClick={()=>toggleIn(bkTypes,id,setBkTypes)} style={{padding:'8px 12px', borderRadius:999, fontSize:12.5, fontWeight:700, cursor:'pointer', border:`1px solid ${on?'var(--accent)':'var(--border)'}`, background:on?'rgba(197,169,94,0.14)':'transparent', color:on?'var(--accent)':'var(--text-3)'}}>{on?'✓ ':''}{label}</button>
              );})}
            </div>
            <label className="form-label">Durations you offer</label>
            <div style={{display:'flex', flexWrap:'wrap', gap:'8px', marginBottom:'14px'}}>
              {ALL_DUR.map(([v,label])=>{ const on=bkDur.includes(v); return (
                <button key={v} onClick={()=>toggleIn(bkDur,v,setBkDur)} style={{padding:'8px 12px', borderRadius:999, fontSize:12.5, fontWeight:700, cursor:'pointer', border:`1px solid ${on?'var(--accent)':'var(--border)'}`, background:on?'rgba(197,169,94,0.14)':'transparent', color:on?'var(--accent)':'var(--text-3)'}}>{on?'✓ ':''}{label}</button>
              );})}
            </div>
            <div style={{display:'flex', gap:'10px', marginBottom:'14px'}}>
              <div style={{flex:1}}><label className="form-label">Min notice (hours)</label><input className="form-input" type="number" min="0" value={minNoticeH} onChange={e=>setMinNoticeH(e.target.value)} /></div>
              <div style={{flex:1}}><label className="form-label">Bookable out (days)</label><input className="form-input" type="number" min="1" value={horizonD} onChange={e=>setHorizonD(e.target.value)} /></div>
            </div>
            <div style={{display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap'}}>
              <button className="btn btn-primary" disabled={savingBooking} onClick={saveBookingSettings}>{savingBooking?'Saving…':'Save booking settings'}</button>
              <button className="btn btn-ghost" onClick={()=>setShowBookings(true)}>Manage bookings</button>
            </div>
            {bookingMsg && <div style={{marginTop:'10px', fontSize:'12px', color: bookingMsg.startsWith('Error')?'var(--red)':'var(--text-2)'}}>{bookingMsg}</div>}
            {showBookings && <BookingsManagerModal userId={userId} slug={bookingSlug} onClose={()=>setShowBookings(false)} />}
          </div>
        </div>
        <div className="panel" style={{marginBottom:'18px'}}>
          <div className="panel-header"><h3>Simplify PrismOS</h3></div>
          <div className="panel-body">
            {moduleMsg && <div className={moduleMsg.startsWith('Error')?'auth-error':'auth-success'} style={{marginBottom:'12px'}}>{moduleMsg}</div>}
            <p style={{fontSize:'13px',color:'var(--text-2)',margin:'0 0 14px',lineHeight:1.5}}>
              Turn off pages you don&rsquo;t use to declutter every menu. Your data stays — flip a page back on any time. A few essentials (Today, Settings) can&rsquo;t be turned off.
            </p>
            <SimplifyPanel mv={mv} role={isAdmin ? 'admin' : 'agent'} onToggle={toggleModule} />
          </div>
        </div>
        <div className="panel" style={{marginBottom:'18px'}}>
          <div className="panel-header"><h3>Unlock features</h3></div>
          <div className="panel-body">
            <p style={{fontSize:'13px',color:'var(--text-2)',margin:'0 0 14px',lineHeight:1.5}}>
              Have an unlock code from your broker? Enter it to turn on additional features on this account.
            </p>
            <RedeemCodeBox onRedeemed={reloadEntitlements} />
            {Array.isArray(entitlements) && entitlements.length > 0 && (
              <div style={{marginTop:'14px',fontSize:'12px',color:'var(--text-3)'}}>
                Unlocked: {entitlements.join(', ')}
              </div>
            )}
          </div>
        </div>
        {isAdmin && <AdminLicensingPanel userId={userId} />}
        <EmailAccountsPanel emailAccounts={emailAccounts || []} setEmailAccounts={setEmailAccounts} />
        <CubeACRPanel userId={userId} emailAccounts={emailAccounts || []} />
        <EmailAliasesPanel emailAliases={emailAliases || []} setEmailAliases={setEmailAliases} emailAccounts={emailAccounts || []} userId={userId} />
            </>}
            {settingsTab==='prefs' && <>
              <CoachSettings userId={userId} />
        <TipsSetting />
        <React.Suspense fallback={<div style={{height:'1px'}} />}><QuarterlyTaxBanner userId={userId} /></React.Suspense>
        <div className="panel" style={{marginBottom:'18px'}}>
          <div className="panel-header"><h3>Auto-schedule tasks on calendar</h3></div>
          <div className="panel-body">
            <div style={{display:'flex', alignItems:'center', gap:'14px'}}>
              <p style={{flex:1, minWidth:0, fontSize:'12.5px', color:'var(--text-2)', lineHeight:1.5, margin:0}}>When on, Prism automatically places tasks that have an estimated duration into open blocks on your calendar. Turn it off to keep those blocks off your calendar — your tasks stay in your task list either way.</p>
              <button onClick={toggleAutoSchedule} role="switch" aria-checked={autoScheduleOn} disabled={savingAuto} title={autoScheduleOn ? 'On' : 'Off'} style={{flexShrink:0, width:48, height:28, borderRadius:999, border:'none', cursor: savingAuto?'wait':'pointer', background: autoScheduleOn ? 'var(--accent)' : 'var(--border-strong)', position:'relative', transition:'background .15s'}}>
                <span style={{position:'absolute', top:3, left: autoScheduleOn?23:3, width:22, height:22, borderRadius:'50%', background:'#fff', transition:'left .15s'}} />
              </button>
            </div>
            {autoMsg && <div style={{marginTop:'10px', fontSize:'12px', color: autoMsg.startsWith('Error')?'var(--red)':'var(--text-2)'}}>{autoMsg}</div>}
          </div>
        </div>
        <div className="panel" style={{marginBottom:'18px'}}>
          <div className="panel-header"><h3>Profile</h3></div>
          <div className="panel-body">
            {nameMsg&&<div className={nameMsg.startsWith('Error')?'auth-error':'auth-success'} style={{marginBottom:'12px'}}>{nameMsg}</div>}
            <form onSubmit={handleNameSave}>
              <div className="form-group"><label className="form-label">Greeting Name</label><input className="form-input" value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="e.g., Dara" maxLength={60} /><div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'4px'}}>Used to greet you across PrismOS — e.g., “Good morning, Dara.” in your Ari Briefing.</div></div>
              <button className="btn btn-primary" disabled={savingName}>{savingName?'Saving…':'Save Name'}</button>
            </form>
          </div>
        </div>
        <div className="panel" style={{marginBottom:'18px'}}>
          <div className="panel-header"><h3>Task Preferences</h3></div>
          <div className="panel-body">
            {prefMsg&&<div className={prefMsg.startsWith('Error')?'auth-error':'auth-success'} style={{marginBottom:'12px'}}>{prefMsg}</div>}
            <div className="form-group">
              <label className="form-label">Default Priority System</label>
              <select className="form-select" value={priorityPref||'eisenhower'} onChange={e=>handlePriorityPref(e.target.value)} disabled={savingPref}>
                <option value="eisenhower">Eisenhower (A1, A2, B1…)</option>
                <option value="simple">Simple (High / Medium / Low)</option>
              </select>
              <p style={{fontSize:'12px',color:'var(--text-2)',marginTop:'8px',lineHeight:1.5}}>
                Sets the default for new tasks. You can still switch systems per-task in the task editor.
                Eisenhower groups by quadrant (A=urgent+important, B=important, C=urgent, D=neither) and ranks within each.
              </p>
            </div>
          </div>
        </div>
        <div className="panel" style={{marginBottom:'18px'}}>
          <div className="panel-header"><h3>Ari Briefing Delivery</h3></div>
          <div className="panel-body">
            {briefMsg&&<div className={briefMsg.startsWith('Error')?'auth-error':'auth-success'} style={{marginBottom:'12px'}}>{briefMsg}</div>}
            <label style={{display:'flex',alignItems:'center',gap:'10px',cursor:'pointer',marginBottom:'14px'}}>
              <input type="checkbox" checked={briefEnabled} onChange={e=>{ setBriefEnabled(e.target.checked); saveBrief(e.target.checked, briefHour); }}/>
              <span style={{fontSize:'14px',fontWeight:600}}>Email me my briefing every morning</span>
            </label>
            <div className="form-group" style={{opacity:briefEnabled?1:0.5}}>
              <label className="form-label">Deliver from / to</label>
              <select className="form-select" value={briefAcct||''} disabled={!briefEnabled||savingBrief} onChange={e=>{ const v=e.target.value||null; setBriefAcct(v); saveBrief(briefEnabled, briefHour, v); }}>
                {!briefAcct && <option value="">Default (first email account)</option>}
                {(emailAccounts||[]).map(a=><option key={a.id} value={a.id}>{a.email_address||a.email}</option>)}
              </select>
              <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'4px'}}>The morning briefing (and its voicemail) is emailed from and to this connected account.</div>
            </div>
            <div className="form-group" style={{opacity:briefEnabled?1:0.5}}>
              <label className="form-label">Delivery time</label>
              <select className="form-select" value={briefHour} disabled={!briefEnabled||savingBrief} onChange={e=>{ const h=parseInt(e.target.value,10); setBriefHour(h); saveBrief(briefEnabled,h); }}>
                {[5,6,7,8,9,10,11].map(h=><option key={h} value={h}>{h}:00 AM</option>)}
              </select>
              <p style={{fontSize:'12px',color:'var(--text-2)',marginTop:'8px',lineHeight:1.5}}>Each morning at this time, Ari generates your briefing and emails it to your connected inbox &mdash; your reach-outs, tasks, and calendar in one note, with a spoken “voicemail” recording attached. Open the app to send the drafted replies. Uses your current time zone.</p>
            </div>
            <div style={{borderTop:'1px solid var(--border)',marginTop:'16px',paddingTop:'16px'}}>
              <div style={{fontSize:'14px',fontWeight:600,marginBottom:'4px'}}>Phone notifications</div>
              <p style={{fontSize:'12px',color:'var(--text-2)',margin:'0 0 12px',lineHeight:1.5}}>Get a push notification on this device when your briefing is ready. {pushOn ? 'Enabled on this device.' : 'Not enabled on this device yet.'}</p>
              {pushMsg && <div style={{fontSize:'12px',color:pushMsg.toLowerCase().includes('fail')||pushMsg.toLowerCase().includes('not')||pushMsg.toLowerCase().includes('could')?'var(--red)':'var(--green)',marginBottom:'10px'}}>{pushMsg}</div>}
              <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
                {!pushOn && <button className="btn btn-primary btn-sm" disabled={pushBusy} onClick={enablePush}>{pushBusy?'…':'Enable notifications'}</button>}
                {pushOn && <button className="btn btn-ghost btn-sm" disabled={pushBusy} onClick={testPush}>{pushBusy?'…':'Send test notification'}</button>}
              </div>
            </div>
          </div>
        </div>
        <WorkingHoursSection userId={userId} />
        <AriPermissionsPanel userId={userId} />
        <div className="panel" style={{marginBottom:'18px'}}>
          <div className="panel-header"><h3>About you</h3></div>
          <div className="panel-body">
            {aboutMsg && <div className={aboutMsg.startsWith('Error')?'auth-error':'auth-success'} style={{marginBottom:'12px'}}>{aboutMsg}</div>}
            <p style={{fontSize:'13px',color:'var(--text-2)',margin:'0 0 14px',lineHeight:1.5}}>
              Your AI assistant uses this to tailor responses. The more context, the better.
            </p>
            <form onSubmit={handleAboutSave}>
              <div className="form-group">
                <label className="form-label">What do you do?</label>
                <input
                  className="form-input"
                  type="text"
                  value={profession}
                  onChange={e=>setProfession(e.target.value)}
                  placeholder="e.g. Real estate broker, Doctor, Engineer"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Timezone</label>
                <input
                  className="form-input"
                  type="text"
                  value={timezone}
                  onChange={e=>setTimezone(e.target.value)}
                  placeholder="e.g. America/New_York"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Tell your assistant about you</label>
                <textarea
                  className="form-input"
                  rows={5}
                  value={assistantContext}
                  onChange={e=>setAssistantContext(e.target.value)}
                  placeholder="A few sentences about your work, priorities, who you serve, what matters."
                  style={{resize:'vertical',fontFamily:'inherit',minHeight:'110px'}}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Office address</label>
                <input
                  className="form-input"
                  value={officeAddress}
                  onChange={e=>setOfficeAddress(e.target.value)}
                  placeholder="e.g. 123 Main St, Suite 200, Lutz, FL 33549"
                />
              </div>
              <button className="btn btn-primary" disabled={savingAbout}>{savingAbout?'Saving…':'Save'}</button>
            </form>
          </div>
        </div>
            </>}
            {settingsTab==='ai' && <>
        <div className="panel" style={{marginBottom:'18px'}}>
          <div className="panel-header"><h3>Your Claude API key</h3></div>
          <div className="panel-body">
            <p style={{fontSize:'12.5px', color:'var(--text-2)', lineHeight:1.5, marginTop:0}}>Optional. Add your own Anthropic <b>API</b> key and your AI features run on your account — you pay Anthropic directly. Leave it empty to use the brokerage account. (An API key from console.anthropic.com — not a Claude.ai chat subscription.)</p>
            {aiKey && aiKey.status === 'active' ? (
              <div style={{display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap'}}>
                <span style={{fontSize:'13px', color:'var(--text-1)'}}>Connected: <b>sk-ant-…{aiKey.last4}</b></span>
                <span style={{fontSize:'11px', fontWeight:700, color:'#22c55e', border:'1px solid #22c55e55', borderRadius:999, padding:'2px 8px'}}>Active</span>
                <button className="btn btn-ghost btn-sm" disabled={aiKeyBusy} onClick={removeAiKey}>Remove</button>
              </div>
            ) : (
              <div style={{display:'flex', gap:'8px', flexWrap:'wrap'}}>
                <input className="form-input" type="password" value={aiKeyInput} onChange={e=>setAiKeyInput(e.target.value)} placeholder="sk-ant-…" style={{flex:'1 1 240px'}} />
                <button className="btn btn-primary" disabled={aiKeyBusy || !aiKeyInput.trim()} onClick={saveAiKey}>{aiKeyBusy?'Checking…':'Test & Save'}</button>
              </div>
            )}
            {aiKeyMsg && <div style={{marginTop:'10px', fontSize:'12px', color: /error|reject|failed|doesn|Anthropic rejected/i.test(aiKeyMsg)?'var(--red)':'var(--text-2)'}}>{aiKeyMsg}</div>}
          </div>
        </div>
        {isAdmin && (
        <div className="panel" style={{marginBottom:'18px', border:'1px solid var(--accent-dim)'}}>
          <div className="panel-header"><h3>AI model for deep research</h3></div>
          <div className="panel-body">
            <p style={{fontSize:'12.5px', color:'var(--text-2)', lineHeight:1.5, marginTop:0}}>Contact web-research runs in the background. Pick the engine for <b>your</b> research — agents always use Sonnet.</p>
            <div style={{display:'flex', gap:'10px', flexWrap:'wrap'}}>
              {[{v:'sonnet', t:'Sonnet 4.6', d:'Fast · economical · default'}, {v:'opus', t:'Opus 4.8', d:'Deepest · more tokens'}].map(o=>{ const on = researchModel===o.v; return (
                <button key={o.v} disabled={savingModel} onClick={()=>saveResearchModel(o.v)} style={{flex:'1 1 170px', textAlign:'left', padding:'12px 14px', borderRadius:'12px', cursor:'pointer', border:`1px solid ${on?'var(--accent)':'var(--border)'}`, background: on?'rgba(197,169,94,0.12)':'transparent'}}>
                  <div style={{fontSize:'14px', fontWeight:800, color: on?'var(--accent)':'var(--text-1)'}}>{o.t}{on?' ✓':''}</div>
                  <div style={{fontSize:'11.5px', color:'var(--text-3)', marginTop:'2px'}}>{o.d}</div>
                </button>); })}
            </div>
            {modelMsg && <div style={{marginTop:'10px', fontSize:'12px', color: modelMsg.startsWith('Error')?'var(--red)':'var(--text-2)'}}>{modelMsg}</div>}
          </div>
        </div>
        )}
        {isAdmin && (
        <div className="panel" style={{marginBottom:'18px'}}>
          <div className="panel-header"><h3>AI usage & cost — this month</h3></div>
          <div className="panel-body">
            <p style={{fontSize:'12.5px', color:'var(--text-2)', lineHeight:1.5, marginTop:0}}>Per-agent Claude usage on the <b>brokerage account</b> (what you could bill back). Every agent with a login is listed; agents on their own key are billed by Anthropic and shown separately.</p>
            {usageRows === null ? <div style={{fontSize:'12px', color:'var(--text-3)'}}>Loading…</div> : usageRows.length === 0 ? <div style={{fontSize:'12px', color:'var(--text-3)'}}>No agents with logins yet.</div> : (
              <div style={{display:'flex', flexDirection:'column', gap:'2px'}}>
                {usageRows.map((r,i)=>(
                  <div key={i} style={{display:'flex', justifyContent:'space-between', gap:'10px', fontSize:'12.5px', padding:'7px 0', borderBottom:'1px solid var(--border)'}}>
                    <span style={{color: Number(r.platform_cost_usd||0)>0 ? 'var(--text-1)':'var(--text-3)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{r.email || 'Unknown'}{Number(r.calls||0)>0 ? <span style={{color:'var(--text-3)', fontWeight:400}}> · {r.calls} calls</span> : null}</span>
                    <span style={{flexShrink:0}}><span style={{color: Number(r.platform_cost_usd||0)>0 ? 'var(--accent)':'var(--text-3)', fontWeight:700}}>${Number(r.platform_cost_usd||0).toFixed(2)}</span>{Number(r.own_key_cost_usd||0)>0 ? <span style={{color:'var(--text-3)'}}> (+${Number(r.own_key_cost_usd).toFixed(2)} own key)</span> : null}</span>
                  </div>
                ))}
                <div style={{display:'flex', justifyContent:'space-between', gap:'10px', fontSize:'13px', padding:'10px 0 2px', marginTop:'2px', fontWeight:700}}>
                  <span style={{color:'var(--text-2)'}}>Total ({usageRows.length} agents)</span>
                  <span style={{color:'var(--accent-2)'}}>${usageRows.reduce((s,r)=>s+Number(r.platform_cost_usd||0),0).toFixed(2)}</span>
                </div>
                <p style={{fontSize:'11px', color:'var(--text-3)', lineHeight:1.5, marginTop:'8px', marginBottom:0}}>Costs reflect AI features that record usage. We're expanding logging so every AI action (briefings, planning, call &amp; recording analysis, orchestrations) is captured — until then, totals may run higher than shown.</p>
              </div>
            )}
          </div>
        </div>
        )}
            </>}
            {settingsTab==='account' && <>
        <div className="panel" style={{marginBottom:'18px'}}>
          <div className="panel-header"><h3>Account</h3></div>
          <div className="panel-body">
            <div className="form-group"><label className="form-label">Email</label><input className="form-input" value={user?.email||''} disabled style={{opacity:0.6}} /></div>
            <div className="form-group"><label className="form-label">User ID</label><input className="form-input" value={user?.id||''} disabled style={{opacity:0.6,fontSize:'11px'}} /></div>
          </div>
        </div>
        <div className="panel">
          <div className="panel-header"><h3>Change Password</h3></div>
          <div className="panel-body">
            {msg&&<div className={msg.startsWith('Error')?'auth-error':'auth-success'} style={{marginBottom:'12px'}}>{msg}</div>}
            <form onSubmit={handlePasswordChange}>
              <div className="form-group"><label className="form-label">New Password</label><input className="form-input" type="password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="Min 6 characters" required minLength={6} /></div>
              <button className="btn btn-primary" disabled={saving}>{saving?'Saving…':'Update Password'}</button>
            </form>
          </div>
        </div>
        <div className="panel" style={{marginBottom:'18px'}}>
          <div className="panel-header"><h3>About</h3></div>
          <div className="panel-body">
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px',flexWrap:'wrap'}}>
              <div>
                <div style={{fontWeight:700,color:'var(--text-1)',fontSize:'15px'}}>PrismOS</div>
                <div style={{fontSize:'12px',color:'var(--text-3)',marginTop:'2px'}}>Build {BUILD_VERSION}</div>
                <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'4px'}}>This is the version running on this device right now.</div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={async()=>{
                try {
                  if (!('serviceWorker' in navigator)) { notify('Updates aren’t supported on this browser.','error'); return; }
                  const reg = await navigator.serviceWorker.getRegistration();
                  if (!reg) { notify('No service worker yet — reload the page once.','error'); return; }
                  await reg.update();
                  if (reg.waiting) notify('New version found — tap Refresh to update.','success');
                  else notify('You’re on the latest version.','success');
                } catch (e) { notify('Couldn’t check for updates right now.','error'); }
              }}>Check for updates</button>
            </div>
          </div>
        </div>
            </>}
          </div>
        )}
      </div>
    </div>
  );
}
