import React, { useState, useEffect, useCallback, useMemo, useRef, useContext } from 'react';
import { createPortal } from 'react-dom';
import { supabase, SUPABASE_URL, ensureFreshSession } from './dataService';
import { useConnectionHealth } from './connection';
import { useReturnBookmark } from './returnBookmark';
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
import useTapActivate from './useTapActivate';
import { TIPS_BY_SCREEN } from './tips';
import MindsetMenu from './views/MindsetMenu';
import { MODES, VIEW_TO_MODE, modeById } from './modes';
import { rememberRoomSpot, roomResumeSpot } from './roomResume';
import { PAGES, PAGE_GROUPS, pageVisible, roleAllows, makeEntitled, ALL_FEATURES } from './pages';
const CallDetail = lazyWithReload(() => import('./views/CallDetail'));
const UncardedView = lazyWithReload(() => import('./views/UncardedView'));
const LeadNotifyReview = lazyWithReload(() => import('./views/LeadNotifyReview'));
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
import { notify, notifyError, confirmDialog, subscribeToasts, subscribeConfirms } from './notify';
import { Tip } from './tipsUi';
import ChatView from './views/ChatView';
import { buildMenu } from './menuConfig';
import ScreenSwitcher from './views/ScreenSwitcher';
import GlobalSearch from './views/GlobalSearch';
import GestureHint from './views/GestureHint';
import NotYourView from './views/NotYourView';
import ViewLoadingFallback from './views/ViewLoadingFallback';
import { touchScreen, previousScreen } from './openScreens';
import { forkHandlers, attachTwoFingerFlip } from './flipGestures';
import { startOutboxWatcher, pruneDrafts } from './outbox';
import { syncTimezone } from './deviceTime';
import { MyNumbersView } from './views/MetricsPanels';
import { LockedPage, QuickLog } from './views/QuickLog';
import { ScoreboardView, PipelineView } from './views/ScoreboardView';
import { ContactPicker, emailAssignTask, HeaderSearchIcon, HeaderSearchInput, MultiValueField, RecruitingKpiTile, useDictation } from './views/SharedUi';
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

