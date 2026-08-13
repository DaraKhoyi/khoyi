import React, { useState, useEffect, useCallback, useMemo, useRef, useContext } from 'react';
import { createPortal } from 'react-dom';
import { supabase, SUPABASE_URL, ensureFreshSession } from './dataService';
import { useConnectionHealth } from './connection';
import { useNbaSkips, SnoozeMenu } from './nbaSkips';
import * as tus from 'tus-js-client';
import DocumentsView, { ContactDocuments } from './views/DocumentsView';
import LinkedNotes from './views/LinkedNotes';
import ProductionBoard, { MyProduction } from './views/ProductionViews';
import DashboardHub from './views/DashboardHub';
import TodayView from './views/TodayView';
import FirstLook from './views/FirstLook';
import SomedayView from './views/SomedayView';
import ModeBar from './views/ModeBar';
import { TIPS_BY_SCREEN } from './tips';
import MindsetMenu from './views/MindsetMenu';
import { MODES, VIEW_TO_MODE, modeById } from './modes';
import { rememberRoomSpot, roomResumeSpot } from './roomResume';
import { PAGES, PAGE_GROUPS, pageVisible, roleAllows, makeEntitled, ALL_FEATURES } from './pages';
const CallDetail = lazyWithReload(() => import('./views/CallDetail'));
import IdentifyRecording from './views/IdentifyRecording';
// The Next Best Action ranking. Lives INSIDE the robot-chat function directory on
// purpose: deploy-functions.yml decides what to redeploy from the CHANGED PATH's
// function name, and it FILTERS OUT _shared — so an engine living in _shared/ would
// ship to the client and silently never reach the server. Here, editing it IS a
// robot-chat change, so both sides always move together. Pure functions, no deps.
import { buildNextActions, buildGrowthMoves, bounceSignals, docSignals, BOUNCE_SHORT } from '../supabase/functions/robot-chat/nba.js';

// --- Hardware/gesture BACK button closes the top modal instead of leaving the PWA ---
// A modal calls useBackClose(onClose) to register its close handler in a shared LIFO
// stack while it is mounted. The SINGLE back/popstate handler (the app-root guard, see
// __prismModalCloseStack usage below) closes the top registered modal on back and only
// asks to exit the app when no modals are open. Stack + hook now live in ./backClose;
// App.js re-exports useBackClose for the views that import it from '../App'.
import { __prismModalCloseStack, useBackClose } from './backClose';
import { quoCall } from './quo';
import ForkTuningOverlay from './views/ForkTuningOverlay';
import AriRewriteButton from './views/AriRewriteButton';
import QuoTextModal from './views/QuoTextModal';
import PropertyModal from './views/PropertyModal';
import SingleContactPicker from './views/SingleContactPicker';
import TemplatesModal from './views/TemplatesModal';
import FollowupDraftModal from './views/FollowupDraftModal';
import ActivityTimeline from './views/ActivityTimeline';
import DownloadResearchDocx from './views/DownloadResearchDocx';
import PrepLeadButton from './views/PrepLeadButton';
import RelationshipIntel from './views/RelationshipIntel';
import ContactKnowledge from './views/ContactKnowledge';
import SocialLinksPanel from './views/SocialLinksPanel';
import ContactRecordingsSection from './views/ContactRecordingsSection';
import ResearchProgress from './views/ResearchProgress';
import { audioNeedsConversion, transcodeAudioToMp3, resumableUpload } from './audio';
import MultiContactPicker from './views/MultiContactPicker';
import CustomFieldsPanel from './views/CustomFieldsPanel';
import ContactDetailModal from './views/ContactDetailModal';
import PrismThinking from './views/PrismThinking';
import BouncesModal from './views/BouncesModal';
import PlanTimeline from './views/PlanTimeline';
import PlanMyDayModal from './views/PlanMyDayModal';
import AutoScheduleFields from './views/AutoScheduleFields';
import DatePickerModal from './views/DatePickerModal';
import TaskModal from './views/TaskModal';
import { docOriginMeta, OriginChip, LifecycleChip, FILE_STATUSES, STATUS_META, CHK_STATUS, CHK_META, FARBAR_BUYER_CHECKLIST, logFileEvent, shortDate, StatusPill, FILE_DOC_TYPES, DOCTYPE_LABEL, DOCTYPE_TO_ITEM, WAIVER_TO_KIND, resolveDeadlineWaiver, generateDeadlinesFromTerms } from './fileDomain';
import MissingDocsComposer from './views/MissingDocsComposer';
import SignPortal from './views/SignPortal';
import SignatureRequestModal from './views/SignatureRequestModal';
import SignatureManageModal from './views/SignatureManageModal';
import FileDetailModal from './views/FileDetailModal';
import DropboxFolderBrowser from './views/DropboxFolderBrowser';
import TipsSetting from './views/TipsSetting';
import EmailAccountsPanel from './views/EmailAccountsPanel';
import EmailAliasesPanel from './views/EmailAliasesPanel';
import WorkingHoursSection from './views/WorkingHoursSection';
import AriPermissionsPanel from './views/AriPermissionsPanel';
import CubeACRPanel from './views/CubeACRPanel';
import BookingsManagerModal from './views/BookingsManagerModal';
import CoachSettings from './views/CoachSettings';
import IosSharingSettings from './views/IosSharingSettings';
import CloudStorageSettings from './views/CloudStorageSettings';
import AdminLicensingPanel from './views/AdminLicensingPanel';
import RedeemCodeBox from './views/RedeemCodeBox';
import SimplifyPanel from './views/SimplifyPanel';
import SettingsView from './views/SettingsView';
import ChatMessageBubble from './views/ChatMessageBubble';
import ChatView from './views/ChatView';
import { CallFollowupsPanel, ShareRecordingModal, EmailRepliesPanel, ReviewView } from './views/ReviewPanels';
import { cadenceDue, stageMeta } from './views/LeadsBoard';
import { AgentsView } from './views/AgentsAdmin';
import { TrackerTaskModal, ProjectTasksPanel } from './views/TrackerPanels';
import { OnboardingModal, AnnouncementModal, AnnouncementsAdmin } from './views/OnboardingModal';
import { FilesView } from './views/FilesView';
import { LearnView } from './views/LearnView';
import { SYSTEMS } from './systemHealth';
import { TeamsAdmin, ContactTypesAdmin, TeamView } from './views/AdminPanels';
import CoachNudge from './views/CoachNudge';
import CoachView from './views/CoachView';
import KnowledgeView from './views/KnowledgeView';
import QuoCallDetail from './views/QuoCallDetail';
import { logJournalEntry } from './lib/journalLog';
import { BUILD_VERSION } from './version';
import './index.css';
import { computeCDA } from './lib/cda';

// Lazy-load wrapper with stale-deploy recovery: if a view's code chunk fails to
// load because a new version was deployed while the app was open (the old hashed
// chunk no longer exists on the server), reload once to pick up the fresh build
// instead of surfacing a "failed to fetch dynamically imported module" error.
function lazyWithReload(factory) {
  return React.lazy(() =>
    factory().catch((err) => {
      const msg = String((err && err.message) || err || '');
      if (/dynamically imported module|Loading chunk|module script failed|Failed to fetch/i.test(msg)) {
        try {
          const last = +(sessionStorage.getItem('__chunkReloadAt') || 0);
          if (Date.now() - last > 10000) {
            sessionStorage.setItem('__chunkReloadAt', String(Date.now()));
            window.location.reload();
            return new Promise(() => {}); // hold render while the page reloads
          }
        } catch (_) {
          window.location.reload();
          return new Promise(() => {});
        }
        // Already reloaded once recently — don't crash to a blank/frozen screen.
        // Give the user a clear way to pick up the new version.
        return { default: function ChunkNeedsRefresh() {
          return React.createElement('div', { style: { padding: '32px 20px', textAlign: 'center', color: 'var(--text-2)' } },
            React.createElement('div', { style: { fontSize: '15px', fontWeight: 600, color: 'var(--text-1)', marginBottom: '6px' } }, 'A new version was just deployed'),
            React.createElement('div', { style: { fontSize: '13px', marginBottom: '16px' } }, 'Tap refresh to load the latest.'),
            React.createElement('button', { className: 'btn btn-primary', onClick: () => { try { sessionStorage.removeItem('__chunkReloadAt'); } catch (_) {} window.location.reload(); } }, 'Refresh to update')
          );
        } };
      }
      throw err;
    })
  );
}

// A Suspense fallback that stops spinning forever. If a lazy view chunk hasn't
// resolved in ~14s (a hung import, usually a stale/partial cache after a deploy
// on an installed PWA — the exact "app opens to a spinner and never loads"
// failure), we surface a Refresh action instead of an endless spinner. A hung
// import() promise never rejects, so lazyWithReload's catch and the error
// boundary can't help here — only a timeout can.
function ViewLoadingFallback() {
  const [stuck, setStuck] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setStuck(true), 14000);
    return () => clearTimeout(t);
  }, []);
  if (!stuck) return <div className="loading-screen" style={{ height: '60vh' }}><div className="spinner" /></div>;
  const hardReload = () => {
    try { sessionStorage.removeItem('__chunkReloadAt'); } catch (_) {}
    // Clear caches + unregister SW so the next load is a clean fetch of the
    // current build, then reload. Best-effort; reload regardless.
    const done = () => window.location.reload();
    try {
      const jobs = [];
      if (window.caches && caches.keys) jobs.push(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))));
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) jobs.push(navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))));
      Promise.all(jobs).then(done, done);
      setTimeout(done, 2500);
    } catch (_) { done(); }
  };
  return (
    <div className="loading-screen" style={{ height: '60vh', flexDirection: 'column', gap: 14, textAlign: 'center', padding: '0 24px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)' }}>This screen is taking longer than usual</div>
      <div style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 340, lineHeight: 1.5 }}>A new version may have just been deployed. Refresh to load the latest build.</div>
      <button className="btn btn-primary" onClick={hardReload}>Refresh to update</button>
    </div>
  );
}
const FinanceView = lazyWithReload(() => import('./views/AccountingViews').then(m => ({ default: m.FinanceView })));
const TransactionPipeline = lazyWithReload(() => import('./views/TransactionPipeline'));
const InvestorPipeline = lazyWithReload(() => import('./views/InvestorPipeline'));
const UnstuckView = lazyWithReload(() => import('./views/UnstuckView'));
const AdoptionView = lazyWithReload(() => import('./views/AdoptionView'));
const ProspectingView = lazyWithReload(() => import('./views/ProspectingView'));
const QuarterlyTaxBanner = lazyWithReload(() => import('./views/AccountingViews').then(m => ({ default: m.QuarterlyTaxBanner })));
const TasksView = lazyWithReload(() => import('./views/TasksView'));
const AriBriefingView = lazyWithReload(() => import('./views/AriBriefingView'));
const ChiefOfStaffView = lazyWithReload(() => import('./views/ChiefOfStaffView'));
const AgentRunsView = lazyWithReload(() => import('./views/AgentRunsView'));
const AgentActivityView = lazyWithReload(() => import('./views/AgentActivityView'));
const GroupMessageView = lazyWithReload(() => import('./views/GroupMessageView'));
const AppHealthView = lazyWithReload(() => import('./views/AppHealthView'));
const GrowthView = lazyWithReload(() => import('./views/AriBriefingView').then(m => ({ default: m.GrowthView })));
const ContactsView = lazyWithReload(() => import('./views/ContactsView'));
const ListingPresentationView = lazyWithReload(() => import('./views/ListingPresentationView'));
const AgentProduction = lazyWithReload(() => import('./views/AgentProduction'));
const GoogleContactsView = lazyWithReload(() => import('./views/GoogleContactsView'));
const CadenceReviewView = lazyWithReload(() => import('./views/CadenceReviewView'));
const CadenceSuggestion = lazyWithReload(() => import('./views/CadenceSuggestion'));
const PlaybooksView = lazyWithReload(() => import('./views/PlaybooksView'));
const CalendarView = lazyWithReload(() => import('./views/CalendarView'));
const InboxView = lazyWithReload(() => import('./views/InboxView'));
const SystemsView = lazyWithReload(() => import('./views/SystemsView'));
const RecruitingView = lazyWithReload(() => import('./views/RecruitingView'));
const PropertiesView = lazyWithReload(() => import('./views/PropertiesView'));
const InvestmentsView = lazyWithReload(() => import('./views/InvestmentsView'));
const MileageView = lazyWithReload(() => import('./views/MileageView'));
const JournalView = lazyWithReload(() => import('./views/JournalView'));
const QuoView = lazyWithReload(() => import('./views/QuoView'));
const DealsView = lazyWithReload(() => import('./views/DealsView'));
const BrainView = lazyWithReload(() => import('./views/BrainView'));
const TrackerView = lazyWithReload(() => import('./views/TrackerView'));
const PrismView = lazyWithReload(() => import('./views/PrismView'));
const MyPrismView = lazyWithReload(() => import('./views/MyPrismView'));
const DiscAssessmentView = lazyWithReload(() => import('./views/DiscAssessmentView'));
const DiscRosterView = lazyWithReload(() => import('./views/DiscRosterView'));
const MyVoiceView = lazyWithReload(() => import('./views/MyVoiceView'));
const VoiceRosterView = lazyWithReload(() => import('./views/VoiceRosterView'));

const NotesView = lazyWithReload(() => import('./views/NotesView'));
const EmailReviewView = lazyWithReload(() => import('./views/EmailReviewView'));

// ── Hierarchical sidebar menu helpers ───────────────────────────────
function assignMenuKeys(nodes, prefix) {
  nodes.forEach((n, i) => { n._key = prefix + '-' + i; if (n.children) assignMenuKeys(n.children, n._key); });
}
function menuDescendantBuilt(node, builtSet) {
  if (node.built === false) return false;
  if (node.children) return node.children.some(c => menuDescendantBuilt(c, builtSet));
  return node.view ? builtSet.has(node.view) : false;
}
function menuContainsView(node, view) {
  if (!node.children) return node.view === view;
  return node.children.some(c => menuContainsView(c, view));
}
function AiMark({ size = 13 }) {
  // Classy gold "smart / AI" sparkle, shown after Ari-powered menu items.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ marginLeft: '7px', flexShrink: 0, verticalAlign: '-2px' }}>
      <path d="M12 1.6c.5 4.9 5.5 9.9 10.4 10.4C17.5 12.5 12.5 17.5 12 22.4 11.5 17.5 6.5 12.5 1.6 12 6.5 11.5 11.5 6.5 12 1.6Z" fill="#c5a95e"/>
      <path d="M19.2 2.6c.13 1.7 1.1 2.67 2.8 2.8-1.7.13-2.67 1.1-2.8 2.8-.13-1.7-1.1-2.67-2.8-2.8 1.7-.13 2.67-1.1 2.8-2.8Z" fill="#d8bd78"/>
    </svg>
  );
}
const MenuNode = React.memo(function MenuNode({ node, depth, ctx }) {
  const { view, navigate, builtSet, byNavId, openPath, toggle } = ctx;
  const hasChildren = !!(node.children && node.children.length);
  const leafView = node.view || null;
  const isAction = typeof node.action === 'function';
  const built = node.built === false ? false
    : hasChildren ? menuDescendantBuilt(node, builtSet)
    : (leafView ? builtSet.has(leafView) : isAction ? true : false);
  const open = hasChildren && openPath[depth] === node._key;
  const active = leafView === view && !node.sub;
  const clickable = (built && leafView) || hasChildren || isAction;
  // A node can be BOTH a destination and a parent (e.g. Ask Ari, which opens Ari
  // yet also holds Listing Presentation). In that case the label navigates and the
  // chevron expands — navigate() closes the menu, so firing both on one click would
  // make the children unreachable. Pure groups (no view) toggle on the whole row.
  const navigable = built && leafView;
  const handleClick = () => {
    if (isAction) { node.action(); return; }
    if (navigable) { navigate(leafView, node.sub || null); return; }
    if (hasChildren) toggle(depth, node._key);
  };
  const toggleOpen = (e) => { e.stopPropagation(); toggle(depth, node._key); };
  const indent = 14;
  return (
    <>
      <div className={'nav-item' + (active ? ' active' : '')}
        onClick={clickable ? handleClick : undefined}
        title={(built || hasChildren) ? undefined : 'Not built yet'}
        style={{ paddingLeft: indent + 'px', fontSize: depth === 0 ? '14px' : '12.5px',
          color: built ? 'var(--text-1)' : 'var(--text-3)',
          opacity: (built || hasChildren) ? 1 : 0.5,
          cursor: clickable ? 'pointer' : 'default' }}>
        <span style={{ display: 'inline-flex', justifyContent: 'center', alignItems: 'center', width: depth === 0 ? '22px' : '20px', flexShrink: 0, color: built ? (active ? 'var(--accent)' : 'var(--text-2)') : 'var(--text-3)' }}>
          <Icon name={node.icon || leafView} size={depth === 0 ? 18 : 16} fb={'•'} />
        </span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}{node.ai && built && <AiMark />}</span>
        {!built && !hasChildren && <span style={{ fontSize: '8.5px', color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: '4px', padding: '1px 5px', marginLeft: '6px', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>soon</span>}
        {depth === 0 && leafView && byNavId[leafView] && byNavId[leafView].badge ? <span className="nav-badge">{byNavId[leafView].badge}</span> : null}
        {hasChildren && <span onClick={navigable ? toggleOpen : undefined} style={{ marginLeft: '6px', fontSize: depth === 0 ? '17px' : '15px', lineHeight: 1, color: 'var(--accent)', opacity: 0.9, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0, cursor: 'pointer', padding: navigable ? '4px 6px' : '0', margin: navigable ? '-4px 0 -4px 2px' : '0 0 0 6px' }}>▸</span>}
      </div>
      {hasChildren && open && (
        <div style={{ margin: depth === 0 ? '4px 10px 10px 34px' : '4px 8px 8px 24px', background: 'var(--bg-elev)', border: '1px solid var(--border-strong)', borderLeft: '3px solid var(--accent)', borderRadius: '12px', boxShadow: '0 16px 42px -14px rgba(0,0,0,0.75)', overflow: 'hidden', padding: '5px 0' }}>
          {node.children.map((c, i) => <MenuNode key={c._key || i} node={c} depth={depth + 1} ctx={ctx} />)}
        </div>
      )}
    </>
  );
});

// Touch BUILD_VERSION so webpack includes it (changes bundle hash on every version bump)
if (typeof window !== 'undefined') window.__BUILD_VERSION__ = BUILD_VERSION;

// ─── ICON SYSTEM ────────────────────────────────────────────────────
// Crisp monoline (lucide-style) SVG icons used for the primary nav and
// anywhere a clean, platform-consistent glyph beats an emoji. Stroke uses
// currentColor so each icon inherits its container's color + transitions
// (e.g. grey → gold when a nav item goes active). Self-contained: no new
// dependency. Unknown names fall back to the `fb` emoji so nothing ever
// renders blank. To migrate more of the app off emoji over time, add the
// concept here and render <Icon name="…" />.
import { Icon, ICON_PATHS } from './icons';
import { todayISO, priorityLabel, priorityClass, pad2, ymd, today_ymd, quoNormPhone, quoLast10, quoFmtPhone, quoFmtWhen, quoFmtDur, money, num, pickerInitials, owesReply, modal, lbl, splitQuotedReply, decodeEntities, MERGE_FIELDS, applyMergeFields, resolveSendAccount, isTopPriority, QUADRANTS, sortTasks } from './helpers';

// Rainbow PRISM wordmark — DISC palette (D red, I amber, S green, C blue) + violet 5th
const PRISM_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6'];
function PrismMark() {
  return <span className="prism-mark">Prism</span>;
}

// Brand lockup with "Advantage" on its own line, horizontally centered under
// the E in ONE. The exact glyph is measured at layout time (and again after
// fonts load / on resize) so the alignment holds across sizes and surfaces.
function RogLogo() {
  const wmRef = useRef(null);
  const eRef = useRef(null);
  const advRef = useRef(null);
  React.useLayoutEffect(() => {
    const center = () => {
      const wm = wmRef.current, e = eRef.current, adv = advRef.current;
      if (!wm || !e || !adv) return;
      const wmR = wm.getBoundingClientRect(), eR = e.getBoundingClientRect();
      if (!wmR.width || !eR.width) return;
      const advW = adv.getBoundingClientRect().width;
      // In the mobile menu only, start "Advantage" between the N and the E of ONE
      // (its left edge at the N|E boundary). Everywhere else — laptop, tablet, and
      // the login lockup — keep it centered under the E, unchanged.
      const inMenu = !!wm.closest('.sidebar-logo');
      const mobile = window.matchMedia('(max-width: 768px)').matches;
      if (inMenu && mobile) {
        const neBoundary = eR.left - wmR.left;            // left edge of E = N|E boundary
        const maxLeft = Math.max(0, wmR.width - advW);    // never overflow the wordmark
        adv.style.marginLeft = Math.max(0, Math.min(Math.round(neBoundary), Math.round(maxLeft))) + 'px';
      } else {
        const eCenter = (eR.left - wmR.left) + eR.width / 2;
        adv.style.marginLeft = Math.max(0, Math.round(eCenter - advW / 2)) + 'px';
      }
    };
    center();
    const t = setTimeout(center, 150);
    window.addEventListener('resize', center);
    const mq = window.matchMedia('(max-width: 768px)');
    if (mq.addEventListener) mq.addEventListener('change', center);
    else if (mq.addListener) mq.addListener(center);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(center).catch(() => {});
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', center);
      if (mq.removeEventListener) mq.removeEventListener('change', center);
      else if (mq.removeListener) mq.removeListener(center);
    };
  }, []);
  return (
    <>
      <div className="rog-wordmark rog-wordmark--stack" ref={wmRef}>
        <span className="rog-realty">REALTY</span><span className="rog-one">ON<span ref={eRef}>E</span></span><span className="rog-group">GROUP</span>
        <span className="rog-adv" ref={advRef}>Advantage</span>
      </div>
      <div className="rog-sub"><span className="rog-pb">powered by </span><PrismMark /><span className="rog-pb" style={{ fontStyle: 'normal', marginLeft: '10px' }}>Ver. {BUILD_VERSION}</span></div>
    </>
  );
}

// ─── PRISM MIRROR PRINCIPLE ─────────────────────────────────────────
// Core PrismOS rule for any AI that drafts communication on behalf of the
// user (email, text, DM, voicemail script, social DM, etc.). Pass this
// verbatim into the system prompt of every drafting feature.
//
// The principle is simple in two parts:
//   1. MIRROR them. If we know the contact's DISC profile, shape the
//      cadence to match — direct and outcome-focused for a D, warm and
//      story-led for an I, steady and unhurried for an S, precise and
//      well-evidenced for a C.
//   2. SOUND LIKE THE USER. Mirroring is not impersonation. The user's
//      voice — their phrasings, humor, sign-offs, sentence rhythm — must
//      stay intact. Robotic AI tells ("As an AI", "I'd be happy to
//      assist", "I hope this email finds you well", formulaic structure,
//      excessive hedging) are out. If a real person wouldn't write it
//      that way, neither do we.
//
// The goal: meet them where they are, in your own voice — never sound
// like a machine wrote it.
export const PRISM_MIRROR_PRINCIPLE = `# Prism Mirror Principle

When drafting communication for the user, follow two rules:

**1. Mirror the recipient.** If their DISC profile is known, shape the message to match their behavioral cadence:
- **D (Dominant):** direct, brief, bottom-line first, outcome-focused, minimal pleasantries
- **I (Influencer):** warm, enthusiastic, story-led, social, optimistic, exclamation points OK
- **S (Steady):** unhurried, friendly, relationship-oriented, no pressure, reassuring
- **C (Conscientious):** precise, evidence-backed, organized, detail-rich, factual tone

**2. Sound like the user, not an AI.** Mirroring is *not* impersonation of the recipient and *not* a license to sound robotic. Preserve the user's natural voice — their phrasings, sense of humor, sign-offs, sentence rhythm. Avoid the AI tells:
- ❌ "As an AI…", "I'd be happy to assist", "I hope this email finds you well"
- ❌ Formulaic openings and closings
- ❌ Excessive hedging, qualifiers, or disclaimers
- ❌ Bullet-point answers when prose would feel more human
- ❌ Over-explanation, restating the question, signposting structure

If a real person who knows the user wouldn't recognize the draft as theirs, rewrite it. The test isn't "is it correct?" — it's "would the user actually send this?"`;

// Contact segment types. Order = display order in dropdowns and filter pills.
// "All" is a UI-only filter sentinel; it isn't stored.
function AuthScreen() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleLogin(e) {
    e.preventDefault(); setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  }
  async function handleSignup(e) {
    e.preventDefault(); setLoading(true); setError('');
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) setError(error.message);
    else setSuccess('Check your email to confirm your account.');
    setLoading(false);
  }
  async function handleReset(e) {
    e.preventDefault(); setLoading(true); setError('');
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) setError(error.message);
    else setSuccess('Reset link sent — check your inbox.');
    setLoading(false);
  }

  const switchMode = (m) => { setMode(m); setError(''); setSuccess(''); };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">
          <RogLogo />
        </div>
        {mode === 'login' && <>
          <h2>Welcome back</h2>
          <p>Sign in to your workspace</p>
          {error && <div className="auth-error">{error}</div>}
          {success && <div className="auth-success">{success}</div>}
          <form onSubmit={handleLogin}>
            <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required /></div>
            <div className="form-group"><label className="form-label">Password</label><input className="form-input" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required /></div>
            <button className="btn btn-primary" style={{width:'100%'}} disabled={loading}>{loading ? 'Signing in…' : 'Sign In'}</button>
          </form>
          <div className="auth-switch"><button type="button" className="auth-link" onClick={()=>switchMode('reset')}>Forgot password?</button> · <button type="button" className="auth-link" onClick={()=>switchMode('signup')}>Create account</button></div>
        </>}
        {mode === 'signup' && <>
          <h2>Create account</h2>
          <p>Get started with Prism</p>
          {error && <div className="auth-error">{error}</div>}
          {success && <div className="auth-success">{success}</div>}
          <form onSubmit={handleSignup}>
            <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required /></div>
            <div className="form-group"><label className="form-label">Password</label><input className="form-input" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required /></div>
            <button className="btn btn-primary" style={{width:'100%'}} disabled={loading}>{loading ? 'Creating…' : 'Create Account'}</button>
          </form>
          <div className="auth-switch">Already have an account? <button type="button" className="auth-link" onClick={()=>switchMode('login')}>Sign in</button></div>
        </>}
        {mode === 'reset' && <>
          <h2>Reset password</h2>
          <p>We'll send a reset link to your email</p>
          {error && <div className="auth-error">{error}</div>}
          {success && <div className="auth-success">{success}</div>}
          <form onSubmit={handleReset}>
            <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required /></div>
            <button className="btn btn-primary" style={{width:'100%'}} disabled={loading}>{loading ? 'Sending…' : 'Send Reset Link'}</button>
          </form>
          <div className="auth-switch"><button type="button" className="auth-link" onClick={()=>switchMode('login')}>Back to sign in</button></div>
        </>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// ONBOARDING MODAL — first-run setup (Pass 2 Batch C)
//
// Shown to any signed-in user where user_settings.onboarding_complete = false.
// Blocking — no close, no ESC, no backdrop dismiss. The user fills in 4
// fields (name, profession, timezone, assistant context) and we upsert
// user_settings + flip onboarding_complete=true.
// ─────────────────────────────────────────

// ── System-wide announcements ────────────────────────────────
// Blocking modal that surfaces unacknowledged announcements one at a time
// (oldest first). Each must be checked off before the next appears; they
// persist across sessions until acknowledged.

// Brokerage-level team builder (owner/broker_admin). Create teams, name a leader, add members.
function ConnectionBanner() {
  const { status, retryNow } = useConnectionHealth();
  if (status === 'online') return null;
  const offline = status === 'offline';
  return (
    <div role="status" aria-live="polite" style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      padding: '7px 14px', fontSize: 12.5, fontWeight: 600,
      background: 'linear-gradient(180deg, #201811, #1A130C)',
      color: '#EBCB82', borderBottom: '1px solid rgba(203,163,92,0.35)',
      position: 'relative', zIndex: 40,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: '50%', background: offline ? '#C98A3C' : '#CBA35C',
        boxShadow: '0 0 0 0 rgba(203,163,92,0.6)', animation: 'connPulse 1.6s ease-in-out infinite', flexShrink: 0,
      }} />
      <span>{offline
        ? 'You\u2019re offline \u2014 showing your last-loaded data. We\u2019ll refresh automatically when you\u2019re back.'
        : 'Reconnecting\u2026 your work is safe; this will clear on its own.'}</span>
      {!offline && (
        <button onClick={retryNow} style={{
          background: 'transparent', border: '1px solid rgba(203,163,92,0.4)', color: '#EBCB82',
          borderRadius: 999, padding: '2px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
        }}>Retry now</button>
      )}
      <style>{`@keyframes connPulse{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(203,163,92,0.5)}50%{opacity:.55;box-shadow:0 0 0 5px rgba(203,163,92,0)}}`}</style>
    </div>
  );
}