const FinanceView = lazyWithReload(() => import('./views/AccountingViews').then(m => ({ default: m.FinanceView })));
const TransactionPipeline = lazyWithReload(() => import('./views/TransactionPipeline'));
const InvestorPipeline = lazyWithReload(() => import('./views/InvestorPipeline'));
const UnstuckView = lazyWithReload(() => import('./views/UnstuckView'));
const TagsView = lazyWithReload(() => import('./views/TagsView'));
const CorrespondentView = lazyWithReload(() => import('./views/CorrespondentView'));
const InvestorTransition = lazyWithReload(() => import('./views/InvestorTransition'));
const AdoptionView = lazyWithReload(() => import('./views/AdoptionView'));
const ProspectingView = lazyWithReload(() => import('./views/ProspectingView'));
const QuarterlyTaxBanner = lazyWithReload(() => import('./views/QuarterlyTaxBanner'));
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
  // A node can be BOTH destination and parent (Ask Ari opens Ari AND holds Listing
  // Presentation): the label navigates, the chevron expands. navigate() closes the
  // menu, so firing both would make the children unreachable. Pure groups toggle.
  const navigable = built && leafView;
  const handleClick = () => {
    if (isAction) { node.action(); return; }
    if (navigable) { navigate(leafView, node.sub || null); return; }
    if (hasChildren) toggle(depth, node._key);
  };
  const toggleOpen = (e) => { e.stopPropagation(); toggle(depth, node._key); };
  const tap = useTapActivate(handleClick); const indent = 14;   // iOS first-tap fix
  return (
    <>
      <div className={'nav-item' + (active ? ' active' : '')}
        {...(clickable ? tap : {})}
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
  // THE ROOM IS STICKY. It was DERIVED from the current view, and VIEW_TO_MODE maps
  // each screen to the FIRST room that claims it — so an agent in Prospecting who
  // tapped a contact was silently moved to Nerve Center, because 'contacts' is
  // claimed by that room. The room did not vanish; it changed without being asked
  // to, which is worse, because the bar under their thumb quietly became a
  // different bar.
  //
  // Now the chosen room persists until the agent chooses another or goes Home,
  // exactly as a tab bar behaves: pushing a screen does not change your tab. When
  // the current screen is outside the room, the bar still shows the room and its
  // own name, so getting back is one tap and never ambiguous.
  //
  // Falls back to the derived room so arriving somewhere by deep-link or by the
  // menu still puts you in a sensible room rather than none.
  const [stickyMode, setStickyMode] = useState(null);
  const activeMode = view === 'dashboard' ? null : (stickyMode || VIEW_TO_MODE[view] || null);
  // Entering a room resumes where you left off IN THAT ROOM, but only within the
  // same day — the first visit each day opens the room's home screen (Nerve Center
  // opens on Contacts). A stale bookmark pointing at a screen that no longer
  // belongs to the room is ignored, so re-organising a room never strands anyone.
  const enterMode = (modeId) => {
    if (modeId === '__today__') { setStickyMode(null); setView('today'); return; }
    const m = modeById(modeId);
    if (!m) return;
    setStickyMode(modeId);
    const spot = m.resume ? roomResumeSpot(session?.user?.id, modeId, todayISO(), m.views) : null;
    if (spot) {
      setView(spot.view);
      if (spot.sub) setDeepLink(d => ({ view: spot.view, sub: spot.sub, n: d.n + 1 }));
      return;
    }
    setView(m.home);
  };
  const goHome = () => { setStickyMode(null); setView('today'); };   // Home leaves the room as well as the screen
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
  useReturnBookmark(view, mainScrollRef, viewRef);
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
    // Only bookmark screens that BELONG to the room. Now that the room is sticky,
    // an agent can be standing on a screen outside it — bookmarking that would
    // make re-entering the room open something it does not contain, which is the
    // stale-bookmark problem this resume logic already guards against on read.
    if (!m.views.includes(view)) return;
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

  // ── ALT-TAB switcher ──────────────────────────────────────────────────────
  // Declared HERE, after view/deepLink/sidebarOpen/mindsetOpen, deliberately:
  // everything below references those, and an earlier placement put them in the
  // temporal dead zone — the whole app failed to mount with "Cannot access before
  // initialization". esbuild builds that happily; only the boot check catches it.
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // True only for the session in which onboarding was just completed, so the
  // tour and any announcement stand down and the agent lands on their own data.
  const [justOnboarded, setJustOnboarded] = useState(false);
  const goToScreen = React.useCallback((sc) => {
    if (!sc) return;
    setView(sc.view);
    if (sc.sub) setDeepLink(d => ({ view: sc.view, sub: sc.sub, n: d.n + 1 }));
  }, []);
  const flipBack = React.useCallback(() => {
    goToScreen(previousScreen(session?.user?.id, view, null));
  }, [goToScreen, session, view]);
  // Two-finger tap anywhere -> flip. NOT double-tap-anywhere: on iOS that is zoom
  // outside touch-action:manipulation, and select-a-word inside every text field.
  React.useEffect(() => attachTwoFingerFlip(flipBack), [flipBack]);

  // Stored timezone follows the DEVICE — see src/deviceTime.js for why display and
  // scheduling need different treatment.
  React.useEffect(() => {
    const uid = session?.user?.id;
    if (!uid || !userSettings) return;
    syncTimezone(uid, userSettings.timezone).then((moved) => {
      if (!moved) return;
      setUserSettings(u => ({ ...(u || {}), timezone: moved.to }));
      if (window.__notify) window.__notify('Times now follow ' + moved.to.split('/').pop().replace(/_/g, ' ') + '.', 'info');
    });
  }, [session, userSettings?.timezone]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Drain anything captured while the signal was bad. Runs on reconnect, on
  // foreground, and once a minute — the user never presses anything, because a
  // retry the user has to trigger is a retry that does not happen.
  React.useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return;
    pruneDrafts();
    return startOutboxWatcher({
      voice_note: async (payload) => {
        const { data, error } = await supabase.functions.invoke('voice-note', { body: payload });
        // THROW to keep it queued. Returning quietly would delete the recording,
        // which is the exact loss this exists to prevent.
        if (error || data?.error) throw new Error(data?.error || error?.message || 'send failed');
      },
    }, uid);
  }, [session]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Remember the screen we are on so the switcher has something to flip to.
  React.useEffect(() => {
    const uid = session?.user?.id; if (!uid || !view) return;
    touchScreen(uid, view, null, { label: (PAGES[view] && PAGES[view].label) || view });
  }, [view, session]);
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
    // Lets a component deep-link a view WITH a filter (Morning Brief -> contacts:owe).
    window.__deepLink = (d) => { try { if (d && d.view) setDeepLink({ view: d.view, sub: d.sub || null, n: d.n || Date.now() }); } catch (_) {} };
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
  // Admin comes from agents.role via app-whoami, never from an email address.
  // Until it loads, assume NOT admin: showing admin controls to someone who turns
  // out not to be one is worse than a second of missing buttons, and the old
  // email fallback meant Josh and Alex — both broker_admin in the database — were
  // denied admin in the app purely because they are not Dara.
  const isAdmin = !!(appCtx && appCtx.is_admin);
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
  const builtSet = new Set([...NAV.map(i => i.id), 'disc_test', 'disc_roster', 'myvoice', 'voice_roster', 'google_contacts', 'cadence_review', 'uncarded', 'lead_notify', 'unstuck', 'tags', 'correspondent', 'investor_transition', 'my_prism', 'production', 'transactions']);
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
  const MENU = buildMenu({ isAdmin, isTeamLeader, brokerageGroup, teamGroup, setSidebarOpen, enterMode });
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
        <div className="mobile-header-logo" {...forkHandlers({ onFlip: flipBack, onSwitcher: () => setSwitcherOpen(true), onMenu: () => setSidebarOpen(true) })} style={{cursor:"pointer",touchAction:"manipulation"}} role="button" aria-label="Menu — double-tap to flip back, hold to switch"><svg className="mh-fork" width="27" height="30" viewBox="0 0 40 40" fill="none" aria-hidden="true"><g className="mh-fork-wave mh-fork-w2" stroke="#EBCB82" strokeWidth="1.2" strokeLinecap="round" fill="none"><path d="M31 8 Q37 17 31 26"/><path d="M9 8 Q3 17 9 26"/></g><g className="mh-fork-wave mh-fork-w1" stroke="#EBCB82" strokeWidth="1.3" strokeLinecap="round" fill="none"><path d="M28 11 Q32 17 28 23"/><path d="M12 11 Q8 17 12 23"/></g><g stroke="#CBA35C" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" fill="none"><path d="M15 6 V21"/><path d="M25 6 V21"/><path d="M15 21 C15 26 17 28 20 28 C23 28 25 26 25 21"/><path d="M20 28 V36"/></g><circle cx="20" cy="37.4" r="1.9" fill="#CBA35C"/></svg><span className="mh-divider"></span><div className="mh-text"><span className="rog-wordmark"><span className="rog-realty">REALTY</span><span className="rog-one">ONE</span><span className="rog-group">GROUP</span><span className="rog-adv">Advantage</span></span><span className="rog-sub"><span className="rog-pb">powered by </span><PrismMark /></span></div></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
          {/* The header magnifier now searches EVERYTHING, not just the Library.
              A magnifier in a header is the most conventional control in software
              and every user expects it to search the whole app; scoping it to one
              screen meant an agent who remembered a client's name but not whether
              they wanted a note, a task or the contact had to search four screens
              in turn. Library search is still on the Library screen. */}
          <button className="hamburger" onClick={() => setSearchOpen(true)} aria-label="Search everything" title="Search everything">
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
          <style>{`.main-content.ww-prism{background:radial-gradient(ellipse 130% 46% at 88% 0%, var(--room-accent-26, transparent), transparent 64%), radial-gradient(ellipse 120% 34% at 8% 100%, var(--room-accent-08, transparent), transparent 66%), radial-gradient(120% 20% at 50% -2%, rgba(203,163,92,.09), transparent 55%), #100D09;} .ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h1,.ww-prism h2,.ww-prism h3{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .btn-add-circle{background:#EBCB82;color:#1a1409;} .ww-prism .form-input,.ww-prism .form-select,.ww-prism .form-textarea{background:#1B1610;border:1px solid rgba(203,163,92,.22);color:#F6F1E7;} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;} .ww-prism .seg-btn.active{background:linear-gradient(180deg,#EBCB82,#CBA35C)!important;color:#1a1409!important;}`}</style>
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
              : view==='tags' ? <TagsView isAdmin={isAdmin} />
              : view==='correspondent' ? <CorrespondentView userId={user.id} />
              : view==='investor_transition' ? <InvestorTransition userId={user.id} />
              : view==='prospecting' ? <ProspectingView userId={user.id} initialSub={deepLink.view==='prospecting'?deepLink.sub:null} subNonce={deepLink.n} barDriven={activeMode==='prospect' && dataLoaded}/>
              : view==='tasks'       ? <div className="ww-tasks"><style>{`.ww-tasks{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 30% at 50% -6%, rgba(203,163,92,.09), transparent 60%), #100D09;min-height:100%;} .ww-tasks .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-tasks .view-header h2,.ww-tasks .page-header h2{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;font-size:30px;} .ww-tasks .panel-header h3{font-family:'Fraunces',serif;font-weight:400;letter-spacing:-.01em;color:#F6F1E7;} .ww-tasks .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-tasks .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-tasks .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-tasks .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-tasks .btn-add-circle{background:#EBCB82;color:#1a1409;} .ww-tasks .btn-view-toggle{border:1px solid rgba(203,163,92,.28);color:#C8BFAE;} .ww-tasks .btn-view-toggle.active{background:rgba(203,163,92,.16);color:#EBCB82;border-color:#CBA35C;} .ww-tasks .task-item{border-color:rgba(203,163,92,.14);} .ww-tasks .task-text{color:#F6F1E7;} .ww-tasks .empty-state{color:#8C8475;} .ww-tasks .empty-icon{color:#CBA35C;}`}</style><TasksView tasks={tasks} setTasks={setTasks} userId={user.id} defaultSystem={priorityPref} taskFilter={taskFilter} setTaskFilter={onTaskFilterChange} taskViewMode={taskViewMode} setTaskViewMode={onTaskViewModeChange} brain={brain} contacts={contacts} properties={properties} events={events} focusTaskId={focusTaskId} setFocusTaskId={setFocusTaskId}/>{taskViewMode !== 'matrix' && <><ProjectTasksPanel userId={user.id}/><EmailRepliesPanel/></>}</div>
              : view==='uncarded' ? <UncardedView setView={setView}/>
              : view==='lead_notify' ? <LeadNotifyReview/>
              : view==='email_review' ? <EmailReviewView userId={user.id} emailAccounts={emailAccounts} contacts={contacts} setView={setView} onCount={setNeedsReviewCount}/>
              : view==='inbox'       ? <div className="ww-prism"><style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 30% at 50% -6%, rgba(203,163,92,.09), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h2{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel-header h3,.ww-prism h3.mv-h2{font-family:'Fraunces',serif;font-weight:400;color:#F6F1E7;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .btn-add-circle{background:#EBCB82;color:#1a1409;} .ww-prism .btn-view-toggle{border:1px solid rgba(203,163,92,.28);color:#C8BFAE;} .ww-prism .btn-view-toggle.active{background:rgba(203,163,92,.16);color:#EBCB82;border-color:#CBA35C;} .ww-prism .task-item{border-color:rgba(203,163,92,.14);} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style><InboxView emailAccounts={emailAccounts} setEmailAccounts={setEmailAccounts} emailAliases={emailAliases} setEmailAliases={setEmailAliases} profiles={profiles} contacts={contacts} userId={user.id} setView={setView} reloadData={loadData} defaultSystem={priorityPref}/></div>
              : view==='quo'         ? <div className="ww-prism"><style>{`.ww-prism{--bg-base:#100D09;--bg-card:#1B1610;--bg-hover:#221B10;--border:rgba(203,163,92,.20);--border-strong:rgba(203,163,92,.40);--accent:#CBA35C;--accent-2:#EBCB82;--accent-dim:rgba(203,163,92,.45);--accent-glow:rgba(203,163,92,.14);--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 30% at 50% -6%, rgba(203,163,92,.09), transparent 60%), #100D09;min-height:100%;} .ww-prism .ww-eyebrow{font-size:10.5px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;} .ww-prism h2{font-family:'Fraunces',serif;font-weight:300;letter-spacing:-.02em;} .ww-prism .panel-header h3,.ww-prism h3.mv-h2{font-family:'Fraunces',serif;font-weight:400;color:#F6F1E7;} .ww-prism .panel{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:16px;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.30);color:#C8BFAE;} .ww-prism .btn-ghost:hover{border-color:#CBA35C;color:#EBCB82;} .ww-prism .btn-add-circle{background:#EBCB82;color:#1a1409;} .ww-prism .btn-view-toggle{border:1px solid rgba(203,163,92,.28);color:#C8BFAE;} .ww-prism .btn-view-toggle.active{background:rgba(203,163,92,.16);color:#EBCB82;border-color:#CBA35C;} .ww-prism .task-item{border-color:rgba(203,163,92,.14);} .ww-prism .empty-state{color:#8C8475;} .ww-prism .empty-icon{color:#CBA35C;}`}</style><QuoView contacts={contacts} userId={user.id} profiles={profiles} defaultSystem={priorityPref}/></div>
              : view==='contacts'    ? <ContactsView initialSub={deepLink.view==='contacts' ? deepLink.sub : null} contacts={contacts} setContacts={setContacts} userId={user.id} profiles={profiles} setProfiles={setProfiles} canSeeRestricted={isAdmin || !!(appCtx&&appCtx.is_team_leader) || (appCtx&&appCtx.role==='owner')}/>
              : view==='recruiting'  ? <RecruitingView contacts={contacts} setContacts={setContacts} userId={user.id}/>
              : view==='deals'       ? <DealsView deals={deals} setDeals={setDeals} contacts={contacts} setContacts={setContacts} properties={properties} userId={user.id}/>
              : view==='files'       ? <FilesView files={files} setFiles={setFiles} contacts={contacts} setContacts={setContacts} properties={properties} userId={user.id} user={user} isAdmin={isAdmin}/>
              : view==='team'        ? <TeamView/>
              : view==='contact_types' ? <ContactTypesAdmin isPrivileged={isAdmin || !!(appCtx&&appCtx.is_team_leader) || (appCtx&&appCtx.role==='owner')}/>
              : view==='agents' ? ((isAdmin||isTeamLeader) ? <AgentsView userId={user.id} user={user} appCtx={appCtx} isAdmin={isAdmin}/> : <NotYourView setView={setView} what="The agent roster" />)
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
      {/* ONE INTERSTITIAL BEFORE FIRST VALUE, NOT FOUR. A new agent met onboarding,
          FirstLook, an announcement and the room picker before seeing a row of
          their own data. The tour now waits for the SECOND session, when they have
          a reason to care what it is showing them. */}
      {dataLoaded && userSettings && userSettings.onboarding_complete === true
        && userSettings.first_look_done !== true && !justOnboarded && (
        <FirstLook userId={user.id} setView={setView}
          onDone={() => setUserSettings(u => ({ ...(u || {}), first_look_done: true }))} />
      )}
      {dataLoaded && userSettings && (userSettings.onboarding_complete === false || onboardingReopen) && (
        <OnboardingModal
          userId={user.id}
          userEmail={user.email}
          initial={onboardingReopen ? userSettings : null}
          onClose={onboardingReopen && userSettings.onboarding_complete !== false ? () => setOnboardingReopen(false) : undefined}
          onComplete={() => { setOnboardingReopen(false); setJustOnboarded(true); loadData(); }}
        />
      )}
      {/* An announcement is never why someone opened the app. Held back on the
          first session; it will be waiting next time. */}
      {dataLoaded && user && userSettings && userSettings.onboarding_complete !== false && !justOnboarded && (
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
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)}
        onPick={(hit) => {
          setSearchOpen(false);
          if (hit.contactId) setDeepLink({ view: 'contacts', sub: hit.contactId, n: Date.now() });
          else if (hit.noteId) setDeepLink({ view: 'notes', sub: hit.noteId, n: Date.now() });
          setView(hit.view);
        }} />
      {/* Gestures have no affordance, so the flip nobody discovers is the same as
          a flip nobody built. Shown once, after three screens. */}
      <GestureHint />
      {switcherOpen && (
        <ScreenSwitcher userId={session?.user?.id} currentView={view} currentSub={null}
          onPick={(sc) => { setSwitcherOpen(false); goToScreen(sc); }}
          onClose={() => setSwitcherOpen(false)} />
      )}
    </div>
  );
}

export default function App() {
  const m = (typeof window !== 'undefined') && window.location.pathname.match(/^\/sign\/([A-Za-z0-9_-]+)/);
  if (m) return <SignPortal token={m[1]} />;
  return <AppMain />;
}

// The barrel re-export that used to live here is gone. App.js is the composition
// root: it imports from feature modules and is imported by NOBODY. Sixteen views
// used to reach back into it via '../App', which made the dependency graph a cycle
// rather than a tree. If a view needs something shared, it belongs in a shared
// module (src/views/SharedUi.jsx, src/uiPrimitives.jsx, src/helpers.js), not here.