// Persistent banner shown whenever the current session is an impersonated one.
function ImpersonationBanner() {
  const [imp] = React.useState(() => { try { return JSON.parse(localStorage.getItem('__impersonating') || 'null'); } catch (_) { return null; } });
  const [leaving, setLeaving] = React.useState(false);
  if (!imp) return null;
  async function exit() {
    setLeaving(true);
    let real = null;
    try { real = JSON.parse(localStorage.getItem('__realSession') || 'null'); } catch (_) {}
    try {
      if (real && real.access_token) await supabase.auth.setSession(real);
      try { await supabase.functions.invoke('impersonate', { body: { action: 'end', log_id: imp.log_id } }); } catch (_) {}
    } catch (_) {}
    try { localStorage.removeItem('__impersonating'); localStorage.removeItem('__realSession'); } catch (_) {}
    if (!real || !real.access_token) { try { await supabase.auth.signOut(); } catch (_) {} }
    window.location.reload();
  }
  return (
    <div style={{ background: 'linear-gradient(90deg,#7a1f1f,#a83232)', color: '#fff', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', fontWeight: 600 }}>
      <span style={{ fontSize: '15px' }}>🎭</span>
      <span style={{ flex: 1, minWidth: 0 }}>You're acting as <b>{imp.name}</b>. Everything you do is recorded as them.</span>
      <button onClick={exit} disabled={leaving} style={{ background: '#fff', color: '#7a1f1f', border: 'none', borderRadius: '8px', padding: '5px 12px', fontWeight: 700, fontSize: '12.5px', cursor: 'pointer', whiteSpace: 'nowrap' }}>{leaving ? 'Returning…' : 'Return to my account'}</button>
    </div>
  );
}

// Picker to choose who to act as (server re-verifies permission).
function ActAsPicker({ userId }) {
  const [cands, setCands] = React.useState(null);
  const [busy, setBusy] = React.useState('');
  const [msg, setMsg] = React.useState('');
  React.useEffect(() => { (async () => { try { const { data } = await supabase.rpc('impersonation_candidates'); setCands(Array.isArray(data) ? data : []); } catch (_) { setCands([]); } })(); }, []);
  async function actAs(c) {
    setBusy(c.user_id); setMsg('');
    try {
      const { data: { session: real } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('impersonate', { body: { target_user_id: c.user_id } });
      if (error || !data || !data.access_token) { setMsg('Could not switch: ' + (error?.message || data?.error || 'unknown error')); setBusy(''); return; }
      try {
        localStorage.setItem('__realSession', JSON.stringify({ access_token: real.access_token, refresh_token: real.refresh_token }));
        localStorage.setItem('__impersonating', JSON.stringify({ name: c.name, log_id: data.log_id, at: Date.now() }));
      } catch (_) {}
      await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
      window.location.reload();
    } catch (e) { setMsg(String(e)); setBusy(''); }
  }
  return (
    <div>
      <div className="page-header"><h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><span>🎭</span>Act as another user</h2><p>Open the app as one of your users to see exactly what they see. Your real identity is recorded the whole time.</p></div>
      <div style={{ maxWidth: '560px' }}>
        {cands === null && <div style={{ color: 'var(--text-3)', fontSize: '13px' }}>Loading…</div>}
        {cands && cands.length === 0 && <div className="panel"><div className="panel-body"><div style={{ fontSize: '13px', color: 'var(--text-3)' }}>There's no one you can act as.</div></div></div>}
        {cands && cands.map(c => (
          <div key={c.user_id} className="panel" style={{ marginBottom: '10px' }}>
            <div className="panel-body" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--bg-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>{(c.name || c.email || '?').slice(0, 2).toUpperCase()}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, color: 'var(--text-1)', fontSize: '14px' }}>{c.name}{c.is_admin && <span style={{ fontSize: '10px', color: 'var(--accent)', marginLeft: '6px', border: '1px solid var(--border)', borderRadius: '6px', padding: '1px 6px' }}>{c.role}</span>}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>{c.email}</div>
              </div>
              <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => actAs(c)}>{busy === c.user_id ? 'Switching…' : 'Act as'}</button>
            </div>
          </div>
        ))}
        {msg && <div style={{ fontSize: '12.5px', color: 'var(--red)', marginTop: '8px' }}>{msg}</div>}
      </div>
    </div>
  );
}

const DATE_FILTERS = [
  { id:'all',       label:'All',        hint:'Everything not done' },
  { id:'past',      label:'Past Due',   hint:'Overdue tasks' },
  { id:'today',     label:'Today',      hint:'Due today + past due' },
  { id:'tomorrow',  label:'Tomorrow',   hint:'Due tomorrow' },
  { id:'7days',     label:'7 Days',     hint:'Next 7 days' },
  { id:'future',    label:'Future',     hint:'Beyond tomorrow' },
  { id:'undated',   label:'Undated',    hint:'No due date — someday/maybe' },
  { id:'completed', label:'Completed',  hint:'Marked done' },
];

// ─────────────────────────────────────────
// CONTACT PICKER — reusable inline picker for any modal that needs to link contacts.
// Renders selected contacts as chips + a "+ Add contact" toggle that opens a search list.
// Parent owns the selection (selectedIds state) — this component just edits it.
// ─────────────────────────────────────────
function ContactPicker({ contacts = [], selectedIds = [], onChange, label = 'Contacts', placeholder = 'Search by name, email, or company…', emptyText = 'No matches.' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const linked = selectedIds.map(id => contacts.find(c => c.id === id)).filter(Boolean);
  const q = query.trim().toLowerCase();
  const options = (() => {
    const base = contacts.filter(c => !selectedIds.includes(c.id));
    if (!q) return base.slice(0, 20);
    return base.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.company || '').toLowerCase().includes(q)
    ).slice(0, 20);
  })();
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div style={{display:'flex',flexWrap:'wrap',gap:'6px',marginBottom:'8px'}}>
        {linked.map(c => (
          <span key={c.id} style={{display:'inline-flex',alignItems:'center',gap:'4px',padding:'4px 10px',background:'rgba(197,169,94,0.12)',border:'1px solid var(--accent)',borderRadius:'12px',fontSize:'12px',color:'var(--text-1)'}}>
            {c.name}
            <button type="button" onClick={() => onChange(selectedIds.filter(id => id !== c.id))}
              style={{background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',padding:'0 0 0 4px',fontSize:'14px',lineHeight:1}}>×</button>
          </span>
        ))}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(o => !o)} style={{fontSize:'11px',padding:'4px 10px'}}>
          {open ? '× Close' : '+ Add contact'}
        </button>
      </div>
      {open && (
        <div style={{border:'1px solid var(--border)',borderRadius:'8px',padding:'8px',background:'var(--bg-base)',maxHeight:'240px',display:'flex',flexDirection:'column'}}>
          <input className="form-input" autoFocus value={query} onChange={e=>setQuery(e.target.value)}
            placeholder={placeholder} style={{margin:0,marginBottom:'6px',fontSize:'12px'}} />
          <div style={{overflowY:'auto',flex:1}}>
            {options.length === 0 && (
              <div style={{padding:'12px',textAlign:'center',color:'var(--text-3)',fontSize:'11px'}}>
                {query ? emptyText : 'No contacts to add.'}
              </div>
            )}
            {options.map(c => (
              <button key={c.id} type="button"
                onClick={() => { onChange([...selectedIds, c.id]); setQuery(''); }}
                style={{display:'block',width:'100%',textAlign:'left',padding:'6px 8px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',fontSize:'12px',color:'var(--text-1)'}}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                <div style={{fontWeight:600}}>{c.name}</div>
                {(c.email || c.company) && (
                  <div style={{fontSize:'10px',color:'var(--text-3)'}}>
                    {c.email}{c.email && c.company ? ' · ' : ''}{c.company}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// TASK MODAL
// ─────────────────────────────────────────

// ── resolveSendAccount ───────────────────────────────────────────────────────
// Which account outbound mail sends from. Every call site used to run its own
// `.order('created_at').limit(1)`, so mail went from the OLDEST-connected
// account regardless of intent — which is why it kept going out as
// dara@brokerdara.com. Precedence: the user's chosen default, then any active
// email-capable account, then oldest as a last resort.


async function emailAssignTask(taskId, email) {
  if (!taskId || !email || !email.to) return { error: null };
  const acc = await resolveSendAccount('id');
  if (!acc) return { error: 'No connected email account — connect Gmail in Settings.' };
  const { data: sr, error: se } = await supabase.functions.invoke('gmail-send', { body: { account_id: acc.id, to: email.to, subject: email.subject, body_text: email.body } });
  if (se || (sr && sr.error)) return { error: 'Email send failed: ' + ((se && se.message) || (sr && sr.error)) };
  await supabase.from('tasks').update({ assignment_method: 'email', assignee_email: email.to, email_thread_id: sr.provider_thread_id, email_message_id: sr.provider_message_id }).eq('id', taskId);
  return { error: null };
}

// ── Shared auto-schedule controls ──
// Single source of truth so EVERY task editor (personal + project tracker) gets
// identical scheduling fields. Self-contained: manages its own state and bubbles
// the persisted payload up via onChange. `dueDate` gates the hard-deadline option.




// ─────────────────────────────────────────
// TASKS VIEW
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// TASKS VIEW — ONE Tasks-inspired design
// Filter pills (Today default) · view switcher (Sequence/Matrix) ·
// priority-anchored drag (A1/A2/A3 badge IS the handle) ·
// persistent bottom drop zones (Today / Tomorrow / Pick Date).
// Powered by SortableJS for proper touch+delay behavior.
// ─────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────
// TASKS VIEW — ONE Tasks-inspired design with CUSTOM drag system
// ─────────────────────────────────────────────────────────────────────
// Why custom drag instead of SortableJS/ReactSortable: those libraries
// physically mutate the DOM to handle drag-and-drop, which conflicts
// with React's reconciler and produces ghost elements that persist
// across renders. After three attempts to bridge the gap, switched to
// native PointerEvents:
//   - We never mutate React-managed DOM during drag
//   - The "floating clone" that follows the finger is a single <div>
//     parented to document.body, fully under our control
//   - Drop targets register via React context; we hit-test pointer
//     position against their bounding rects
//   - On release, we update React state via the registered callback
// React owns the entire task-list DOM. No libraries fight with it.
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// GLOBAL TOAST SYSTEM
// ─────────────────────────────────────────────────────────────────────
// Lightweight, event-bus based. Call notify('message', 'error') from anywhere.
// Renders a stack in the top-right; auto-dismisses after 5s.
// Pass 1 Batch B addition: surface silent errors from optimistic-rollback
// patterns. Batch C will expand uses across writes throughout the app.

// Toast + confirm registry now lives in ./notify (single shared instance).
import { notify, notifyError, confirmDialog, subscribeToasts, subscribeConfirms } from './notify';

function ConfirmHost() {
  const [dialog, setDialog] = useState(null);
  useEffect(() => {
    return subscribeConfirms((p) => setDialog(p));
  }, []);
  if (!dialog) return null;
  const done = (val) => { try { dialog.resolve(val); } catch (_) {} setDialog(null); };
  return createPortal(
    <div onClick={() => done(false)} style={{ position:'fixed', inset:0, zIndex:100001, background:'rgba(0,0,0,0.62)', display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background:'var(--bg-card, #161921)', border:'1px solid var(--border, #252a38)', borderRadius:'14px', maxWidth:'430px', width:'100%', padding:'22px 22px 18px', boxShadow:'0 24px 70px rgba(0,0,0,0.55)' }}>
        <div style={{ fontSize:'15px', lineHeight:1.5, color:'var(--text-1, #e8eaf0)', whiteSpace:'pre-wrap', marginBottom:'20px' }}>{dialog.message}</div>
        <div style={{ display:'flex', gap:'10px', justifyContent:'flex-end' }}>
          <button type="button" onClick={() => done(false)} style={{ padding:'9px 16px', borderRadius:'9px', border:'1px solid var(--border,#252a38)', background:'transparent', color:'var(--text-2,#9499b0)', fontSize:'14px', fontWeight:500, cursor:'pointer' }}>{dialog.cancelLabel}</button>
          <button type="button" autoFocus onClick={() => done(true)} style={{ padding:'9px 18px', borderRadius:'9px', border:'none', background: dialog.danger ? '#ef4444' : 'var(--accent, #C5A95E)', color: dialog.danger ? '#fff' : '#0d0f14', fontSize:'14px', fontWeight:600, cursor:'pointer' }}>{dialog.confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ToastHost() {
  const [toasts, setToasts] = useState([]);
  // Track viewport so toasts re-position on rotate/resize without page reload.
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(max-width: 768px)').matches
      : false
  ));
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = e => setIsMobile(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);  // older Safari fallback
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);
  useEffect(() => {
    function onToast(t) {
      setToasts(prev => [...prev, t]);
      // Auto-dismiss
      setTimeout(() => {
        setToasts(prev => prev.filter(x => x.id !== t.id));
        // A toast carrying an action needs long enough to read AND reach on a
        // phone; 4s is fine for "Done — nice work" and far too short for Undo.
      }, t.action ? 9000 : (t.kind === 'error' ? 6500 : 4000));
    }
    return subscribeToasts(onToast);
  }, []);

  if (toasts.length === 0) return null;
  return createPortal(
    <div style={{
      position:'fixed',
      ...(isMobile
        ? { bottom: '14px', left: '50%', transform: 'translateX(-50%)', alignItems: 'center' }
        : { top: '14px', right: '14px', alignItems: 'flex-end' }
      ),
      zIndex:100000,
      display:'flex',
      flexDirection:'column',
      gap:'8px',
      maxWidth:'92vw',
      pointerEvents:'none',
    }}>
      {toasts.map(t => {
        const color = t.kind === 'error' ? '#ef4444' : t.kind === 'success' ? '#22c55e' : 'var(--accent)';
        return (
          <div key={t.id}
            style={{
              pointerEvents:'auto',
              padding:'10px 14px',
              borderRadius:'8px',
              background:'var(--bg-card)',
              border:`1px solid ${color}`,
              color:'var(--text-1)',
              fontSize:'13px',
              fontWeight:500,
              boxShadow:'0 6px 18px rgba(0,0,0,0.35)',
              display:'flex',
              alignItems:'center',
              gap:'8px',
              maxWidth:'380px',
              cursor:'pointer',
            }}
            onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}>
            <span style={{color}}>{t.kind === 'error' ? '⚠' : t.kind === 'success' ? '✓' : 'ℹ'}</span>
            <span style={{flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{t.message}</span>
            {t.action && t.action.label && (
              <button type="button"
                onClick={(e) => { e.stopPropagation(); try { t.action.onClick && t.action.onClick(); } catch (_) {} setToasts(prev => prev.filter(x => x.id !== t.id)); }}
                style={{ flex:'none', background:'none', border:'1px solid '+color, color, borderRadius:100,
                  padding:'3px 10px', fontSize:'11.5px', fontWeight:800, cursor:'pointer' }}>
                {t.action.label}
              </button>
            )}
          </div>
        );
      })}
    </div>,
    document.body
  );
}

// ── Resumable upload ──────────────────────────────────────────────────────
// Chunked, auto-retrying upload to Supabase Storage — reliable for large files
// (long meetings) over mobile networks where a single POST would time out.

// ── Client error monitoring ───────────────────────────────────────────────
// Captures crashes (error boundaries) and uncaught errors/rejections into
// public.client_errors so we SEE failures the moment a user hits one — with
// user, view, app version and stack — instead of chasing screenshots.
const __errThrottle = new Map();
function __shouldLogErr(key) {
  const now = Date.now();
  if (now - (__errThrottle.get(key) || 0) < 30000) return false;
  __errThrottle.set(key, now);
  if (__errThrottle.size > 80) { for (const [k, t] of __errThrottle) if (now - t > 120000) __errThrottle.delete(k); }
  return true;
}
function __isNoise(msg) {
  const m = String(msg || '');
  return !m || /ResizeObserver loop|^Script error\.?$|Load failed|NetworkError|Failed to fetch|AbortError|The operation was aborted/i.test(m);
}
async function logClientError(payload) {
  try {
    const message = String((payload && payload.message) || '').slice(0, 2000);
    if (__isNoise(message)) return;
    const key = `${payload.kind || 'boundary'}|${payload.view || ''}|${message}`;
    if (!__shouldLogErr(key)) return;
    let user_id = null, email = null;
    try { const { data } = await supabase.auth.getUser(); if (data && data.user) { user_id = data.user.id; email = data.user.email || null; } } catch (_) {}
    await supabase.from('client_errors').insert({
      user_id, email,
      view: payload.view || (typeof window !== 'undefined' ? window.__currentView : null) || null,
      message,
      stack: payload.stack ? String(payload.stack).slice(0, 6000) : null,
      component_stack: payload.componentStack ? String(payload.componentStack).slice(0, 6000) : null,
      app_version: BUILD_VERSION,
      user_agent: (typeof navigator !== 'undefined' ? navigator.userAgent : '').slice(0, 500),
      url: (typeof location !== 'undefined' ? location.href : '').slice(0, 500),
      kind: payload.kind || 'boundary',
    });
  } catch (_) { /* logging must never throw */ }
}
if (typeof window !== 'undefined') { window.__logClientError = logClientError; }
if (typeof window !== 'undefined' && !window.__prismErrHooked) {
  window.__prismErrHooked = true;
  window.addEventListener('error', (e) => {
    if (!e || !e.error) return; // skip resource-load noise (no Error object)
    logClientError({ message: (e.error && e.error.message) || e.message, stack: e.error && e.error.stack, kind: 'window' });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    logClientError({ message: (r && r.message) || (typeof r === 'string' ? r : 'Unhandled promise rejection'), stack: r && r.stack, kind: 'promise' });
  });
}

// Pass 5 Batch A: ViewErrorBoundary.
// Wraps the view router only — sidebar stays outside so the user can always
// navigate away from a crashed view (per Q2=C). Reset by keying on the view
// id, so changing tabs gives the new view a fresh shot.
class ViewErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('View crashed:', error, info);
    this.setState({ info });
    try {
      logClientError({
        view: this.props.viewName,
        message: (error && error.message) || String(error),
        stack: error && error.stack,
        componentStack: info && info.componentStack,
        kind: 'boundary',
      });
    } catch (_) {}
  }
  copyDetails = () => {
    const { error, info } = this.state;
    const text = [
      `Prism build: ${BUILD_VERSION}`,
      `View: ${this.props.viewName || '(unknown)'}`,
      `Time: ${new Date().toISOString()}`,
      `Error: ${error?.message || String(error)}`,
      '',
      'Stack:',
      error?.stack || '(no stack)',
      '',
      'React component stack:',
      info?.componentStack || '(no component stack)',
    ].join('\n');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => { if (window.__notify) window.__notify('Error details copied to clipboard', 'success'); },
        () => { if (window.__notify) window.__notify('Could not copy. See console.', 'error'); }
      );
    }
  };
  render() {
    if (this.state.error) {
      return (
        <div style={{padding:'40px 20px',maxWidth:'560px',margin:'40px auto'}}>
          <div className="panel">
            <div className="panel-body" style={{textAlign:'center',padding:'32px 20px'}}>
              <div style={{fontSize:'40px',marginBottom:'12px'}}><Icon name="alert" size={34} /></div>
              <h3 style={{margin:'0 0 8px',color:'var(--text-1)'}}>This view ran into an error</h3>
              <p style={{margin:'0 0 16px',color:'var(--text-2)',fontSize:'13px',lineHeight:1.5}}>
                Use the sidebar to switch to another view — that's not affected.
                If this keeps happening on the same view, copy the details and let Anthropic know.
              </p>
              <details style={{textAlign:'left',background:'var(--bg-base)',padding:'10px 12px',borderRadius:'6px',marginBottom:'16px',fontSize:'11px',color:'var(--text-3)'}}>
                <summary style={{cursor:'pointer',color:'var(--text-2)'}}>Show technical details</summary>
                <pre style={{whiteSpace:'pre-wrap',wordBreak:'break-word',margin:'8px 0 0',fontFamily:'monospace',fontSize:'10px',color:'var(--text-2)'}}>
{this.state.error?.message || String(this.state.error)}
{'\n\n'}
{(this.state.error?.stack || '').split('\n').slice(0, 6).join('\n')}
                </pre>
              </details>
              <div style={{display:'flex',gap:'8px',justifyContent:'center',flexWrap:'wrap'}}>
                <button className="btn btn-ghost btn-sm" onClick={this.copyDetails}>
                  <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="clipboard" size={13} /> Copy error details</span>
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>
                  ↻ Reload page
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function HeaderSearchIcon({ value, open, onToggle }) {
  const hasValue = (value || '').trim().length > 0;
  return (
    <button
      type="button"
      onClick={onToggle}
      title={hasValue ? `Search: "${value}"` : 'Search'}
      aria-label="Search"
      aria-pressed={open}
      className={`btn-view-toggle${open ? ' active' : ''}`}
      style={{position:'relative'}}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7"/>
        <line x1="16.6" y1="16.6" x2="21" y2="21"/>
      </svg>
      {hasValue && !open && (
        <span style={{
          position:'absolute', top:'5px', right:'5px',
          width:'8px', height:'8px', borderRadius:'50%',
          background:'var(--accent)', border:'2px solid var(--bg-base)',
          pointerEvents:'none', boxSizing:'content-box',
        }} aria-hidden="true"/>
      )}
    </button>
  );
}

function HeaderSearchInput({ value, onChange, placeholder, onClose, autoFocus = true, style }) {
  const ref = useRef(null);
  useEffect(() => {
    if (autoFocus && ref.current) {
      // setTimeout so the input is mounted before we focus, and so a parent's
      // mouse-down on the icon doesn't immediately re-blur.
      const t = setTimeout(() => ref.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);
  return (
    <div style={{position:'relative', marginBottom:'10px', ...style}}>
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { onChange(''); onClose(); } }}
        placeholder={placeholder}
        style={{
          width:'100%', padding:'9px 38px 9px 12px',
          background:'var(--bg-card)', border:'1px solid var(--accent)',
          borderRadius:'8px', color:'var(--text-1)', fontSize:'13px',
          outline:'none', boxSizing:'border-box',
        }}
      />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}  // don't blur input first
        onClick={() => { onChange(''); onClose(); }}
        title="Close search (Esc)"
        aria-label="Close search"
        style={{
          position:'absolute', right:'6px', top:'50%', transform:'translateY(-50%)',
          background:'none', border:'none', color:'var(--text-3)', fontSize:'18px',
          cursor:'pointer', lineHeight:1, padding:'4px 8px',
        }}>×</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// TASKS VIEW — main component
// ─────────────────────────────────────────────────────────────────────




// ─────────────────────────────────────────
// EISENHOWER 2x2 QUADRANT GRID
// Read-only ordering (by rank within quadrant). Click task to edit.
// Shows only Eisenhower tasks; simple-system tasks excluded (they have no quadrant).
// ─────────────────────────────────────────
// Pass 4 Batch D: email triage display metadata.
// One source of truth for icons, colors, and labels used by InboxView.


// ─────────────────────────────────────────
// DASHBOARD — Lead-Gen ROI cards
// Self-contained: fetches its own finance data and uses the SAME true-ROI math
// as the Prospecting ROI scoreboard (cash spend + time value vs income), so the
// numbers always agree. Renders one full-width, gamified card per adopted
// (active, non-overhead) lead-gen system. Hidden entirely when none are adopted.
// ─────────────────────────────────────────
function DashboardROI({ userId, setView }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
      const [sysR, txR, teR, setR] = await Promise.all([
        supabase.from('lead_gen_systems').select('*').eq('user_id', userId).eq('is_active', true).eq('is_archived', false),
        supabase.from('transactions').select('amount,date,scope,lead_gen_system_id').eq('user_id', userId).eq('is_archived', false).eq('scope', 'business').gte('date', yearStart).not('lead_gen_system_id', 'is', null).limit(2000),
        supabase.from('time_entries').select('minutes,lead_gen_system_id,occurred_at').eq('user_id', userId).not('lead_gen_system_id', 'is', null).limit(5000),
        supabase.from('finance_settings').select('hourly_rate').eq('user_id', userId).maybeSingle(),
      ]);
      if (!alive) return;
      const systems = (sysR.data || []).filter(sy => !sy.is_overhead);
      const txns = txR.data || [];
      const tes = teR.data || [];
      const hourly = Number(setR.data?.hourly_rate || 0);
      const now = new Date();
      const grade = (roi) => {
        if (roi === null) return { g: '—', c: 'var(--text-3)' };
        if (roi >= 5) return { g: 'A+', c: 'var(--green)' };
        if (roi >= 3) return { g: 'A', c: 'var(--green)' };
        if (roi >= 2) return { g: 'B', c: '#84cc16' };
        if (roi >= 1) return { g: 'C', c: 'var(--yellow)' };
        if (roi >= 0.5) return { g: 'D', c: '#f59e0b' };
        return { g: 'F', c: 'var(--red)' };
      };
      const rows = systems.map(sys => {
        const sysTx = txns.filter(t => t.lead_gen_system_id === sys.id);
        const cash = Math.abs(sysTx.filter(t => Number(t.amount) < 0).reduce((a, t) => a + Number(t.amount), 0));
        const income = sysTx.filter(t => Number(t.amount) > 0).reduce((a, t) => a + Number(t.amount), 0);
        const sysTe = tes.filter(te => te.lead_gen_system_id === sys.id);
        const minutes = sysTe.reduce((a, te) => a + Number(te.minutes || 0), 0);
        const invested = cash + (minutes / 60) * hourly;
        const roi = invested > 0 ? income / invested : null;
        const series = [];
        for (let wk = 7; wk >= 0; wk--) {
          const cutoff = new Date(now); cutoff.setDate(now.getDate() - wk * 7); cutoff.setHours(23, 59, 59, 999);
          const c = Math.abs(sysTx.filter(t => Number(t.amount) < 0 && new Date(t.date) <= cutoff).reduce((a, t) => a + Number(t.amount), 0));
          const inc = sysTx.filter(t => Number(t.amount) > 0 && new Date(t.date) <= cutoff).reduce((a, t) => a + Number(t.amount), 0);
          const mins = sysTe.filter(te => te.occurred_at && new Date(te.occurred_at) <= cutoff).reduce((a, te) => a + Number(te.minutes || 0), 0);
          const invv = c + (mins / 60) * hourly;
          series.push(invv > 0 ? inc / invv : 0);
        }
        return { sys, cash, income, minutes, invested, roi, net: income - invested, series };
      }).sort((a, b) => {
        if (a.roi === null && b.roi === null) return b.invested - a.invested;
        if (a.roi === null) return 1; if (b.roi === null) return -1;
        return b.roi - a.roi;
      });
      const totalInvested = rows.reduce((a, r) => a + r.invested, 0);
      const totalIncome = rows.reduce((a, r) => a + r.income, 0);
      const blended = totalInvested > 0 ? totalIncome / totalInvested : null;
      setData({ rows, blended, gr: grade(blended), grade });
    })();
    return () => { alive = false; };
  }, [userId]);

  if (!data || data.rows.length === 0) return null;
  const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString();
  const fmtH = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; };
  const statusFor = (r) => {
    if (r.invested === 0) return { label: 'No data yet', color: 'var(--text-3)', icon: '•' };
    if (r.roi === null || r.income === 0) return { label: 'Awaiting income', color: 'var(--text-3)', icon: '⏳' };
    if (r.roi >= 3) return { label: 'Strong', color: 'var(--green)', icon: '🔥' };
    if (r.roi >= 1) return { label: 'Profitable', color: 'var(--accent)', icon: '✓' };
    return { label: 'Underwater', color: 'var(--red)', icon: '⚠' };
  };
  const W = 104, H = 32, PAD = 3;
  const sparkPts = (series) => {
    const max = Math.max(...series, 0), n = series.length;
    return series.map((v, idx) => {
      const x = PAD + (n > 1 ? idx * (W - 2 * PAD) / (n - 1) : 0);
      const y = H - PAD - (max > 0 ? (v / max) : 0) * (H - 2 * PAD);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  };
  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: 'var(--text-1)', display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
          <Icon name="target" size={16} style={{ color: 'var(--accent)' }} /> Lead-Gen ROI
          <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-3)' }}>· this year</span>
        </h3>
        {data.blended !== null && (
          <button onClick={() => setView('prospecting')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 12px', background: 'var(--accent-glow)', border: '1px solid var(--accent)', borderRadius: '999px', color: 'var(--accent)', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
            Blended {data.blended.toFixed(1)}× · {data.gr.g} →
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {data.rows.map((r, idx) => {
          const g = data.grade(r.roi);
          const st = statusFor(r);
          const medal = (r.roi !== null && idx < 3) ? medals[idx] : null;
          const barPct = r.roi === null ? 0 : Math.min(100, (r.roi / 5) * 100);
          const pts = sparkPts(r.series).split(' ');
          const last = pts[pts.length - 1].split(',');
          return (
            <div key={r.sys.id} onClick={() => setView('prospecting')}
              style={{ background: 'linear-gradient(135deg, var(--accent-glow), var(--bg-card) 55%)', border: '1px solid var(--accent)', borderRadius: '14px', padding: '16px 18px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '14px', transition: 'box-shadow .12s' }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 20px rgba(197,169,94,0.20)'; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; }}>
              {/* Header: rank + name (left), grade (right) */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                  {medal
                    ? <span style={{ fontSize: '22px', lineHeight: 1, flexShrink: 0 }}>{medal}</span>
                    : <span style={{ flexShrink: 0, width: '24px', height: '24px', borderRadius: '50%', background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-3)', fontSize: '10.5px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{r.roi !== null ? `#${idx + 1}` : '—'}</span>}
                  <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: r.sys.color || 'var(--accent)', flexShrink: 0 }} />
                  <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.25 }}>{r.sys.name}</span>
                </div>
                <span style={{ fontSize: '15px', fontWeight: 800, color: g.c, background: 'var(--bg-base)', border: `1px solid ${g.c}`, borderRadius: '8px', padding: '3px 10px', flexShrink: 0 }}>{g.g}</span>
              </div>
              {/* Metrics: ROI + status (left), bar (mid), sparkline (right) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' }}>
                <div style={{ flexShrink: 0 }}>
                  <div style={{ fontSize: '34px', fontWeight: 800, lineHeight: 1, color: r.roi === null ? 'var(--text-3)' : 'var(--accent)' }}>{r.roi === null ? '—' : r.roi.toFixed(1) + '×'}</div>
                  <div style={{ marginTop: '5px', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700, color: st.color }}>{st.icon} {st.label}</div>
                </div>
                <div style={{ flex: '1 1 150px', minWidth: '140px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '5px' }}><span>Return on investment</span><span>elite · 5×</span></div>
                  <div style={{ height: '9px', borderRadius: '999px', background: 'var(--bg-base)', border: '1px solid var(--border)', overflow: 'hidden' }}>
                    <div style={{ width: `${barPct}%`, height: '100%', background: g.c, borderRadius: '999px', transition: 'width .3s' }} />
                  </div>
                </div>
                <div style={{ flexShrink: 0, textAlign: 'center' }}>
                  <svg width={W} height={H} style={{ display: 'block' }}>
                    <polyline points={sparkPts(r.series)} fill="none" stroke={g.c} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                    <circle cx={Number(last[0])} cy={Number(last[1])} r="2.6" fill={g.c} />
                  </svg>
                  <div style={{ fontSize: '9px', color: 'var(--text-3)', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>8-wk trend</div>
                </div>
              </div>
              {/* Stat strip */}
              <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: '11px' }}>
                {[
                  { l: 'Net', v: `${r.net >= 0 ? '+' : ''}${money(r.net)}`, c: r.roi === null ? 'var(--text-3)' : (r.net >= 0 ? 'var(--green)' : 'var(--red)') },
                  { l: 'Income', v: money(r.income), c: 'var(--text-1)' },
                  { l: 'Invested', v: money(r.invested), c: 'var(--text-1)' },
                  { l: 'Time logged', v: fmtH(r.minutes), c: 'var(--text-1)' },
                ].map(stat => (
                  <div key={stat.l}>
                    <div style={{ fontSize: '9px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{stat.l}</div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: stat.c, marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>{stat.v}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Animated count-up for the dashboard's big numbers (eases from the last value
// to the new one, so first paint counts up from 0).
function CountUp({ value, duration = 750, style }) {
  const target = Number(value) || 0;
  const [n, setN] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef();
  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      setN(Math.round(from + (target - from) * e));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);
  return <span style={style}>{n}</span>;
}

// Tiny 7-day "tasks completed" sparkline (gold bars, today highlighted).
function WeekSparkline({ days }) {
  const max = Math.max(1, ...days.map(d => d.c));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 30 }}>
      {days.map((d, i) => {
        const isToday = i === days.length - 1;
        const h = Math.max(3, Math.round((d.c / max) * 28));
        return (
          <div key={i} title={`${d.label}: ${d.c} done`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <div style={{ width: 7, height: h, borderRadius: 3, background: isToday ? 'linear-gradient(180deg,var(--accent-2),var(--accent))' : 'var(--border-strong)', transition: 'height .4s ease' }} />
            <span style={{ fontSize: 8, color: isToday ? 'var(--accent)' : 'var(--text-3)', fontWeight: isToday ? 800 : 600 }}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// "Plan my day" — asks Ari to triage the day's due/overdue + top tasks into a
// realistic ordered sequence around the calendar.
// Vertical time-blocked day timeline — fixed events + scheduled plan steps.


// ── Next Best Action engine ─────────────────────────────────────────────────
// MOVED to supabase/functions/_shared/nba.js so the SERVER can run the exact
// same ranking (Ari's next_actions tool). Imported at the top of this file.
// Do not re-inline it here — one engine, two consumers, zero drift.
// Delivery-failure copy. A bounce is the ONLY signal that an email the app already
// told you was "Sent." never actually arrived — so it outranks everything else.
// BOUNCE_SHORT now lives in the shared NBA engine (imported above) — Ari uses it too.



function NextBestAction({ contacts=[], setContacts, tasks=[], setTasks, events=[], deals=[], gciGoal=0, setView, onOpenPlan, myUserId=null, oweReplyMap={}, setOweReplyMap }){
  const now=Date.now();
  const [openSignals,setOpenSignals]=useState({});
  const [docActions,setDocActions]=useState([]);
  const [bounceActions,setBounceActions]=useState([]);
  const [showBounces,setShowBounces]=useState(false);
  const [bounceNonce,setBounceNonce]=useState(0);
  useEffect(()=>{ let alive=true; (async()=>{
    try{
      const { data } = await supabase.from('email_bounces')
        .select('id, original_subject, failed_recipients, reason_code, bounced_at')
        .eq('handled',false).order('bounced_at',{ascending:false}).limit(10);
      if(!alive) return;
      setBounceActions(bounceSignals(data||[]));  // shared engine — same copy Ari speaks
    }catch(_){}
  })(); return ()=>{alive=false;}; },[bounceNonce]);
  useEffect(()=>{ let alive=true; (async()=>{
    try{
      const since=new Date(Date.now()-30*86400000).toISOString();
      const { data } = await supabase.from('email_tracking')
        .select('contact_id,confident_open_at,open_count')
        .not('contact_id','is',null).not('confident_open_at','is',null)
        .gte('confident_open_at',since).order('confident_open_at',{ascending:false}).limit(300);
      if(!alive) return;
      const m={}; for(const r of (data||[])){ if(!m[r.contact_id]) m[r.contact_id]=r; } // newest per contact
      setOpenSignals(m);
    }catch(_){}
  })(); return ()=>{alive=false;}; },[]);
  useEffect(()=>{ let alive=true; (async()=>{
    try{
      const { data } = await supabase.from('documents').select('id, title, doc_type, summary, action_label, signed_state, document_contacts(contact_id)').eq('action_needed',true).eq('status','ready').order('created_at',{ascending:false}).limit(20);
      if(!alive) return;
      setDocActions(docSignals(data||[], contacts));  // shared engine — same copy Ari speaks
    }catch(_){}
  })(); return ()=>{alive=false;}; },[contacts]);
  const { skipAction, filterSkipped } = useNbaSkips(myUserId);
  const actions=React.useMemo(()=>{ const base=buildNextActions({contacts,tasks,events,deals,now,oweReplyMap,openSignals}); const all=[...base,...docActions,...bounceActions].sort((a,b)=>b.score-a.score); return filterSkipped(all); },[contacts,tasks,events,deals,oweReplyMap,openSignals,docActions,bounceActions,filterSkipped]);
  const growth=React.useMemo(()=>buildGrowthMoves({contacts,deals,gciGoal,now}),[contacts,deals,gciGoal]);
  const [idx,setIdx]=useState(0); const [showAll,setShowAll]=useState(false);
  const [swipeDir,setSwipeDir]=useState(0);
  const nbaGoTo=React.useCallback((delta)=>{ setSwipeDir(delta); setIdx(i=>{ const L=(list||[]).length; if(L<=1) return i; return ((i+delta)%L+L)%L; }); },[list]);
  const nbaTouch=React.useRef({x:0,y:0,active:false});
  const nbaTouchStart=(e)=>{ const t=e.touches[0]; nbaTouch.current={x:t.clientX,y:t.clientY,active:true}; };
  const nbaTouchEnd=(e)=>{ if(!nbaTouch.current.active) return; nbaTouch.current.active=false; const t=e.changedTouches[0]; const dx=t.clientX-nbaTouch.current.x, dy=t.clientY-nbaTouch.current.y; if(Math.abs(dx)>44 && Math.abs(dx)>Math.abs(dy)*1.5) nbaGoTo(dx<0?1:-1); };
  const nbaNavBtn={width:26,height:26,borderRadius:'50%',border:'1px solid rgba(203,163,92,0.4)',background:'rgba(203,163,92,0.08)',color:'#EBCB82',fontSize:17,lineHeight:'22px',cursor:'pointer',padding:0,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0};
  const urgent=actions.length>0; const list=urgent?actions:growth;
  const cur=list[Math.min(idx,list.length-1)]||null;
  const runCta=(cta)=>{ if(!cta) return; if(cta.kind==='task_done'){ const id=cta.payload;
      // Same fire-and-forget as TodayView had — this is the second hero card.
      (async()=>{ const { error } = await supabase.from('tasks').update({completed:true, completed_at:new Date().toISOString()}).eq('id',id);
        if(error){ if(window.__notify) window.__notify('Could not mark done: '+(error.message||error),'error'); return; }
        setTasks&&setTasks(pr=>pr.map(x=>x.id===id?{...x,completed:true}:x));
        if(window.__notify) window.__notify('Done — nice work.','success');
        setIdx(0); })(); } else if(cta.kind==='open_reply'){ const ch=cta.channel||''; const isText=ch.includes('text')||ch.includes('sms'); if((isText||(!ch.includes('email')&&!cta.email)) && cta.phone){ window.__quoTab={ tab:'messages', phone:cta.phone, name:cta.name }; setView&&setView('quo'); } else if(cta.email){ window.__inboxOpenEmail=cta.email; setView&&setView('inbox'); } else if(cta.phone){ window.__quoTab={ tab:'messages', phone:cta.phone, name:cta.name }; setView&&setView('quo'); } else { setView&&setView('inbox'); } } else if(cta.kind==='bounces'){ setShowBounces(true); } else if(cta.kind==='view'){ setView&&setView(cta.payload); } else if(cta.kind==='call'){ window.location.href='tel:'+cta.payload; } };
  // "I already replied" — clears an owe-a-reply instantly by bumping the field the
  // engine reads (last_outbound_at past last_inbound_at), independent of email/text
  // sync timing. Updates local state so the card drops immediately.
  const markReplied=async(contactId)=>{ if(!contactId) return; const nowIso=new Date().toISOString();
    // Second copy of the TodayView handler fixed in v1.04.62.
    const { error } = await supabase.from('contact_interactions').insert({ user_id: myUserId, contact_id: contactId, direction:'outbound', channel:'manual', occurred_at: nowIso, brief:'Marked replied' });
    if(error){ if(window.__notify) window.__notify('Could not mark replied: '+(error.message||error),'error'); return; } setOweReplyMap && setOweReplyMap(m=>{ const n={...m}; delete n[contactId]; return n; }); if(window.__notify) window.__notify('Marked as replied — nice.','success'); setIdx(0); };
  // "No reply needed" — the matter's handled or no longer applies, and you did NOT
  // reply. Stamps no_reply_needed_at at the inbound's time so THIS message clears
  // but a future inbound from them re-arms it. Honest: doesn't fake an outbound.
  const markNoReplyNeeded=(contactId)=>{ if(!contactId) return; const stampIso=(oweReplyMap && oweReplyMap[contactId]) || new Date().toISOString(); try{ supabase.from('contacts').update({ no_reply_needed_at: stampIso }).eq('id', contactId).then(()=>{},()=>{}); }catch(_){} setOweReplyMap && setOweReplyMap(m=>{ const n={...m}; delete n[contactId]; return n; }); setContacts && setContacts(pr=>pr.map(x=>x.id===contactId?{...x, no_reply_needed_at: stampIso}:x)); if(window.__notify) window.__notify('Cleared — no reply needed.','success'); setIdx(0); };
  if(!cur) return null;
  const tagColor=cur.tag==='bounce'?'var(--red)':cur.tag==='overdue'?'var(--red)':cur.tag==='reply'?'var(--yellow)':cur.tag==='appt'?'#06b6d4':cur.tag==='deal'?'#22c55e':'var(--accent)';
  return (
    <div className="nba-card" onTouchStart={nbaTouchStart} onTouchEnd={nbaTouchEnd} style={{position:'relative',borderRadius:20,padding:'20px 18px 16px',marginBottom:22,background:'radial-gradient(90% 130% at 100% 0%, rgba(203,163,92,0.16), transparent 55%), linear-gradient(180deg, #1B1610, #100D09)',border:'1px solid rgba(203,163,92,0.55)',boxShadow:'0 0 40px rgba(203,163,92,0.12)',touchAction:'pan-y',overflow:'hidden'}}>
      <style>{`@keyframes nbaSlideL{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}@keyframes nbaSlideR{from{opacity:0;transform:translateX(-16px)}to{opacity:1;transform:translateX(0)}}`}</style>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:9}}>
        <span style={{fontSize:11,fontWeight:800,letterSpacing:'0.18em',textTransform:'uppercase',color:'#EBCB82'}}>{urgent?'✦ Do this next':'✦ You are caught up — consider this'}</span>
        {list.length>1 ? (
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <button aria-label="Previous" onClick={()=>nbaGoTo(-1)} style={nbaNavBtn}>‹</button>
            <span style={{fontSize:10.5,color:'var(--text-3)',fontWeight:700,minWidth:34,textAlign:'center'}}>{Math.min(idx+1,list.length)} / {list.length}</span>
            <button aria-label="Next" onClick={()=>nbaGoTo(1)} style={nbaNavBtn}>›</button>
          </div>
        ) : null}
      </div>
      <div key={idx} style={{animation: swipeDir<0?'nbaSlideR 0.22s ease':'nbaSlideL 0.22s ease'}}>
      <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
        <div style={{width:38,height:38,borderRadius:11,flexShrink:0,background:'var(--bg-base)',border:'1px solid '+tagColor,display:'inline-flex',alignItems:'center',justifyContent:'center'}}><Icon name={cur.icon||'target'} size={18} style={{color:tagColor}}/></div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:20,fontFamily:'Fraunces, serif',fontWeight:300,letterSpacing:'-0.01em',color:'#F6F1E7',lineHeight:1.18,overflowWrap:'anywhere',wordBreak:'break-word'}}>{cur.title}</div>
          <div style={{fontSize:12.5,color:'var(--text-2)',marginTop:3,lineHeight:1.4,overflowWrap:'anywhere',wordBreak:'break-word'}}>{cur.why}</div>
          {cur.contactId && <button type="button" onClick={()=>{ window.__pendingOpenContact=cur.contactId; setView&&setView('contacts'); }} style={{marginTop:7,background:'none',border:'none',padding:0,color:'#CBA35C',fontSize:12,fontWeight:700,cursor:'pointer',display:'inline-flex',alignItems:'center',gap:4}}>View contact <span aria-hidden="true">&rarr;</span></button>}
        </div>
      </div>
      </div>
      <div style={{display:'flex',gap:8,marginTop:13,flexWrap:'wrap',alignItems:'center'}}>
        {cur.cta && <button className="btn btn-primary btn-sm" onClick={()=>runCta(cur.cta)}>{cur.cta.label}</button>}
        {cur.tag==='reply' && cur.contactId && <button className="btn btn-ghost btn-sm" onClick={()=>markReplied(cur.contactId)} title="I've already replied — clear this">✓ Replied</button>}
        {cur.tag==='reply' && cur.contactId && <button className="btn btn-ghost btn-sm" onClick={()=>markNoReplyNeeded(cur.contactId)} title="No reply is needed — handled elsewhere or no longer applies">No reply needed</button>}
        {list.length>1 && <SnoozeMenu onPick={(when)=>{ skipAction(cur, when); setIdx(0); }} />}
        {urgent && onOpenPlan && <button className="btn btn-ghost btn-sm" onClick={()=>onOpenPlan()}>Plan my day</button>}
        {list.length>1 && <button className="btn btn-ghost btn-sm" style={{marginLeft:'auto'}} onClick={()=>setShowAll(s=>!s)}>{showAll?'Hide':'See all ('+list.length+')'}</button>}
      </div>
      {showBounces && <BouncesModal onClose={()=>setShowBounces(false)} onChanged={()=>setBounceNonce(n=>n+1)} />}
      {showAll && <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid var(--border)',display:'flex',flexDirection:'column',gap:10}}>
        {list.slice(0,8).map((a,i)=>(
          <div key={a.key} onClick={()=>{setIdx(i);setShowAll(false);}} style={{display:'flex',gap:10,alignItems:'center',cursor:'pointer',opacity:i===idx?1:0.8}}>
            <Icon name={a.icon||'target'} size={14} style={{color:'var(--text-3)',flexShrink:0}}/>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.title}</div><div style={{fontSize:11,color:'var(--text-3)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.why}</div></div>
          </div>
        ))}
      </div>}
      {!showAll && list.length>1 ? (
        <div style={{display:'flex',justifyContent:'center',gap:6,marginTop:14}}>
          {list.slice(0,8).map((_,i)=>(
            <button key={i} aria-label={'Go to action '+(i+1)} onClick={()=>{setSwipeDir(i>idx?1:-1);setIdx(i);}} style={{width:i===idx?18:6,height:6,borderRadius:3,border:'none',padding:0,cursor:'pointer',transition:'all 0.2s',background:i===idx?'#CBA35C':'rgba(203,163,92,0.3)'}} />
          ))}
        </div>
      ) : null}
    </div>
  );
}



// Morning read — Ari's daily briefing narrative, folded into the Dashboard so
// there's one home. Heavy outreach actions live in the on-demand workspace.
function DashboardPipelinePanel({ contacts = [], setView, showSphere = true }){
  const [systems,setSystems]=useState(null);
  useEffect(()=>{ (async()=>{ const { data } = await supabase.from('lead_gen_systems').select('id,name,color,monthly_budget,is_archived,is_overhead'); setSystems((data||[]).filter(s=>!s.is_archived)); })(); },[]);
  const TYPE_META = [['our_agent','Agents','var(--accent)'],['recruit','Recruits','#8b5cf6'],['lead','Leads','#f59e0b'],['client','Clients','#22c55e'],['vendor','Vendors','#3b82f6'],['partner','Partners','#06b6d4'],['family','Family','#ec4899'],['personal','Personal','#94a3b8'],['agent','Agents (other)','#eab308']];
  const all = contacts||[];
  const _byId={}; all.forEach(c=>{ if(!c.lead_gen_system_id) return; const k=c.lead_gen_system_id; _byId[k]=_byId[k]||{leads:0,closed:0}; _byId[k].leads++; if(c.pipeline_stage==='closed') _byId[k].closed++; });
  const srcKpi = (systems||[]).filter(s=>!s.is_overhead).map(s=>{ const d=_byId[s.id]||{leads:0,closed:0}; const conv=d.leads?Math.round(d.closed/d.leads*100):0; const budget=Number(s.monthly_budget)||0; const cpl=d.leads?budget/d.leads:null; return {id:s.id,name:s.name,color:s.color,leads:d.leads,closed:d.closed,conv,budget,cpl}; }).filter(x=>x.leads>0||x.budget>0).sort((a,b)=>(b.leads-a.leads)||(b.budget-a.budget));
  const anyLeads = srcKpi.some(x=>x.leads>0);
  const srcMax = Math.max(1, ...srcKpi.map(x=>x.leads));
  const counts={}; all.forEach(c=>{ const ty=c.type||'other'; counts[ty]=(counts[ty]||0)+1; });
  const sphere = TYPE_META.map(([id,label,color])=>({id,label,color,n:counts[id]||0})).filter(x=>x.n>0).sort((a,b)=>b.n-a.n);
  const sphereMax = Math.max(1, ...sphere.map(x=>x.n));
  if(systems===null) return null;
  return (<>
    <div className="dash-panel" style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:16,padding:18,marginBottom:20}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4,gap:8}}>
        <div style={{fontSize:14,fontWeight:700,color:'var(--text-1)',display:'inline-flex',alignItems:'center',gap:8}}><Icon name="signal" size={16} style={{color:'var(--accent)'}}/> Lead Source Effectiveness</div>
        <button className="btn btn-ghost btn-sm" onClick={()=>setView('pipeline')}>My pipeline →</button>
      </div>
      <div style={{fontSize:11,color:'var(--text-3)',marginBottom:14}}>{anyLeads?'Leads produced and what closed, by system':'Your active systems and monthly spend — tag contacts with a source to see what converts'}</div>
      {srcKpi.length===0 ? <div style={{fontSize:12,color:'var(--text-3)'}}>No lead-gen systems set up yet.</div> :
        srcKpi.map(k=>(<div key={k.id} style={{marginBottom:13}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:5,gap:8}}>
            <span style={{fontSize:13,fontWeight:600,color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{k.name}</span>
            <span style={{fontSize:11,color:'var(--text-2)',flexShrink:0}}>{k.leads} lead{k.leads===1?'':'s'} · {k.conv}% closed</span>
          </div>
          <div style={{height:11,borderRadius:6,background:'var(--bg-base)',overflow:'hidden'}}><div style={{height:'100%',width:(anyLeads?Math.round(k.leads/srcMax*100):100)+'%',background:k.color||'var(--accent)',borderRadius:6,opacity:anyLeads?1:0.3,transition:'width .6s ease'}}/></div>
          <div style={{marginTop:4,fontSize:10.5,color:'var(--text-3)'}}>{k.budget>0?('$'+k.budget.toLocaleString()+'/mo'+(k.cpl!=null?' · $'+Math.round(k.cpl).toLocaleString()+'/lead':'')):'No spend tracked'}{k.closed>0?' · '+k.closed+' closed':''}</div>
        </div>))
      }
    </div>
    {showSphere && (<div className="dash-panel" style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:16,padding:18,marginBottom:20}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,gap:8}}>
        <div style={{fontSize:14,fontWeight:700,color:'var(--text-1)',display:'inline-flex',alignItems:'center',gap:8}}><Icon name="contacts" size={16} style={{color:'var(--accent)'}}/> Your sphere</div>
        <span style={{fontSize:12,color:'var(--text-2)'}}>{all.length} contacts</span>
      </div>
      {sphere.length===0 ? <div style={{fontSize:12,color:'var(--text-3)'}}>No contacts yet.</div> :
        sphere.map(s=>(<div key={s.id} style={{display:'flex',alignItems:'center',gap:10,marginBottom:9}}>
          <span style={{width:96,fontSize:12,color:'var(--text-2)',flexShrink:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.label}</span>
          <div style={{flex:1,height:16,borderRadius:5,background:'var(--bg-base)',overflow:'hidden'}}><div style={{height:'100%',width:Math.round(s.n/sphereMax*100)+'%',background:s.color,borderRadius:5,minWidth:s.n>0?4:0,transition:'width .6s ease'}}/></div>
          <span style={{width:34,textAlign:'right',fontSize:13,fontWeight:700,color:'var(--text-1)'}}>{s.n}</span>
        </div>))
      }
    </div>)}
  </>);
}

function MetricTiles({ needsNow, oweReplyN, reachN, pending=[], overdue=[], unreadEmailCount=0, apptWeek, contacts=[], weekTotal, topTasks=[], setView }){
  return (
      <div className="cards-row">
        <div className="dash-tile" onClick={()=>{ setView(needsNow>0?'contacts':'tasks'); }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-3)', fontWeight:700 }}>Needs you now</span>
            <span style={{ width:30, height:30, borderRadius:9, background:'var(--accent-glow)', border:'1px solid var(--accent)', display:'inline-flex', alignItems:'center', justifyContent:'center' }}><Icon name="target" size={15} style={{ color:'var(--accent)' }} /></span>
          </div>
          <div style={{ fontSize:30, fontWeight:800, color: needsNow>0?'var(--accent)':'var(--text-1)', marginTop:8, lineHeight:1 }}><CountUp value={needsNow} /></div>
          <div style={{ fontSize:11.5, color:'var(--text-2)', marginTop:5 }}>{oweReplyN} replies · {reachN} reach-outs</div>
        </div>
        <div className="dash-tile" onClick={()=>setView('tasks')}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-3)', fontWeight:700 }}>Open tasks</span>
            <span style={{ width:30, height:30, borderRadius:9, background:'var(--bg-base)', border:'1px solid var(--border)', display:'inline-flex', alignItems:'center', justifyContent:'center' }}><Icon name="flame" size={15} style={{ color:'var(--text-2)' }} /></span>
          </div>
          <div style={{ fontSize:30, fontWeight:800, color:'var(--text-1)', marginTop:8, lineHeight:1 }}><CountUp value={pending.length} /></div>
          <div style={{ fontSize:11.5, color:'var(--text-2)', marginTop:5 }}>{topTasks.length} top priority</div>
        </div>
        <div className="dash-tile" onClick={()=>setView('inbox')}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-3)', fontWeight:700 }}>Unread email</span>
            <span style={{ width:30, height:30, borderRadius:9, background:'var(--bg-base)', border:'1px solid var(--border)', display:'inline-flex', alignItems:'center', justifyContent:'center' }}><Icon name="inbox" size={15} style={{ color:'var(--text-2)' }} /></span>
          </div>
          <div style={{ fontSize:30, fontWeight:800, color:'var(--text-1)', marginTop:8, lineHeight:1 }}><CountUp value={unreadEmailCount} /></div>
          <div style={{ fontSize:11.5, color:'var(--text-2)', marginTop:5 }}>in your inbox</div>
        </div>
        <div className="dash-tile" onClick={()=>setView('tasks')}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-3)', fontWeight:700 }}>Overdue</span>
            <span style={{ width:30, height:30, borderRadius:9, background: overdue.length>0?'rgba(239,68,68,0.12)':'var(--bg-base)', border:`1px solid ${overdue.length>0?'rgba(239,68,68,0.4)':'var(--border)'}`, display:'inline-flex', alignItems:'center', justifyContent:'center' }}><Icon name="clock" size={15} style={{ color: overdue.length>0?'#f06b6b':'var(--text-2)' }} /></span>
          </div>
          <div style={{ fontSize:30, fontWeight:800, color: overdue.length>0?'#f06b6b':'var(--text-1)', marginTop:8, lineHeight:1 }}><CountUp value={overdue.length} /></div>
          <div style={{ fontSize:11.5, color:'var(--text-2)', marginTop:5 }}>{overdue.length>0?'needs rescue':'all caught up'}</div>
        </div>
        <div className="dash-tile" onClick={()=>setView('contacts')}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-3)', fontWeight:700 }}>Reach-outs due</span>
            <span style={{ width:30, height:30, borderRadius:9, background: reachN>0?'var(--accent-glow)':'var(--bg-base)', border:`1px solid ${reachN>0?'var(--accent)':'var(--border)'}`, display:'inline-flex', alignItems:'center', justifyContent:'center' }}><Icon name="contacts" size={15} style={{ color: reachN>0?'var(--accent)':'var(--text-2)' }} /></span>
          </div>
          <div style={{ fontSize:30, fontWeight:800, color: reachN>0?'var(--accent)':'var(--text-1)', marginTop:8, lineHeight:1 }}><CountUp value={reachN} /></div>
          <div style={{ fontSize:11.5, color:'var(--text-2)', marginTop:5 }}>sphere touches</div>
        </div>
        <div className="dash-tile" onClick={()=>setView('calendar')}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-3)', fontWeight:700 }}>Appointments</span>
            <span style={{ width:30, height:30, borderRadius:9, background:'var(--bg-base)', border:'1px solid var(--border)', display:'inline-flex', alignItems:'center', justifyContent:'center' }}><Icon name="calendar" size={15} style={{ color:'var(--text-2)' }} /></span>
          </div>
          <div style={{ fontSize:30, fontWeight:800, color:'var(--text-1)', marginTop:8, lineHeight:1 }}><CountUp value={apptWeek} /></div>
          <div style={{ fontSize:11.5, color:'var(--text-2)', marginTop:5 }}>next 7 days</div>
        </div>
        <div className="dash-tile" onClick={()=>setView('contacts')}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-3)', fontWeight:700 }}>Contacts</span>
            <span style={{ width:30, height:30, borderRadius:9, background:'var(--bg-base)', border:'1px solid var(--border)', display:'inline-flex', alignItems:'center', justifyContent:'center' }}><Icon name="contacts" size={15} style={{ color:'var(--text-2)' }} /></span>
          </div>
          <div style={{ fontSize:30, fontWeight:800, color:'var(--text-1)', marginTop:8, lineHeight:1 }}><CountUp value={contacts.length} /></div>
          <div style={{ fontSize:11.5, color:'var(--text-2)', marginTop:5 }}>in your sphere</div>
        </div>
        <div className="dash-tile" onClick={()=>setView('tasks')}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span style={{ fontSize:11, textTransform:'uppercase', letterSpacing:'0.06em', color:'var(--text-3)', fontWeight:700 }}>Done this week</span>
            <span style={{ width:30, height:30, borderRadius:9, background:'rgba(34,197,94,0.12)', border:'1px solid rgba(34,197,94,0.35)', display:'inline-flex', alignItems:'center', justifyContent:'center' }}><Icon name="flame" size={15} style={{ color:'#4ade80' }} /></span>
          </div>
          <div style={{ fontSize:30, fontWeight:800, color:'var(--text-1)', marginTop:8, lineHeight:1 }}><CountUp value={weekTotal} /></div>
          <div style={{ fontSize:11.5, color:'var(--text-2)', marginTop:5 }}>tasks completed</div>
        </div>
      </div>
  );
}

function GciGauge({ deals=[], gciGoal=0, setView, userId }){
  const [goalOverride,setGoalOverride]=useState(null);
  const [editGoal,setEditGoal]=useState(false);
  const [goalInput,setGoalInput]=useState('');
  const [savingGoal,setSavingGoal]=useState(false);
  const [anim,setAnim]=useState(false);
  useEffect(()=>{ const tm=setTimeout(()=>setAnim(true),80); return ()=>clearTimeout(tm); },[]);
  const goal = goalOverride!=null ? goalOverride : (Number(gciGoal)||0);
  const saveGoal=async()=>{ const val=Math.round(Number(String(goalInput).replace(/[^0-9.]/g,''))||0); if(!val){ setEditGoal(false); return; } setSavingGoal(true); try{ await supabase.from('finance_settings').upsert({ user_id:userId, annual_gci_goal:val }, { onConflict:'user_id' }); setGoalOverride(val); setEditGoal(false); if(window.__notify) window.__notify('GCI goal set to $'+val.toLocaleString(),'success'); }catch(e){ if(window.__notify) window.__notify('Could not save goal.','error'); } setSavingGoal(false); };
  const ACTIVE=['lead','active','under_contract','closing'];
  const PROB={closing:0.90,under_contract:0.75,active:0.35,lead:0.15};
  const m0=(n)=>'$'+Math.round(n||0).toLocaleString();
  const gciOf=(d)=>{ const g=Number(d.gross_commission)||0; if(g) return g; const sp=Number(d.sale_price)||0, pct=Number(d.commission_pct)||0; return sp*pct/100; };
  const yr=new Date().getFullYear();
  const active=deals.filter(d=>ACTIVE.includes(d.status));
  const pipelineGci=active.reduce((a,d)=>a+gciOf(d),0);
  const weighted=active.reduce((a,d)=>a+gciOf(d)*(PROB[d.status]??0.3),0);
  const closed=deals.filter(d=>d.status==='closed' && d.close_date && new Date(d.close_date).getFullYear()===yr);
  const gciYtd=closed.reduce((a,d)=>a+gciOf(d),0);
  const dayOfYear=Math.max(1,Math.floor((Date.now()-new Date(yr,0,0))/86400000));
  const expectedPct=Math.min(1,dayOfYear/365);
  const expected=goal>0?goal*expectedPct:0;
  const pctG=goal>0?Math.min(1,gciYtd/goal):0;
  const onTrack=goal>0 && gciYtd>=expected;
  const R=92, SW=14, C=2*Math.PI*R;
  const off=anim?C*(1-pctG):C;
  const paceRad=(135+expectedPct*270)*Math.PI/180;
  const paceX=110+90*Math.cos(paceRad), paceY=110+90*Math.sin(paceRad);
  const goalLbl=goal>=1000?('$'+Math.round(goal/1000)+'k'):('$'+Math.round(goal));
  return (<div className="dash-panel prism-pop" style={{background:'linear-gradient(150deg, rgba(197,169,94,0.10), rgba(197,169,94,0.02))',border:'1px solid var(--accent)',borderRadius:18,padding:20,marginBottom:16}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
      <div style={{fontSize:13,fontWeight:700,color:'var(--text-1)',display:'inline-flex',gap:7,alignItems:'center'}}><Icon name="dollar" size={15} style={{color:'var(--accent)'}}/> GCI to goal</div>
      <button className="btn btn-ghost btn-sm" onClick={()=>setView('deals')}>Deals →</button>
    </div>
    <div style={{display:'flex',justifyContent:'center',margin:'2px 0'}}>
      <svg width="230" height="200" viewBox="0 0 220 196">
        <defs>
          <linearGradient id="gciG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--accent-2)"/><stop offset="1" stopColor="#9A8038"/></linearGradient>
          <filter id="gciGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <path d="M 46.36 173.64 A 90 90 0 1 1 173.64 173.64" fill="none" stroke="var(--border)" strokeWidth="14" strokeLinecap="round"/>
        {pctG>0 && <path d="M 46.36 173.64 A 90 90 0 1 1 173.64 173.64" fill="none" stroke="url(#gciG)" strokeWidth="14" strokeLinecap="round" pathLength="100" strokeDasharray="100" strokeDashoffset={anim?(100-pctG*100):100} filter="url(#gciGlow)" style={{transition:'stroke-dashoffset 1.1s cubic-bezier(.22,1,.36,1)'}}/>}
        {goal>0 && <circle cx={paceX} cy={paceY} r="4.5" fill="var(--text-1)" stroke="var(--bg-card)" strokeWidth="2"/>}
        <text x="110" y="104" textAnchor="middle" fill="var(--text-1)" fontSize="30" fontWeight="800">{m0(gciYtd)}</text>
        <text x="110" y="126" textAnchor="middle" fill="var(--text-3)" fontSize="12">{goal>0?('of '+m0(goal)):'no goal set'}</text>
        {goal>0 && <text x="110" y="146" textAnchor="middle" fill="var(--accent)" fontSize="12" fontWeight="700">{Math.round(pctG*100)}% to goal</text>}
        {goal>0 && <text x="42" y="192" textAnchor="middle" fill="var(--text-3)" fontSize="10">$0</text>}
        {goal>0 && <text x="178" y="192" textAnchor="middle" fill="var(--text-3)" fontSize="10">{goalLbl}</text>}
      </svg>
    </div>
    {goal>0 ? (
      <div style={{textAlign:'center',marginBottom:14}}><span style={{fontSize:11.5,fontWeight:700,color:onTrack?'var(--green)':'#f5b34a',background:onTrack?'rgba(34,197,94,0.12)':'rgba(245,179,74,0.12)',border:'1px solid '+(onTrack?'rgba(34,197,94,0.35)':'rgba(245,179,74,0.35)'),borderRadius:999,padding:'4px 12px'}}>{onTrack?('On pace ✓ · '+m0(gciYtd-expected)+' ahead'):('Behind pace by '+m0(expected-gciYtd))}</span></div>
    ) : (
      <div style={{marginBottom:14}}>{editGoal ? (
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',justifyContent:'center'}}>
          <input type="number" inputMode="numeric" value={goalInput} onChange={e=>setGoalInput(e.target.value)} placeholder="e.g. 150000" style={{flex:'1 1 140px',minWidth:120,background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:8,color:'var(--text-1)',padding:'8px 10px',fontSize:13}}/>
          <button className="btn btn-primary btn-sm" disabled={savingGoal} onClick={saveGoal}>{savingGoal?'Saving…':'Save goal'}</button>
        </div>
      ) : (
        <div style={{textAlign:'center'}}><button className="btn btn-primary btn-sm" onClick={()=>{setGoalInput('');setEditGoal(true);}}>Set your annual GCI goal</button></div>
      )}</div>
    )}
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,paddingTop:14,borderTop:'1px solid var(--border)'}}>
      <div style={{textAlign:'center'}}><div style={{fontSize:18,fontWeight:800,color:'var(--text-1)'}}>{m0(pipelineGci)}</div><div style={{fontSize:10,fontWeight:700,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--text-3)',marginTop:4}}>Pipeline</div>{weighted>0 && <div style={{fontSize:9.5,color:'var(--text-3)',marginTop:1}}>~{m0(weighted)} wtd</div>}</div>
      <div style={{textAlign:'center'}}><div style={{fontSize:18,fontWeight:800,color:'var(--text-1)'}}>{active.length}</div><div style={{fontSize:10,fontWeight:700,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--text-3)',marginTop:4}}>Active</div></div>
      <div style={{textAlign:'center'}}><div style={{fontSize:18,fontWeight:800,color:'var(--text-1)'}}>{closed.length}</div><div style={{fontSize:10,fontWeight:700,letterSpacing:'.06em',textTransform:'uppercase',color:'var(--text-3)',marginTop:4}}>Closed {yr}</div></div>
    </div>
  </div>);
}

function PipelineFunnel({ deals=[], setView }){
  const STAGES=[['lead','Lead','#f59e0b'],['active','Active','#3b82f6'],['under_contract','Under contract','#8b5cf6'],['closing','Closing','#06b6d4'],['closed','Closed','#22c55e']];
  const gciOf=(d)=>{ const g=Number(d.gross_commission)||0; if(g) return g; const sp=Number(d.sale_price)||0, pct=Number(d.commission_pct)||0; return sp*pct/100; };
  const yr=new Date().getFullYear();
  const rows=STAGES.map(([id,label,color])=>{ const ds=deals.filter(d=> id==='closed' ? (d.status==='closed'&&d.close_date&&new Date(d.close_date).getFullYear()===yr) : d.status===id ); return {id,label,color,n:ds.length,gci:ds.reduce((a,d)=>a+gciOf(d),0)}; });
  const total=rows.reduce((a,r)=>a+r.n,0);
  const mx=Math.max(1,...rows.map(r=>r.n));
  return (<div className="dash-panel" style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:18,padding:20,marginBottom:16}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:total>0?14:6}}>
      <div style={{fontSize:13,fontWeight:700,color:'var(--text-1)',display:'inline-flex',gap:7,alignItems:'center'}}><Icon name="signal" size={15} style={{color:'var(--accent)'}}/> Pipeline funnel</div>
      <button className="btn btn-ghost btn-sm" onClick={()=>setView('deals')}>Deals →</button>
    </div>
    {total===0 ? (
      <div style={{fontSize:12.5,color:'var(--text-3)',lineHeight:1.55}}>Your pipeline is clear. As you add deals they flow through these stages — with live commission value at each step.
        <div style={{display:'flex',gap:6,marginTop:12,flexWrap:'wrap'}}>{STAGES.map(([id,label])=>(<span key={id} style={{fontSize:10.5,fontWeight:600,color:'var(--text-3)',border:'1px dashed var(--border)',borderRadius:999,padding:'4px 10px'}}>{label}</span>))}</div>
      </div>
    ) : (
      <div>{rows.map((r)=>(
        <div key={r.id} style={{display:'flex',alignItems:'center',gap:10,marginBottom:9}}>
          <span style={{width:96,fontSize:12,color:'var(--text-2)',flexShrink:0}}>{r.label}</span>
          <div style={{flex:1}}><div style={{width:Math.max(r.n>0?8:0,Math.round(r.n/mx*100))+'%',minWidth:r.n>0?28:0,height:24,borderRadius:7,background:r.color,opacity:0.9,display:'flex',alignItems:'center',justifyContent:'center',transition:'width .7s ease'}}>{r.n>0 && <span style={{fontSize:12,fontWeight:800,color:'#0c0c0f'}}>{r.n}</span>}</div></div>
          <span style={{width:70,textAlign:'right',fontSize:11,color:'var(--text-3)',flexShrink:0}}>{r.gci>0?('$'+Math.round(r.gci).toLocaleString()):'—'}</span>
        </div>))}
      </div>
    )}
  </div>);
}

function SphereDonut({ contacts=[], setView }){
  const [anim,setAnim]=useState(false);
  useEffect(()=>{ const tm=setTimeout(()=>setAnim(true),100); return ()=>clearTimeout(tm); },[]);
  const TYPE_META=[['our_agent','Agents','#C5A95E'],['recruit','Recruits','#8b5cf6'],['vendor','Vendors','#3b82f6'],['family','Family','#ec4899'],['lead','Leads','#f59e0b'],['client','Clients','#22c55e'],['partner','Partners','#06b6d4'],['personal','Personal','#94a3b8'],['agent','Agents (other)','#eab308']];
  const counts={}; (contacts||[]).forEach(c=>{ const ty=c.type||'other'; counts[ty]=(counts[ty]||0)+1; });
  let seg=TYPE_META.map(([id,label,color])=>({id,label,color,n:counts[id]||0})).filter(x=>x.n>0);
  const known=new Set(TYPE_META.map(m=>m[0])); let otherN=0; Object.keys(counts).forEach(k=>{ if(!known.has(k)) otherN+=counts[k]; }); if(otherN>0) seg.push({id:'other',label:'Other',color:'#64748b',n:otherN});
  seg.sort((a,b)=>b.n-a.n);
  const tot=seg.reduce((a,s)=>a+s.n,0);
  const R=58, C=2*Math.PI*R; let off=0;
  if(tot===0) return (<div className="dash-panel" style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:18,padding:20,marginBottom:16}}><div style={{fontSize:13,fontWeight:700,color:'var(--text-1)',marginBottom:6}}>Your sphere</div><div style={{fontSize:12,color:'var(--text-3)'}}>No contacts yet.</div></div>);
  return (<div className="dash-panel prism-pop" style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:18,padding:20,marginBottom:16}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
      <div style={{fontSize:13,fontWeight:700,color:'var(--text-1)',display:'inline-flex',gap:7,alignItems:'center'}}><Icon name="contacts" size={15} style={{color:'var(--accent)'}}/> Your sphere</div>
      <button className="btn btn-ghost btn-sm" onClick={()=>setView('contacts')}>{tot} contacts →</button>
    </div>
    <div style={{display:'flex',gap:18,alignItems:'center',flexWrap:'wrap'}}>
      <svg width="150" height="150" viewBox="0 0 150 150" style={{flexShrink:0,margin:'0 auto'}}>
        {seg.map((s,i)=>{ const len=s.n/tot*C; const el=(<circle key={i} cx="75" cy="75" r={R} fill="none" stroke={s.color} strokeWidth="20" strokeDasharray={(anim?Math.max(0,len-1.5):0)+' '+C} strokeDashoffset={-off} transform="rotate(-90 75 75)" style={{transition:'stroke-dasharray .9s cubic-bezier(.22,1,.36,1)'}}/>); off+=len; return el; })}
        <text x="75" y="71" textAnchor="middle" fill="var(--text-1)" fontSize="26" fontWeight="800">{tot}</text>
        <text x="75" y="90" textAnchor="middle" fill="var(--text-3)" fontSize="9.5" letterSpacing=".08em">CONTACTS</text>
      </svg>
      <div style={{flex:1,minWidth:150}}>
        {seg.map((s,i)=>(<div key={i} onClick={()=>setView('contacts')} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,cursor:'pointer'}}>
          <span style={{width:9,height:9,borderRadius:3,background:s.color,flexShrink:0}}/>
          <span style={{flex:1,fontSize:12,color:'var(--text-2)'}}>{s.label}</span>
          <span style={{fontSize:12,fontWeight:700,color:'var(--text-1)'}}>{s.n}</span>
        </div>))}
      </div>
    </div>
  </div>);
}

function MyNumbersView({ tasks=[], contacts=[], events=[], deals=[], unreadEmailCount=0, setView, userId, oweReplyMap={} }){
  const [gciGoal,setGciGoal]=useState(0);
  useEffect(()=>{ (async()=>{ try{ const { data } = await supabase.from('finance_settings').select('annual_gci_goal').eq('user_id',userId).maybeSingle(); setGciGoal(Number(data?.annual_gci_goal)||0); }catch(_e){} })(); },[userId]);
  const now=Date.now(); const todayISO=new Date(now).toISOString().slice(0,10);
  const pending=tasks.filter(t=>!t.completed);
  const overdue=pending.filter(t=>t.due_date && t.due_date<todayISO);
  const topTasks=pending.filter(t=>t.priority==='high');
  const lastTouch=(c)=>{ const a=[c.last_contact_at,c.last_inbound_at,c.last_outbound_at].filter(Boolean).map(x=>new Date(x).getTime()); return a.length?Math.max(...a):null; };
  const oweReplyN=contacts.filter(c=>{ if(c.reachout_snooze_until&&new Date(c.reachout_snooze_until)>new Date(now))return false; const owedAt=oweReplyMap && oweReplyMap[c.id]; if(!owedAt) return false; if(c.comms_settled_at && new Date(c.comms_settled_at)>=new Date(owedAt)) return false; return true; }).length;
  const reachN=contacts.filter(c=>{ const cad=c.cadence_days; if(!cad)return false; if(c.reachout_snooze_until&&new Date(c.reachout_snooze_until)>new Date(now))return false; const ts=lastTouch(c); const ds=ts===null?null:Math.floor((now-ts)/86400000); return ds===null?true:ds>=cad; }).length;
  const dueOrOverdue=pending.filter(t=>t.due_date&&t.due_date<=todayISO).length;
  const needsNow=oweReplyN+reachN+dueOrOverdue;
  const apptWeek=(events||[]).filter(e=>e.start_at&&new Date(e.start_at).getTime()>=now&&(new Date(e.start_at).getTime()-now)<=7*86400000).length;
  const weekTotal=tasks.filter(t=>t.completed&&t.completed_at&&(now-new Date(t.completed_at).getTime())<=7*86400000).length;
  return (<div className="view ww-prism">
    <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 26% at 50% -4%, rgba(203,163,92,.09), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h2,.ww-prism h3{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .form-input,.ww-prism .form-select{background:#1B1610;border:1px solid rgba(203,163,92,.22);color:#F6F1E7;} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style>
    <MyProduction year={2026} />
    <div style={{ marginBottom:14 }}>
      <h2 style={{ margin:0, fontFamily:'Fraunces, serif', fontSize:34, fontWeight:300, letterSpacing:'-0.02em', color:'#F6F1E7', lineHeight:1.05 }}>My numbers.</h2>
      <div style={{ fontSize:13, color:'#C8BFAE', marginTop:4 }}>Your production, pipeline, and activity</div>
    </div>
    <div style={{ marginTop:14 }}>
      <GciGauge deals={deals} gciGoal={gciGoal} setView={setView} userId={userId} />
      <SphereDonut contacts={contacts} setView={setView} />
      <PipelineFunnel deals={deals} setView={setView} />
      <div style={{ fontSize:10.5, fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-3)', margin:'2px 2px 10px' }}>Activity</div>
      <MetricTiles needsNow={needsNow} oweReplyN={oweReplyN} reachN={reachN} pending={pending} overdue={overdue} unreadEmailCount={unreadEmailCount} apptWeek={apptWeek} contacts={contacts} weekTotal={weekTotal} topTasks={topTasks} setView={setView} />
      <DashboardPipelinePanel contacts={contacts} setView={setView} showSphere={false} />
      {userId && <DashboardROI userId={userId} setView={setView} />}
    </div>
  </div>);
}

// Read-only announcements history for the Dashboard — lets anyone revisit past
// announcements (not just see them once at acknowledgement). RLS scopes rows to
// brokerage-wide + the viewer's own team; unacked ones are badged "new".
function DashboardAnnouncements({ userId }) {
  const [items, setItems] = useState([]);
  const [newIds, setNewIds] = useState(() => new Set());
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.from('announcements')
          .select('id,title,body,created_at,team_id')
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(8);
        if (alive) setItems(Array.isArray(data) ? data : []);
      } catch (_) { if (alive) setItems([]); }
      try {
        const { data } = await supabase.rpc('my_unacked_announcements');
        if (alive && Array.isArray(data)) setNewIds(new Set(data.map(a => a.id)));
      } catch (_) {}
    })();
    return () => { alive = false; };
  }, [userId]);
  if (!items.length) return null;
  const when = (iso) => {
    const d = new Date(iso), now = new Date(), s = Math.floor((now - d) / 1000);
    if (s < 60) return 'Just now';
    const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
    const days = Math.floor(h / 24); if (days === 1) return 'Yesterday';
    if (days < 7) return days + 'd ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  };
  const shown = expanded ? items : items.slice(0, 3);
  return (
    <div className="dash-card" style={{ marginBottom: 22 }}>
      <div className="panel-header" style={{ borderRadius: '16px 16px 0 0' }}>
        <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="megaphone" size={15} style={{ color: 'var(--accent)' }} /> Announcements</h3>
        {newIds.size > 0 && <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent)' }}>{newIds.size} new</span>}
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {shown.map((a, i) => {
          const isNew = newIds.has(a.id);
          const last = i === shown.length - 1;
          return (
            <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 0', borderBottom: last ? 'none' : '1px solid var(--border)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: isNew ? 'var(--accent)' : 'var(--border)' }} title={isNew ? 'New' : 'Seen'} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-1)' }}>{a.title || 'Announcement'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', whiteSpace: 'nowrap', flexShrink: 0 }}>{when(a.created_at)}</div>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 3, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{a.body}</div>
                <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{a.team_id ? 'Team' : 'Brokerage'}</div>
              </div>
            </div>
          );
        })}
        {items.length > 3 && <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(e => !e)} style={{ alignSelf: 'flex-start', marginTop: 8 }}>{expanded ? 'Show less' : `Show ${items.length - 3} more`}</button>}
      </div>
    </div>
  );
}

function DashboardView({ tasks, setTasks, unreadEmailCount = 0, needsReviewCount = 0, reviewCount = 0, user, setView, robots, contacts = [], setContacts, brain, defaultSystem, properties = [], events = [], onOpenPlan, deals = [], oweReplyMap = {}, setOweReplyMap }) {
  const [editTask, setEditTask] = useState(null);
  const [fin, setFin] = useState(null);

  // Save edits to a task triggered from the dashboard. Mirrors the logic in
  // TasksView so behavior (priority system, task_contacts sync) is identical.
  async function handleTaskSave(data) {
    if (!editTask) return;
    const { _contact_ids, _email, ...taskData } = data;
    const { data: updated, error } = await supabase.from('tasks')
      .update(taskData).eq('id', editTask.id).select().single();
    if (error) {
      notify("Couldn't save changes. Try again.", 'error');
      return;
    }
    if (updated) {
      setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
    }
    // Atomic contact-link replacement (Pass 1 Finding #4)
    if (Array.isArray(_contact_ids)) {
      const { error: rpcErr } = await supabase.rpc('set_task_contacts', {
        p_task_id: editTask.id,
        p_contact_ids: _contact_ids,
      });
      if (rpcErr) {
        notify("Task saved — but contact links didn't update.", 'error');
      }
    }
    if (_email) {
      const { error: emErr } = await emailAssignTask(editTask.id, _email);
      if (emErr) { notify(emErr, 'error'); return; }
      notify('Task emailed to ' + _email.to, 'success');
    }
    setEditTask(null);
  }

  // Toggle complete from the dashboard (checkbox click)
  async function toggleComplete(task, e) {
    e.stopPropagation();  // don't trigger the row's edit-on-click
    const newCompleted = !task.completed;
    const { data: updated, error } = await supabase.from('tasks')
      .update({ completed: newCompleted, updated_at: new Date().toISOString() })
      .eq('id', task.id).select().single();
    if (error) {
      notify("Couldn't update task. Try again.", 'error');
      return;
    }
    if (updated) setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
  }
  // Pull streak + GCI goal for the momentum hero (best-effort).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.from('finance_settings')
          .select('current_prospecting_streak,best_prospecting_streak,annual_gci_goal')
          .eq('user_id', user?.id).maybeSingle();
        if (alive) setFin(data || {});
      } catch (_e) { if (alive) setFin({}); }
    })();
    return () => { alive = false; };
  }, [user?.id]);

  const pending = tasks.filter(t=>!t.completed);
  const topTasks = sortTasks(pending.filter(isTopPriority));
  const today = new Date();
  const now = Date.now();
  const gr = today.getHours()<12?'Good morning':today.getHours()<17?'Good afternoon':'Good evening';
  const name = user?.user_metadata?.display_name?.trim() || user?.user_metadata?.full_name?.trim()?.split(/\s+/)[0] || user?.email?.split('@')[0] || 'there';
  const todayISO = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const doneToday = tasks.filter(t=>t.completed && t.updated_at && new Date(t.updated_at).toDateString()===today.toDateString()).length;
  const dueToday = pending.filter(t=>t.due_date===todayISO).length;
  const overdue = pending.filter(t=>t.due_date && t.due_date < todayISO);
  const todayTotal = doneToday + dueToday;
  const ringPct = todayTotal>0 ? doneToday/todayTotal : (pending.length===0 ? 1 : 1);
  // "Needs you now" — mirrors the Needs Attention panel's totals. Uses the ONE
  // canonical owesReply() rule (honors settle re-arm on a newer inbound) instead
  // of a hand-rolled copy that treated any settle as permanent (the Scott bug).
  const oweReplyN = contacts.filter(c => {
    if (c.reachout_snooze_until && new Date(c.reachout_snooze_until) > new Date()) return false;
    return owesReply(c);
  }).length;
  const reachN = contacts.filter(c => { const cad = c.cadence_days; if (!cad) return false; if (c.reachout_snooze_until && new Date(c.reachout_snooze_until) > new Date()) return false; const a = [c.last_contact_at, c.last_inbound_at, c.last_outbound_at].filter(Boolean).map(t => new Date(t).getTime()); const ts = a.length ? Math.max(...a) : null; const ds = ts === null ? null : Math.floor((now - ts) / 86400000); return ds === null ? true : ds >= cad; }).length;
  const dueOrOverdue = pending.filter(t => t.due_date && t.due_date <= todayISO).length;
  const needsNow = oweReplyN + reachN + dueOrOverdue;
  const upcoming = (events||[]).filter(e=>e.start_at && new Date(e.start_at) >= new Date()).sort((a,b)=>new Date(a.start_at)-new Date(b.start_at)).slice(0,4);
  const apptWeek = (events||[]).filter(e=>e.start_at && new Date(e.start_at).getTime() >= now && (new Date(e.start_at).getTime()-now) <= 7*86400000).length;
  const gciGoal = Number(fin?.annual_gci_goal || 0);
  const _ACTIVE = ['lead','active','under_contract','closing'];
  const _gciOf = (d)=>{ const g=Number(d.gross_commission)||0; if(g) return g; const sp=Number(d.sale_price)||0, pct=Number(d.commission_pct)||0; return sp*pct/100; };
  const _yrNow = new Date().getFullYear();
  const pipelineGci = (deals||[]).filter(d=>_ACTIVE.includes(d.status)).reduce((a,d)=>a+_gciOf(d),0);
  const gciYtd = (deals||[]).filter(d=>d.status==='closed' && d.close_date && new Date(d.close_date).getFullYear()===_yrNow).reduce((a,d)=>a+_gciOf(d),0);
  const gciPct = gciGoal>0 ? Math.min(100, Math.round(gciYtd/gciGoal*100)) : 0;
  const streak = fin?.current_prospecting_streak || 0;
  const bestStreak = fin?.best_prospecting_streak || 0;
  const money0 = (n) => '$' + Math.round(n).toLocaleString();
  const robot = robots[0];
  // Last 7 days of completed-task counts for the hero sparkline
  const weekDone = (() => {
    const arr = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const ds = d.toDateString();
      const c = tasks.filter(t => t.completed && (t.completed_at || t.updated_at) && new Date(t.completed_at || t.updated_at).toDateString() === ds).length;
      arr.push({ c, label: d.toLocaleDateString('en-US', { weekday: 'narrow' }) });
    }
    return arr;
  })();
  const weekTotal = weekDone.reduce((a, b) => a + b.c, 0);

  // Radial progress ring (gold gradient)
  const Ring = ({ pct, size=96, stroke=10, children }) => {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    const off = c * (1 - Math.max(0, Math.min(1, pct)));
    return (
      <div style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
        <svg width={size} height={size} style={{ transform:'rotate(-90deg)' }}>
          <defs><linearGradient id="dashGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--accent-2)"/><stop offset="1" stopColor="var(--accent)"/></linearGradient></defs>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--bg-base)" strokeWidth={stroke} />
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="url(#dashGold)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{ transition:'stroke-dashoffset .7s ease' }} />
        </svg>
        <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>{children}</div>
      </div>
    );
  };
  const fmtEvent = (iso) => { const d = new Date(iso); const sameDay = d.toDateString() === today.toDateString(); const tom = new Date(today); tom.setDate(tom.getDate()+1); const isTom = d.toDateString() === tom.toDateString(); const t = d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); return sameDay ? `Today · ${t}` : isTom ? `Tomorrow · ${t}` : `${d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})} · ${t}`; };

  return (
    <div className="ww-prism">
      <style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 26% at 50% -4%, rgba(203,163,92,.10), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h2,.ww-prism h3{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .dash-hero{background:linear-gradient(180deg,#1B1610,#100D09);border:1px solid rgba(203,163,92,.22);border-radius:20px;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .quick-chip{border:1px solid rgba(203,163,92,.34);color:#C8BFAE;background:transparent;} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style>
      <CoachNudge contacts={contacts} tasks={tasks} events={events} deals={deals} reviewCount={reviewCount} oweReplyMap={oweReplyMap} setView={setView} />
      {reviewCount > 0 && (
        <button onClick={()=>setView('review')} style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'12px 16px', marginBottom:12, borderRadius:14, cursor:'pointer', textAlign:'left', background:'linear-gradient(180deg,#1B1610,#100D09)', border:'1px solid rgba(203,163,92,.34)' }}>
          <span style={{ fontSize:18 }}>✦</span>
          <span style={{ flex:1, fontSize:13.5, fontWeight:600, color:'#F6F1E7' }}>{reviewCount} thing{reviewCount>1?'s':''} waiting for you to review</span>
          <span style={{ color:'#CBA35C', fontSize:18 }}>→</span>
        </button>
      )}
      {needsReviewCount > 0 && (
        <button onClick={()=>setView('email_review')} style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'11px 15px', marginBottom:12, borderRadius:12, cursor:'pointer', background:'linear-gradient(90deg, rgba(197,169,94,0.16), rgba(197,169,94,0.06))', border:'1px solid rgba(197,169,94,0.45)', color:'var(--text-1)' }}>
          <span style={{ fontSize:13.5, fontWeight:700 }}>📩 <b style={{ color:'var(--accent)' }}>{needsReviewCount}</b> email{needsReviewCount>1?'s':''} flagged for your review</span>
          <span style={{ fontSize:12.5, fontWeight:800, color:'var(--accent)', whiteSpace:'nowrap' }}>Review →</span>
        </button>
      )}
      {/* Hero */}
      <div className="dash-hero">
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:16, flexWrap:'wrap' }}>
          <div style={{ minWidth:0 }}>
            <h2 style={{ margin:0, fontFamily:'Fraunces, serif', fontSize:34, fontWeight:300, letterSpacing:'-0.02em', color:'#F6F1E7', lineHeight:1.05 }}>{gr}, {name}.</h2>
            <p style={{ margin:'4px 0 0', fontSize:13, color:'var(--text-2)', fontWeight:500 }}>{today.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</p>
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap', flex:'1 1 100%', justifyContent:'center' }}>
            <span title={`Best streak: ${bestStreak} days`} style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'7px 12px', borderRadius:999, background:'rgba(245,158,11,0.12)', border:'1px solid rgba(245,158,11,0.4)', color:'#f5b34a', fontSize:12.5, fontWeight:800 }}>🔥 {streak}-day streak</span>
            <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'7px 12px', borderRadius:999, background:'rgba(34,197,94,0.12)', border:'1px solid rgba(34,197,94,0.35)', color:'#4ade80', fontSize:12.5, fontWeight:800 }}>✓ {doneToday} done today</span>
          </div>
        </div>

        {/* Today focus row: ring + momentum + CTA */}
        <div style={{ display:'flex', alignItems:'center', gap:20, marginTop:18, flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:16, flex:'1 1 260px', minWidth:240 }}>
            <Ring pct={ringPct}>
              <CountUp value={dueToday} style={{ fontSize:30, fontWeight:300, fontFamily:'Fraunces, serif', color:'#F6F1E7', lineHeight:1 }} />
              <span style={{ fontSize:9.5, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-3)', marginTop:2 }}>due today</span>
            </Ring>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:14, fontWeight:700, color:'var(--text-1)' }}>{dueToday===0 ? 'Today is clear' : `${dueToday} ${dueToday===1?'task':'tasks'} to close out`}</div>
              <div style={{ fontSize:12.5, color:'var(--text-2)', marginTop:3 }}>{doneToday} done · {pending.length} open{overdue.length>0 ? <span style={{ color:'var(--red)', fontWeight:700 }}> · {overdue.length} overdue</span> : null}</div>
              {gciGoal>0 && <div style={{ fontSize:11.5, color:'var(--text-3)', marginTop:5, display:'inline-flex', alignItems:'center', gap:5 }}><Icon name="target" size={12} style={{ color:'var(--accent)' }} /> {money0(gciGoal)} GCI goal</div>}
            </div>
          </div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', flex:'1 1 100%', justifyContent:'center' }}>
            <button className="btn btn-primary" onClick={()=>setView('chat')} style={{ borderRadius:11, padding:'11px 18px', fontSize:14, boxShadow:'0 4px 14px rgba(197,169,94,0.35)' }}>✦ Ask {robot?.name||'Ari'}</button>
            <button className="quick-chip" onClick={onOpenPlan} style={{ padding:'11px 16px' }}>✦ Plan my day</button>
          </div>
        </div>

        {/* Weekly momentum sparkline */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, marginTop:16, paddingTop:14, borderTop:'1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.07em', textTransform:'uppercase', color:'var(--text-3)' }}>This week</div>
            <div style={{ fontSize:13, fontWeight:700, color:'var(--text-1)', marginTop:2 }}><CountUp value={weekTotal} /> tasks completed</div>
          </div>
          <WeekSparkline days={weekDone} />
        </div>
      </div>

      <NextBestAction contacts={contacts} setContacts={setContacts} tasks={tasks} setTasks={setTasks} events={events} deals={deals} gciGoal={gciGoal} setView={setView} onOpenPlan={onOpenPlan} myUserId={user?.id} oweReplyMap={oweReplyMap} setOweReplyMap={setOweReplyMap} />
      <Tip id="nba" label="Why this is first">Top producers don't do <b>more</b> — they do the <b>right thing next</b>. Prism scans every signal — your tasks, who owes you a reply, cadence, appointments, deals — and surfaces the single highest-leverage move, so you never wonder where to start.</Tip>

      {/* At-a-glance pulse — full metrics live in My numbers */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <span style={{ fontSize:10.5, fontWeight:800, letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--text-3)' }}>At a glance</span>
        <button className="btn btn-ghost btn-sm" onClick={()=>setView('numbers')}>My numbers →</button>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(78px,1fr))', gap:9, marginBottom:22 }}>
        {[
          { label:'Needs now', val:needsNow, color: needsNow>0?'var(--accent)':'var(--text-1)' },
          { label:'Appts 7d', val:apptWeek, color:'var(--text-1)' },
          { label:'Pipeline', val:money0(pipelineGci), color:'var(--text-1)' },
          { label: gciGoal>0?'GCI pace':'GCI', val: gciGoal>0?(gciPct+'%'):money0(gciYtd), color:'var(--accent)' },
        ].map((s,si)=>(
          <div key={si} onClick={()=>setView('numbers')} style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:13, padding:'13px 10px', cursor:'pointer', textAlign:'center' }}>
            <div style={{ fontSize:24, fontWeight:300, fontFamily:'Fraunces, serif', letterSpacing:'-0.01em', color:s.color, lineHeight:1 }}>{s.val}</div>
            <div style={{ fontSize:9.5, color:'var(--text-3)', marginTop:4, fontWeight:700, letterSpacing:'0.04em', textTransform:'uppercase' }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div className="dash-grid">
        {/* Top Priority */}
        <div className="dash-card" style={{ marginBottom:20 }}>
          <div className="panel-header" style={{ borderRadius:'16px 16px 0 0' }}><h3 style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="flame" size={15} style={{ color:'var(--accent)' }} /> Top Priority</h3><button className="btn btn-ghost btn-sm" onClick={()=>setView('tasks')}>All tasks</button></div>
          <div className="panel-body">
            {topTasks.length===0
              ? <div className="empty-state" style={{padding:'20px 0'}}><p>All clear — no top priority tasks.</p></div>
              : <div className="task-list">{topTasks.slice(0,5).map(t=>(
                  <div key={t.id} className="task-item" onClick={() => setEditTask(t)} style={{cursor:'pointer'}}>
                    <input type="checkbox" checked={!!t.completed} onClick={(e) => toggleComplete(t, e)} onChange={() => {}} style={{flexShrink:0,width:'18px',height:'18px',cursor:'pointer',accentColor:'var(--accent)'}} title={t.completed ? 'Mark as not done' : 'Mark as done'} />
                    <span className="task-text" style={{textDecoration: t.completed ? 'line-through' : 'none', color: t.completed ? 'var(--text-3)' : 'var(--text-1)'}}>{t.title}</span>
                    <div className="task-meta">
                      <span className={`task-priority ${priorityClass(t)}`}>{priorityLabel(t)}</span>
                      {t.due_date && <span className="task-due">{t.due_date}</span>}
                    </div>
                  </div>
                ))}</div>
            }
          </div>
        </div>

        {editTask && (
          <TaskModal onClose={() => setEditTask(null)} onSave={handleTaskSave}
            onDelete={async (t) => {
              if (!await confirmDialog(`Delete "${t.title}"? This cannot be undone.`, { confirmLabel: 'Delete', danger: true })) return;
              const { error } = await supabase.from('tasks').delete().eq('id', t.id);
              if (error) { if (window.__notify) window.__notify('Could not delete: ' + error.message, 'error'); return; }
              setTasks(prev => prev.filter(x => x.id !== t.id));
              setEditTask(null);
              if (window.__notify) window.__notify('Task deleted.', 'success');
              try { window.dispatchEvent(new Event('prism:tasks-changed')); } catch (_) {}
            }}
            initial={editTask} defaultSystem={defaultSystem} brain={brain} contacts={contacts} properties={properties} events={events} userId={user.id} />
        )}
      </div>

      <DashboardAnnouncements userId={user?.id} />

      {/* Lead-Gen ROI */}
    </div>
  );
}

// ─────────────────────────────────────────
// CONTACTS VIEW
// ─────────────────────────────────────────
// Contact detail modal: shows DISC profile, evidence trail, baseline test entry,
// and re-analyze. Replaces directly opening the edit form when clicking a contact.
// Recordings panel inside ContactDetailModal: list, upload, transcribe, view transcript.
// ─── AUDIO TRANSCODING (browser, ffmpeg.wasm) ──────────────────────────
// OpenAI Whisper rejects formats like AMR (what Android call-recorders produce)
// and Storage blocks them too. When an unsupported file is picked we transcode
// it to a small 16 kHz mono MP3 in the browser before upload — accepted by both
// Storage and Whisper. Uses the single-thread ffmpeg.wasm core (no COOP/COEP
// required, so it works on GitHub Pages), lazy-loaded from CDN only on demand.



// Contact detail modal: shows DISC profile, evidence trail, baseline test entry,
// and re-analyze. Replaces directly opening the edit form when clicking a contact.
// ─────────────────────────────────────────────────────────────────────────
// Unified Activity Timeline — phone calls, meetings, texts, emails & notes in
// one chronological stream (the way Attio / Affinity / HubSpot do it). Backed
// by public.contact_interactions (kind/body/occurred_at/direction/duration/
// pinned). Supports back-dating, pin-to-top, inline edit, type filtering, and
// "log + schedule follow-up" which spawns a linked task.
// ─────────────────────────────────────────────────────────────────────────

// Follow-up drafter — reads a timeline entry + contact context, asks Ari to
// draft an email or text in the user's voice, and sends via Gmail (email) or
// hands off to the SMS app (text). Logs the sent follow-up back to the timeline.
// ── Message templates + merge fields ─────────────────────────────────────



// Templates manager — create / edit / delete reusable email & text snippets.


// ─────────────────────────────────────────
// QUO TEXT COMPOSER — send an SMS through the user's Quo (OpenPhone) number
// straight from the app (contact card, contacts list, daily briefing), so no
// copy/paste into a phone's Messages app. Logs the text to the contact timeline.
// ─────────────────────────────────────────










// Downloads a cleaned-up, branded Word (.docx) research report. Two modes:
// "client" (factual dossier to share — no DISC, no coaching) and "agent" (adds
// the DISC behavioral read; still excludes the rapport/things-to-avoid coaching).
// The docx is built server-side (research-report-docx) so it works on every
// device, including iPhone.










// ─── CustomFieldsPanel — Prism CRM custom fields ────────────────────
// Renders all custom_field_definitions for the contact scope, grouped
// by group_name in collapsible sections. Each field gets an appropriate
// editor (text, long_text, number, currency, date, boolean, dropdown,
// contact_ref, lead_gen_system_ref, etc.) and saves on blur / change.
// Agents can add their own custom fields via the "+ Add field" button.
// Cross-indexed refs (contact_ref, lead_gen_system_ref) show a select
// of the relevant records, so a "Lender" field surfaces all of the
// user's contacts that match the optional filter.



// ─── MultiContactPicker ──────────────────────────────────────────────
// Chip-style picker for multi-contact custom fields (children, parents,
// any user-defined contact_ref_multi field). Behavior:
//   - Existing linked contacts render as chips with × to remove
//   - Type to search existing contacts by name; ↑/↓ to navigate, Enter
//     to add, Backspace at empty input removes the last chip
//   - If the typed name doesn't match any existing contact, a
//     "+ Create new contact: 'X'" option appears at the bottom — tap to
//     create a new contact record on the fly and link it in one step
//   - Filters out the current contact (no self-links) and contacts
//     already added


// ─── SingleContactPicker ─────────────────────────────────────────────
// Search-with-autocomplete picker for single-value contact_ref fields
// (Spouse / partner, Lender, Title rep, Referred by, etc.). Mirrors
// the MultiContactPicker UX but holds exactly one selected contact:
//   - When unset: a search input. Type a name to filter; ↑/↓ to move,
//     Enter to pick. Same '+ Create new contact: \"X\"' affordance when
//     no exact match exists.
//   - When set: shows the selected contact as a chip with avatar +
//     name + secondary line. × clears the value and returns to search.
// Respects def.ref_filter so e.g. the 'Lender' field only surfaces
// vendor/partner contacts in the dropdown.


// ── Social links ─────────────────────────────────────────────────────────────
// Stored as contacts.socials jsonb, keyed by platform. Two jobs: give the agent
// one-tap access to a person's profiles, and feed those profiles into web
// research as identity anchors (a LinkedIn URL is the single strongest anchor —
// far better than name+email). Covers every person-type (lead, recruit, agent)
// because they're all contacts rows.

// Turn a handle or partial into a full URL for linking; leave real URLs alone.






// Helper: does this stored value object actually hold a non-empty value
// for its declared field type?


// Single field row — label + appropriate editor


// Read a value row into the editor's local-state shape


// ─── AddCustomFieldModal — user-defined fields ───────────────────────


// ─── MultiValueField ────────────────────────────────────────────────
// Reusable editor for multi-entry contact fields (phones, emails).
// Each entry has a value, a label (Mobile / Work / Home / etc., picked
// from a standard list or custom), and an is_default flag. The default
// entry is the one shown in the contact's compact display and used by
// quick actions like Call / Email. Modeled after iOS Contacts and
// Google Contacts which converged on the same pattern.
const PHONE_LABEL_OPTIONS = ['Mobile', 'Work', 'Home', 'Main', 'Fax', 'Pager', 'Other'];
const EMAIL_LABEL_OPTIONS = ['Personal', 'Work', 'School', 'Other'];

function MultiValueField({ values, onChange, kind, addLabel }) {
  const standard = kind === 'email' ? EMAIL_LABEL_OPTIONS : PHONE_LABEL_OPTIONS;
  const arr = Array.isArray(values) ? values : [];

  function update(i, patch) {
    onChange(arr.map((v, idx) => idx === i ? { ...v, ...patch } : v));
  }
  function remove(i) {
    const next = arr.filter((_, idx) => idx !== i);
    // If we removed the default, make the first remaining entry the default
    if (arr[i]?.is_default && next.length > 0 && !next.some(x => x.is_default)) {
      next[0] = { ...next[0], is_default: true };
    }
    onChange(next);
  }
  function setDefault(i) {
    onChange(arr.map((v, idx) => ({ ...v, is_default: idx === i })));
  }
  function add() {
    const next = [...arr, { value: '', label: standard[0], is_default: arr.length === 0 }];
    onChange(next);
  }
  function handleLabelChange(i, raw) {
    if (raw === '__custom__') {
      const cur = arr[i]?.label && !standard.includes(arr[i].label) ? arr[i].label : '';
      const custom = window.prompt('Custom label?', cur);
      if (custom && custom.trim()) update(i, { label: custom.trim() });
    } else {
      update(i, { label: raw });
    }
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
      {arr.map((v, i) => {
        const isCustom = v.label && !standard.includes(v.label);
        return (
          <div key={i} style={{display:'flex',flexDirection:'column',gap:'4px'}}>
            <div style={{display:'flex',gap:'4px',alignItems:'center'}}>
              <select
                value={isCustom ? '__current_custom__' : (v.label || standard[0])}
                onChange={(e) => handleLabelChange(i, e.target.value === '__current_custom__' ? v.label : e.target.value)}
                style={{
                  width:'104px',flexShrink:0,
                  background:'var(--bg-base)',color:'var(--text-1)',
                  border:'1px solid var(--border)',borderRadius:'6px',
                  padding:'7px 4px',fontSize:'12px',
                }}>
                {isCustom && <option value="__current_custom__">{v.label}</option>}
                {standard.map(l => <option key={l} value={l}>{l}</option>)}
                <option value="__custom__">Custom…</option>
              </select>
              <span style={{flex:1}} />
              {(v.value || '').trim() && (() => {
                const actBtn = { display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:0, width:'38px', height:'34px', cursor:'pointer', background:'rgba(197,169,94,0.10)', border:'1px solid var(--border)', borderRadius:'6px', color:'var(--accent)', fontSize:'14px', lineHeight:1, textDecoration:'none' };
                if (kind === 'email') {
                  return <a href="#" onClick={(ev)=>{ev.preventDefault(); if(window.__composeEmail) window.__composeEmail(v.value.trim());}} title="Send email" style={actBtn}><Icon name="mail" size={14} /></a>;
                }
                const tel = (v.value || '').replace(/[^\d+]/g, '');
                return (
                  <>
                    <a href={`tel:${tel}`} title="Call" style={actBtn}><Icon name="quo" size={14} /></a>
                    <a href={`sms:${tel}`} title="Text" style={actBtn}><Icon name="message" size={14} /></a>
                  </>
                );
              })()}
              <button type="button" onClick={() => setDefault(i)}
                title={v.is_default ? 'Default — used for quick actions' : 'Make this the default'}
                aria-pressed={v.is_default}
                style={{
                  flexShrink:0,width:'38px',height:'34px',cursor:'pointer',
                  background:'var(--bg-base)',
                  border:`1px solid ${v.is_default ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius:'6px', color: v.is_default ? 'var(--accent)' : 'var(--text-3)',
                  fontSize:'14px',lineHeight:1,
                }}>{v.is_default ? '★' : '☆'}</button>
              <button type="button" onClick={() => remove(i)}
                title="Remove" aria-label="Remove"
                style={{
                  flexShrink:0,width:'34px',height:'34px',cursor:'pointer',
                  background:'var(--bg-base)',
                  border:'1px solid var(--border)',borderRadius:'6px',
                  color:'var(--text-3)',fontSize:'15px',lineHeight:1,
                }}>×</button>
            </div>
            <input
              type={kind === 'email' ? 'email' : 'tel'}
              value={v.value || ''}
              onChange={(e) => update(i, { value: e.target.value })}
              placeholder={kind === 'email' ? 'name@example.com' : '(555) 555-5555'}
              style={{
                width:'100%',boxSizing:'border-box',
                background:'var(--bg-base)',color:'var(--text-1)',
                border:'1px solid var(--border)',borderRadius:'6px',
                padding:'9px 11px',fontSize:'13px',outline:'none',
              }}/>
          </div>
        );
      })}
      <button type="button" onClick={add}
        style={{
          alignSelf:'flex-start',padding:'5px 11px',
          background:'transparent',border:'1px dashed var(--border)',
          borderRadius:'6px',color:'var(--text-3)',cursor:'pointer',
          fontSize:'11.5px',fontWeight:600,
        }}>{addLabel}</button>
    </div>
  );
}

// ── Teachable moments ──────────────────────────────────────────────
// In-context lessons that teach the "why". Persist per-device; the off-switch
// only unlocks once the agent has learned enough (proficiency gate) — so tips
// aren't offered too early, but once earned they toggle freely.
import { TIPS_UNLOCK_AT, tipsSeenList, tipsSeenCount, tipsPace, setTipsPace, effectivePace, tipCooldownMs, tipsAreEnabled, tipsUnlocked, setTipsEnabled, tipsLastShown, Tip, TipFor } from './tipsUi';

function RecruitingKpiTile({ label, value, sub, color }) {
  return (
    <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'8px',padding:'10px 12px'}}>
      <div style={{fontSize:'9.5px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',fontWeight:700,marginBottom:'3px'}}>{label}</div>
      <div style={{fontSize:'20px',fontWeight:300,fontFamily:'Fraunces, serif',letterSpacing:'-0.01em',color:color || 'var(--text-1)',fontVariantNumeric:'tabular-nums'}}>{value}</div>
      {sub && <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>{sub}</div>}
    </div>
  );
}





function useDictation(onFinal) {
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState('');
  const recRef = useRef(null);
  const wantRef = useRef(false);      // does the user still want to be listening?
  const timerRef = useRef(null);      // pending auto-restart
  const startedAtRef = useRef(0);
  const failsRef = useRef(0);         // consecutive fast failures (runaway guard)
  const onFinalRef = useRef(onFinal);
  useEffect(() => { onFinalRef.current = onFinal; });
  const supported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const teardown = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const r = recRef.current; recRef.current = null;
    if (r) { try { r.onresult = r.onerror = r.onend = null; } catch (_) {} try { r.abort(); } catch (_) {} }
  }, []);

  const launch = useCallback(() => {
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) return;
    teardown(); // never leave a previous recognizer holding the mic
    let rec; try { rec = new SR(); } catch (_) { return; }
    rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (ev) => {
      let f = '', it = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) f += r[0].transcript; else it += r[0].transcript; }
      if (f) { failsRef.current = 0; if (onFinalRef.current) onFinalRef.current(f); }
      setInterim(it);
    };
    rec.onerror = (e) => {
      const err = e && e.error;
      // Fatal — stop for good. (no-speech / aborted / network are transient; let onend auto-restart.)
      if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture') {
        wantRef.current = false; setRecording(false); setInterim('');
      }
    };
    rec.onend = () => {
      setInterim('');
      if (!wantRef.current) { setRecording(false); return; }
      // Mobile speech engines quietly end after a pause even with continuous=true.
      // Restart so dictation keeps going — but bail out if it's failing rapidly.
      const quick = (Date.now() - startedAtRef.current) < 600;
      failsRef.current = quick ? failsRef.current + 1 : 0;
      if (failsRef.current >= 5) { wantRef.current = false; setRecording(false); return; }
      timerRef.current = setTimeout(() => { if (wantRef.current) launch(); }, 300);
    };
    recRef.current = rec;
    startedAtRef.current = Date.now();
    try { rec.start(); setRecording(true); } catch (_) { /* already starting / busy */ }
  }, [teardown]);

  const start = useCallback(() => { wantRef.current = true; failsRef.current = 0; launch(); }, [launch]);
  const stop = useCallback(() => { wantRef.current = false; teardown(); setRecording(false); setInterim(''); }, [teardown]);
  useEffect(() => () => { wantRef.current = false; teardown(); }, [teardown]);
  return { recording, interim, start, stop, supported };
}

// Textarea that grows with its content (no inner scroll until maxHeight).
function QuickLog({ userId, onNavigate, onUploadRecording }) {
  const recRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const dict = useDictation((f) => setText(prev => { const sep = (!prev || /\s$/.test(prev)) ? '' : ' '; return prev + sep + f.trim() + ' '; }));

  async function save() {
    const c = text.trim(); if (!c || saving) return;
    if (dict.recording) dict.stop();
    setSaving(true);
    try { await logJournalEntry(userId, c, dict.recording ? 'voice' : 'text'); setText(''); setJournalOpen(false); if (window.__notify) window.__notify('Logged to journal', 'success'); }
    catch (e) { if (window.__notify) window.__notify(e.message || 'Save failed — please try again. Your text is still here.', 'error'); }
    finally { setSaving(false); }
  }

  const go = (view) => { setMenuOpen(false); if (onNavigate) onNavigate(view); };
  const goQuo = (tab) => { try { window.__quoTab = tab; } catch (e) {} go('quo'); };
  const openJournal = () => { setMenuOpen(false); setJournalOpen(true); };

  // Listed in the user's order; rendered bottom-up (journal nearest the thumb).
  const MENU = [
    { key: 'journal', label: 'Journal',        icon: 'journal',   run: openJournal },
    { key: 'task',    label: 'Task',           icon: 'tasks',     run: () => go('tasks') },
    { key: 'event',   label: 'Calendar',       icon: 'calendar',  run: () => go('calendar') },
    { key: 'contact', label: 'Contact',        icon: 'contacts',  run: () => go('contacts') },
    { key: 'ari',     label: 'Ari',            icon: 'briefing',  run: () => go('chat') },
    { key: 'text',    label: 'Text',           icon: 'message',   run: () => goQuo('messages') },
    { key: 'email',   label: 'Email',          icon: 'mail',      run: () => go('inbox') },
    { key: 'call',    label: 'Quo',            icon: 'quo',       run: () => goQuo('calls') },
    { key: 'recording', label: 'Recording',    icon: 'mic',       run: () => { setMenuOpen(false); if (recRef.current) recRef.current.click(); } },
  ];
  useEffect(() => { window.__attachRecording = () => { if (recRef.current) recRef.current.click(); }; return () => { try { delete window.__attachRecording; } catch (_) {} }; }, []);

  return (
    <>
      <input ref={recRef} type="file" accept="audio/*,.amr,.m4a,.mp3,.wav,.aac,.ogg,.opus,.webm,.3gp" style={{ display: 'none' }}
        onChange={(e) => { const file = e.target.files && e.target.files[0]; e.target.value = ''; if (file && onUploadRecording) onUploadRecording(file); }} />
      {/* Floating quick-create menu */}
      {menuOpen && (
        <>
          <div onClick={() => setMenuOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(1px)' }} />
          <div style={{ position: 'fixed', right: '11px', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 123px)', zIndex: 9001, display: 'flex', flexDirection: 'column-reverse', gap: '12px', alignItems: 'flex-end' }}>
            {MENU.map((m, i) => (
              <button key={m.key} onClick={m.run}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', animation: 'qmRise 0.18s ease both', animationDelay: `${i * 0.03}s` }}>
                <span style={{ padding: '7px 12px', borderRadius: '999px', background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-1)', fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,0.35)' }}>{m.label}</span>
                <span style={{ width: '42px', height: '42px', borderRadius: '50%', background: 'var(--bg-card)', border: '1px solid var(--accent)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(0,0,0,0.4)', flexShrink: 0 }}>
                  <Icon name={m.icon} size={19} />
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* FAB — memory icon, 40% smaller, toggles the menu */}
      <button onClick={() => setMenuOpen(o => !o)} aria-label={menuOpen ? 'Close quick create' : 'Quick create'} title="Quick create"
        style={{ position: 'fixed', right: '16px', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 78px)', zIndex: 9002, width: '33px', height: '33px', borderRadius: '50%', background: 'var(--accent)', color: 'var(--bg-base)', border: 'none', boxShadow: '0 6px 20px rgba(0,0,0,0.45)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 0.18s ease', transform: menuOpen ? 'rotate(90deg)' : 'none' }}>
        {menuOpen ? <span style={{ fontSize: '16px', fontWeight: 700, lineHeight: 1 }}>✕</span> : <Icon name="brain" size={17} />}
      </button>

      {journalOpen && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setJournalOpen(false); }} style={{ padding: '12px' }}>
          <div className="modal" style={{ maxWidth: 'none', width: 'min(760px, 100%)', height: 'min(92vh, 100%)', maxHeight: 'none', padding: '18px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: '16px', display:'inline-flex', alignItems:'center', gap:'7px' }}><Icon name="journal" size={16} /> Quick log</h3>
              <button onClick={() => setJournalOpen(false)} style={{ background: 'none', border: 'none', fontSize: '22px', color: 'var(--text-3)', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <textarea autoFocus value={text + (dict.interim ? ((text && !/\s$/.test(text)) ? ' ' : '') + dict.interim : '')} onChange={e => setText(e.target.value)} placeholder="Capture a moment — it'll timestamp and auto-link…"
              style={{ flex: 1, minHeight: 0, width: '100%', padding: '15px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text-1)', fontSize: '16px', boxSizing: 'border-box', lineHeight: 1.6, resize: 'none', fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'center', flexShrink: 0 }}>
              {dict.supported && <button onClick={() => dict.recording ? dict.stop() : dict.start()} style={{ padding: '10px 16px', borderRadius: '999px', border: `1px solid ${dict.recording ? 'var(--red)' : 'var(--border)'}`, background: dict.recording ? 'rgba(239,68,68,0.12)' : 'var(--bg-hover)', color: dict.recording ? 'var(--red)' : 'var(--text-2)', cursor: 'pointer', fontSize: '13px', fontWeight: 700 }}>{dict.recording ? <>⏹ Recording…</> : <><Icon name="mic" size={13} /> Voice</>}</button>}
              <span style={{ flex: 1 }} />
              <button onClick={save} disabled={saving || !text.trim()} style={{ padding: '10px 24px', background: 'var(--accent)', color: 'var(--bg-base)', border: 'none', borderRadius: '999px', fontWeight: 800, fontSize: '14px', cursor: 'pointer', opacity: (saving || !text.trim()) ? 0.5 : 1 }}>{saving ? '…' : 'Log'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}




// ─────────────────────────────────────────
// SETTINGS VIEW


// ─────────────────────────────────────────
// SETTINGS VIEW
// ─────────────────────────────────────────




// Ari capability toggles — gate what the assistant can read/do, scoped to you.
















// SimplifyPanel — every hideable page from the registry, grouped, each with a
// show/hide toggle. Core pages appear as always-on (locked). Driven entirely by
// pages.js so a new page shows up here automatically, and hiding here propagates
// to every menu via pageVisible().
// AdminLicensingPanel — the owner's control center (Settings, admin only):
// the master enforcement switch, code generation, and the live code list.


// RedeemCodeBox — enter an unlock code, redeem it, refresh entitlements. Reused
// on the locked-page panel and in Settings.


// LockedPage — shown when enforcement is on and the user opens a page they aren't
// entitled to. An honest upsell, not a dead end: says what the page is and lets
// them redeem a code on the spot.
function LockedPage({ page, onRedeem, onSettings }) {
  return (
    <div style={{ maxWidth: 520, margin: '8vh auto 0', textAlign: 'center', padding: '0 20px' }}>
      <div style={{ width: 64, height: 64, borderRadius: 18, margin: '0 auto 20px', display: 'grid', placeItems: 'center', background: 'rgba(203,163,92,0.1)', border: '1px solid rgba(203,163,92,0.3)' }}>
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#CBA35C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
      </div>
      <div style={{ fontSize: '10.5px', fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 6 }}>Locked feature</div>
      <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 400, fontSize: 28, color: 'var(--text-1)', margin: '0 0 10px' }}>{page.label}</h2>
      <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6, margin: '0 0 24px' }}>
        This page isn&rsquo;t part of your current plan. If you have an unlock code, enter it below and it&rsquo;ll turn on right away — otherwise reach out to your broker to add it.
      </p>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, textAlign: 'left' }}>
        <RedeemCodeBox onRedeemed={onRedeem} />
      </div>
      <button className="btn btn-ghost" style={{ marginTop: 18 }} onClick={onSettings}>Go to Settings</button>
    </div>
  );
}






// ─────────────────────────────────────────
// PROJECT TRACKER  (tracker schema — multi-user RBAC)
// ─────────────────────────────────────────
function InstallPwaPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    // If already running as installed PWA, never show
    const inStandalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true; // iOS-specific flag
    if (inStandalone) return;

    // Respect dismissal window (7 days)
    try {
      const dismissed = Number(localStorage.getItem('pwa_install_dismissed_at') || 0);
      if (dismissed && Date.now() - dismissed < 7 * 24 * 60 * 60 * 1000) return;
    } catch (_) {}

    // Detect iOS Safari — beforeinstallprompt never fires there
    const ua = window.navigator.userAgent || '';
    const isIos = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    if (isIos && isSafari) {
      setShowIosHelp(true);
      setVisible(true);
      return;
    }

    // Android Chrome path
    function onBeforeInstall(e) {
      e.preventDefault();          // stop the mini-infobar; we'll show our own UI
      setDeferredPrompt(e);
      setVisible(true);
    }
    function onInstalled() {
      setVisible(false);
      setDeferredPrompt(null);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (_) {}
    setDeferredPrompt(null);
    setVisible(false);
  }
  function dismiss() {
    try { localStorage.setItem('pwa_install_dismissed_at', String(Date.now())); } catch (_) {}
    setVisible(false);
  }
  if (!visible) return null;

  return (
    <div className="pwa-install-banner">
      <div className="pwa-install-icon">⤓</div>
      <div className="pwa-install-text">
        {showIosHelp ? (
          <>
            <strong>Install PrismOS</strong>
            <span>Tap <span style={{whiteSpace:'nowrap'}}>Share ↑</span>, then <span style={{whiteSpace:'nowrap'}}>"Add to Home Screen"</span></span>
          </>
        ) : (
          <>
            <strong>Install PrismOS</strong>
            <span>Hide the browser bar — install as an app</span>
          </>
        )}
      </div>
      {!showIosHelp && (
        <button type="button" className="pwa-install-btn" onClick={handleInstall}>Install</button>
      )}
      <button type="button" className="pwa-install-dismiss" onClick={dismiss} aria-label="Dismiss">×</button>
    </div>
  );
}

// ─────────────────────────────────────────
// APP COMPONENT
// ─────────────────────────────────────────
// Detects when a newer deploy is live (bundle hash changed) and offers a
// one-tap refresh — so an installed PWA never silently runs a stale build.
function UpdateBanner() {
  const [ready, setReady] = useState(false);
  const currentHashRef = useRef(null);
  useEffect(() => {
    try {
      const el = document.querySelector('script[src*="/static/js/main."]');
      if (el) { const m = el.src.match(/main\.([a-f0-9]+)\.js/); if (m) currentHashRef.current = m[1]; }
    } catch (_) {}
    let stop = false;
    async function check() {
      if (stop || !currentHashRef.current) return;
      try {
        const res = await fetch('/index.html?cb=' + Date.now(), { cache: 'no-store' });
        const txt = await res.text();
        const m = txt.match(/main\.([a-f0-9]+)\.js/);
        if (m && m[1] !== currentHashRef.current) setReady(true);
      } catch (_) {}
    }
    check();
    const t = setTimeout(check, 3000);
    const iv = setInterval(check, 60000);
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { stop = true; clearTimeout(t); clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  async function refresh() {
    try {
      if ('serviceWorker' in navigator) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map(r => r.update())); }
      if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); }
    } catch (_) {}
    window.location.reload();
  }
  if (!ready) return null;
  return (
    <div style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)', zIndex: 5000, background: 'var(--accent)', color: 'var(--bg-base)', borderRadius: '999px', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', fontSize: '13px', fontWeight: 700, maxWidth: '92vw' }}>
      <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="sparkles" size={13} /> New version available</span>
      <button onClick={refresh} style={{ background: 'var(--bg-base)', color: 'var(--accent)', border: 'none', borderRadius: '999px', padding: '6px 14px', fontWeight: 800, fontSize: '12px', cursor: 'pointer' }}>Refresh</button>
    </div>
  );
}

/* ============================================================
   FILES — Buyer-side transaction file management (Phase 1)
   FAR/BAR (Florida) checklist. Manual create + upload + review.
   ============================================================ */



// Which checklist items WE author/generate (owned) vs come from outside (external/capture).


// Document provenance label/colour — invisible plumbing surfaced as a calm chip.

/* ---- Phase 3: contingency timeline, waiver auto-resolution, consistency audit ---- */
function pctOf(b,p){ const v=num(p); return v?b*v/100:0; }


function ScoreboardView({ userId, appCtx, setView }){
  const ownerId = (appCtx && appCtx.owner_id) || userId;
  const [rows,setRows]=useState(null);
  const [metric,setMetric]=useState('contacts');
  useEffect(()=>{ let alive=true; (async()=>{ try{ const { data } = await supabase.rpc('brokerage_scoreboard',{ p_owner: ownerId }); if(alive) setRows(data||[]); }catch(e){ if(alive) setRows([]); } })(); return ()=>{alive=false;}; },[ownerId]);
  const m0=(v)=>'$'+Math.round(v||0).toLocaleString();
  const METRICS=[
    {id:'contacts',label:'Sphere',get:r=>Number(r.contacts)||0,fmt:v=>String(v),note:'Contacts in your CRM'},
    {id:'activity',label:'Activity',get:r=>Number(r.tasks_done_30d)||0,fmt:v=>String(v),note:'Tasks completed in 30 days'},
    {id:'pipeline',label:'Pipeline',get:r=>Number(r.pipeline_gci)||0,fmt:m0,note:'Commission in active deals'},
    {id:'deals',label:'Closed',get:r=>Number(r.deals_closed)||0,fmt:v=>String(v),note:'Deals closed this year'},
    {id:'gci',label:'GCI',get:r=>Number(r.gci_ytd)||0,fmt:m0,note:'Gross commission, year to date'},
  ];
  if(rows===null) return (<div className="view"><div className="panel" style={{padding:24,textAlign:'center',color:'var(--text-2)'}}>Loading the board…</div></div>);
  const M=METRICS.find(x=>x.id===metric)||METRICS[0];
  const sorted=[...rows].sort((a,b)=>M.get(b)-M.get(a));
  const n=sorted.length;
  const meIdx=sorted.findIndex(r=>r.is_me);
  const me=meIdx>=0?sorted[meIdx]:null;
  const myRank=meIdx>=0?meIdx+1:null;
  const avg=n?sorted.reduce((a,r)=>a+M.get(r),0)/n:0;
  const maxV=Math.max(1,...sorted.map(x=>M.get(x)));
  const anyData=sorted.some(r=>M.get(r)>0);
  const medal=(i)=> i===0?'#FFD24A':i===1?'#C4CBD4':i===2?'#CE8E54':'var(--text-3)';
  return (
    <div className="view">
      <div className="panel" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
        <div>
          <h2 style={{margin:0,display:'flex',alignItems:'center',gap:8}}><Icon name="target" size={20}/> How I'm doing</h2>
          <div style={{fontSize:12,color:'var(--text-2)',marginTop:2}}>Where you stand across the brokerage</div>
        </div>
      </div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:12}}>
        {METRICS.map(x=>(<button key={x.id} onClick={()=>setMetric(x.id)} style={{background:metric===x.id?'var(--accent)':'transparent',color:metric===x.id?'#111':'var(--text-2)',border:'1px solid var(--accent)',fontWeight:700,borderRadius:999,padding:'6px 13px',fontSize:12.5,cursor:'pointer'}}>{x.label}</button>))}
      </div>
      {me ? (
        <div className="dash-panel" style={{marginTop:12,padding:18,background:'linear-gradient(135deg, rgba(197,169,94,0.10), rgba(197,169,94,0.02))',border:'1px solid var(--accent)',borderRadius:16}}>
          <div style={{display:'flex',alignItems:'center',gap:18,flexWrap:'wrap'}}>
            <div style={{textAlign:'center',minWidth:84}}>
              <div style={{fontSize:40,fontWeight:800,color:'var(--accent)',lineHeight:1}}>#{myRank}</div>
              <div style={{fontSize:11,color:'var(--text-3)',marginTop:3,fontWeight:700,letterSpacing:'0.06em',textTransform:'uppercase'}}>of {n}</div>
            </div>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontSize:26,fontWeight:800,color:'var(--text-1)',lineHeight:1}}>{M.fmt(M.get(me))}</div>
              <div style={{fontSize:12.5,color:'var(--text-2)',marginTop:3}}>{M.label} · {M.note}</div>
              <div style={{fontSize:12,marginTop:8,fontWeight:700,color: M.get(me)>=avg?'var(--green)':'#f5b34a'}}>{M.get(me)>=avg?'Above':'Below'} brokerage average ({M.fmt(avg)})</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="panel" style={{marginTop:12,padding:16,color:'var(--text-2)',fontSize:13}}>Your agent profile isn't linked to this login yet, so your own row isn't highlighted. An admin can link it under Brokerage → Agent roster.</div>
      )}
      <div className="dash-panel" style={{marginTop:12,padding:16,borderRadius:16,background:'var(--bg-card)',border:'1px solid var(--border)'}}>
        <div style={{fontSize:13,fontWeight:700,color:'var(--text-1)',marginBottom:14,display:'inline-flex',alignItems:'center',gap:8}}><Icon name="chart" size={15} style={{color:'var(--accent)'}}/> Leaderboard · {M.label}</div>
        {!anyData ? <div style={{fontSize:12.5,color:'var(--text-3)'}}>No {M.label.toLowerCase()} logged yet — the board fills in as the brokerage works. Keep going.</div> :
          sorted.map((r,i)=>{ const v=M.get(r); return (
            <div key={r.agent_id} style={{display:'flex',alignItems:'center',gap:10,marginBottom:11,padding:r.is_me?'7px 9px':'0 0',background:r.is_me?'var(--accent-glow)':'transparent',border:r.is_me?'1px solid var(--accent)':'none',borderRadius:10}}>
              <span style={{width:24,textAlign:'center',fontSize:14,fontWeight:800,color:medal(i),flexShrink:0}}>{i+1}</span>
              <span style={{width:104,fontSize:12.5,fontWeight:r.is_me?800:600,color:'var(--text-1)',flexShrink:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.is_me?'You':(r.name||'—')}</span>
              <div style={{flex:1,height:14,borderRadius:5,background:'var(--bg-base)',overflow:'hidden'}}><div style={{height:'100%',width:Math.round(v/maxV*100)+'%',background:r.is_me?'var(--accent)':'var(--accent-dim)',borderRadius:5,minWidth:v>0?4:0,transition:'width .6s ease'}}/></div>
              <span style={{width:78,textAlign:'right',fontSize:12.5,fontWeight:700,color:'var(--text-1)',flexShrink:0}}>{M.fmt(v)}</span>
            </div>); })
        }
      </div>
    </div>
  );
}

function PipelineView({ contacts, userId }){
  const [systems,setSystems]=useState(null);
  useEffect(()=>{ (async()=>{ const { data } = await supabase.from('lead_gen_systems').select('id,name,color,monthly_budget,is_archived'); setSystems((data||[]).filter(s=>!s.is_archived)); })(); },[]);
  const PSTAGES = [['new','New'],['attempting','Attempting'],['contacted','Contacted'],['appointment_set','Appt set'],['nurture','Nurture'],['closed','Closed']];
  const STAGE_COLORS = { new:'#3b82f6', attempting:'#8b5cf6', contacted:'#f59e0b', appointment_set:'#06b6d4', nurture:'#22c55e', closed:'var(--accent)' };
  const all = contacts||[];
  const pipe = all.filter(c=>c.pipeline_stage && c.pipeline_stage!=='lost');
  const closed = pipe.filter(c=>c.pipeline_stage==='closed');
  const active = pipe.filter(c=>c.pipeline_stage!=='closed');
  const winRate = pipe.length? Math.round(closed.length/pipe.length*100):0;
  const funnel = PSTAGES.map(([id,label])=>({ id,label, n: pipe.filter(c=>c.pipeline_stage===id).length }));
  const funnelMax = Math.max(1, ...funnel.map(f=>f.n));
  const _byId={}; all.forEach(c=>{ if(!c.lead_gen_system_id) return; const k=c.lead_gen_system_id; _byId[k]=_byId[k]||{leads:0,closed:0}; _byId[k].leads++; if(c.pipeline_stage==='closed') _byId[k].closed++; });
  const srcKpi = (systems||[]).map(s=>{ const d=_byId[s.id]||{leads:0,closed:0}; const conv=d.leads?Math.round(d.closed/d.leads*100):0; const budget=Number(s.monthly_budget)||0; const cpl=d.leads?budget/d.leads:null; return {id:s.id,name:s.name,color:s.color,leads:d.leads,closed:d.closed,conv,budget,cpl}; }).filter(x=>x.leads>0).sort((a,b)=>b.leads-a.leads);
  const srcMax = Math.max(1, ...srcKpi.map(x=>x.leads));
  const stat=(label,val,sub)=> (<div className="panel" style={{padding:'14px',flex:1,minWidth:'120px'}}>
      <div style={{fontSize:'24px',fontWeight:800,color:'var(--text-1)',lineHeight:1}}>{val}</div>
      <div style={{fontSize:'11px',color:'var(--text-2)',marginTop:'4px'}}>{label}</div>
      {sub?<div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>{sub}</div>:null}
    </div>);
  if(systems===null) return <div className="view"><div className="panel" style={{padding:'24px',textAlign:'center',color:'var(--text-2)'}}>Loading your pipeline…</div></div>;
  return (
    <div className="view">
      <div className="panel" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
        <div>
          <h2 style={{margin:0,display:'flex',alignItems:'center',gap:'8px'}}><Icon name="target" size={20}/> My pipeline</h2>
          <div style={{fontSize:'12px',color:'var(--text-2)',marginTop:'2px'}}>Your leads by stage and where they came from</div>
        </div>
      </div>
      {pipe.length===0 ? (
        <div className="panel" style={{marginTop:'12px',padding:'28px',textAlign:'center'}}>
          <div style={{fontSize:'15px',fontWeight:700,color:'var(--text-1)',marginBottom:'6px'}}>No leads in your pipeline yet</div>
          <div style={{fontSize:'13px',color:'var(--text-2)',maxWidth:'440px',margin:'0 auto',lineHeight:1.5}}>Open any contact, then on the Overview tab set a <b>pipeline stage</b> and tag a <b>lead source</b>. They will roll up here into your funnel and source ROI.</div>
        </div>
      ) : (<>
        <div style={{display:'flex',gap:'10px',flexWrap:'wrap',marginTop:'12px'}}>
          {stat('In pipeline', pipe.length)}
          {stat('Active', active.length, 'not yet closed')}
          {stat('Closed', closed.length)}
          {stat('Win rate', winRate+'%', closed.length+' of '+pipe.length)}
        </div>
        <div className="panel" style={{marginTop:'12px',padding:'18px'}}>
          <div style={{fontSize:'14px',fontWeight:700,color:'var(--text-1)',marginBottom:'16px',display:'inline-flex',alignItems:'center',gap:'8px'}}><Icon name="chart" size={16}/> Pipeline funnel</div>
          {funnel.map(f=>(<div key={f.id} style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'10px'}}>
            <span style={{width:'82px',fontSize:'12px',color:'var(--text-2)',flexShrink:0}}>{f.label}</span>
            <div style={{flex:1,height:'22px',borderRadius:'6px',background:'var(--bg-base)',overflow:'hidden'}}><div style={{height:'100%',width:(Math.round(f.n/funnelMax*100))+'%',background:STAGE_COLORS[f.id]||'var(--accent)',borderRadius:'6px',minWidth:f.n>0?'4px':'0',transition:'width .5s ease'}}/></div>
            <span style={{width:'30px',textAlign:'right',fontSize:'13px',fontWeight:700,color:'var(--text-1)'}}>{f.n}</span>
          </div>))}
        </div>
        <div className="panel" style={{marginTop:'12px',padding:'18px'}}>
          <div style={{fontSize:'14px',fontWeight:700,color:'var(--text-1)',marginBottom:'4px',display:'inline-flex',alignItems:'center',gap:'8px'}}><Icon name="signal" size={16}/> Lead Source Effectiveness</div>
          <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'16px'}}>Which systems are actually producing</div>
          {srcKpi.length===0 ? <div style={{fontSize:'12px',color:'var(--text-3)'}}>No lead sources tagged yet. Add a Lead Source on a contact Overview to see ROI here.</div> :
            srcKpi.map(k=>(<div key={k.id} style={{marginBottom:'14px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:'5px',gap:'8px'}}>
                <span style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{k.name}</span>
                <span style={{fontSize:'11px',color:'var(--text-2)',flexShrink:0}}>{k.leads} lead{k.leads===1?'':'s'} · {k.conv}% closed</span>
              </div>
              <div style={{height:'12px',borderRadius:'6px',background:'var(--bg-base)',overflow:'hidden'}}><div style={{height:'100%',width:(Math.round(k.leads/srcMax*100))+'%',background:k.color||'var(--accent)',borderRadius:'6px',transition:'width .5s ease'}}/></div>
              <div style={{marginTop:'4px',fontSize:'10.5px',color:'var(--text-3)'}}>{k.budget>0?('$'+k.budget.toLocaleString()+'/mo'+(k.cpl!=null?' · $'+Math.round(k.cpl).toLocaleString()+'/lead':'')):'No spend tracked'}{k.closed>0?' · '+k.closed+' closed':''}</div>
            </div>))
          }
        </div>
      </>)}
    </div>
  );
}

function AppMain() {
  const [session, setSession] = useState(null);
  const [appCtx, setAppCtx] = useState(null);
  useEffect(()=>{ if(!session) { setAppCtx(null); return; } let alive=true; (async()=>{ try{ try{ await supabase.rpc('claim_agent_profile'); }catch(_e){} const { data } = await supabase.functions.invoke('app-whoami'); if(alive && data && !data.error) setAppCtx(data); }catch(_){} })(); return ()=>{alive=false;}; },[session]);
  // STAGE 2: load the user's granted (pro) entitlements. Not enforced yet — the
  // menus still pass entitled:null to pageVisible so nothing is hidden. This just
  // makes the data available so Stage 3 can flip enforcement on in one place.
  const [entitlements, setEntitlements] = useState(null);
  const reloadEntitlements = React.useCallback(async () => {
    try { const { data } = await supabase.rpc('get_my_entitlements'); setEntitlements(Array.isArray(data) ? data.map(r=>r.feature) : []); }
    catch(_){ setEntitlements([]); }
  }, []);
  useEffect(()=>{ if(!session) { setEntitlements(null); return; } let alive=true; (async()=>{ await reloadEntitlements(); })(); return ()=>{alive=false;}; },[session, reloadEntitlements]);
  // STAGE 3: the master enforcement switch (app_config.licensing_enforced),
  // seeded OFF. Until Dara flips it, enforced=false → entitled stays null →
  // nothing is licensed-away (protects the live beta). Everything else in Stage 3
  // (redeem, admin code-gen, locked panels) is built and testable regardless.
  const [licensingEnforced, setLicensingEnforced] = useState(false);
  useEffect(()=>{ if(!session) return; let alive=true; (async()=>{ try{ const { data } = await supabase.from('app_config').select('value').eq('key','licensing_enforced').maybeSingle(); if(alive) setLicensingEnforced(data?.value === true); }catch(_){} })(); return ()=>{alive=false;}; },[session]);
  // The one entitlement predicate the menus + router use. Only ACTIVE when the
  // master switch is on; otherwise null (no filtering — current behavior).
  const entitled = React.useMemo(() => {
    if (!licensingEnforced) return null;
    const role = (appCtx?.is_admin) ? 'admin' : 'agent';
    return makeEntitled(entitlements || [], appCtx?.role === 'owner' ? 'owner' : role);
  }, [licensingEnforced, entitlements, appCtx]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('today');   // Today is home; Dashboard is retired
  // ── mindset-mode navigation ──────────────────────────────────────────────
  // The room the current screen lives in (derived), and the helpers the hub +
  // bottom bar use. Entering a mode jumps to that room's home screen; Home
  // returns to the hub (the dashboard).
  const activeMode = view === 'dashboard' ? null : (VIEW_TO_MODE[view] || null);
  // Entering a room resumes where you left off IN THAT ROOM, but only within the
  // same day — the first visit each day opens the room's home screen (My World
  // opens on Contacts). A stale bookmark pointing at a screen that no longer
  // belongs to the room is ignored, so re-organising a room never strands anyone.
  const enterMode = (modeId) => {
    if (modeId === '__today__') { setView('today'); return; }
    const m = modeById(modeId);
    if (!m) return;
    const spot = m.resume ? roomResumeSpot(session?.user?.id, modeId, todayISO(), m.views) : null;
    if (spot) {
      setView(spot.view);
      if (spot.sub) setDeepLink(d => ({ view: spot.view, sub: spot.sub, n: d.n + 1 }));
      return;
    }
    setView(m.home);
  };
  const goHome = () => setView('today');   // Today replaces the Dashboard as home
  React.useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('dropbox');
      if (p) {
        if (p === 'connected') { if (window.__notify) window.__notify('Dropbox connected', 'success'); setView('settings'); }
        else if (window.__notify) window.__notify('Dropbox connection failed', 'error');
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch (_) {}
  }, []);
  const viewRef = useRef(view); viewRef.current = view;
  // Dashboard-only pull-to-refresh: re-syncs data via loadData() without a page
  // reload, so in-progress work is never lost. Native pull-to-refresh is disabled
  // app-wide in CSS (overscroll-behavior), which is what used to wipe state.
  const mainScrollRef = useRef(null);
  // Always open a freshly-selected view at its top (don't restore prior scroll position).
  useEffect(() => { const el = mainScrollRef.current; if (el) el.scrollTo({ top: 0, left: 0 }); }, [view]);
  const ptrRef = useRef({ startY: 0, active: false });
  const [ptrPull, setPtrPull] = useState(0);
  const [ptrBusy, setPtrBusy] = useState(false);
  const PTR_THRESHOLD = 64;
  const onMainTouchStart = (e) => {
    if (view !== 'today') { ptrRef.current.active = false; return; }
    const el = mainScrollRef.current;
    if (el && el.scrollTop <= 0 && !ptrBusy) { ptrRef.current.startY = e.touches[0].clientY; ptrRef.current.active = true; }
    else ptrRef.current.active = false;
  };
  const onMainTouchMove = (e) => {
    if (!ptrRef.current.active || ptrBusy) return;
    const el = mainScrollRef.current;
    if (!el || el.scrollTop > 0) { ptrRef.current.active = false; setPtrPull(0); return; }
    const dy = e.touches[0].clientY - ptrRef.current.startY;
    setPtrPull(dy > 0 ? Math.min(dy * 0.5, 80) : 0);
  };
  const onMainTouchEnd = async () => {
    if (!ptrRef.current.active) return;
    ptrRef.current.active = false;
    if (ptrPull >= PTR_THRESHOLD && !ptrBusy) {
      setPtrBusy(true); setPtrPull(40);
      try { await loadData(); } catch (_) {}
      setPtrBusy(false);
    }
    setPtrPull(0);
  };
  const [focusTaskId, setFocusTaskId] = useState(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [focusEventId, setFocusEventId] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [openPath, setOpenPath] = useState([]);
  const [deepLink, setDeepLink] = useState({ view: null, sub: null, n: 0 });
  // Drop a bookmark on every move inside a room. Cheap (one localStorage write),
  // and it is what makes the room feel like a place you can step out of.
  React.useEffect(() => {
    if (!activeMode) return;
    const m = modeById(activeMode);
    if (!m || !m.resume) return;
    rememberRoomSpot(session?.user?.id, activeMode, view,
      deepLink.view === view ? deepLink.sub : null, todayISO());
  }, [activeMode, view, deepLink, session]);

  const [tasks, setTasks] = useState([]);
  const [robots, setRobots] = useState([]);
  const [notes, setNotes] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [properties, setProperties] = useState([]);
  const [deals, setDeals] = useState([]);
  const [files, setFiles] = useState([]);
  const [mileageEntries, setMileageEntries] = useState([]);
  const [investments, setInvestments] = useState([]);
  const [brain, setBrain] = useState([]);
  const [events, setEvents] = useState([]);
  const [emailAliases, setEmailAliases] = useState([]);
  const [playbookSteps, setPlaybookSteps] = useState([]);
  const [playbookRuns, setPlaybookRuns] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [voiceCards, setVoiceCards] = useState([]);
  const [emailAccounts, setEmailAccounts] = useState([]);
  const [sharedAudio, setSharedAudio] = useState(null);
  // Web Share Target: another app shared an audio file to PrismOS. The service
  // worker stashed it in the 'prismos-shared' cache and redirected here with
  // Expose the live view so tests can assert where we actually are. The smoke gate
  // could only ever check "did this view crash", never "did we land on it".
  useEffect(() => { try { window.__currentView = view; } catch (_) {} }, [view]);

  // ── Deep links: /?view=prospecting ────────────────────────────────────────
  // The view lived only in memory, so every launch — and every new tab — landed on
  // the Dashboard. That is what made "open CRM here, prospecting there" impossible.
  // Read ONCE on boot, then wipe the query string (same pattern as ?shared= below)
  // so the URL never becomes a second source of truth fighting the back-button
  // guard, which owns history for the modal stack.
  // Whitelisted on purpose: a launcher is user input like any other, and ?view=
  // should not be able to poke at an arbitrary internal string.
  useEffect(() => {
    let v;
    try { v = new URLSearchParams(window.location.search).get('view'); } catch (_) { return; }
    if (!v) return;
    const ALLOWED = ['dashboard','prospecting','tasks','calendar','contacts','inbox','quo',
                     'journal','numbers','chat','finance','documents','mileage','production','investor_pipeline'];
    if (ALLOWED.includes(v)) {
      setView(v);
      try { const tb = new URLSearchParams(window.location.search).get('tab'); if (tb) window.__investorTab = tb; } catch (_) {}
    }
    try { window.history.replaceState({}, '', '/'); } catch (_) {}
  }, []);

  // ?shared=audio; pull it out and open the "Share a recording" flow.
  useEffect(() => {
    let params;
    try { params = new URLSearchParams(window.location.search); } catch (_) { return; }
    const shared = params.get('shared');
    if (!shared) return;
    (async () => {
      try {
        const cache = await caches.open('prismos-shared');
        if (shared === 'audio') {
          const resp = await cache.match('/__shared_audio');
          if (resp) { const blob = await resp.blob(); const fn = decodeURIComponent(resp.headers.get('x-filename') || 'shared-recording'); setSharedAudio(new File([blob], fn, { type: blob.type || 'audio/mpeg' })); await cache.delete('/__shared_audio'); }
        } else if (shared === 'file') {
          const resp = await cache.match('/__shared_file');
          if (resp) { const blob = await resp.blob(); const fn = decodeURIComponent(resp.headers.get('x-filename') || 'shared-document'); window.__pendingSharedDoc = new File([blob], fn, { type: blob.type || 'application/octet-stream' }); await cache.delete('/__shared_file'); setView('documents'); }
        } else if (shared === 'text') {
          const resp = await cache.match('/__shared_text');
          if (resp) { const d = await resp.json().catch(() => null); if (d) { window.__pendingSharedText = d; setView('journal'); } await cache.delete('/__shared_text'); }
        } else if (shared === 'vcard') {
          const resp = await cache.match('/__shared_vcard');
          if (resp) { const txt = await resp.text().catch(() => ''); if (txt) { window.__pendingSharedVCard = txt; setView('contacts'); } await cache.delete('/__shared_vcard'); }
        }
      } catch (_) {}
      try { window.history.replaceState({}, '', '/'); } catch (_) {}
    })();
  }, []);
  // Pass 2 Batch C — user_settings: drives the onboarding modal + future Settings.
  const [userSettings, setUserSettings] = useState(null);
  const [onboardingReopen, setOnboardingReopen] = useState(false);
  // Dashboard "Unread Email" tile — count of unread inbox threads (excludes snoozed)
  const [unreadEmailCount, setUnreadEmailCount] = useState(0);
  const [needsReviewCount, setNeedsReviewCount] = useState(0);
  const [oweReplyMap, setOweReplyMap] = useState({});
  const [dataLoaded, setDataLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop keeps the sidebar permanently visible; mobile only when opened. We use
  // this to avoid rendering the ~30-node menu tree on every app render when it's
  // closed on a phone — that churn was the iPhone menu lag.
  const [wideScreen, setWideScreen] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 900px)').matches : true));
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 900px)');
    const on = () => setWideScreen(mq.matches);
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on); };
  }, []);
  const [mindsetOpen, setMindsetOpen] = useState(false); // the mindset menu (upper-right)
  // Live badge for the nightly email-review queue (open items needing action).
  useEffect(() => {
    if (!dataLoaded) return; let alive = true;
    supabase.from('email_review_items').select('id', { count: 'exact', head: true })
      .eq('status', 'open').eq('needs_review', true)
      .then(({ count }) => { if (alive) setNeedsReviewCount(count || 0); }).catch(() => {});
    return () => { alive = false; };
  }, [dataLoaded]);
  const [priorityPref, setPriorityPref] = useState('eisenhower');
  const [taskFilter, setTaskFilter] = useState('today');
  const [taskViewMode, setTaskViewMode] = useState('sequence');

  // Sync priority pref + task UI prefs from user metadata when session changes
  useEffect(() => {
    const meta = session?.user?.user_metadata || {};
    const pref = meta.priority_system;
    if (pref === 'simple' || pref === 'eisenhower') setPriorityPref(pref);
    else setPriorityPref('eisenhower');
    const tf = meta.task_filter;
    if (tf && DATE_FILTERS.some(f => f.id === tf)) setTaskFilter(tf);
    else setTaskFilter('today');
    const tv = meta.task_view_mode;
    if (tv === 'sequence' || tv === 'matrix' || tv === 'focus') setTaskViewMode(tv);
    else setTaskViewMode('sequence');
  }, [session]);

  // Persist task UI prefs to user metadata (debounced, fire-and-forget)
  const persistMetaPref = useCallback((key, value) => {
    // Skip if not signed in yet
    if (!session) return;
    supabase.auth.updateUser({ data: { [key]: value } }).catch(() => {});
  }, [session]);
  const onTaskFilterChange = useCallback((v) => { setTaskFilter(v); persistMetaPref('task_filter', v); }, [persistMetaPref]);
  const onTaskViewModeChange = useCallback((v) => { setTaskViewMode(v); persistMetaPref('task_view_mode', v); }, [persistMetaPref]);

  useEffect(() => {
    // Bootstrap the session. If the backend is briefly unreachable (as during
    // an outage), retry a few times with backoff instead of dropping the user at
    // a broken screen — most blips self-heal within seconds. getSession() reads
    // the locally-persisted session, so a transient failure here is rare, but a
    // cold token refresh can hit the network; we guard it either way.
    (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          setSession(session); setLoading(false);
          return;
        } catch (err) {
          if (attempt === 2) { setLoading(false); break; }  // give up gracefully; UI shows login/reconnect
          await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
        }
      }
    })();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  // iOS wake recovery. A backgrounded Safari/PWA tab freezes its refresh timer,
  // so the app can wake with an EXPIRED access token. Until it refreshes, every
  // authenticated request sends a stale bearer: RPCs see auth.uid()=null (a broker
  // silently looks like a nobody, so the production card renders blank) and edge
  // calls 401 with nothing to show — which reads to the user as a "lock-up." On
  // every return to foreground we proactively freshen the token, then re-sync the
  // React session so anything gated on it re-renders with real data. Debounced so
  // rapid focus/visibility churn can't stack refreshes.
  useEffect(() => {
    let busy = false, last = 0;
    const wake = async () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (busy || now - last < 4000) return;  // debounce
      busy = true; last = now;
      try {
        await ensureFreshSession();
        const { data: { session: fresh } } = await supabase.auth.getSession();
        if (fresh) setSession(fresh);
      } catch (_) { /* offline / transient — connection layer handles the UI */ }
      finally { busy = false; }
    };
    const onVis = () => { if (document.visibilityState === 'visible') wake(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', wake);
    window.addEventListener('pageshow', wake);   // iOS bfcache restore
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', wake);
      window.removeEventListener('pageshow', wake);
    };
  }, []);

  // Back-button guard. On mount we push a sentinel history entry; every hardware/
  // browser back press pops it and fires popstate, which we intercept. Crucially we
  // RE-ARM the sentinel *synchronously* at the top of the handler — so the app is
  // never left unguarded during the async confirm. (That gap is exactly how a quick
  // second back-tap used to slip through and exit the app.) Precedence on back:
  // close the top open modal → step back to the home screen → and only on the home
  // screen, ask to exit with a proper confirm/cancel dialog.
  useEffect(() => {
    let allowExit = false;
    // Keep exactly ONE guard entry on top of history. Only add it when the current
    // top isn't already ours — so repeated interactions don't stack dozens of
    // entries (which would make "back" need many presses to escape).
    const armed = () => !!(window.history.state && window.history.state.__prismGuard);
    const arm = () => { try { if (!armed()) window.history.pushState({ __prismGuard: true }, ''); } catch (_) {} };
    arm();
    const reArm = () => { if (!allowExit) arm(); };
    const onPop = async () => {
      if (allowExit) return;
      arm(); // re-guard immediately, before anything async can run
      // 1) An open modal / overlay? Close the top one and stay put.
      if (__prismModalCloseStack.length) {
        const top = __prismModalCloseStack[__prismModalCloseStack.length - 1];
        try { top.close(); } catch (_) {}
        return;
      }
      // 2) Not on the home screen? Back returns home instead of leaving the app.
      if (viewRef.current && viewRef.current !== 'today') {
        try { setView('today'); } catch (_) {}
        return;
      }
      // 3) On the home screen with nothing to close → confirm before leaving.
      const ok = await confirmDialog(
        'Exit Prism?\n\nYou are on the home screen. Do you want to close the app?',
        { confirmLabel: 'Exit', cancelLabel: 'Stay', danger: true }
      );
      if (ok) {
        allowExit = true;
        window.removeEventListener('popstate', onPop);
        try { window.history.go(-2); } catch (_) { try { window.history.back(); } catch (_e) {} }
      }
      // Cancel: we already re-armed at the top, so the app simply stays.
    };
    window.addEventListener('popstate', onPop);
    // Robustness for mobile PWAs (especially Samsung Internet): a pushState entry
    // added before any user gesture is frequently NOT made back-navigable, a
    // resumed PWA can drop it, and other replaceState calls can overwrite it. So
    // re-assert the guard on the first interaction and whenever the app regains
    // focus / visibility. `arm()` is a no-op when a guard entry is already on top.
    const onVis = () => { if (document.visibilityState === 'visible') reArm(); };
    window.addEventListener('pointerdown', reArm, true);
    window.addEventListener('touchstart', reArm, true);
    window.addEventListener('keydown', reArm, true);
    window.addEventListener('focus', reArm);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('pointerdown', reArm, true);
      window.removeEventListener('touchstart', reArm, true);
      window.removeEventListener('keydown', reArm, true);
      window.removeEventListener('focus', reArm);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const loadData = useCallback(async (isRetry = false) => {
    if (!session) return;
    // Pass 1 Batch D — Findings #10 + #12 + #16:
    // - Removed: legacy emails, drawings, fin_accounts, fin_assets (per Q2 decision)
    // - Added bounds: events limited to 6 months back / 18 months ahead
    // - Added limits: completed tasks capped (recent 200 only), brain capped (500),
    //   notes capped (500), contacts capped (1000), email_threads unread count only
    // - Switched to Promise.allSettled so a single query failure doesn't block the rest
    const now = new Date();
    const eventsLowerBound = new Date(now.getTime() - 180 * 86400000).toISOString();
    const eventsUpperBound = new Date(now.getTime() + 540 * 86400000).toISOString();

    const queries = [
      ['tasks',          supabase.from('tasks').select('*').is('archived_at', null).eq('someday', false).order('created_at', { ascending: false }).limit(500)],
      ['robots',         supabase.from('robots').select('*').eq('active', true).order('created_at', { ascending: true })],
      ['notes',          supabase.from('notes').select('*').order('updated_at', { ascending: false }).limit(500)],
      ['contacts',       supabase.from('contacts').select('*').order('created_at', { ascending: false }).limit(10000)],
      ['properties',     supabase.from('properties').select('*').order('created_at', { ascending: false })],
      ['deals',          supabase.from('deals').select('*').order('updated_at', { ascending: false }).limit(500)],
      ['files',          supabase.from('files').select('*').order('updated_at', { ascending: false }).limit(500)],
      ['mileageEntries', supabase.from('mileage_entries').select('*').order('date', { ascending: false }).limit(1000)],
      ['investments',    supabase.from('investments').select('*').order('created_at', { ascending: false })],
      ['brain',          supabase.from('brain').select('*').order('created_at', { ascending: false }).limit(500)],
      ['events',         supabase.from('events').select('*')
                            .gte('start_at', eventsLowerBound).lte('start_at', eventsUpperBound)
                            .order('start_at', { ascending: true })],
      ['playbookSteps',  supabase.from('playbook_steps').select('*').order('step_order', { ascending: true })],
      ['playbookRuns',   supabase.from('playbook_runs').select('*').order('created_at', { ascending: false }).limit(50)],
      ['profiles',       supabase.from('profiles').select('*').order('created_at', { ascending: true })],
      ['voiceCards',     supabase.from('voice_cards').select('*').order('created_at', { ascending: true })],
      ['emailAccounts',  supabase.from('email_accounts').select('*').order('created_at', { ascending: true })],
      ['emailAliases',   supabase.from('email_aliases').select('*').order('email_address', { ascending: true })],
      // Pass 2 Batch C — user_settings row drives onboarding modal + personalization.
      // maybeSingle so we get null (not an error) when row doesn't exist yet.
      ['userSettings',   supabase.from('user_settings').select('*').eq('user_id', session?.user?.id).maybeSingle()],
      // Lightweight unread count for the Dashboard tile — replaces the old legacy
      // `emails.filter(...)` approach. Uses head:true + count='exact' to avoid
      // fetching any rows (just the count).
      ['unreadEmailCount', supabase.from('email_threads').select('id', { count: 'exact', head: true })
                              .eq('has_unread', true).contains('labels', ['INBOX']).is('snoozed_until', null)],
      ['oweReply',       supabase.rpc('my_owe_reply')],
    ];

    // Two-phase load: Phase 1 (small, first-paint-critical) reveals the UI fast;
    // Phase 2 (heavy/secondary datasets, incl. up to 10k contacts) streams in after.
    const PHASE1 = new Set(['tasks','robots','brain','events','profiles','userSettings','unreadEmailCount','emailAccounts']);
    const q1 = queries.filter(([k]) => PHASE1.has(k));
    const q2 = queries.filter(([k]) => !PHASE1.has(k));

    const apply = (entries, results) => {
      const byKey = Object.fromEntries(entries.map(([k], i) => [k, results[i]]));
      const failed = [];
      function take(key, setter) {
        const r = byKey[key];
        if (r && r.status === 'fulfilled' && r.value && !r.value.error) setter(r.value);
        else if (key in byKey) failed.push(key);
      }
    take('tasks',         res => setTasks(res.data || []));
    take('robots',        res => setRobots(res.data || []));
    take('notes',         res => setNotes(res.data || []));
    take('contacts',      res => setContacts(res.data || []));
    take('properties',    res => setProperties(res.data || []));
    take('deals',         res => setDeals(res.data || []));
    take('files',         res => setFiles(res.data || []));
    take('mileageEntries',res => setMileageEntries(res.data || []));
    take('investments',   res => setInvestments(res.data || []));
    take('brain',         res => setBrain(res.data || []));
    take('events',        res => setEvents(res.data || []));
    take('playbookSteps', res => setPlaybookSteps(res.data || []));
    take('playbookRuns',  res => setPlaybookRuns(res.data || []));
    take('profiles',      res => setProfiles(res.data || []));
    take('voiceCards',    res => setVoiceCards(res.data || []));
    take('emailAccounts', res => setEmailAccounts(res.data || []));
    take('emailAliases',  res => setEmailAliases(res.data || []));
    take('userSettings',  res => setUserSettings(res.data || null));
    take('unreadEmailCount', res => setUnreadEmailCount(typeof res.count === 'number' ? res.count : 0));
    take('oweReply', res => { const m = {}; (res.data || []).forEach(r => { if (r && r.contact_id) m[r.contact_id] = r.last_inbound_at; }); setOweReplyMap(m); });
      return failed;
    };

    // Phase 1 — await only the essentials, then reveal the app immediately.
    const r1 = await Promise.allSettled(q1.map(([_, q]) => q));
    const failed1 = apply(q1, r1);
    setDataLoaded(true);

    // Phase 2 — heavier/secondary datasets load in the background and populate as they arrive.
    Promise.allSettled(q2.map(([_, q]) => q)).then(async r2 => {
      const failed = [...failed1, ...apply(q2, r2)];
      if (failed.length === 0) return;
      console.warn('loadData: queries failed:', failed);
      if (!isRetry) {
        // Transient blips (a 5G drop or an auth-token refresh the moment the app
        // resumes) tend to fail the whole parallel batch at once. Nudge the
        // session and retry once, silently, before bothering the user.
        try { await supabase.auth.getSession(); } catch (_) {}
        setTimeout(() => { loadData(true); }, 1500);
      } else {
        // Still failing after a retry — this is a real problem worth surfacing.
        notify(`Couldn't load: ${failed.join(', ')}. Pull to refresh, or check your connection.`, 'error');
      }
    });
  }, [session]);

  useEffect(() => { loadData(); }, [loadData]);

  // Handle the OAuth-callback redirect — show a brief banner, refresh data, and clean the URL.
  const [gmailConnectedFlash, setGmailConnectedFlash] = useState(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('gmail_connected');
    const googleConnected = params.get('google_connected');
    const purposeParam = params.get('purpose') || '';
    if (connected || googleConnected) {
      const email = connected || googleConnected;
      const purposes = purposeParam.split(',').filter(Boolean);
      const isEmail = purposes.includes('email');
      const isCalendar = purposes.includes('calendar');
      let purposeLabel = 'email';
      if (isEmail && isCalendar) purposeLabel = 'email + calendar';
      else if (isCalendar) purposeLabel = 'calendar';
      else if (isEmail) purposeLabel = 'email';
      const nextStep = isEmail
        ? 'Open Inbox and tap Sync to pull messages.'
        : (isCalendar ? 'Open Calendar to see your synced events.' : '');
      setGmailConnectedFlash({ email, purposeLabel, nextStep });
      // Strip the params from the URL
      params.delete('gmail_connected');
      params.delete('google_connected');
      params.delete('purpose');
      const newSearch = params.toString();
      const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
      window.history.replaceState({}, '', newUrl);
      // Reload data so the new account appears
      if (session) loadData();
      // Kick off the right sync based on what just connected
      if (googleConnected && session) {
        if (isCalendar) {
          supabase.functions.invoke('calendar-sync', {
            body: { user_id: session.user.id, direction: 'both' }
          }).then(async () => {
            const { data: fresh } = await supabase.from('events').select('*').order('start_at', { ascending: true });
            if (fresh) setEvents(fresh);
          }).catch(()=>{});
        }
        if (isEmail) {
          // Find the email-purpose account and trigger a Gmail sync so messages appear
          supabase.from('email_accounts')
            .select('id')
            .eq('user_id', session.user.id)
            .eq('email_address', email.toLowerCase())
            .maybeSingle()
            .then(({ data: acct }) => {
              if (acct) {
                supabase.functions.invoke('gmail-sync', { body: { account_id: acct.id } }).catch(()=>{});
                // Also pull the user's Gmail labels into our local mirror so the
                // label picker has data the first time it's opened.
                supabase.functions.invoke('gmail-labels-sync', { body: { account_id: acct.id } }).catch(()=>{});
              }
            });
          // Also sync Send-mail-as aliases
          supabase.functions.invoke('gmail-aliases-sync', {
            body: { user_id: session.user.id }
          }).then(async () => {
            const { data: aliases } = await supabase.from('email_aliases').select('*').order('email_address', { ascending: true });
            if (aliases) setEmailAliases(aliases);
          }).catch(()=>{});
        }
      }
      // Hide the flash after 6s
      const t = setTimeout(() => setGmailConnectedFlash(null), 6000);
      return () => clearTimeout(t);
    }
  }, [session, loadData]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    setTasks([]); setRobots([]); setNotes([]);
    setContacts([]); setProperties([]); setInvestments([]); setBrain([]); setEvents([]); setPlaybookSteps([]); setPlaybookRuns([]); setEmailAliases([]);
    setProfiles([]); setVoiceCards([]); setEmailAccounts([]);
    setUserSettings(null);
    setUnreadEmailCount(0);
    setNeedsReviewCount(0);
    setOweReplyMap({});
    setDataLoaded(false);
  }

  const navigate = (id, sub = null) => {
    // Close the drawer FIRST so the tap feels instant, then let the heavy view
    // mount on the next frame. Switching view synchronously while the drawer is
    // still open locks the main thread on a phone (multi-second freeze).
    setSidebarOpen(false);
    requestAnimationFrame(() => {
      setView(id);
      if (sub) setDeepLink(d => ({ view: id, sub, n: d.n + 1 }));
    });
  };
  // Global "compose an email in-app" helper: any Email affordance can call
  // window.__composeEmail(address) to open the PrismOS composer instead of the OS/Gmail app.
  useEffect(() => {
    window.__composeEmail = (email) => { if (!email) return; try { window.__inboxComposeTo = String(email).trim(); } catch (_) {} navigate('inbox'); };
    // Open a contact record from anywhere (email headers, timelines). Separate
    // from __openContactResearch on purpose: that one KICKS OFF research, which
    // is wrong when the user just wants to look someone up.
    window.__openContact = (contactId) => { try { if (!contactId) return; window.__pendingOpenContact = contactId; navigate('contacts'); } catch (_) {} };
    window.__openContactResearch = (contactId, prefill, hint) => { try { window.__autoResearchHint = hint || (prefill && prefill.hint) || null; if (contactId) { window.__pendingResearch = contactId; } else if (prefill) { window.__pendingContactPrefill = prefill; } navigate('contacts'); } catch (_) {} };
    window.__setView = (v) => { try { navigate(v); } catch (_) {} };  // used by the automated smoke-check harness
    window.__getView = () => { try { return viewRef.current; } catch (_) { return null; } };  // read hook: lets tests assert WHICH view is on screen
    window.__openOnboarding = () => { setOnboardingReopen(true); setSidebarOpen(false); };  // manual re-launch of the setup wizard
  }); // eslint-disable-line
  // Stamp the active view so uncaught errors/rejections are attributed correctly.
  useEffect(() => { if (typeof window !== 'undefined') window.__currentView = view; }, [view]);

  const uidForReview = session?.user?.id || null;
  const [reviewCount, setReviewCount] = useState(0);
  React.useEffect(() => {
    if (!uidForReview) return;
    try { if (localStorage.getItem('prism_tips_pace')) return; } catch(_){ return; }
    (async () => {
      try {
        const { data } = await supabase.from('profiles').select('primary_letter').eq('user_id', uidForReview).eq('subject_kind', 'owner').maybeSingle();
        const L = ((data && data.primary_letter) || '').toUpperCase();
        const def = L === 'C' ? 'thorough' : (L === 'D' || L === 'I') ? 'light' : 'balanced';
        try { localStorage.setItem('prism_tips_pace', def); } catch(_){}
      } catch(_) { try { localStorage.setItem('prism_tips_pace', 'balanced'); } catch(_2){} }
    })();
  }, [uidForReview]);
  React.useEffect(() => {
    if (!uidForReview) return; let alive = true;
    (async () => {
      try {
        const [{ count: recN }, { data: calls }] = await Promise.all([
          supabase.from('pending_recordings').select('id', { count: 'exact', head: true }).eq('user_id', uidForReview).eq('status', 'pending'),
          supabase.from('quo_calls').select('proposed_tasks').eq('user_id', uidForReview).eq('review_status', 'pending'),
        ]);
        const taskN = (calls || []).reduce((a, c) => a + (Array.isArray(c.proposed_tasks) ? c.proposed_tasks.length : 0), 0);
        if (alive) setReviewCount((recN || 0) + taskN);
      } catch (_) {}
    })();
    return () => { alive = false; };
  }, [uidForReview, view]);

  if (loading) return <div className="loading-screen"><div className="spinner"/><p>Loading…</p></div>;
  if (!session) return <AuthScreen />;

  const user = session.user;
  const emailAdmin = ((user?.email)||'').toLowerCase()==='khoyi1234@gmail.com';
  const isAdmin = appCtx ? !!appCtx.is_admin : emailAdmin;
  const isTeamLeader = appCtx ? !!appCtx.is_team_leader : false;
  const isImpersonating = (() => { try { return !!localStorage.getItem('__impersonating'); } catch (_) { return false; } })();
  const openTaskCount = tasks.filter(t=>!t.completed).length;

  // ── the hub's briefing data: hero + vital signs + per-mode state ──────────
  // Built from counts already loaded here — no new queries. Each room learns
  // whether it has anything urgent so the dashboard can float it up and light it.
  const hubOweReply = Object.keys(oweReplyMap || {}).length;
  const hubTodayStr = new Date().toISOString().slice(0, 10);
  const hubDueToday = tasks.filter(t => !t.completed && t.due_date === hubTodayStr).length;   // ACTUALLY due today — not 'today or earlier'
  const hubActiveDeals = (deals || []).filter(d => ['lead', 'active', 'pending'].includes(d.status)).length;
  const hubClear = (reviewCount || 0) + (needsReviewCount || 0);
  const hubHero = hubOweReply > 0
    ? { title: `${hubOweReply} ${hubOweReply === 1 ? 'person is' : 'people are'} waiting on your reply`, why: 'A fast reply keeps deals and relationships warm.', cta: 'Reply now', go: () => setView('contacts') }
    : hubDueToday > 0
    ? { title: `${hubDueToday} ${hubDueToday === 1 ? 'task is' : 'tasks are'} due today`, why: 'Clear today’s list before it becomes tomorrow’s backlog.', cta: 'Plan my day', go: () => setView('briefing') }
    : hubClear > 0
    ? { title: `${hubClear} items from your calls to review`, why: 'Turn conversations into tasks before they’re forgotten.', cta: 'Review now', go: () => setView('review') }
    : { title: 'You’re clear — go find your next deal', why: 'Nothing urgent. A great time to prospect.', cta: 'Start prospecting', go: () => setView('prospecting') };
  const hubVitals = [
    { id: 'owe', value: hubOweReply || '0', label: 'Owe a reply', lit: hubOweReply > 0, onClick: () => setView('contacts') },
    { id: 'due', value: hubDueToday || '0', label: 'Due today', lit: hubDueToday > 0, onClick: () => setView('tasks') },
    { id: 'clear', value: hubClear || '0', label: 'To clear', lit: hubClear > 0, onClick: () => setView('review') },
    { id: 'deals', value: hubActiveDeals || '0', label: 'Deals in motion', good: hubActiveDeals > 0, onClick: () => setView('pipeline') },
  ];
  const hubModeState = {
    plan: { urgent: hubDueToday > 0 || hubClear > 0, badge: hubDueToday + hubClear, hint: hubDueToday ? `${hubDueToday} due today` : null },
    relationships: { urgent: hubOweReply > 0, badge: hubOweReply, hint: hubOweReply ? `${hubOweReply} owe a reply` : null },
    prospect: {},
    deals: { badge: hubActiveDeals, hint: hubActiveDeals ? `${hubActiveDeals} in motion` : null },
    money: {},
    brokerage: {},
  };
  const barBadges = { tasks: openTaskCount, review: reviewCount, inbox: unreadEmailCount, email_review: needsReviewCount, contacts: hubOweReply };

  const NAV_ALL = [
    { id: 'today',       icon: '✦', label: 'Today' },
    { id: 'investor_pipeline', icon: '🏦', label: 'Investor Pipeline' },
    { id: 'dashboard',   icon: '⚡', label: 'Dashboard' },
    { id: 'review',      icon: '📥', label: 'Review',      badge: reviewCount || null },
    { id: 'coach',       icon: '🎯', label: 'Coach' },
    { id: 'learn',       icon: '🎓', label: 'Field Guide' },
    { id: 'chief',       icon: '💼', label: 'Chief of Staff' },
    { id: 'agentruns',   icon: '🤖', label: 'Prepared by AI' },
    { id: 'agent_activity', icon: '🛡️', label: 'Agent activity' },
    { id: 'adoption', icon: '📡', label: 'Adoption' },
    { id: 'group_message', icon: '✨', label: 'Group message' },
    { id: 'app_health', icon: '🩺', label: 'App health' },
    { id: 'numbers',     icon: '📊', label: 'My numbers' },
    { id: 'growth',      icon: '📈', label: 'Growth',      badge: null },
    { id: 'prospecting', icon: '🎯', label: 'Prospecting', badge: null },
    { id: 'pipeline',    icon: '🎯', label: 'My pipeline', badge: null },
    { id: 'scoreboard',  icon: '🏆', label: "How I'm doing", badge: null },
    { id: 'team',        icon: '👥', label: 'Team', badge: null },
    { id: 'contact_types', icon: '🏷️', label: 'Contact types', badge: null },
    { id: 'tasks',       icon: '✅', label: 'Tasks',       badge: openTaskCount || null },
    { id: 'someday',     icon: '✦', label: 'Someday / Maybe' },
    { id: 'calendar',    icon: '📅', label: 'Calendar',    badge: null },
    { id: 'inbox',       icon: '📬', label: 'Inbox',       badge: unreadEmailCount || null },
    { id: 'email_review', icon: '🕵️', label: 'Email review', badge: needsReviewCount || null },
    { id: 'quo',         icon: '☎️', label: 'Quo',         badge: null },
    { id: 'contacts',    icon: '👥', label: 'Contacts',    badge: contacts.length || null },
    { id: 'documents',   icon: '📁', label: 'Documents',   badge: null },
    { id: 'recruiting',  icon: '🪪', label: 'Recruiting',  badge: contacts.filter(c=>c.type==='recruit' && c.recruiting_stage && !['signed','lost','parked'].includes(c.recruiting_stage)).length || null },
    { id: 'deals',       icon: '🤝', label: 'Files',       badge: deals.filter(d=>['lead','active','under_contract','closing'].includes(d.status)).length || null },
    { id: 'listing_presentation', icon: '🏛️', label: 'Listing Presentation', badge: null },
    { id: 'files',       icon: '📁', label: 'Files',       badge: files.filter(f=>f.side==='buyer' && !['closed','paid','cancelled'].includes(f.status)).length || null },
    ...((isAdmin||isTeamLeader) ? [{ id: 'agents',      icon: '👥', label: 'Brokerage',   badge: null }] : []),
    { id: 'mileage',     icon: '🚗', label: 'Mileage',     badge: null },
    { id: 'properties',  icon: '🏠', label: 'Properties',  badge: properties.length || null },
    { id: 'investments', icon: '💰', label: 'Investments', badge: investments.length || null },
    { id: 'finance',     icon: '📊', label: 'Finance',     badge: null },
    { id: 'brain',       icon: '🧠', label: 'Brain',       badge: brain.length || null },
    { id: 'playbooks',   icon: '📚', label: 'Playbooks',   badge: brain.filter(b=>b.type==='playbook').length || null },
    { id: 'notes',       icon: '📝', label: 'Notes',       badge: null },
    { id: 'journal',     icon: '📓', label: 'Journal',     badge: null },
    { id: 'chat',        icon: '✦',  label: robots[0]?.name || 'Assistant', badge: null },
    { id: 'prism',       icon: '✦',  label: 'Prism Profile', badge: null },
    { id: 'tracker',     icon: '🗂️', label: 'Projects',    badge: null },
    { id: 'systems',     icon: '🩺', label: 'Systems',     badge: null },
    { id: 'knowledge', icon: '📚', label: 'Knowledge', badge: null },
    ...(isAdmin ? [{ id: 'teams', icon: '👥', label: 'Teams', badge: null }] : []),
    ...((isAdmin || isTeamLeader) && !isImpersonating ? [{ id: 'actas', icon: '🎭', label: 'Act as user', badge: null }] : []),
    ...((isAdmin || isTeamLeader) ? [{ id: 'announcements', icon: '📣', label: 'Announcements', badge: null }] : []),
    { id: 'settings',    icon: '⚙️',  label: 'Settings' },
  ];

  // Pass 2 Batch D — Finding #9: filter nav by user_settings.module_visibility.
  // Default is visible (per Q5=yes): only hide when explicitly set to false.
  // STAGE 0: visibility now flows through the ONE registry predicate (pages.js)
  // so the primary menu, mindset rooms, tab bar and (later) licensing all agree.
  // Behavior is unchanged today — role + module_visibility, no entitlements yet.
  const mv = userSettings?.module_visibility || {};
  const navRole = isAdmin ? 'admin' : isTeamLeader ? 'team_leader' : 'agent';
  const navCtx = { role: navRole, moduleVisibility: mv, entitled, isImpersonating };
  const NAV = NAV_ALL.filter(item => (PAGES[item.id] ? pageVisible(item.id, navCtx) : mv[item.id] !== false));
  // Primary tabs (top to bottom) + collapsible "More" group.
  const MAIN_ORDER = ['dashboard', 'numbers', 'chat', 'prospecting', 'tasks', 'calendar', 'contacts', 'inbox', 'journal', 'finance', 'mileage', 'quo'];
  const MORE_ORDER = ['briefing', 'pipeline', 'scoreboard', 'team', 'contact_types', 'recruiting', 'deals', 'investments', 'properties', 'tracker', 'playbooks', 'brain', 'prism', 'systems', 'knowledge', 'teams', 'actas', 'announcements', 'settings'];
  const byNavId = Object.fromEntries(NAV.map(i => [i.id, i]));
  const usedIds = new Set([...MAIN_ORDER, ...MORE_ORDER]);
  const mainNav = MAIN_ORDER.map(id => byNavId[id]).filter(Boolean);
  const moreNav = [...MORE_ORDER.map(id => byNavId[id]).filter(Boolean), ...NAV.filter(i => !usedIds.has(i.id))];
  const viewInMore = moreNav.some(i => i.id === view);

  // Master menu (mirrors the menu plan PDF). White = built & working; greyed "soon" = not built yet.
  // Views that are real screens but are not NAV entries must be listed here or
  // the sidebar renders them greyed out and unclickable. Adding a MENU row is
  // not enough on its own — google_contacts shipped greyed for exactly that
  // reason.
  const builtSet = new Set([...NAV.map(i => i.id), 'disc_test', 'disc_roster', 'myvoice', 'voice_roster', 'google_contacts', 'cadence_review', 'unstuck', 'my_prism', 'production', 'transactions']);
  const fin = (sub, label) => ({ label, view: 'finance', sub });
  // Role-gated branches. Broker tab = admins/owner only. Team tab = team leaders only.
  // Agents see neither. (Mirrors the approved agent-centric menu IA.)
  const brokerageGroup = { label: 'Brokerage', icon: 'building', children: [
    { label: 'Announcements', view: 'announcements', icon: 'megaphone' },
    { label: 'Team Dashboard', view: 'agents', icon: 'dashboard' },
    { label: 'Team Sharing', view: 'team', icon: 'users' },
    { label: 'Adoption', view: 'adoption', icon: 'signal' },
    { label: 'Agent Roster', view: 'agents', icon: 'users', children: [
      { label: 'Add Agent', view: 'agents', icon: 'recruiting' },
      { label: 'Set Up Agent', view: 'agents', icon: 'clipboard' },
      { label: 'Commission Plan & GCI', built: false, icon: 'target' },
      { label: 'Commission On Track?', view: 'production', icon: 'chart' },
      { label: 'DISC & Systems Deployed', built: false, icon: 'signal' },
      { label: 'Company Leads', built: false, icon: 'gift' },
      { label: 'Oversight Accountability', built: false, icon: 'eye' },
    ] },
    { label: 'Agent DISC Read', view: 'disc_roster', icon: 'bulb' },
    { label: 'Agent Voice Cards', view: 'voice_roster', icon: 'mic' },
    { label: 'Contact Types', view: 'contact_types', icon: 'clipboard' },
    { label: 'Brokerage Dashboard', view: 'finance', sub: 'dashboard', icon: 'dashboard' },
    { label: 'Transactions', view: 'transactions', icon: 'file' },
    { label: 'Brokerage Financials', view: 'finance', sub: 'reports', icon: 'finance' },
    { label: 'Teams', view: 'teams', icon: 'users' },
    ...(!isImpersonating ? [{ label: 'Act as a User', view: 'actas', icon: 'users' }] : []),
  ] };
  const teamGroup = { label: 'Team', icon: 'users', children: [
    { label: 'Announcements', view: 'announcements', icon: 'megaphone' },
    { label: 'Team Dashboard', view: 'agents', icon: 'dashboard' },
    { label: 'Recruiting', view: 'recruiting', icon: 'recruiting' },
    { label: 'Team Roster', view: 'agents', icon: 'users', children: [
      { label: 'Commission On Track?', built: false, icon: 'chart' },
      { label: 'DISC & Systems Deployed', built: false, icon: 'signal' },
      { label: 'Company Leads', built: false, icon: 'gift' },
      { label: 'Oversight Accountability', built: false, icon: 'eye' },
    ] },
  ] };
  const MENU = [
    // ── Top level — promoted daily drivers (Dara's order) ──
    { label: 'Today', view: 'today', icon: 'sparkles' },
    // My World is a ROOM, not a screen, so it is an action node rather than a
    // view node: enterMode() applies the room's resume rule — Contacts on the
    // first visit each day, then wherever you left off. Pointing it straight at
    // 'contacts' would look identical here and silently throw that away.
    { label: 'My World', icon: 'contacts',
      action: () => { setSidebarOpen(false); enterMode('relationships'); } },
    { label: 'Unstuck.', view: 'unstuck', icon: 'properties', ai: true },
    { label: 'Investor Pipeline', view: 'investor_pipeline', icon: 'building' },
    { label: 'Google Contacts', view: 'google_contacts', icon: 'contacts' },
    { label: 'Cadence Review', view: 'cadence_review', icon: 'clock' },
    // ── Planning — the daily-drivers grouped: what to do, when, and with whom ──
    { label: 'Planning', icon: 'calendar', children: [
      { label: 'Tasks', view: 'tasks', icon: 'tasks' },
      { label: 'Someday / Maybe', view: 'someday', icon: 'sparkles' },
      { label: 'Calendar', view: 'calendar', icon: 'calendar', ai: true },
      { label: 'Contacts', view: 'contacts', icon: 'contacts', ai: true },
      { label: 'My Stats', view: 'numbers', icon: 'chart' },
    ] },
    { label: 'Inbox', view: 'inbox', icon: 'inbox', ai: true },
    { label: 'Phone & Text', view: 'quo', icon: 'quo', ai: true },
    { label: 'Daily Journal', view: 'journal', icon: 'journal', ai: true },
    { label: 'Library', view: 'notes', icon: 'notes', ai: true },
    { label: 'Finance Dashboard', view: 'finance', icon: 'dollar' },
    { label: 'Mileage', view: 'mileage', icon: 'car' },
    // Ask Ari, with Listing Presentation nested beneath it.
    { label: 'Ask Ari', view: 'chat', icon: 'chat', ai: true, children: [
      { label: 'Listing Presentation', view: 'listing_presentation', icon: 'properties' },
    ] },
    { label: 'Prospecting', view: 'prospecting', icon: 'prospecting' },
    // ── AI Agents ──
    { label: 'AI Agents', icon: 'sparkles', ai: true, children: [
      { label: 'Chief of Staff', view: 'chief', icon: 'briefing' },
      { label: 'Prepared by AI', view: 'agentruns', icon: 'sparkles' },
      { label: 'Agent Activity', view: 'agent_activity', icon: 'brain' },
      ...(isAdmin ? [{ label: 'App Health', view: 'app_health', icon: 'brain' }] : []),
    ] },
    // ── Pipeline & Growth ──
    { label: 'Pipeline & Growth', icon: 'target', children: [
      { label: 'Transaction Pipeline', view: 'pipeline', icon: 'chart' },
      { label: 'Prospecting', view: 'prospecting', icon: 'prospecting' },
      { label: 'Lead-Gen Systems', view: 'prospecting', sub: 'systems', icon: 'signal' },
      { label: "How I'm Doing", view: 'scoreboard', icon: 'target' },
      { label: 'Growth', view: 'growth', icon: 'chart' },
      ...(isAdmin ? [{ label: 'Recruiting', view: 'recruiting', icon: 'recruiting' }] : []),
    ] },
    // ── Communications ──
    { label: 'Communications', icon: 'message', children: [
      { label: 'Inbox', view: 'inbox', icon: 'inbox' },
      { label: 'Email Review', view: 'email_review', icon: 'mail', ai: true },
      { label: 'Phone & Text (Quo)', view: 'quo', icon: 'quo' },
      { label: 'Group Message', view: 'group_message', icon: 'message', ai: true },
      { label: 'Journal', view: 'journal', icon: 'journal' },
      { label: 'Drip Campaigns', built: false, icon: 'signal' },
    ] },
    // ── Deals & Property ──
    { label: 'Deals & Property', icon: 'briefcase', children: [
      { label: 'Transaction Pipeline', view: 'deals', icon: 'deals' },
      { label: 'Contract Management', view: 'files', icon: 'folder', ai: true, children: [
        { label: 'View Transactions', view: 'tracker', icon: 'tracker' },
        { label: 'Upload Trans. Docs', built: false, icon: 'folder' },
        { label: 'Upload Recordings', built: false, icon: 'mic' },
      ] },
      { label: 'Documents', view: 'documents', icon: 'folder' },
      { label: 'Residential', view: 'properties', icon: 'properties', children: [
        { label: 'Create Trans.', built: false, icon: 'plus' },
        { label: 'Upload Trans. Docs', built: false, icon: 'folder' },
        { label: 'Upload Recordings', built: false, icon: 'mic' },
      ] },
      { label: 'Commercial', built: false, icon: 'building', children: [
        { label: 'Create Trans.', built: false, icon: 'plus' },
        { label: 'Upload Trans. Docs', built: false, icon: 'folder' },
        { label: 'Upload Recordings', built: false, icon: 'mic' },
      ] },
      { label: 'Rentals', built: false, icon: 'properties', children: [
        { label: 'Create Trans.', built: false, icon: 'plus' },
      ] },
      { label: 'My Projects', view: 'tracker', icon: 'tracker' },
      { label: 'My Investments', view: 'investments', icon: 'investments' },
    ] },
    // ── Finance ──
    { label: 'Finance', icon: 'dollar', children: [
      { label: 'Finance Dashboard', view: 'finance', icon: 'finance', children: [
        { label: 'Data Entry', view: 'finance', sub: 'ledger', icon: 'camera' },
        { label: 'Blueprint (Budget)', view: 'finance', sub: 'blueprint', icon: 'compass' },
        { label: 'Financial Records', view: 'finance', sub: 'reports', icon: 'chart' },
      ] },
      { label: 'Mileage', view: 'mileage', icon: 'car' },
    ] },
    // ── Learn & Coaching ──
    { label: 'Learn & Coaching', icon: 'library', children: [
      { label: 'Brain', view: 'brain', icon: 'brain', ai: true },
      { label: 'Playbooks', view: 'playbooks', icon: 'playbooks' },
      { label: 'AI Notes', view: 'notes', icon: 'notes', ai: true },
      { label: 'Knowledge', view: 'knowledge', icon: 'library' },
      { label: 'Training', icon: 'school', children: [
        { label: 'DISC Learning', built: false, icon: 'bulb' },
        { label: 'Coaching', built: false, icon: 'megaphone' },
        { label: 'Accountability Partner', built: false, icon: 'users' },
      ] },
    ] },
    // ── My Prism Identity ──
    { label: 'My Prism Identity', icon: 'prism', children: [
      { label: 'My Prism Profile', view: 'my_prism', icon: 'prism' },
      { label: 'DISC / Grit Test', view: 'disc_test', icon: 'bulb' },
      { label: 'My Voice (Voice Card)', view: 'myvoice', icon: 'mic' },
      { label: 'Get Started / Onboarding', icon: 'star', action: () => { try { window.__openOnboarding && window.__openOnboarding(); } catch (_) {} } },
      { label: 'Business Plan', built: false, icon: 'clipboard' },
    ] },
    // ── Brokerage (admin -> Brokerage, team leader -> Team, agent -> neither) ──
    ...(isAdmin ? [brokerageGroup] : isTeamLeader ? [teamGroup] : []),
    // ── Settings & Systems ──
    { label: 'Settings & Systems', icon: 'settings', children: [
      { label: 'Settings', view: 'settings', icon: 'settings' },
      { label: 'System Health', view: 'app_health', icon: 'systems' },
    ] },
  ];
  assignMenuKeys(MENU, 'm');
  // STAGE 1: prune pages the user has hidden (Simplify) — or later, isn't
  // licensed for — from the primary menu tree, so hiding a page removes it from
  // EVERY menu, not just the tab bar. A branch with no visible leaves is dropped.
  // Uses the one registry predicate (pages.js). Entries with no `view` (group
  // headers, placeholders, actions) are kept unless all their children vanish.
  const pruneMenu = (nodes) => (nodes || []).map(n => {
    if (n.children) {
      const kids = pruneMenu(n.children);
      if (!kids.length && !n.view) return null;   // empty group header → drop
      return { ...n, children: kids };
    }
    if (n.view && PAGES[n.view] && !pageVisible(n.view, navCtx)) return null;
    return n;
  }).filter(Boolean);
  const MENU_VISIBLE = pruneMenu(MENU);
  // menuCtx must stay a plain object here (this code runs after the app-shell
  // guards, so no hooks). The perf win comes from MenuNode being React.memo'd and
  // the tree only rendering when the drawer is open — see the render site.
  const menuCtx = { view, navigate, builtSet, byNavId, openPath,
    toggle: (depth, key) => setOpenPath(prev => prev[depth] === key ? prev.slice(0, depth) : [...prev.slice(0, depth), key]) };

  return (
    <div className="app-shell" style={{flexDirection:'column'}}>
      <ConnectionBanner />
      <InstallPwaPrompt />
      <UpdateBanner />
      <ImpersonationBanner />
      {/* QuickLog FAB (the graph icon) is preserved but hidden for now — Dara
          asked to remove it from all displays and save it for later. Flip
          SHOW_QUICKLOG_FAB to true to bring it back. */}
      {false && <QuickLog userId={user.id} onNavigate={navigate} onUploadRecording={(f) => setSharedAudio(f)} />}
      {/* Mobile header */}
      <div className="mobile-header">
        <div className="mobile-header-logo" onClick={() => setSidebarOpen(true)} style={{cursor:"pointer"}} role="button" aria-label="Menu"><svg className="mh-fork" width="27" height="30" viewBox="0 0 40 40" fill="none" aria-hidden="true"><g className="mh-fork-wave mh-fork-w2" stroke="#EBCB82" strokeWidth="1.2" strokeLinecap="round" fill="none"><path d="M31 8 Q37 17 31 26"/><path d="M9 8 Q3 17 9 26"/></g><g className="mh-fork-wave mh-fork-w1" stroke="#EBCB82" strokeWidth="1.3" strokeLinecap="round" fill="none"><path d="M28 11 Q32 17 28 23"/><path d="M12 11 Q8 17 12 23"/></g><g stroke="#CBA35C" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M15 6 V21"/><path d="M25 6 V21"/><path d="M15 21 C15 26 17 28 20 28 C23 28 25 26 25 21"/><path d="M20 28 V36"/></g><circle cx="20" cy="37.4" r="1.9" fill="#CBA35C"/></svg><span className="mh-divider"></span><div className="mh-text"><span className="rog-wordmark"><span className="rog-realty">REALTY</span><span className="rog-one">ONE</span><span className="rog-group">GROUP</span><span className="rog-adv">Advantage</span></span><span className="rog-sub"><span className="rog-pb">powered by </span><PrismMark /></span></div></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
          {/* Persistent Library search — the whole knowledge base is one tap from
              anywhere, which is what makes stored intelligence feel INSTANT rather
              than buried three menus deep. */}
          <button className="hamburger" onClick={() => { setDeepLink({ view: 'notes', sub: 'search', n: Date.now() }); setView('notes'); }} aria-label="Search your library" title="Search your library">
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="#CBA35C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/></svg>
          </button>
          <button className="hamburger" onClick={() => setMindsetOpen(true)} aria-label="Mindset menu" title="Rooms">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#CBA35C" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="6" r="1.8"/><circle cx="19" cy="12" r="1.8"/><circle cx="5" cy="18" r="1.8"/><path d="M7 6h9M7 18h9M17 12H8"/></svg>
          </button>
        </div>
      </div>

      {/* The mindset menu — opens from the UPPER-RIGHT button. Dashboard + the
          five rooms (+ Brokerage for admins). */}
      <MindsetMenu open={mindsetOpen} onClose={() => setMindsetOpen(false)}
        currentView={view} activeMode={activeMode} isAdmin={isAdmin || isTeamLeader}
        onHome={goHome} onEnterMode={enterMode}
        modeBadges={{ relationships: hubOweReply, deals: hubActiveDeals, prospect: 0, money: 0, brokerage: 0 }}
        userName={user.user_metadata?.display_name?.trim()||user.user_metadata?.full_name?.trim()?.split(/\s+/)[0]||user.email?.split('@')[0]}
        userEmail={user.email} onSignOut={handleSignOut} />

      <div style={{display:'flex',flex:1,overflow:'hidden'}}>
        {/* The old full menu — opens from the TUNING FORK. Keeps access to every
            screen and setting while the mindset structure matures. */}
        {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
        <nav className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-logo">
            <RogLogo />
          </div>
          <div className="sidebar-nav">
            <div className="nav-section-label">Menu</div>
            {(sidebarOpen || wideScreen) && MENU_VISIBLE.map((node, i) => <MenuNode key={node._key || i} node={node} depth={0} ctx={menuCtx} />)}
          </div>
          <div className="sidebar-footer">
            <div className="sidebar-user">
              <div className="sidebar-avatar">{(user.user_metadata?.display_name||user.user_metadata?.full_name||user.email||'').slice(0,2).toUpperCase()}</div>
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{user.user_metadata?.display_name?.trim()||user.user_metadata?.full_name?.trim()?.split(/\s+/)[0]||user.email?.split('@')[0]}</div>
                <div className="sidebar-user-email">{user.email}</div>
              </div>
              <button className="logout-btn" onClick={handleSignOut} title="Sign out">⏻</button>
            </div>
          </div>
        </nav>

        {/* Main */}
        <main className="main-content ww-prism" ref={mainScrollRef} onTouchStart={onMainTouchStart} onTouchMove={onMainTouchMove} onTouchEnd={onMainTouchEnd} style={activeMode ? { paddingBottom: 'calc(var(--modebar-h, 76px) + 8px)' } : undefined}>
          <style>{`.main-content.ww-prism{background:radial-gradient(120% 20% at 50% -2%, rgba(203,163,92,.09), transparent 55%), #100D09;} .ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h1,.ww-prism h2,.ww-prism h3{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .btn-add-circle{background:#EBCB82;color:#1a1409;} .ww-prism .form-input,.ww-prism .form-select,.ww-prism .form-textarea{background:#1B1610;border:1px solid rgba(203,163,92,.22);color:#F6F1E7;} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;} .ww-prism .seg-btn.active{background:linear-gradient(180deg,#EBCB82,#CBA35C)!important;color:#1a1409!important;}`}</style>
          {(ptrPull > 0 || ptrBusy) && (
            <div className="ptr-indicator" style={{ height: ptrBusy ? 40 : ptrPull, opacity: ptrBusy ? 1 : Math.min(ptrPull / PTR_THRESHOLD, 1) }}>
              <span className={'ptr-spinner' + (ptrBusy ? ' spin' : '')} style={!ptrBusy ? { transform: `rotate(${(ptrPull / PTR_THRESHOLD) * 180}deg)` } : undefined} />
              <span>{ptrBusy ? 'Refreshing…' : (ptrPull >= PTR_THRESHOLD ? 'Release to refresh' : 'Pull to refresh')}</span>
            </div>
          )}
          {gmailConnectedFlash && (
            <div style={{padding:'10px 14px',marginBottom:'14px',background:'rgba(34, 197, 94, 0.1)',border:'1px solid var(--green)',borderRadius:'8px',color:'var(--green)',fontSize:'13px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span>✓ Connected <strong>{gmailConnectedFlash.email}</strong> for <strong>{gmailConnectedFlash.purposeLabel}</strong>. {gmailConnectedFlash.nextStep}</span>
              <button className="btn btn-ghost btn-sm" onClick={()=>setGmailConnectedFlash(null)}>×</button>
            </div>
          )}
          {!dataLoaded
            ? <div className="loading-screen" style={{height:'60vh'}}><div className="spinner"/></div>
            : <ViewErrorBoundary key={view} viewName={view}>
                <React.Suspense fallback={<ViewLoadingFallback />}>
                {(entitled && PAGES[view] && !pageVisible(view, navCtx) && !PAGES[view].core)
                  ? <LockedPage page={PAGES[view]} onRedeem={reloadEntitlements} onSettings={()=>setView('settings')} />
                : view==='cadence_review' ? <CadenceReviewView userId={user.id} />
                : view==='google_contacts' ? <GoogleContactsView userId={user.id} setView={setView} />
                : view==='listing_presentation' ? <ListingPresentationView userId={user.id} agentName={appCtx?.name || user?.email || ''} />
                : view==='someday'     ? <SomedayView userId={user.id} setView={setView} />
                : view==='today'       ? <TodayView contacts={contacts} setContacts={setContacts} tasks={tasks} setTasks={setTasks} events={events} deals={deals} setView={setView} myUserId={user.id} oweReplyMap={oweReplyMap} setOweReplyMap={setOweReplyMap} agentName={(user?.user_metadata?.full_name || user?.email || '').split('@')[0].split(' ')[0]} onOpenPlan={()=>setPlanOpen(true)} />
                : view==='dashboard'   ? <DashboardHub
                    agentName={(user?.user_metadata?.full_name || user?.email || '').split('@')[0].split(' ')[0]}
                    hour={new Date().getHours()}
                    isAdmin={isAdmin || isTeamLeader}
                    hero={hubHero} onHero={hubHero.go}
                    vitals={hubVitals}
                    modeState={hubModeState}
                    onEnterMode={enterMode} />
                : view==='classic_dashboard' ? <DashboardView tasks={tasks} setTasks={setTasks} unreadEmailCount={unreadEmailCount} needsReviewCount={needsReviewCount} reviewCount={reviewCount} user={user} setView={setView} robots={robots} contacts={contacts} setContacts={setContacts} brain={brain} defaultSystem={priorityPref} properties={properties} events={events} onOpenPlan={()=>setPlanOpen(true)} deals={deals} oweReplyMap={oweReplyMap} setOweReplyMap={setOweReplyMap}/>
                : view==='production' ? <ProductionBoard year={2026} />
                : view==='numbers'    ? <MyNumbersView tasks={tasks} contacts={contacts} events={events} deals={deals} unreadEmailCount={unreadEmailCount} setView={setView} userId={user.id} oweReplyMap={oweReplyMap} />
              : view==='chief'       ? <ChiefOfStaffView userId={user.id} setView={setView} setFocusTaskId={setFocusTaskId} setFocusEventId={setFocusEventId} onOpenPlan={()=>setPlanOpen(true)}/>
              : view==='agentruns'   ? <AgentRunsView userId={user.id} setView={setView}/>
              : view==='agent_activity' ? <AgentActivityView userId={user.id}/>
              : view==='adoption' ? <AdoptionView userId={user.id}/>
              : view==='group_message' ? <GroupMessageView contacts={contacts} profiles={profiles} userId={user.id}/>
              : view==='app_health' ? <AppHealthView/>
              : view==='documents' ? <div className="ww-prism"><style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 30% at 50% -6%, rgba(203,163,92,.09), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h2{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel-header h3{font-family:'Fraunces',serif;font-weight:400;color:#F6F1E7;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .btn-add-circle{background:#EBCB82;color:#1a1409;} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style><DocumentsView userId={user.id}/></div>
              : view==='review'      ? <ReviewView userId={user.id} contacts={contacts} events={events} setTasks={setTasks} priorityPref={priorityPref} setView={setView} />
              : view==='coach'       ? <CoachView userId={user.id} setView={setView} />
              : view==='learn'       ? <LearnView setView={setView} userId={user.id} isAdmin={isAdmin} />
              : view==='briefing'    ? <AriBriefingView userId={user.id} user={user} setView={setView} setFocusTaskId={setFocusTaskId} setFocusEventId={setFocusEventId} profiles={profiles} contacts={contacts} properties={properties} events={events} brain={brain} defaultSystem={priorityPref} tasks={tasks} setTasks={setTasks} onOpenPlan={()=>setPlanOpen(true)} needsReviewCount={needsReviewCount}/>
              : view==='growth'      ? <GrowthView userId={user.id} setView={setView}/>
              : view==='scoreboard'  ? <ScoreboardView userId={user.id} appCtx={appCtx} setView={setView}/>
              : view==='pipeline'    ? <PipelineView contacts={contacts} userId={user.id}/>
              : view==='unstuck' ? <UnstuckView userId={user.id} />
              : view==='prospecting' ? <ProspectingView userId={user.id} initialSub={deepLink.view==='prospecting'?deepLink.sub:null} subNonce={deepLink.n} barDriven={activeMode==='prospect' && dataLoaded}/>
              : view==='tasks'       ? <div className="ww-tasks"><style>{`.ww-tasks{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 30% at 50% -6%, rgba(203,163,92,.09), transparent 60%), #100D09;min-height:100%;} .ww-tasks .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-tasks .view-header h2,.ww-tasks .page-header h2{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;font-size:30px;} .ww-tasks .panel-header h3{font-family:'Fraunces',serif;font-weight:400;letter-spacing:-.01em;color:#F6F1E7;} .ww-tasks .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-tasks .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-tasks .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-tasks .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-tasks .btn-add-circle{background:#EBCB82;color:#1a1409;} .ww-tasks .btn-view-toggle{border:1px solid rgba(203,163,92,.28);color:#C8BFAE;} .ww-tasks .btn-view-toggle.active{background:rgba(203,163,92,.16);color:#EBCB82;border-color:#CBA35C;} .ww-tasks .task-item{border-color:rgba(203,163,92,.14);} .ww-tasks .task-text{color:#F6F1E7;} .ww-tasks .empty-state{color:#8C8475;} .ww-tasks .empty-icon{color:#CBA35C;}`}</style><TasksView tasks={tasks} setTasks={setTasks} userId={user.id} defaultSystem={priorityPref} taskFilter={taskFilter} setTaskFilter={onTaskFilterChange} taskViewMode={taskViewMode} setTaskViewMode={onTaskViewModeChange} brain={brain} contacts={contacts} properties={properties} events={events} focusTaskId={focusTaskId} setFocusTaskId={setFocusTaskId}/>{taskViewMode !== 'matrix' && <><ProjectTasksPanel userId={user.id}/><EmailRepliesPanel/></>}</div>
              : view==='email_review' ? <EmailReviewView userId={user.id} emailAccounts={emailAccounts} setView={setView} onCount={setNeedsReviewCount}/>
              : view==='inbox'       ? <div className="ww-prism"><style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 30% at 50% -6%, rgba(203,163,92,.09), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h2{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel-header h3,.ww-prism h3.mv-h2{font-family:'Fraunces',serif;font-weight:400;color:#F6F1E7;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .btn-add-circle{background:#EBCB82;color:#1a1409;} .ww-prism .btn-view-toggle{border:1px solid rgba(203,163,92,.28);color:#C8BFAE;} .ww-prism .btn-view-toggle.active{background:rgba(203,163,92,.16);color:#EBCB82;border-color:#CBA35C;} .ww-prism .task-item{border-color:rgba(203,163,92,.14);} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style><InboxView emailAccounts={emailAccounts} setEmailAccounts={setEmailAccounts} emailAliases={emailAliases} setEmailAliases={setEmailAliases} profiles={profiles} contacts={contacts} userId={user.id} setView={setView} reloadData={loadData} defaultSystem={priorityPref}/></div>
              : view==='quo'         ? <div className="ww-prism"><style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 30% at 50% -6%, rgba(203,163,92,.09), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h2{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel-header h3,.ww-prism h3.mv-h2{font-family:'Fraunces',serif;font-weight:400;color:#F6F1E7;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .btn-add-circle{background:#EBCB82;color:#1a1409;} .ww-prism .btn-view-toggle{border:1px solid rgba(203,163,92,.28);color:#C8BFAE;} .ww-prism .btn-view-toggle.active{background:rgba(203,163,92,.16);color:#EBCB82;border-color:#CBA35C;} .ww-prism .task-item{border-color:rgba(203,163,92,.14);} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style><QuoView contacts={contacts} userId={user.id} profiles={profiles} defaultSystem={priorityPref}/></div>
              : view==='contacts'    ? <ContactsView contacts={contacts} setContacts={setContacts} userId={user.id} profiles={profiles} setProfiles={setProfiles} canSeeRestricted={isAdmin || !!(appCtx&&appCtx.is_team_leader) || (appCtx&&appCtx.role==='owner')}/>
              : view==='recruiting'  ? <RecruitingView contacts={contacts} setContacts={setContacts} userId={user.id}/>
              : view==='deals'       ? <DealsView deals={deals} setDeals={setDeals} contacts={contacts} setContacts={setContacts} properties={properties} userId={user.id}/>
              : view==='files'       ? <FilesView files={files} setFiles={setFiles} contacts={contacts} setContacts={setContacts} properties={properties} userId={user.id} user={user} isAdmin={isAdmin}/>
              : view==='team'        ? <TeamView/>
              : view==='contact_types' ? <ContactTypesAdmin isPrivileged={isAdmin || !!(appCtx&&appCtx.is_team_leader) || (appCtx&&appCtx.role==='owner')}/>
              : view==='agents' && (isAdmin||isTeamLeader) ? <AgentsView userId={user.id} user={user} appCtx={appCtx} isAdmin={isAdmin}/>
              : view==='mileage'     ? <MileageView mileageEntries={mileageEntries} setMileageEntries={setMileageEntries} deals={deals} contacts={contacts} setContacts={setContacts} properties={properties} userId={user.id}/>
              : view==='properties'  ? <PropertiesView properties={properties} setProperties={setProperties} userId={user.id} contacts={contacts}/>
              : view==='investments' ? <InvestmentsView investments={investments} setInvestments={setInvestments} properties={properties} userId={user.id} contacts={contacts}/>
              : view==='finance'     ? <FinanceView userId={user.id} initialSub={deepLink.view==='finance'?deepLink.sub:null} subNonce={deepLink.n}/>
              : view==='transactions' ? <TransactionPipeline userId={user.id}/>
              : view==='investor_pipeline' ? <InvestorPipeline userId={user.id}/>
              : view==='brain'       ? <BrainView brain={brain} setBrain={setBrain} userId={user.id} tasks={tasks} events={events} contacts={contacts}/>
              : view==='playbooks'   ? <PlaybooksView brain={brain} playbookSteps={playbookSteps} setPlaybookSteps={setPlaybookSteps} playbookRuns={playbookRuns} setPlaybookRuns={setPlaybookRuns} tasks={tasks} setTasks={setTasks} userId={user.id} setView={setView} setTaskFilter={onTaskFilterChange} events={events}/>
              : view==='calendar'    ? <CalendarView events={events} setEvents={setEvents} userId={user.id} brain={brain} contacts={contacts} emailAccounts={emailAccounts} properties={properties} tasks={tasks} setTasks={setTasks} focusEventId={focusEventId} setFocusEventId={setFocusEventId}/>
              : view==='notes'       ? <NotesView notes={notes} setNotes={setNotes} userId={user.id} initialSub={deepLink.view==='notes'?deepLink.sub:null} subNonce={deepLink.n}/>
              : view==='journal'     ? <div className="ww-prism"><style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 30% at 50% -6%, rgba(203,163,92,.09), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h2{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel-header h3{font-family:'Fraunces',serif;font-weight:400;color:#F6F1E7;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .btn-add-circle{background:#EBCB82;color:#1a1409;} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style><JournalView userId={user.id}/></div>
              : view==='chat'        ? <ChatView robots={robots} userId={user.id} hasModeBar={!!activeMode}/>
              : view==='prism'       ? <PrismView profiles={profiles} setProfiles={setProfiles} voiceCards={voiceCards} setVoiceCards={setVoiceCards} contacts={contacts} userId={user.id}/>
              : view==='my_prism'    ? <MyPrismView userId={user.id} user={user}/>
              : view==='disc_test'   ? <DiscAssessmentView userId={user.id} user={user} profiles={profiles} setProfiles={setProfiles}/>
              : view==='disc_roster' ? <DiscRosterView/>
              : view==='myvoice'     ? <MyVoiceView userId={user.id} user={user} voiceCards={voiceCards} setVoiceCards={setVoiceCards}/>
              : view==='voice_roster'? <VoiceRosterView/>
              : view==='tracker'     ? <TrackerView userId={user.id} defaultSystem={priorityPref} contacts={contacts}/>
              : view==='systems'     ? <SystemsView contacts={contacts} userId={user.id} />
              : view==='knowledge' ? <KnowledgeView userId={user.id} isAdmin={isAdmin} />
              : view==='teams' ? <TeamsAdmin userId={user.id} />
              : view==='actas' ? <ActAsPicker userId={user.id} />
              : view==='announcements' ? <AnnouncementsAdmin userId={user.id} isAdmin={isAdmin} />
              : view==='settings'    ? <SettingsView user={user} priorityPref={priorityPref} onPriorityPrefChange={setPriorityPref} emailAccounts={emailAccounts} setEmailAccounts={setEmailAccounts} emailAliases={emailAliases} setEmailAliases={setEmailAliases} userId={user.id} userSettings={userSettings} setUserSettings={setUserSettings} isAdmin={isAdmin} entitlements={entitlements} reloadEntitlements={reloadEntitlements} licensingEnforced={licensingEnforced}/>
              : null}
                </React.Suspense>
              </ViewErrorBoundary>
          }
        </main>
      </div>
      {/* The scoped bottom bar — only appears inside a mindset room, showing just
          that room's 3-5 sections plus a Home button back to the hub. */}
      {activeMode && dataLoaded && (
        <ModeBar modeId={activeMode} currentView={view} currentSub={deepLink.view === view ? deepLink.sub : null}
          onNavigate={navigate} onHome={goHome} badges={barBadges} />
      )}
      <ToastHost />
      <ConfirmHost />
      {planOpen && dataLoaded && user && (
        <PlanMyDayModal
          tasks={tasks} events={events} contacts={contacts} properties={properties}
          userId={user.id} name={(robots && robots[0] && robots[0].name) || 'Ari'}
          setView={setView} oweReplyMap={oweReplyMap}
          onOpenTask={(t)=>{ if (setFocusTaskId) setFocusTaskId(t.id); setView('tasks'); }}
          setTasks={setTasks}
          onClose={()=>setPlanOpen(false)}
        />
      )}
      {/* Pass 2 Batch C: Blocking onboarding modal for new users (and existing
          users on first run after this ships). Only mounts once user_settings
          has been fetched (avoids flashing the modal before we know). */}
      {dataLoaded && userSettings && userSettings.onboarding_complete === true && userSettings.first_look_done !== true && (
        <FirstLook userId={user.id} setView={setView}
          onDone={() => setUserSettings(u => ({ ...(u || {}), first_look_done: true }))} />
      )}
      {dataLoaded && userSettings && (userSettings.onboarding_complete === false || onboardingReopen) && (
        <OnboardingModal
          userId={user.id}
          userEmail={user.email}
          initial={onboardingReopen ? userSettings : null}
          onClose={onboardingReopen && userSettings.onboarding_complete !== false ? () => setOnboardingReopen(false) : undefined}
          onComplete={() => { setOnboardingReopen(false); loadData(); }}
        />
      )}
      {dataLoaded && user && userSettings && userSettings.onboarding_complete !== false && (
        <AnnouncementModal userId={user.id} />
      )}
      {sharedAudio && user && (
        <ShareRecordingModal
          file={sharedAudio}
          userId={user.id}
          contacts={contacts}
          onClose={(done) => { setSharedAudio(null); if (done) { try { loadData(); } catch (_) {} } }}
        />
      )}
    </div>
  );
}

export default function App() {
  const m = (typeof window !== 'undefined') && window.location.pathname.match(/^\/sign\/([A-Za-z0-9_-]+)/);
  if (m) return <SignPortal token={m[1]} />;
  return <AppMain />;
}

export { ActivityTimeline, AriRewriteButton, ForkTuningOverlay, PrismThinking, CallFollowupsPanel, ContactDetailModal, ContactPicker, ContactsView, DatePickerModal, DealsView, HeaderSearchIcon, HeaderSearchInput, Icon, MileageView, MultiValueField, NotesView, PropertyModal, QuoCallDetail, QuoTextModal, RecruitingKpiTile, RecruitingView, Tip, TipFor, SYSTEMS, SingleContactPicker, TaskModal, TrackerTaskModal, cadenceDue, confirmDialog, emailAssignTask, lbl, modal, money, notify, notifyError, num, pad2, pickerInitials, priorityClass, priorityLabel, quoCall, quoFmtDur, quoFmtPhone, quoFmtWhen, quoLast10, quoNormPhone, sortTasks, stageMeta, todayISO, today_ymd, useDictation, ymd };

