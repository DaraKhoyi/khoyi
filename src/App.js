import React, { useState, useEffect, useCallback, useMemo, useRef, useContext } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from './dataService';
import { BUILD_VERSION } from './version';
import './index.css';

// Touch BUILD_VERSION so webpack includes it (changes bundle hash on every version bump)
if (typeof window !== 'undefined') window.__BUILD_VERSION__ = BUILD_VERSION;

// Contact segment types. Order = display order in dropdowns and filter pills.
// "All" is a UI-only filter sentinel; it isn't stored.
const CONTACT_TYPES = [
  { id: 'attorney',           label: 'Attorney',           icon: '⚖️' },
  { id: 'broker',             label: 'Broker',             icon: '🧑‍💼' },
  { id: 'brokerage',          label: 'Brokerage',          icon: '🏢' },
  { id: 'builder',            label: 'Builder',            icon: '🔨' },
  { id: 'client_commercial',  label: 'Client – Commercial', icon: '🏬' },
  { id: 'client_residential', label: 'Client – Residential', icon: '🏠' },
  { id: 'commercial_tenant',  label: 'Commercial Tenant',  icon: '🏪' },
  { id: 'contractor',         label: 'Contractor',         icon: '🛠️' },
  { id: 'developer',          label: 'Developer',          icon: '🏗️' },
  { id: 'doctor',             label: 'Doctor',             icon: '🩺' },
  { id: 'family',             label: 'Family',             icon: '👨‍👩‍👧' },
  { id: 'flipper',            label: 'Flipper',            icon: '🔄' },
  { id: 'investments',        label: 'Investments',        icon: '💰' },
  { id: 'lender',             label: 'Lender',             icon: '🏦' },
  { id: 'our_agent',          label: 'Our Agent',          icon: '🌟' },
  { id: 'personal',           label: 'Personal',           icon: '💛' },
  { id: 'prospect_agent',     label: 'Prospect Agent',     icon: '🎣' },
  { id: 'regulator',          label: 'Regulator',          icon: '📋' },
  // Legacy / catchall last
  { id: 'client',             label: 'Client (legacy)',    icon: '🤝' },
  { id: 'lead',               label: 'Lead',               icon: '🌱' },
  { id: 'agent',              label: 'Agent (legacy)',     icon: '🧑‍💼' },
  { id: 'recruit',            label: 'Recruit',            icon: '🎯' },
  { id: 'partner',            label: 'Partner',            icon: '🤲' },
  { id: 'vendor',             label: 'Vendor',             icon: '🔧' },
  { id: 'misc',                label: 'Misc',              icon: '🗂️' },
  { id: 'other',              label: 'Other',              icon: '❓' },
];
const CONTACT_TYPE_LABELS = Object.fromEntries(CONTACT_TYPES.map(t => [t.id, t.label]));

// ─────────────────────────────────────────
// AUTH SCREEN
// ─────────────────────────────────────────
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
          <h1><span>Prism</span></h1>
          <p>Your personal operating system</p>
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
function OnboardingModal({ userId, userEmail, onComplete }) {
  const [displayName, setDisplayName] = useState('');
  const [profession, setProfession] = useState('');
  const [timezone, setTimezone] = useState(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }
    catch (_) { return ''; }
  });
  const [assistantContext, setAssistantContext] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Block ESC dismissal.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') e.preventDefault(); };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!displayName.trim()) { setError('Please enter your name.'); return; }
    setSaving(true);
    const payload = {
      user_id: userId,
      display_name: displayName.trim(),
      profession: profession.trim() || null,
      timezone: timezone.trim() || null,
      assistant_context: assistantContext.trim() || null,
      onboarding_complete: true,
      updated_at: new Date().toISOString(),
    };
    const { error: upErr } = await supabase.from('user_settings').upsert(payload, { onConflict: 'user_id' });
    if (upErr) {
      setSaving(false);
      setError(upErr.message || 'Could not save. Please try again.');
      return;
    }
    // Also update the user's robot system prompt to include their context so
    // chat replies are personalized from message #1.
    if (assistantContext.trim() || profession.trim() || displayName.trim()) {
      try {
        const contextLine = [
          displayName.trim() ? `The user's name is ${displayName.trim()}.` : null,
          profession.trim() ? `Their role: ${profession.trim()}.` : null,
          assistantContext.trim() ? `About them: ${assistantContext.trim()}` : null,
        ].filter(Boolean).join(' ');
        const newPrompt = `You are Ari, a sharp, friendly personal AI assistant. ${contextLine} You help with tasks, decisions, scheduling, writing, and anything else they need. Be direct, warm, and genuinely useful. Keep responses concise unless depth is needed. You are always on their side.`;
        await supabase.from('robots').update({ system_prompt: newPrompt }).eq('user_id', userId);
      } catch (_) { /* non-fatal — base prompt still works */ }
    }
    setSaving(false);
    onComplete();
  }

  return (
    <div className="modal-overlay" style={{zIndex: 2000, padding: '16px'}}>
      <div className="modal" style={{maxWidth: '520px', width: '100%', maxHeight: '92vh', overflowY: 'auto'}}>
        <div className="modal-header" style={{borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '16px'}}>
          <div>
            <h2 style={{margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--text-1)'}}>Welcome to Prism</h2>
            <p style={{margin: '4px 0 0', fontSize: '13px', color: 'var(--text-2)'}}>
              A few quick things so we can set up your workspace and personalize your assistant.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Your name <span style={{color: 'var(--red)'}}>*</span></label>
            <input
              className="form-input"
              type="text"
              autoFocus
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="What should we call you?"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">What do you do?</label>
            <input
              className="form-input"
              type="text"
              value={profession}
              onChange={e => setProfession(e.target.value)}
              placeholder="e.g. Real estate broker, Doctor, Engineer, Designer"
            />
            <p style={{margin: '4px 0 0', fontSize: '11px', color: 'var(--text-3)'}}>
              Helps your AI assistant calibrate what's important and what's urgent for you.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Timezone</label>
            <input
              className="form-input"
              type="text"
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              placeholder="e.g. America/New_York"
            />
            <p style={{margin: '4px 0 0', fontSize: '11px', color: 'var(--text-3)'}}>
              Auto-detected from your browser. Edit if it's wrong.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">Tell your assistant about you</label>
            <textarea
              className="form-input"
              rows={5}
              value={assistantContext}
              onChange={e => setAssistantContext(e.target.value)}
              placeholder="A few sentences about your work, priorities, who you serve, what matters. Your AI assistant uses this to tailor every response."
              style={{resize: 'vertical', fontFamily: 'inherit', minHeight: '110px'}}
            />
            <p style={{margin: '4px 0 0', fontSize: '11px', color: 'var(--text-3)'}}>
              Optional — but the more context, the better the assistance. You can edit this anytime in Settings.
            </p>
          </div>

          {error && (
            <div style={{padding: '10px 12px', background: 'rgba(239,68,68,0.12)', border: '1px solid var(--red)', borderRadius: '6px', color: 'var(--red)', fontSize: '13px', marginBottom: '12px'}}>
              {error}
            </div>
          )}

          <div className="modal-actions" style={{display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px'}}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Finish setup'}
            </button>
          </div>
        </form>

        <p style={{margin: '14px 0 0', fontSize: '11px', color: 'var(--text-3)', textAlign: 'center'}}>
          Signed in as {userEmail}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// CHAT VIEW
// ─────────────────────────────────────────
function ChatView({ robots, userId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const robot = robots[0] || null;
  const robotId = robot?.id;

  // Load conversation history
  useEffect(() => {
    if (!robotId || !userId) { setLoadingHistory(false); return; }
    supabase
      .from('robot_conversations')
      .select('messages')
      .eq('user_id', userId)
      .eq('robot_id', robotId)
      .maybeSingle()
      .then(({ data }) => {
        const entries = Array.isArray(data?.messages) ? data.messages : [];
        const flat = [];
        for (const e of entries) {
          if (e.user_message) flat.push({ role: 'user', content: e.user_message });
          if (e.assistant_response) flat.push({ role: 'assistant', content: e.assistant_response });
        }
        setMessages(flat);
        setLoadingHistory(false);
      });
  }, [robotId, userId]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const send = useCallback(async () => {
    if (!input.trim() || sending || !robot) return;
    const text = input.trim();
    const userMsg = { role: 'user', content: text };
    const optimistic = [...messages, userMsg];
    setMessages(optimistic);
    setInput('');
    setSending(true);

    // Keep focus on input after sending
    setTimeout(() => inputRef.current?.focus(), 50);

    const history = optimistic.slice(-21, -1).map(m => ({ role: m.role, content: m.content }));

    try {
      const { data, error } = await supabase.functions.invoke('robot-chat', {
        body: { robot_id: robot.id, user_id: userId, message: text, history },
      });
      if (error) throw error;
      const reply = data?.response || data?.reply || data?.content || '';
      if (reply) {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last?.content === reply) return prev;
          return [...prev, { role: 'assistant', content: reply }];
        });
      } else if (data?.error) {
        setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ ${data.error}` }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Connection error: ${err.message || err}` }]);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, sending, robot, messages, userId]);

  // Handle Enter key — shift+enter = newline, enter = send
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);

  // Auto-grow textarea
  const handleInput = useCallback((e) => {
    const ta = e.target;
    setInput(ta.value);
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }, []);

  if (!robot) {
    return (
      <div>
        <div className="page-header"><h2>AI Assistant</h2><p>No assistant found</p></div>
        <div className="empty-state"><div className="empty-icon">🤖</div><p>No robots configured yet.</p></div>
      </div>
    );
  }

  return (
    <div className="chat-wrap">
      {/* Robot header */}
      <div className="chat-robot-header">
        <div className="chat-robot-avatar">{robot.avatar_emoji || '🤖'}</div>
        <div>
          <div className="chat-robot-name">{robot.name}</div>
          <div className="chat-robot-role">{robot.role}</div>
        </div>
        <div className="online-dot" title="Online" />
      </div>

      {/* Messages */}
      <div className="chat-messages" ref={scrollRef}>
        {loadingHistory ? (
          <div className="chat-empty"><div className="spinner" style={{margin:'0 auto'}} /></div>
        ) : messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">{robot.avatar_emoji || '🤖'}</div>
            <h3>Hey, I'm {robot.name}</h3>
            <p>{robot.role}<br/>What can I help you with today?</p>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`chat-bubble-wrap ${m.role}`}>
              <div className={`chat-bubble ${m.role}`}>{m.content}</div>
            </div>
          ))
        )}
        {sending && (
          <div className="chat-bubble-wrap assistant">
            <div className="chat-bubble assistant">
              <div className="chat-typing">
                <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="chat-input-bar">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={`Message ${robot.name}…`}
          rows={1}
          disabled={sending}
        />
        <button
          className="chat-send-btn"
          onClick={send}
          disabled={!input.trim() || sending}
          aria-label="Send"
        >
          ➤
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// EISENHOWER PRIORITY HELPERS
// ─────────────────────────────────────────
// A = Q1 Urgent & Important   B = Q2 Important, Not Urgent
// C = Q3 Urgent, Not Important D = Q4 Neither
const QUADRANTS = [
  { letter:'A', label:'A — Urgent & Important',     short:'Do now' },
  { letter:'B', label:'B — Important, Not Urgent',  short:'Schedule' },
  { letter:'C', label:'C — Urgent, Not Important',  short:'Delegate' },
  { letter:'D', label:'D — Neither',                short:'Drop' },
];
const QUADS = ['A', 'B', 'C', 'D'];
// Sort key for Eisenhower: A1 < A2 < B1 < ... Simple-system tasks sort after
// using high(0)/medium(1)/low(2) and their simple_rank. Tasks with no priority info sort last.
function taskSortKey(t) {
  if (t.priority_system === 'eisenhower' && t.eisenhower_quadrant) {
    const qIdx = { A:0, B:1, C:2, D:3 }[t.eisenhower_quadrant] ?? 4;
    return [0, qIdx, t.eisenhower_rank ?? 999];
  }
  const pIdx = { high:0, medium:1, low:2 }[t.priority] ?? 3;
  return [1, pIdx, t.simple_rank ?? 999];
}
function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const ka = taskSortKey(a), kb = taskSortKey(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    return 0;
  });
}
function priorityLabel(t) {
  if (t.priority_system === 'eisenhower' && t.eisenhower_quadrant) {
    return `${t.eisenhower_quadrant}${t.eisenhower_rank ?? ''}`;
  }
  return t.priority || '';
}
function priorityClass(t) {
  if (t.priority_system === 'eisenhower' && t.eisenhower_quadrant) {
    return `priority-${t.eisenhower_quadrant}`;
  }
  return `priority-${t.priority || 'medium'}`;
}
// "Top priority" = anything in quadrant A OR simple-system high
function isTopPriority(t) {
  if (t.priority_system === 'eisenhower') return t.eisenhower_quadrant === 'A';
  return t.priority === 'high';
}
// Date helpers (local-time YYYY-MM-DD comparison)
function todayISO() {
  const d = new Date();
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function addDaysISO(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
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
// TASK MODAL
// ─────────────────────────────────────────
function TaskModal({ onClose, onSave, initial, defaultSystem, brain, contacts = [], properties = [], events = [], userId }) {
  const initialSystem = initial?.priority_system || defaultSystem || 'eisenhower';
  const [title, setTitle] = useState(initial?.title || '');
  const [system, setSystem] = useState(initialSystem);
  const [priority, setPriority] = useState(initial?.priority || 'medium');
  const [quadrant, setQuadrant] = useState(initial?.eisenhower_quadrant || 'A');
  const [rank, setRank] = useState(initial?.eisenhower_rank ?? 1);
  const [due_date, setDueDate] = useState(initial?.due_date || '');
  const [notes, setNotes] = useState(initial?.notes || '');
  const [brainEntryId, setBrainEntryId] = useState(initial?.brain_entry_id || '');
  const [propertyId, setPropertyId] = useState(initial?.property_id || '');
  const [recurring, setRecurring] = useState(
    initial?.recurring_config?.interval || 'none'
  );
  // Linked contacts (many-to-many via task_contacts)
  const [contactIds, setContactIds] = useState([]);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [contactQuery, setContactQuery] = useState('');

  // Load existing contact links when editing
  useEffect(() => {
    if (!initial?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('task_contacts')
        .select('contact_id').eq('task_id', initial.id);
      if (!cancelled && data) setContactIds(data.map(r => r.contact_id));
    })();
    return () => { cancelled = true; };
  }, [initial?.id]);

  const linkedContacts = contactIds.map(id => contacts.find(c => c.id === id)).filter(Boolean);
  const filteredContactOptions = (() => {
    const q = contactQuery.trim().toLowerCase();
    const base = contacts.filter(c => !contactIds.includes(c.id));
    if (!q) return base.slice(0, 20);
    return base.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.company || '').toLowerCase().includes(q)
    ).slice(0, 20);
  })();

  // AI quadrant suggestion
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState(null);

  async function suggestQuadrant() {
    if (!title.trim()) return;
    setSuggesting(true);
    setSuggestion(null);
    try {
      const { data, error } = await supabase.functions.invoke('task-quadrant-suggest', {
        body: { title: title.trim(), notes: notes.trim() || null, due_date: due_date || null }
      });
      if (error || data?.error) {
        setSuggestion({ error: error?.message || data?.error });
      } else {
        setSuggestion(data);
        if (system === 'eisenhower' && data.quadrant) {
          setQuadrant(data.quadrant);
        } else {
          // Translate quadrant to simple priority
          const map = { A: 'high', B: 'medium', C: 'medium', D: 'low' };
          if (data.quadrant) setPriority(map[data.quadrant]);
        }
      }
    } catch (e) {
      setSuggestion({ error: e.message });
    } finally {
      setSuggesting(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const recurring_config = recurring === 'none' ? null : { interval: recurring };
    const base = {
      title: title.trim(),
      due_date: due_date || null,
      notes: notes.trim(),
      priority_system: system,
      brain_entry_id: brainEntryId || null,
      property_id: propertyId || null,
      recurring_config,
      recurring: recurring === 'none' ? null : recurring,  // legacy text column
    };
    if (system === 'eisenhower') {
      const r = Math.max(1, parseInt(rank, 10) || 1);
      onSave({ ...base, priority: 'medium', eisenhower_quadrant: quadrant, eisenhower_rank: r, _contact_ids: contactIds });
    } else {
      onSave({ ...base, priority, eisenhower_quadrant: null, eisenhower_rank: null, _contact_ids: contactIds });
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>{initial ? 'Edit Task' : 'New Task'}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label className="form-label">Task</label><input className="form-input" value={title} onChange={e=>setTitle(e.target.value)} placeholder="What needs to get done?" autoFocus required /></div>
          <div className="form-group">
            <label className="form-label">Priority System</label>
            <div style={{display:'flex',gap:'6px'}}>
              <button type="button" className={`btn btn-sm ${system==='eisenhower'?'btn-primary':'btn-ghost'}`} onClick={()=>setSystem('eisenhower')}>Eisenhower (A1, B2…)</button>
              <button type="button" className={`btn btn-sm ${system==='simple'?'btn-primary':'btn-ghost'}`} onClick={()=>setSystem('simple')}>Simple (High/Med/Low)</button>
            </div>
          </div>
          {system === 'eisenhower' ? (
            <div className="form-row">
              <div className="form-group" style={{flex:2}}>
                <label className="form-label" style={{display:'flex',alignItems:'center',gap:'8px',justifyContent:'space-between'}}>
                  <span>Quadrant</span>
                  <button
                    type="button"
                    onClick={suggestQuadrant}
                    disabled={!title.trim() || suggesting}
                    className="btn btn-sm btn-ghost"
                    style={{padding:'2px 8px',fontSize:'10px',color:'var(--accent)',border:'1px solid var(--accent-dim)'}}
                    title="Ask Claude to suggest the right quadrant"
                  >
                    {suggesting ? '…thinking' : '✨ Suggest'}
                  </button>
                </label>
                <select className="form-select" value={quadrant} onChange={e=>setQuadrant(e.target.value)}>
                  {QUADRANTS.map(q => <option key={q.letter} value={q.letter}>{q.label} · {q.short}</option>)}
                </select>
              </div>
              <div className="form-group" style={{flex:1}}>
                <label className="form-label">Rank</label>
                <input className="form-input" type="number" min="1" value={rank} onChange={e=>setRank(e.target.value)} />
              </div>
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label" style={{display:'flex',alignItems:'center',gap:'8px',justifyContent:'space-between'}}>
                <span>Priority</span>
                <button
                  type="button"
                  onClick={suggestQuadrant}
                  disabled={!title.trim() || suggesting}
                  className="btn btn-sm btn-ghost"
                  style={{padding:'2px 8px',fontSize:'10px',color:'var(--accent)',border:'1px solid var(--accent-dim)'}}
                  title="Ask Claude to suggest"
                >
                  {suggesting ? '…thinking' : '✨ Suggest'}
                </button>
              </label>
              <select className="form-select" value={priority} onChange={e=>setPriority(e.target.value)}>
                <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
            </div>
          )}
          {suggestion && !suggestion.error && (
            <div style={{padding:'8px 12px',background:'var(--accent-glow)',border:'1px solid var(--accent-dim)',borderRadius:'6px',marginBottom:'10px',fontSize:'12px'}}>
              <div style={{color:'var(--accent)',fontWeight:600,marginBottom:'2px'}}>✨ Claude suggests <strong>{suggestion.quadrant}</strong> · confidence {Math.round((suggestion.confidence||0)*100)}%</div>
              <div style={{color:'var(--text-2)',lineHeight:1.4}}>{suggestion.reasoning}</div>
            </div>
          )}
          {suggestion?.error && (
            <div style={{padding:'8px 12px',background:'rgba(239,68,68,0.1)',border:'1px solid #ef4444',borderRadius:'6px',marginBottom:'10px',fontSize:'12px',color:'#ef4444'}}>
              Suggest failed: {suggestion.error}
            </div>
          )}
          <div className="form-row">
            <div className="form-group" style={{flex:1}}>
              <label className="form-label" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span>Due Date {!due_date && <span style={{color:'var(--text-3)',fontSize:'10px',fontWeight:400}}>· Someday/Maybe (no date)</span>}</span>
                {due_date && (
                  <button type="button" onClick={() => setDueDate('')}
                    style={{background:'none',border:'none',color:'var(--text-3)',fontSize:'10px',cursor:'pointer',textTransform:'uppercase',letterSpacing:'0.03em',padding:0}}>
                    × Clear
                  </button>
                )}
              </label>
              <input className="form-input" type="date" value={due_date} onChange={e=>setDueDate(e.target.value)} />
            </div>
            <div className="form-group" style={{flex:1}}>
              <label className="form-label">Recurring</label>
              <select className="form-select" value={recurring} onChange={e=>setRecurring(e.target.value)}>
                <option value="none">No</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          </div>
          {brain && brain.length > 0 && (
            <div className="form-group">
              <label className="form-label">Brain context <span style={{color:'var(--text-3)',fontWeight:400,fontSize:'11px'}}>(link this task to a Brain entry — playbook, decision, memory)</span></label>
              <select className="form-select" value={brainEntryId} onChange={e=>setBrainEntryId(e.target.value)}>
                <option value="">— None —</option>
                {['playbook','decision','memory','soul','lesson','north-star'].map(type => {
                  const entries = brain.filter(b => b.type === type);
                  if (entries.length === 0) return null;
                  return (
                    <optgroup key={type} label={type.toUpperCase()}>
                      {entries.map(b => <option key={b.id} value={b.id}>{b.title.slice(0,70)}</option>)}
                    </optgroup>
                  );
                })}
              </select>
            </div>
          )}
          {properties && properties.length > 0 && (
            <div className="form-group">
              <label className="form-label">Property <span style={{color:'var(--text-3)',fontWeight:400,fontSize:'11px'}}>(if this task is about a specific property)</span></label>
              <select className="form-select" value={propertyId} onChange={e=>setPropertyId(e.target.value)}>
                <option value="">— None —</option>
                {['listing','investment','personal','rental'].map(cat => {
                  const items = properties.filter(p => p.category === cat);
                  if (items.length === 0) return null;
                  return (
                    <optgroup key={cat} label={cat.toUpperCase()}>
                      {items.map(p => <option key={p.id} value={p.id}>{p.nickname || p.address || '(unnamed)'}</option>)}
                    </optgroup>
                  );
                })}
                {(() => {
                  const known = new Set(['listing','investment','personal','rental']);
                  const other = properties.filter(p => !known.has(p.category));
                  if (other.length === 0) return null;
                  return (
                    <optgroup label="OTHER">
                      {other.map(p => <option key={p.id} value={p.id}>{p.nickname || p.address || '(unnamed)'}</option>)}
                    </optgroup>
                  );
                })()}
              </select>
            </div>
          )}
          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional details…" /></div>

          <div className="form-group">
            <label className="form-label">Linked contacts {linkedContacts.length > 0 && <span style={{color:'var(--text-3)',fontWeight:400}}>({linkedContacts.length})</span>}</label>
            <div style={{display:'flex',flexWrap:'wrap',gap:'6px',marginBottom:'6px',minHeight:'4px'}}>
              {linkedContacts.map(c => (
                <span key={c.id} style={{display:'inline-flex',alignItems:'center',gap:'4px',padding:'4px 10px',background:'rgba(197,169,94,0.12)',border:'1px solid var(--accent)',borderRadius:'12px',fontSize:'12px',color:'var(--text-1)'}}>
                  {c.name}
                  <button type="button" onClick={() => setContactIds(prev => prev.filter(id => id !== c.id))}
                    style={{background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',padding:'0 0 0 4px',fontSize:'14px',lineHeight:1}}>×</button>
                </span>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setContactPickerOpen(o => !o)} style={{fontSize:'11px',padding:'4px 10px'}}>
                {contactPickerOpen ? '× Close' : '+ Add contact'}
              </button>
            </div>
            {contactPickerOpen && (
              <div style={{border:'1px solid var(--border)',borderRadius:'8px',padding:'8px',background:'var(--bg-base)',maxHeight:'240px',display:'flex',flexDirection:'column'}}>
                <input className="form-input" autoFocus value={contactQuery} onChange={e=>setContactQuery(e.target.value)}
                  placeholder="Search by name, email, or company…" style={{margin:0,marginBottom:'6px',fontSize:'12px'}} />
                <div style={{overflowY:'auto',flex:1}}>
                  {filteredContactOptions.length === 0 && (
                    <div style={{padding:'12px',textAlign:'center',color:'var(--text-3)',fontSize:'11px'}}>
                      {contactQuery ? 'No matches.' : 'No contacts to add.'}
                    </div>
                  )}
                  {filteredContactOptions.map(c => (
                    <button key={c.id} type="button"
                      onClick={() => { setContactIds(prev => [...prev, c.id]); setContactQuery(''); }}
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
          {/* Pass 4 Finding #5: events linked to this task (read-only reverse view) */}
          {initial?.id && (() => {
            const linked = events.filter(e => e.task_id === initial.id);
            if (linked.length === 0) return null;
            return (
              <div className="form-group" style={{padding:'10px',background:'var(--bg-base)',borderRadius:'6px',border:'1px solid var(--border)'}}>
                <div style={{fontSize:'12px',fontWeight:600,color:'var(--text-2)',marginBottom:'6px'}}>📅 Linked events ({linked.length})</div>
                {linked.slice(0, 5).map(ev => (
                  <div key={ev.id} style={{padding:'4px 8px',fontSize:'11px',color:'var(--text-2)',display:'flex',justifyContent:'space-between',gap:'8px'}}>
                    <span>{ev.title}</span>
                    {ev.start_at && <span style={{color:'var(--text-3)',whiteSpace:'nowrap'}}>{new Date(ev.start_at).toLocaleDateString()}</span>}
                  </div>
                ))}
                {linked.length > 5 && <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'4px'}}>+ {linked.length - 5} more</div>}
              </div>
            );
          })()}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save Task</button>
          </div>
        </form>
      </div>
    </div>
  );
}

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

const __toastListeners = new Set();
function notify(message, kind = 'info') {
  __toastListeners.forEach(fn => { try { fn({ id: Date.now() + Math.random(), message, kind }); } catch (_) {} });
}
// Export to window so non-React code paths can call too (cron retry hooks, etc.)
if (typeof window !== 'undefined') {
  window.__notify = notify;
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
      }, t.kind === 'error' ? 6500 : 4000);
    }
    __toastListeners.add(onToast);
    return () => { __toastListeners.delete(onToast); };
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
          </div>
        );
      })}
    </div>,
    document.body
  );
}

const DragContext = React.createContext(null);

// Drag controller — provides startDrag, registerDropZone, and listens to
// global pointermove/pointerup. Wraps any subtree where drag should work.
function DragProvider({ onDragStart, onDragEnd, children }) {
  // activeDrag is set on drag-start and cleared on drag-end. It does NOT change
  // on every pointermove — that's the bug fix from Finding #7 (listener thrash).
  // Pointer coordinates live in a ref and update the floating-clone DOM directly.
  const [activeDrag, setActiveDrag] = useState(null);
  const cloneElRef = useRef(null);            // the floating clone <div> in document.body
  const pointerRef = useRef({ x: 0, y: 0 });  // live pointer position
  const dropZonesRef = useRef([]);            // [{ id, type, getRect, getElement, onDrop }]
  const hoveredZoneRef = useRef(null);

  const register = useCallback((spec) => {
    dropZonesRef.current.push(spec);
    return () => {
      dropZonesRef.current = dropZonesRef.current.filter(z => z.id !== spec.id);
    };
  }, []);

  // Begin a drag — called by a task row's anchor on first move past threshold
  const startDrag = useCallback((opts) => {
    pointerRef.current = { x: opts.clientX, y: opts.clientY };
    setActiveDrag(opts);
    if (onDragStart) onDragStart();
  }, [onDragStart]);

  // Floating clone — rendered ONCE per drag (activeDrag changes only on start/end).
  // Position updates happen via direct DOM manipulation in onMove → no re-renders.
  const floatingClone = activeDrag && createPortal(
    <div ref={(el) => { cloneElRef.current = el; if (el) {
      // Position immediately on mount so first frame is correct
      el.style.left = `${pointerRef.current.x - 40}px`;
      el.style.top  = `${pointerRef.current.y - 16}px`;
    }}}
      style={{
        position:'fixed',
        top: 0, left: 0,                        // overridden by direct DOM updates
        pointerEvents:'none',
        zIndex:99999,
        opacity:0.92,
        transform:'rotate(-1deg)',
        boxShadow:'0 8px 24px rgba(0,0,0,0.5)',
        willChange:'transform',
      }}>
      <div style={{
        display:'inline-flex', alignItems:'center', gap:'6px',
        padding:'6px 10px',
        background:'var(--bg-card)',
        border:`1px solid ${activeDrag.color || 'var(--accent)'}`,
        borderRadius:'6px',
        fontSize:'13px',
        color:'var(--text-1)',
        maxWidth:'70vw',
        whiteSpace:'nowrap',
        overflow:'hidden',
        textOverflow:'ellipsis',
      }}>
        <span style={{
          flexShrink:0,
          padding:'2px 7px',
          background: activeDrag.color || 'var(--accent)',
          color:'#fff',
          fontSize:'10px',
          fontWeight:900,
          borderRadius:'4px',
        }}>{activeDrag.label}</span>
        <span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{activeDrag.title}</span>
      </div>
    </div>,
    document.body
  );

  // Global pointermove + pointerup. Listeners attach ONCE when a drag starts
  // (activeDrag flips null → object) and detach ONCE when it ends — not on every
  // pointer move. Coordinates flow through pointerRef so React doesn't re-render
  // on every move.
  useEffect(() => {
    if (!activeDrag) return;
    function onMove(e) {
      const pt = e.touches ? e.touches[0] : e;
      pointerRef.current = { x: pt.clientX, y: pt.clientY };
      // Update the floating clone's position via direct DOM (no React re-render)
      const el = cloneElRef.current;
      if (el) {
        el.style.left = `${pt.clientX - 40}px`;
        el.style.top  = `${pt.clientY - 16}px`;
      }
      // Hit-test
      let hovered = null;
      for (const z of dropZonesRef.current) {
        const r = z.getRect();
        if (!r) continue;
        if (pt.clientX >= r.left && pt.clientX <= r.right && pt.clientY >= r.top && pt.clientY <= r.bottom) {
          hovered = z;
          // Zones win over quadrants if overlapping
          if (z.type === 'zone') break;
        }
      }
      hoveredZoneRef.current = hovered;
      // Highlight: write to DOM directly to avoid re-render storms
      dropZonesRef.current.forEach(z => {
        const zEl = z.getElement?.();
        if (!zEl) return;
        if (hovered && hovered.id === z.id) zEl.classList.add('drop-hover');
        else zEl.classList.remove('drop-hover');
      });
    }
    function onUp(e) {
      const pt = e.changedTouches ? e.changedTouches[0] : e;
      // Final hit-test
      let target = null;
      for (const z of dropZonesRef.current) {
        const r = z.getRect();
        if (!r) continue;
        if (pt.clientX >= r.left && pt.clientX <= r.right && pt.clientY >= r.top && pt.clientY <= r.bottom) {
          target = z;
          if (z.type === 'zone') break;
        }
      }
      // Clear highlights
      dropZonesRef.current.forEach(z => {
        const zEl = z.getElement?.();
        if (zEl) zEl.classList.remove('drop-hover');
      });
      if (target && target.onDrop) {
        try {
          target.onDrop(activeDrag, { clientX: pt.clientX, clientY: pt.clientY });
        } catch (err) {
          console.error('Drop handler failed:', err);
        }
      }
      setActiveDrag(null);
      if (onDragEnd) onDragEnd();
    }
    function onCancel() {
      dropZonesRef.current.forEach(z => {
        const zEl = z.getElement?.();
        if (zEl) zEl.classList.remove('drop-hover');
      });
      setActiveDrag(null);
      if (onDragEnd) onDragEnd();
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    // Deps: activeDrag (the object) IS the gate — it flips on/off per drag.
    // We deliberately don't depend on its mutating fields (it doesn't have any
    // anymore — clientX/Y were removed from the object's React identity).
    // onDragEnd should be stable (passed from parent as a callback).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDrag, onDragEnd]);

  const ctxValue = useMemo(() => ({
    register,
    startDrag,
    isDragging: !!activeDrag,
  }), [register, startDrag, activeDrag]);

  return (
    <DragContext.Provider value={ctxValue}>
      {children}
      {floatingClone}
    </DragContext.Provider>
  );
}

// Hook for a draggable badge.
//
// Behavior (per Q9 decision): drag starts almost instantly. The priority badge
// is a dedicated drag handle — user agrees not to touch it for scrolling.
// We require a tiny pointer movement (3px) to start drag, which prevents
// pure clicks from triggering drag but lets intentional drags begin immediately.
//
// Stability: the returned handlers are STABLE across renders (callbacks read
// the latest task/label/color via refs). Avoids the "re-register every render"
// churn that Finding #13 flagged.
//
// Cleanup: any pending press timer is cleared on unmount (Finding #15).
function useDraggable({ task, label, color, sourceQuadrant }) {
  const drag = useContext(DragContext);

  // Latest values live in a ref so onPointerDown stays stable across renders.
  const latestRef = useRef({ task, label, color, sourceQuadrant });
  useEffect(() => {
    latestRef.current = { task, label, color, sourceQuadrant };
  });

  const startedRef = useRef(false);     // has drag actually started for this gesture
  const originRef = useRef(null);       // { x, y } where pointerdown happened
  const cleanupRef = useRef(null);      // function to remove window listeners

  // Cleanup window listeners + any pending state on unmount
  useEffect(() => () => {
    if (cleanupRef.current) {
      try { cleanupRef.current(); } catch (_) {}
      cleanupRef.current = null;
    }
    originRef.current = null;
    startedRef.current = false;
  }, []);

  const onPointerDown = useCallback((e) => {
    // Only primary pointer
    if (e.button !== undefined && e.button !== 0) return;
    originRef.current = { x: e.clientX, y: e.clientY };
    startedRef.current = false;

    // Listen at the window level for the next pointermove. As soon as the
    // pointer moves > 3px from the origin, start the drag. This gives near-zero
    // latency (typically <16ms = a single frame), while still distinguishing a
    // tap (no movement) from an intentional drag.
    function maybeStart(ev) {
      if (!originRef.current || startedRef.current) return;
      const dx = ev.clientX - originRef.current.x;
      const dy = ev.clientY - originRef.current.y;
      if (dx * dx + dy * dy < 9) return;  // 3px threshold
      startedRef.current = true;
      const cur = latestRef.current;
      drag.startDrag({
        taskId: cur.task.id,
        title: cur.task.title,
        label: cur.label,
        color: cur.color,
        sourceQuadrant: cur.sourceQuadrant,
        clientX: ev.clientX,
        clientY: ev.clientY,
      });
      if (navigator.vibrate) try { navigator.vibrate(10); } catch (_) {}
      // Once drag has started, the DragProvider takes over. We can detach.
      cleanup();
    }
    function onUpEarly() {
      // Released before reaching threshold = it was a tap, not a drag.
      cleanup();
      originRef.current = null;
    }
    function cleanup() {
      window.removeEventListener('pointermove', maybeStart);
      window.removeEventListener('pointerup', onUpEarly);
      window.removeEventListener('pointercancel', onUpEarly);
      cleanupRef.current = null;
    }
    window.addEventListener('pointermove', maybeStart);
    window.addEventListener('pointerup', onUpEarly);
    window.addEventListener('pointercancel', onUpEarly);
    cleanupRef.current = cleanup;
  }, [drag]);

  return { onPointerDown };
}

// Hook for a drop target — registers with the controller, returns ref to assign.
//
// Stability (Fix #8 + #14): the registration runs ONCE per mount instead of on
// every parent re-render. Consumers can pass freshly-created onDrop callbacks
// without causing register/unregister churn, because we route onDrop through
// a ref that we update synchronously each render. Uses React.useId for a
// stable, deterministic id (not Math.random).
function useDropTarget({ type, onDrop }) {
  const drag = useContext(DragContext);
  const elRef = useRef(null);
  const id = React.useId();
  const onDropRef = useRef(onDrop);
  useEffect(() => { onDropRef.current = onDrop; });

  useEffect(() => {
    const spec = {
      id,
      type,
      getRect: () => elRef.current?.getBoundingClientRect(),
      getElement: () => elRef.current,
      onDrop: (drag, point) => {
        const fn = onDropRef.current;
        if (fn) fn(drag, point);
      },
    };
    const unreg = drag.register(spec);
    return unreg;
  }, [drag, type, id]);

  return elRef;
}

// ─────────────────────────────────────────────────────────────────────
// TASKS VIEW — main component
// ─────────────────────────────────────────────────────────────────────
function TasksView({ tasks, setTasks, userId, defaultSystem, taskFilter, setTaskFilter, taskViewMode, setTaskViewMode, brain, contacts, properties, events = [] }) {
  const [showModal, setShowModal] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const viewMode = (taskViewMode === 'sequence' || taskViewMode === 'matrix') ? taskViewMode : 'sequence';
  const filter = taskFilter || 'today';
  const [isDragging, setIsDragging] = useState(false);
  const [datePickerTask, setDatePickerTask] = useState(null);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const moreButtonRef = useRef(null);
  const [moreMenuPos, setMoreMenuPos] = useState({ top: 0, left: 0 });

  // Latest tasks in a ref so memoized callbacks below can read fresh data
  // without depending on `tasks` (which changes every state update). Combined
  // with useDropTarget's onDrop-via-ref pattern, this keeps drop-zone
  // registration stable across the lifetime of a TasksView mount (Fix #8).
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; });

  // Filtered task set
  const visibleTasks = useMemo(() => {
    const today = todayISO();
    const tomorrow = addDaysISO(1);
    const sevenDays = addDaysISO(7);
    return tasks.filter(t => {
      if (filter === 'completed') return t.completed;
      if (t.completed) return false;
      const d = t.due_date;
      if (filter === 'all') return true;
      if (filter === 'past') return d && d < today;
      if (filter === 'today') return d && d <= today;
      if (filter === 'tomorrow') return d === tomorrow;
      if (filter === '7days') return d && d >= today && d <= sevenDays;
      if (filter === 'future') return d && d > today;
      if (filter === 'undated') return !d;
      return true;
    });
  }, [tasks, filter]);

  const sequenceGroups = useMemo(() => {
    const buckets = {}; QUADS.forEach(q => buckets[q] = []);
    const unranked = [];
    visibleTasks.forEach(t => {
      const q = t.eisenhower_quadrant;
      if (QUADS.includes(q)) buckets[q].push(t);
      else unranked.push(t);
    });
    QUADS.forEach(q => {
      buckets[q].sort((a, b) => (a.eisenhower_rank ?? 999) - (b.eisenhower_rank ?? 999));
    });
    unranked.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
    return { buckets, unranked };
  }, [visibleTasks]);

  function openEdit(task) { setEditTask(task); setShowModal(true); }
  function openNew() { setEditTask(null); setShowModal(true); }

  async function handleSave(data) {
    const { _contact_ids, ...taskData } = data;
    let savedTaskId = null;
    if (editTask) {
      const { data: updated, error } = await supabase.from('tasks').update(taskData).eq('id', editTask.id).select().single();
      if (error) {
        notify("Couldn't save changes. Try again.", 'error');
        return;
      }
      if (updated) {
        setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
        savedTaskId = updated.id;
      }
    } else {
      const peers = tasks.filter(t => !t.completed && t.eisenhower_quadrant === taskData.eisenhower_quadrant);
      const maxRank = peers.reduce((m, t) => Math.max(m, t.eisenhower_rank || 0), 0);
      const insert = { ...taskData, eisenhower_rank: taskData.eisenhower_rank || (maxRank + 1), user_id: userId, completed: false };
      const { data: created, error } = await supabase.from('tasks').insert(insert).select().single();
      if (error) {
        notify("Couldn't create task. Try again.", 'error');
        return;
      }
      if (created) {
        setTasks(prev => [created, ...prev]);
        savedTaskId = created.id;
      }
    }
    // Replace task-contact links atomically (Pass 1 Finding #4).
    // The set_task_contacts RPC inserts new rows + deletes stale ones in a single
    // transaction. Old code did delete-then-insert which could silently lose all
    // links if the insert failed after the delete succeeded.
    if (savedTaskId && Array.isArray(_contact_ids)) {
      const { error: rpcErr } = await supabase.rpc('set_task_contacts', {
        p_task_id: savedTaskId,
        p_contact_ids: _contact_ids,
      });
      if (rpcErr) {
        notify("Task saved but contact links failed to update.", 'error');
        // Do not close the modal — give the user a chance to retry
        return;
      }
    }
    setShowModal(false); setEditTask(null);
  }

  const toggleComplete = useCallback(async (task, e) => {
    if (e) e.stopPropagation();
    const newCompleted = !task.completed;
    const { data: updated, error } = await supabase.from('tasks')
      .update({ completed: newCompleted, updated_at: new Date().toISOString() })
      .eq('id', task.id).select().single();
    if (error) {
      notify("Couldn't update task. Try again.", 'error');
      return;
    }
    if (updated) setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
  }, [setTasks]);

  // Move task to quadrant at position. The drop handler in QuadrantGroup passes
  // the position where the user released (above which row, or end of list).
  //
  // Safety (Pass 1 Findings #5 + #11):
  //  - Snapshot pre-update tasks state so we can rollback on failure
  //  - Persist updates in parallel using allSettled to detect ANY failure
  //  - If any update failed, rollback local state to the snapshot + toast error
  //  - User sees the move stick or hears about it failing — never silent
  const moveTaskToQuadrant = useCallback(async (taskId, destQuadrant, dropAboveTaskId) => {
    const tasks = tasksRef.current;
    const moved = tasks.find(t => t.id === taskId);
    if (!moved) return;
    // Compute new ordering of dest quadrant: take current sorted list, remove moved if it's there,
    // insert before the dropAboveTaskId (or at end if null)
    const destTasks = tasks.filter(t => !t.completed && t.eisenhower_quadrant === destQuadrant && t.id !== taskId)
      .sort((a, b) => (a.eisenhower_rank ?? 999) - (b.eisenhower_rank ?? 999));
    let insertIdx = destTasks.length; // default: end
    if (dropAboveTaskId) {
      const idx = destTasks.findIndex(t => t.id === dropAboveTaskId);
      if (idx >= 0) insertIdx = idx;
    }
    const newDestOrder = [...destTasks.slice(0, insertIdx), { ...moved, eisenhower_quadrant: destQuadrant }, ...destTasks.slice(insertIdx)];
    // Updates for destination
    const updates = newDestOrder.map((t, i) => ({
      id: t.id,
      eisenhower_rank: i + 1,
      eisenhower_quadrant: destQuadrant,
    }));
    // If quadrant changed, also renumber the source
    const sourceQuadrant = moved.eisenhower_quadrant;
    if (sourceQuadrant && sourceQuadrant !== destQuadrant) {
      const sourceTasks = tasks.filter(t => !t.completed && t.eisenhower_quadrant === sourceQuadrant && t.id !== taskId)
        .sort((a, b) => (a.eisenhower_rank ?? 999) - (b.eisenhower_rank ?? 999));
      sourceTasks.forEach((t, i) => {
        updates.push({ id: t.id, eisenhower_rank: i + 1, eisenhower_quadrant: sourceQuadrant });
      });
    }

    // Snapshot pre-update task fields so we can rollback exactly the rows we touch
    const affectedIds = new Set(updates.map(u => u.id));
    const snapshot = tasks
      .filter(t => affectedIds.has(t.id))
      .map(t => ({ id: t.id, eisenhower_rank: t.eisenhower_rank, eisenhower_quadrant: t.eisenhower_quadrant, priority_system: t.priority_system }));

    // Optimistic local update
    const byId = Object.fromEntries(updates.map(u => [u.id, u]));
    setTasks(prev => prev.map(t => {
      const u = byId[t.id];
      if (!u) return t;
      return { ...t, eisenhower_rank: u.eisenhower_rank, eisenhower_quadrant: u.eisenhower_quadrant, priority_system: 'eisenhower' };
    }));

    // Persist in parallel; use allSettled so one failure doesn't mask others.
    const results = await Promise.allSettled(updates.map(u =>
      supabase.from('tasks').update({
        eisenhower_rank: u.eisenhower_rank,
        eisenhower_quadrant: u.eisenhower_quadrant,
        priority_system: 'eisenhower',
      }).eq('id', u.id).select('id')
    ));

    // Treat a Supabase rejection OR a result with non-null .error as a failure
    const failed = results.filter((r, i) => {
      if (r.status === 'rejected') return true;
      const val = r.value;
      if (val && val.error) return true;
      return false;
    });

    if (failed.length > 0) {
      // Rollback local state for affected rows
      const snapById = Object.fromEntries(snapshot.map(s => [s.id, s]));
      setTasks(prev => prev.map(t => {
        const s = snapById[t.id];
        return s ? { ...t, eisenhower_rank: s.eisenhower_rank, eisenhower_quadrant: s.eisenhower_quadrant, priority_system: s.priority_system } : t;
      }));
      notify(
        failed.length === updates.length
          ? "Couldn't save the move. Reverted."
          : `Partial save (${updates.length - failed.length} of ${updates.length}). Reverted.`,
        'error'
      );
    }
  }, [setTasks]);

  // Reschedule a task's due date (called by drop zones). Optimistic with rollback.
  const setTaskDate = useCallback(async (taskId, newDateISO) => {
    const prevDate = tasksRef.current.find(t => t.id === taskId)?.due_date;
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, due_date: newDateISO } : t));
    const { error } = await supabase.from('tasks').update({ due_date: newDateISO }).eq('id', taskId);
    if (error) {
      // Rollback
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, due_date: prevDate } : t));
      notify("Couldn't update due date. Reverted.", 'error');
    }
  }, [setTasks]);

  return (
    <DragProvider onDragStart={() => setIsDragging(true)} onDragEnd={() => setIsDragging(false)}>
      <div className="view">
        <div className="view-header">
          <h2>Tasks</h2>
          <div style={{display:'flex',gap:'8px',alignItems:'center'}}>
            <span style={{fontSize:'12px',color:'var(--text-3)'}}>{visibleTasks.filter(t => !t.completed).length} active</span>
            <button className="btn btn-primary" onClick={openNew}>+ New Task</button>
          </div>
        </div>

        {/* Filter pills */}
        <div style={{display:'flex',gap:'6px',padding:'4px 0 12px',alignItems:'center',flexWrap:'wrap'}}>
          {(() => {
            const primary = [
              { id: 'today',     label: 'Today' },
              { id: 'tomorrow',  label: 'Tomorrow' },
              { id: 'all',       label: 'All' },
            ];
            const secondary = [
              { id: 'past',      label: 'Past Due' },
              { id: '7days',     label: '7 Days' },
              { id: 'future',    label: 'Future' },
              { id: 'undated',   label: 'Undated' },
              { id: 'completed', label: 'Completed' },
            ];
            const activeSecondary = secondary.find(s => s.id === filter);
            const moreLabel = activeSecondary ? activeSecondary.label : 'More';
            const moreActive = !!activeSecondary;
            const pillStyle = (active) => ({
              flexShrink:0, padding:'6px 12px', borderRadius:'999px',
              fontSize:'11px', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.03em',
              border:'1px solid',
              background: active ? 'var(--accent)' : 'transparent',
              borderColor: active ? 'var(--accent)' : 'var(--border)',
              color: active ? '#000' : 'var(--text-2)',
              cursor:'pointer', transition:'.15s',
              display:'inline-flex', alignItems:'center', gap:'4px',
            });
            return (
              <>
                {primary.map(p => (
                  <button key={p.id} onClick={() => setTaskFilter(p.id)} style={pillStyle(filter === p.id)}>{p.label}</button>
                ))}
                <button ref={moreButtonRef}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setMoreMenuPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 180) });
                    setMoreFiltersOpen(o => !o);
                  }}
                  style={pillStyle(moreActive)}>
                  {moreLabel} <span style={{fontSize:'9px',opacity:0.7}}>▾</span>
                </button>
              </>
            );
          })()}
        </div>

        {moreFiltersOpen && createPortal(
          <>
            <div onClick={() => setMoreFiltersOpen(false)}
              style={{position:'fixed',inset:0,zIndex:9998,background:'transparent'}}/>
            <div style={{
              position:'fixed', top:moreMenuPos.top, left:moreMenuPos.left, zIndex:9999,
              background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'8px',
              boxShadow:'0 8px 24px rgba(0,0,0,0.4)', minWidth:'170px', padding:'4px'
            }}>
              {[
                { id: 'past',      label: 'Past Due' },
                { id: '7days',     label: '7 Days' },
                { id: 'future',    label: 'Future' },
                { id: 'undated',   label: 'Undated' },
                { id: 'completed', label: 'Completed' },
              ].map(p => (
                <button key={p.id}
                  onClick={() => { setTaskFilter(p.id); setMoreFiltersOpen(false); }}
                  style={{
                    display:'block', width:'100%', textAlign:'left',
                    padding:'10px 14px', background: filter === p.id ? 'var(--bg-hover)' : 'none',
                    border:'none', cursor:'pointer', borderRadius:'4px',
                    color: filter === p.id ? 'var(--accent)' : 'var(--text-1)',
                    fontSize:'13px', fontWeight: filter === p.id ? 700 : 400,
                  }}>
                  {p.label}
                </button>
              ))}
            </div>
          </>,
          document.body
        )}

        {/* View switcher */}
        <div style={{display:'flex',background:'var(--bg-hover)',padding:'3px',borderRadius:'8px',marginBottom:'14px'}}>
          {[
            { id: 'sequence', label: 'Sequence' },
            { id: 'matrix',   label: 'Matrix' },
          ].map(v => (
            <button key={v.id}
              onClick={() => setTaskViewMode(v.id)}
              style={{
                flex:1, padding:'7px 0', border:'none', borderRadius:'6px',
                fontSize:'11px', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.03em',
                background: viewMode === v.id ? 'var(--accent)' : 'transparent',
                color: viewMode === v.id ? '#000' : 'var(--text-2)',
                cursor:'pointer', transition:'.18s'
              }}>
              {v.label}
            </button>
          ))}
        </div>

        {/* "Move past due to Today" button */}
        {filter === 'today' && (() => {
          const today = todayISO();
          const pastDue = tasks.filter(t => !t.completed && t.due_date && t.due_date < today);
          if (pastDue.length === 0) return null;
          return (
            <button
              onClick={async () => {
                if (!window.confirm(`Move ${pastDue.length} past-due task${pastDue.length === 1 ? '' : 's'} to today?`)) return;
                const ids = pastDue.map(t => t.id);
                await supabase.from('tasks').update({ due_date: today }).in('id', ids);
                setTasks(prev => prev.map(t => ids.includes(t.id) ? { ...t, due_date: today } : t));
              }}
              style={{
                width:'100%', marginBottom:'12px',
                padding:'10px 14px',
                background:'rgba(239,68,68,0.10)',
                border:'1px solid #ef4444',
                borderRadius:'6px',
                color:'#ef4444',
                fontSize:'12px', fontWeight:700,
                cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'center', gap:'8px',
              }}>
              ↻ Move {pastDue.length} past-due task{pastDue.length === 1 ? '' : 's'} to Today
            </button>
          );
        })()}

        {viewMode === 'sequence' ? (
          <SequenceView
            buckets={sequenceGroups.buckets}
            unranked={sequenceGroups.unranked}
            quads={QUADS}
            onEdit={openEdit}
            onToggleComplete={toggleComplete}
            onMoveTask={moveTaskToQuadrant}
            showRanking={filter === 'today'}
          />
        ) : (
          <MatrixView
            groups={sequenceGroups.buckets}
            quads={QUADS}
            onEdit={openEdit}
            onToggleComplete={toggleComplete}
            onMoveTask={moveTaskToQuadrant}
            showRanking={filter === 'today'}
          />
        )}

        <DropZoneStrip
          visible={isDragging}
          onDropToday={(taskId) => setTaskDate(taskId, todayISO())}
          onDropTomorrow={(taskId) => setTaskDate(taskId, addDaysISO(1))}
          onDropPickDate={(taskId) => {
            const task = tasks.find(t => t.id === taskId);
            if (task) setDatePickerTask(task);
          }}
        />

        {datePickerTask && (
          <DatePickerModal
            initial={datePickerTask.due_date || todayISO()}
            onCancel={() => setDatePickerTask(null)}
            onPick={async (iso) => {
              await setTaskDate(datePickerTask.id, iso);
              setDatePickerTask(null);
            }}
          />
        )}

        {showModal && <TaskModal onClose={()=>{setShowModal(false);setEditTask(null);}} onSave={handleSave} initial={editTask} defaultSystem={defaultSystem} brain={brain} contacts={contacts || []} properties={properties || []} events={events} userId={userId} />}
      </div>
    </DragProvider>
  );
}

const QUAD_LABELS = {
  A: 'Q1 · Important / Urgent',
  B: 'Q2 · Important / Not Urgent',
  C: 'Q3 · Not Important / Urgent',
  D: 'Q4 · Not Important / Not Urgent',
};
const QUAD_COLORS = {
  A: '#ef4444',
  B: '#3b82f6',
  C: '#f59e0b',
  D: '#94a3b8',
};

function SequenceView({ buckets, unranked, quads, onEdit, onToggleComplete, onMoveTask, showRanking }) {
  const allEmpty = quads.every(q => (buckets[q] || []).length === 0) && unranked.length === 0;
  return (
    <div>
      {quads.map(q => (
        <QuadrantGroup key={q}
          quadrant={q}
          label={QUAD_LABELS[q]}
          tasks={buckets[q] || []}
          onEdit={onEdit}
          onToggleComplete={onToggleComplete}
          onMoveTask={onMoveTask}
          showRanking={showRanking}
        />
      ))}
      {unranked.length > 0 && (
        <QuadrantGroup
          quadrant={null}
          label="Unranked"
          tasks={unranked}
          onEdit={onEdit}
          onToggleComplete={onToggleComplete}
          onMoveTask={onMoveTask}
          showRanking={showRanking}
        />
      )}
      {allEmpty && (
        <div style={{padding:'40px 0',textAlign:'center'}}>
          <div style={{fontSize:'42px',marginBottom:'10px'}}>✓</div>
          <p style={{color:'var(--text-2)'}}>All clear. Nothing matches this filter.</p>
        </div>
      )}
    </div>
  );
}

function QuadrantGroup({ quadrant, label, tasks, onEdit, onToggleComplete, onMoveTask, showRanking }) {
  const onDrop = useCallback((drag, point) => {
    if (!quadrant) return; // can't drop into unranked
    // Hit-test which row the pointer is over to find insertion index
    const container = elRef.current;
    if (!container) {
      onMoveTask(drag.taskId, quadrant, null);
      return;
    }
    let dropAboveTaskId = null;
    const rows = Array.from(container.querySelectorAll('[data-task-row]'));
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (point.clientY < mid) {
        dropAboveTaskId = row.getAttribute('data-task-row');
        break;
      }
    }
    onMoveTask(drag.taskId, quadrant, dropAboveTaskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quadrant, onMoveTask]);
  const elRef = useDropTarget({ type: 'quadrant', onDrop });
  const headerColor = quadrant ? QUAD_COLORS[quadrant] : 'var(--text-3)';

  return (
    <div style={{marginBottom:'18px'}}>
      <div style={{
        padding:'6px 10px',
        background:'var(--bg-hover)',
        borderLeft:`3px solid ${headerColor}`,
        borderRadius:'4px 4px 0 0',
        fontSize:'10px', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.06em',
        color:'var(--text-2)',
        display:'flex', justifyContent:'space-between', alignItems:'center'
      }}>
        <span>{label}</span>
        <span style={{color:'var(--text-3)',fontWeight:600}}>{tasks.length}</span>
      </div>
      <div ref={elRef} className="tasks-pro-drop-target"
        style={{
          background:'var(--bg-card)',
          border:'1px solid var(--border)',
          borderTop:'none',
          borderRadius:'0 0 4px 4px',
          minHeight: tasks.length === 0 ? '40px' : 'auto',
          transition:'background .15s',
        }}>
        {tasks.map((t, i) => (
          <TaskProRow key={t.id}
            task={t}
            rankNumber={i + 1}
            quadrant={quadrant}
            onEdit={onEdit}
            onToggleComplete={onToggleComplete}
            showRanking={showRanking}
          />
        ))}
        {tasks.length === 0 && (
          <div style={{padding:'10px 14px',fontSize:'11px',color:'var(--text-3)',fontStyle:'italic',textAlign:'center'}}>
            Drop a task here
          </div>
        )}
      </div>
    </div>
  );
}

function TaskProRow({ task, rankNumber, quadrant, onEdit, onToggleComplete, showRanking }) {
  const q = quadrant || task.eisenhower_quadrant;
  const badgeLabel = q
    ? (showRanking ? `${q}${rankNumber}` : q)
    : (showRanking ? `${rankNumber}` : '·');
  const badgeColor = q ? QUAD_COLORS[q] : 'var(--text-3)';
  const isDone = !!task.completed;

  const dragHandlers = useDraggable({
    task,
    label: badgeLabel,
    color: badgeColor,
    sourceQuadrant: q,
  });

  return (
    <div data-task-row={task.id}
      onClick={(e) => {
        if (e.target.closest('.tasks-pro-anchor') || e.target.closest('.tasks-pro-check')) return;
        onEdit(task);
      }}
      style={{
        display:'flex', alignItems:'center', gap:'6px',
        padding:'8px 10px',
        borderBottom:'1px solid var(--border)',
        cursor:'pointer',
        background: isDone ? 'var(--bg-base)' : 'transparent',
        opacity: isDone ? 0.55 : 1,
      }}>
      <input type="checkbox" checked={isDone} className="tasks-pro-check"
        onChange={(e) => onToggleComplete(task, e)}
        onClick={e => e.stopPropagation()}
        style={{flexShrink:0,width:'16px',height:'16px',accentColor:'var(--accent)',cursor:'pointer'}}/>
      <div className="tasks-pro-anchor"
        onPointerDown={dragHandlers.onPointerDown}
        style={{
          flexShrink:0,
          padding:'3px 8px',
          background: badgeColor,
          color:'#fff',
          fontSize:'10px', fontWeight:900,
          borderRadius:'4px',
          cursor:'grab',
          touchAction:'none',
          userSelect:'none',
          minWidth:'30px', textAlign:'center',
          letterSpacing:'0.02em',
        }}
        title="Long-press and drag to reorder, or to a drop zone to reschedule">
        {badgeLabel}
      </div>
      <span style={{
        flex:1, minWidth:0,
        fontSize:'13px',
        color: isDone ? 'var(--text-3)' : 'var(--text-1)',
        textDecoration: isDone ? 'line-through' : 'none',
        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'
      }}>
        {task.title}
      </span>
      {task.due_date && (
        <span style={{
          flexShrink:0,
          fontSize:'10px', fontWeight:600,
          color:'var(--text-3)',
        }}>
          {formatDueShort(task.due_date)}
        </span>
      )}
    </div>
  );
}

function formatDueShort(iso) {
  if (!iso) return '';
  const today = todayISO();
  const tomorrow = addDaysISO(1);
  if (iso === today) return 'Today';
  if (iso === tomorrow) return 'Tomorrow';
  if (iso < today) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function MatrixView({ groups, quads, onEdit, onToggleComplete, onMoveTask, showRanking }) {
  return (
    <div style={{
      display:'grid',
      gridTemplateColumns:'1fr 1fr',
      gridTemplateRows:'1fr 1fr',
      gap:'8px',
      minHeight:'320px',
    }}>
      {quads.map(q => (
        <MatrixQuadrant key={q}
          quadrant={q}
          label={QUAD_LABELS[q]}
          tasks={groups[q] || []}
          onEdit={onEdit}
          onToggleComplete={onToggleComplete}
          onMoveTask={onMoveTask}
          showRanking={showRanking}
        />
      ))}
    </div>
  );
}

function MatrixQuadrant({ quadrant, label, tasks, onEdit, onToggleComplete, onMoveTask, showRanking }) {
  const onDrop = useCallback((drag, point) => {
    const container = elRef.current;
    if (!container) {
      onMoveTask(drag.taskId, quadrant, null);
      return;
    }
    let dropAboveTaskId = null;
    const rows = Array.from(container.querySelectorAll('[data-task-row]'));
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (point.clientY < mid) {
        dropAboveTaskId = row.getAttribute('data-task-row');
        break;
      }
    }
    onMoveTask(drag.taskId, quadrant, dropAboveTaskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quadrant, onMoveTask]);
  const elRef = useDropTarget({ type: 'quadrant', onDrop });
  const headerColor = QUAD_COLORS[quadrant];

  return (
    <div style={{
      background:'var(--bg-card)',
      border:'1px solid var(--border)',
      borderTop:`3px solid ${headerColor}`,
      borderRadius:'6px',
      display:'flex', flexDirection:'column',
      overflow:'hidden',
    }}>
      <div style={{
        padding:'5px 8px',
        background:'var(--bg-hover)',
        fontSize:'9px', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.05em',
        color:'var(--text-2)',
        borderBottom:'1px solid var(--border)',
      }}>
        {label}
      </div>
      <div ref={elRef} className="tasks-pro-drop-target"
        style={{flex:1, overflowY:'auto', minHeight:'80px', padding:'2px 0'}}>
        {tasks.map((t, i) => (
          <MatrixTaskRow key={t.id}
            task={t}
            rankNumber={i + 1}
            quadrant={quadrant}
            headerColor={headerColor}
            onEdit={onEdit}
            onToggleComplete={onToggleComplete}
            showRanking={showRanking}
          />
        ))}
        {tasks.length === 0 && (
          <div style={{padding:'10px',fontSize:'10px',color:'var(--text-3)',fontStyle:'italic',textAlign:'center'}}>
            Empty
          </div>
        )}
      </div>
    </div>
  );
}

function MatrixTaskRow({ task, rankNumber, quadrant, headerColor, onEdit, onToggleComplete, showRanking }) {
  const badgeLabel = showRanking ? `${quadrant}${rankNumber}` : quadrant;
  const dragHandlers = useDraggable({
    task,
    label: badgeLabel,
    color: headerColor,
    sourceQuadrant: quadrant,
  });
  return (
    <div data-task-row={task.id}
      onClick={(e) => {
        if (e.target.closest('.tasks-pro-anchor') || e.target.closest('.tasks-pro-check')) return;
        onEdit(task);
      }}
      style={{
        display:'flex', alignItems:'center', gap:'4px',
        padding:'5px 7px',
        borderBottom:'1px solid var(--border)',
        cursor:'pointer',
        opacity: task.completed ? 0.5 : 1,
      }}>
      <input type="checkbox" checked={!!task.completed} className="tasks-pro-check"
        onChange={(e) => onToggleComplete(task, e)}
        onClick={e => e.stopPropagation()}
        style={{flexShrink:0,width:'13px',height:'13px',accentColor:'var(--accent)'}}/>
      <div className="tasks-pro-anchor"
        onPointerDown={dragHandlers.onPointerDown}
        style={{
          flexShrink:0,
          padding:'1px 5px',
          background: headerColor,
          color:'#fff',
          fontSize:'9px', fontWeight:900,
          borderRadius:'3px',
          cursor:'grab',
          touchAction:'none',
          userSelect:'none',
        }}>
        {badgeLabel}
      </div>
      <span style={{
        flex:1, minWidth:0,
        fontSize:'12px',
        color: task.completed ? 'var(--text-3)' : 'var(--text-1)',
        textDecoration: task.completed ? 'line-through' : 'none',
        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'
      }}>
        {task.title}
      </span>
    </div>
  );
}

function DropZoneStrip({ visible, onDropToday, onDropTomorrow, onDropPickDate }) {
  return (
    <div style={{
      position:'fixed',
      bottom: visible ? '12px' : '-100px',
      left:'12px', right:'12px',
      display:'grid',
      gridTemplateColumns:'1fr 1fr 1fr',
      gap:'8px',
      zIndex:200,
      transition:'bottom .25s ease',
      pointerEvents: visible ? 'auto' : 'none',
    }}>
      <DropZoneCell label="Today" action="today" onDrop={onDropToday} />
      <DropZoneCell label="Tomorrow" action="tomorrow" onDrop={onDropTomorrow} />
      <DropZoneCell label="Pick Date" action="pick" onDrop={onDropPickDate} />
    </div>
  );
}

function DropZoneCell({ label, action, onDrop }) {
  const handleDrop = useCallback((drag) => {
    onDrop(drag.taskId);
  }, [onDrop]);
  const elRef = useDropTarget({ type: 'zone', onDrop: handleDrop });
  return (
    <div ref={elRef} className="tasks-pro-drop-target"
      data-drop-action={action}
      style={{
        background:'var(--bg-card)',
        border:'2px dashed var(--accent)',
        borderRadius:'8px',
        padding:'14px 8px',
        textAlign:'center',
        fontSize:'10px', fontWeight:900, textTransform:'uppercase', letterSpacing:'0.05em',
        color:'var(--accent)',
        minHeight:'48px',
        display:'flex', alignItems:'center', justifyContent:'center',
        boxShadow:'0 4px 12px rgba(0,0,0,0.3)',
        transition:'transform .12s, background .12s',
      }}>
      {label}
    </div>
  );
}

function DatePickerModal({ initial, onCancel, onPick }) {
  const [year, setYear] = useState(() => {
    const [y] = (initial || todayISO()).split('-').map(Number);
    return y;
  });
  const [month, setMonth] = useState(() => {
    const [, m] = (initial || todayISO()).split('-').map(Number);
    return m - 1;
  });
  const today = todayISO();
  const monthName = new Date(year, month, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function pick(day) {
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    onPick(iso);
  }
  function shiftMonth(n) {
    let m = month + n; let y = year;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setMonth(m); setYear(y);
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()} style={{zIndex:1300}}>
      <div className="modal" style={{maxWidth:'320px',width:'92%'}}>
        <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <h3 style={{margin:0,fontSize:'14px'}}>Pick a date</h3>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>✕</button>
        </div>
        <div style={{padding:'14px 16px'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px'}}>
            <button className="btn btn-ghost btn-sm" onClick={() => shiftMonth(-1)}>‹</button>
            <span style={{fontSize:'13px',fontWeight:700}}>{monthName}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => shiftMonth(1)}>›</button>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7, 1fr)',gap:'2px',fontSize:'10px',color:'var(--text-3)',fontWeight:700,textAlign:'center',marginBottom:'4px'}}>
            <div>Su</div><div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div><div>Sa</div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7, 1fr)',gap:'4px'}}>
            {cells.map((c, i) => {
              if (c === null) return <div key={i} />;
              const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(c).padStart(2, '0')}`;
              const isToday = iso === today;
              return (
                <button key={i} onClick={() => pick(c)}
                  style={{
                    padding:'8px 0', fontSize:'12px',
                    background: isToday ? 'var(--accent)' : 'var(--bg-base)',
                    color: isToday ? '#000' : 'var(--text-1)',
                    border:'1px solid var(--border)',
                    borderRadius:'4px', cursor:'pointer',
                    fontWeight: isToday ? 800 : 500,
                  }}>
                  {c}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}



// ─────────────────────────────────────────
// EISENHOWER 2x2 QUADRANT GRID
// Read-only ordering (by rank within quadrant). Click task to edit.
// Shows only Eisenhower tasks; simple-system tasks excluded (they have no quadrant).
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// INBOX VIEW — Gmail-aware
// Reads from email_threads/email_messages when an account is connected.
// No account? Show a connect screen. (Pass 1 Batch D removed the legacy
// fake-email LegacyInboxView and the underlying `emails` table.)
// ─────────────────────────────────────────
function InboxView({ emailAccounts, setEmailAccounts, emailAliases, setEmailAliases, profiles, contacts, userId, setView, reloadData }) {
  // Find the email-purpose Google account. Once a user has gone through OAuth
  // for email, we KEEP that view forever — even if is_active or sync errors
  // would otherwise hide it. The user explicitly disconnects via Settings if
  // they want it gone. This is the "lock in" guarantee.
  const emailAccount =
    emailAccounts.find(a => (a.purposes || []).includes('email') && a.refresh_token) ||
    emailAccounts.find(a => (a.scopes || []).some(s => s.includes('gmail')) && a.refresh_token) ||
    null;

  if (emailAccount) {
    return <GmailInboxView account={emailAccount} setEmailAccounts={setEmailAccounts} emailAliases={emailAliases} setEmailAliases={setEmailAliases} profiles={profiles} contacts={contacts} userId={userId} />;
  }
  return <InboxConnectScreen setView={setView} reloadData={reloadData} />;
}

// Shown in the Inbox tab when no Gmail account is connected.
function InboxConnectScreen({ setView, reloadData }) {
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState(null);

  async function startOAuth() {
    try {
      setConnecting(true);
      setConnectError(null);
      const { data, error } = await supabase.functions.invoke('google-oauth-start', {
        body: { purpose: 'email' },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
      else throw new Error('No OAuth URL returned');
    } catch (err) {
      setConnectError(err?.message || String(err));
      setConnecting(false);
    }
  }

  return (
    <div className="view">
      <div className="view-header"><h2>Inbox</h2></div>
      <div className="empty-state" style={{padding:'40px 20px', textAlign:'center', maxWidth:'520px', margin:'0 auto'}}>
        <h3 style={{marginBottom:'10px'}}>Connect Gmail to use your Inbox</h3>
        <p style={{color:'var(--text-2)', marginBottom:'20px'}}>
          Hook up a Gmail account and your inbox will sync here automatically.
          You can connect more than one — set each one's purpose in Settings.
        </p>
        <button className="btn btn-primary" onClick={startOAuth} disabled={connecting}>
          {connecting ? 'Opening Google…' : 'Connect Gmail'}
        </button>
        {connectError && (
          <p style={{color:'var(--red)', marginTop:'12px', fontSize:'13px'}}>{connectError}</p>
        )}
      </div>
    </div>
  );
}

// ─── Gmail inbox ─────────────────────────────────────────────────
// Renders email HTML in a sandboxed iframe. Sandbox blocks scripts/popups
// so even malicious email HTML can't escape into the app. Auto-sizes height.
function EmailHtmlFrame({ html }) {
  const iframeRef = useRef(null);
  const [height, setHeight] = useState(200);
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    // Wrap in a basic style so dark-mode email content stays readable.
    // <base target="_blank"> ensures every link opens in a new tab instead of
    // trying to navigate the (sandboxed) iframe itself.
    const wrapped = `<!doctype html><html><head><meta charset="utf-8">
      <base target="_blank" rel="noopener noreferrer">
      <style>
        body { margin: 0; padding: 12px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; line-height: 1.6; color: #e8eaf0; background: #161921; word-wrap: break-word; overflow-wrap: anywhere; }
        a { color: #c5a95e; word-break: break-all; }
        a:visited { color: #b09853; }
        img { max-width: 100%; height: auto; display: inline-block; }
        table { max-width: 100% !important; width: auto !important; }
        td, th { max-width: 100%; word-wrap: break-word; }
        blockquote { border-left: 3px solid #252a38; padding-left: 12px; color: #9499b0; margin: 8px 0; }
        pre { white-space: pre-wrap; word-wrap: break-word; }
        * { max-width: 100%; box-sizing: border-box; }
        /* Override email-defined dark/light backgrounds that look bad in our dark UI */
        body[bgcolor], body[style*="background"] { background: #161921 !important; color: #e8eaf0 !important; }
      </style></head><body>${html}</body></html>`;
    iframe.srcdoc = wrapped;
    const onLoad = () => {
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          // Belt and suspenders: also patch any explicit target on links
          // (some emails set target="_self" which would override <base>)
          doc.querySelectorAll('a').forEach(a => {
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer');
          });
          const h = Math.min(1200, Math.max(100, doc.body.scrollHeight + 24));
          setHeight(h);
        }
      } catch (_) { /* cross-origin shouldn't happen with srcdoc */ }
    };
    iframe.addEventListener('load', onLoad);
    return () => iframe.removeEventListener('load', onLoad);
  }, [html]);
  return (
    <iframe
      ref={iframeRef}
      title="email-body"
      // allow-popups + allow-popups-to-escape-sandbox so target="_blank" links open;
      // allow-same-origin so we can read scrollHeight from the iframe document
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      style={{ width: '100%', height: `${height}px`, border: 'none', borderRadius: '6px', background: '#161921' }}
    />
  );
}

// Render plain-text email bodies with auto-linked URLs, markdown-style [text](url),
// and angle-bracket <https://...> URLs. Each detected URL becomes a clickable link.
function PlainTextBody({ text }) {
  if (!text) return null;
  // Parse the text into segments: plain text and links
  // Three patterns to detect, in priority order:
  //   1. [text](url)           — markdown link
  //   2. <https://url>         — angle-bracketed URL
  //   3. https://url           — bare URL
  const segments = [];
  const re = /(\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s<>"')\]]+)/g;
  let lastIdx = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) {
      segments.push({ type: 'text', value: text.substring(lastIdx, match.index) });
    }
    if (match[1]) {
      // Markdown link [label](url)
      segments.push({ type: 'link', label: match[2], url: match[3] });
    } else if (match[4]) {
      // <https://...>
      segments.push({ type: 'link', label: match[4], url: match[4] });
    } else if (match[5]) {
      // Bare URL
      segments.push({ type: 'link', label: match[5], url: match[5] });
    }
    lastIdx = re.lastIndex;
  }
  if (lastIdx < text.length) {
    segments.push({ type: 'text', value: text.substring(lastIdx) });
  }
  return (
    <div style={{fontSize:'14px',lineHeight:'1.7',color:'var(--text-1)',whiteSpace:'pre-wrap',wordBreak:'break-word'}}>
      {segments.map((s, i) => s.type === 'text'
        ? <span key={i}>{s.value}</span>
        : <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
            style={{color:'var(--accent)',wordBreak:'break-all'}}>{s.label}</a>
      )}
    </div>
  );
}

function GmailInboxView({ account, setEmailAccounts, emailAliases, setEmailAliases, profiles, contacts, userId }) {
  const [threads, setThreads] = useState([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [tab, setTab] = useState('inbox');
  const [selectedThread, setSelectedThread] = useState(null);
  const [selectedMessages, setSelectedMessages] = useState([]);

  // Responsive: on mobile (<900px), tapping a thread fully replaces the list
  // view with the reading pane. On desktop, both panels show side-by-side.
  const [isMobileWidth, setIsMobileWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 900 : false
  );
  useEffect(() => {
    function onResize() { setIsMobileWidth(window.innerWidth < 900); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const readingPaneRef = useRef(null);

  // More menu — rendered in a portal to escape the toolbar's overflow clipping
  const moreButtonRef = useRef(null);
  const [moreMenuPos, setMoreMenuPos] = useState({ top: 0, right: 0 });
  // Re-measure position when menu opens (and when window resizes/scrolls while open)
  useEffect(() => {
    function measure() {
      if (!moreButtonRef.current) return;
      const r = moreButtonRef.current.getBoundingClientRect();
      setMoreMenuPos({
        top: r.bottom + 4,
        right: Math.max(8, window.innerWidth - r.right),
      });
    }
    measure();
  }, []);

  // Pickers and dropdowns
  const [showSnoozePicker, setShowSnoozePicker] = useState(false);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [customSnoozeDate, setCustomSnoozeDate] = useState('');

  // User's Gmail labels (custom, type='user')
  const [userLabels, setUserLabels] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('gmail_labels')
        .select('*').eq('account_id', account.id).eq('type', 'user').order('name');
      if (!cancelled && data) setUserLabels(data);
    })();
    return () => { cancelled = true; };
  }, [account.id]);

  // Close popovers on Escape key
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        setShowSnoozePicker(false);
        setShowMoreMenu(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function refreshLabels() {
    try {
      await supabase.functions.invoke('gmail-labels-sync', { body: { account_id: account.id } });
      const { data } = await supabase.from('gmail_labels')
        .select('*').eq('account_id', account.id).eq('type', 'user').order('name');
      if (data) setUserLabels(data);
    } catch (_) { /* non-fatal */ }
  }
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeFrom, setComposeFrom] = useState('');  // resolved sender address
  const [composeReplyMeta, setComposeReplyMeta] = useState(null);  // { message_id, thread_id } when replying
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState('');
  const [syncingAliases, setSyncingAliases] = useState(false);
  // Backfill state: { running, round, totalNew, remaining, error, message }
  const [backfill, setBackfill] = useState(null);

  // Verified aliases the user can send from. Fall back to the account address.
  const verifiedAliases = (emailAliases || []).filter(a => a.verified);
  const defaultAlias = verifiedAliases.find(a => a.is_default)
    || verifiedAliases.find(a => a.is_primary)
    || (verifiedAliases.length > 0 ? verifiedAliases[0] : null);

  // Auto-sync aliases the first time we render with zero rows
  useEffect(() => {
    if (verifiedAliases.length === 0 && !syncingAliases) {
      runAliasesSync(true);  // silent first run
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runAliasesSync(silent = false) {
    setSyncingAliases(true);
    try {
      const { data } = await supabase.functions.invoke('gmail-aliases-sync', {
        body: { user_id: userId, account_id: account.id }
      });
      if (data?.ok) {
        const { data: fresh } = await supabase.from('email_aliases').select('*').order('email_address', { ascending: true });
        if (fresh) setEmailAliases(fresh);
        if (!silent) setSendMsg(`Synced ${data.synced} sender ${data.synced === 1 ? 'address' : 'addresses'}.`);
      }
    } catch (e) {
      if (!silent) setSendMsg('Alias sync failed: ' + (e.message || e));
    } finally {
      setSyncingAliases(false);
    }
  }

  const loadThreads = useCallback(async () => {
    setLoadingThreads(true);
    // tab can be 'inbox', 'sent', or 'snoozed'
    let q = supabase.from('email_threads').select('*').eq('account_id', account.id);
    if (tab === 'sent') {
      q = q.contains('labels', ['SENT']);
    } else if (tab === 'snoozed') {
      // Snoozed: has snoozed_until in the future
      q = q.not('snoozed_until', 'is', null).gt('snoozed_until', new Date().toISOString());
    } else {
      // inbox: must have INBOX label, and not be snoozed
      q = q.contains('labels', ['INBOX']).or(`snoozed_until.is.null,snoozed_until.lte.${new Date().toISOString()}`);
    }
    const { data } = await q.order('last_message_at', { ascending: false }).limit(50);
    setThreads(data || []);
    setLoadingThreads(false);
  }, [account.id, tab]);

  useEffect(() => { loadThreads(); }, [loadThreads]);

  async function openThread(thread) {
    setSelectedThread(thread);
    setLoadingMessages(true);
    const { data } = await supabase
      .from('email_messages')
      .select('*')
      .eq('thread_id', thread.id)
      .order('internal_date', { ascending: true });
    setSelectedMessages(data || []);
    // Mark unread messages as read
    const unread = (data || []).filter(m => !m.is_read);
    if (unread.length > 0) {
      await supabase
        .from('email_messages')
        .update({ is_read: true })
        .in('id', unread.map(m => m.id));
      // Also clear thread unread flag if everything's now read
      await supabase.from('email_threads').update({ has_unread: false }).eq('id', thread.id);
      setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, has_unread: false } : t));
    }
    setLoadingMessages(false);
    // On mobile, scroll the reading pane into view since the list collapses.
    // Use setTimeout so the DOM has time to re-render with the new pane visible.
    setTimeout(() => {
      if (readingPaneRef.current) {
        readingPaneRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      // Belt-and-suspenders: also scroll the page to top, since the pane should fill the view
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
  }

  async function runSync() {
    setSyncing(true);
    setSyncMsg('');
    try {
      const { data, error } = await supabase.functions.invoke('gmail-sync', {
        body: { account_id: account.id },
      });
      if (error) throw error;
      const r = (data && data.synced && data.synced[0]) || {};
      if (r.error) {
        setSyncMsg('Error: ' + r.error);
      } else {
        setSyncMsg(`Synced — ${r.new_messages || 0} new`);
        await loadThreads();
        // Refresh account row
        const { data: acct } = await supabase.from('email_accounts').select('*').eq('id', account.id).single();
        if (acct) setEmailAccounts(prev => prev.map(a => a.id === acct.id ? acct : a));
      }
      setTimeout(() => setSyncMsg(''), 4000);
    } catch (err) {
      setSyncMsg('Error: ' + (err.message || err));
    } finally {
      setSyncing(false);
    }
  }

  // 365-day backfill: walks backward through Gmail in batches.
  // Each round pulls ~300 messages older than what we already have.
  // Stops when 2 consecutive rounds find no new messages.
  async function runBackfill() {
    setBackfill({ running: true, round: 0, totalNew: 0, remaining: null, error: null, message: 'Starting 365-day backfill…' });
    let totalNew = 0;
    let zeroRoundsInARow = 0;
    const MAX_ROUNDS = 100;
    for (let i = 1; i <= MAX_ROUNDS; i++) {
      setBackfill(b => ({ ...b, round: i, message: `Round ${i}: fetching older messages…` }));
      try {
        const { data, error } = await supabase.functions.invoke('gmail-sync', {
          body: {
            account_id: account.id,
            force_backfill: true,
            lookback_days: 365,
            exclude_categories: true,
            max_initial: 2000,
            per_run_cap: 300,
          },
        });
        if (error) throw error;
        const r = (data && data.synced && data.synced[0]) || {};
        if (r.error) throw new Error(r.error);
        const newCount = r.new_messages || 0;
        const remaining = r.remaining_to_fetch || 0;
        totalNew += newCount;
        // Capture in a per-iteration const so the closures below don't bind
        // to the loop-mutated outer variable (eslint no-loop-func).
        const total = totalNew;
        setBackfill(b => ({ ...b, round: i, totalNew: total, remaining,
          message: `Round ${i}: +${newCount} messages · total pulled so far: ${total}${remaining > 0 ? ` · ~${remaining} more in queue` : ''}` }));
        if (newCount === 0) {
          zeroRoundsInARow++;
          if (zeroRoundsInARow >= 2) {
            setBackfill({ running: false, round: i, totalNew: total, remaining: 0, error: null,
              message: `✓ Backfill complete. Pulled ${total} messages from the last 365 days (excluding promotions/updates/social).` });
            break;
          }
        } else {
          zeroRoundsInARow = 0;
        }
      } catch (err) {
        setBackfill(b => ({ ...b, running: false, error: err.message || String(err) }));
        return;
      }
    }
    await loadThreads();
    const { data: acct } = await supabase.from('email_accounts').select('*').eq('id', account.id).single();
    if (acct) setEmailAccounts(prev => prev.map(a => a.id === acct.id ? acct : a));
    setTimeout(() => setBackfill(b => (b && !b.running ? null : b)), 30000);
  }

  // Reply-from picker: prefer whatever address the inbound mail was sent TO
  // (if it matches one of our verified aliases), else fall back to the default.
  function chooseReplyFrom(msg) {
    if (!msg) return defaultAlias?.email_address || account.email_address;
    const toEmail = (r) => {
      if (!r) return null;
      if (typeof r === 'string') return r.trim().toLowerCase();
      if (typeof r === 'object') return r.email ? String(r.email).trim().toLowerCase() : null;
      return null;
    };
    const candidates = [
      ...(Array.isArray(msg.to_addresses) ? msg.to_addresses : []),
      ...(Array.isArray(msg.cc_addresses) ? msg.cc_addresses : []),
    ].map(toEmail).filter(Boolean);
    const verifiedSet = new Set(verifiedAliases.map(a => a.email_address.toLowerCase()));
    for (const cand of candidates) {
      // Strip angle brackets if present (some legacy strings might be "Name <email@x>")
      const m = cand.match(/<([^>]+)>/);
      const bare = (m ? m[1] : cand).toLowerCase().trim();
      if (verifiedSet.has(bare)) return bare;
    }
    return defaultAlias?.email_address || account.email_address;
  }

  function openCompose() {
    setComposeTo(''); setComposeSubject(''); setComposeBody('');
    setComposeFrom(defaultAlias?.email_address || account.email_address);
    setComposeReplyMeta(null);
    setSendMsg('');
    setShowCompose(true);
  }

  // Forward a message: empty recipients, prefilled with "Forwarded message" preamble
  function openForward(msg) {
    if (!msg) return;
    const subj = (msg.subject || '').match(/^fwd?:/i) ? msg.subject : `Fwd: ${msg.subject || ''}`;
    const when = msg.internal_date ? new Date(msg.internal_date).toLocaleString() : '';
    const sentToFmt = (Array.isArray(msg.to_addresses) ? msg.to_addresses : []).map(r => {
      if (typeof r === 'string') return r;
      if (r && typeof r === 'object') return r.name ? `${r.name} <${r.email}>` : r.email;
      return '';
    }).filter(Boolean).join(', ');
    const quoted = msg.body_text || msg.snippet || '';
    setComposeTo('');
    setComposeSubject(subj);
    setComposeBody(
      `\n\n---------- Forwarded message ----------\n` +
      `From: ${msg.from_name ? `${msg.from_name} <${msg.from_address}>` : msg.from_address}\n` +
      `Date: ${when}\n` +
      `Subject: ${msg.subject || ''}\n` +
      (sentToFmt ? `To: ${sentToFmt}\n` : '') +
      `\n${quoted}`
    );
    setComposeFrom(defaultAlias?.email_address || account.email_address);
    // Forward doesn't preserve thread — start a new conversation
    setComposeReplyMeta(null);
    setSendMsg('');
    setShowCompose(true);
  }

  // Move a thread (and its messages) to Trash via Gmail API
  async function trashCurrentThread() {
    if (!selectedThread) return;
    if (!window.confirm('Move this conversation to Trash?')) return;
    try {
      const { data, error } = await supabase.functions.invoke('gmail-trash', {
        body: { account_id: account.id, thread_id: selectedThread.provider_thread_id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      // Remove from local list, close the reading pane
      setThreads(prev => prev.filter(t => t.id !== selectedThread.id));
      setSelectedThread(null);
      setSelectedMessages([]);
    } catch (err) {
      alert('Could not move to Trash: ' + (err.message || err));
    }
  }

  // ===== Email actions: archive / star / unread / spam / labels / snooze =====
  // All route through the gmail-modify edge function with action or add/remove arrays.

  // Compute whether the current thread is starred / unread from its labels
  const currentLabels = (selectedThread?.labels || []);
  const isStarred = currentLabels.includes('STARRED');
  const isUnread = selectedThread?.has_unread || currentLabels.includes('UNREAD');

  async function modifyThread(action, opts = {}) {
    if (!selectedThread) return;
    const { silent = false, removeFromList = false } = opts;
    try {
      const { data, error } = await supabase.functions.invoke('gmail-modify', {
        body: { account_id: account.id, thread_id: selectedThread.provider_thread_id, action },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      // Update local: re-fetch the thread to get the new labels
      const { data: updated } = await supabase.from('email_threads').select('*').eq('id', selectedThread.id).single();
      if (updated) {
        setSelectedThread(updated);
        if (removeFromList) {
          setThreads(prev => prev.filter(t => t.id !== updated.id));
          if (action === 'archive' || action === 'spam') {
            // Close the reading pane on archive/spam
            setSelectedThread(null);
            setSelectedMessages([]);
          }
        } else {
          setThreads(prev => prev.map(t => t.id === updated.id ? updated : t));
        }
      }
    } catch (err) {
      if (!silent) alert('Action failed: ' + (err.message || err));
    }
  }

  // Snooze: hide from inbox until a target time, then restore via cron
  async function snoozeThread(untilDate) {
    if (!selectedThread || !untilDate) return;
    try {
      // Remove from inbox view via Gmail (mirrors what Gmail does), and set snoozed_until locally
      await supabase.functions.invoke('gmail-modify', {
        body: { account_id: account.id, thread_id: selectedThread.provider_thread_id, action: 'archive' },
      });
      await supabase.from('email_threads').update({ snoozed_until: untilDate.toISOString() }).eq('id', selectedThread.id);
      setThreads(prev => prev.filter(t => t.id !== selectedThread.id));
      setSelectedThread(null);
      setSelectedMessages([]);
      setShowSnoozePicker(false);
    } catch (err) {
      alert('Snooze failed: ' + (err.message || err));
    }
  }

  // Apply labels to the thread (add some, remove others)
  async function applyLabels(addIds, removeIds) {
    if (!selectedThread) return;
    try {
      const { data, error } = await supabase.functions.invoke('gmail-modify', {
        body: {
          account_id: account.id,
          thread_id: selectedThread.provider_thread_id,
          add: addIds,
          remove: removeIds,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const { data: updated } = await supabase.from('email_threads').select('*').eq('id', selectedThread.id).single();
      if (updated) {
        setSelectedThread(updated);
        setThreads(prev => prev.map(t => t.id === updated.id ? updated : t));
      }
      setShowLabelPicker(false);
    } catch (err) {
      alert('Label change failed: ' + (err.message || err));
    }
  }

  // Snooze time options
  function snoozeOptions() {
    const now = new Date();
    const opts = [];
    // Later today: 4 hours from now, but if past 7pm, skip
    const laterToday = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    if (laterToday.getHours() <= 21) {
      opts.push({ key: 'later', label: 'Later today', sub: laterToday.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), date: laterToday });
    }
    // Tomorrow at 9am
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    opts.push({ key: 'tomorrow', label: 'Tomorrow', sub: 'Tomorrow at 9:00 AM', date: tomorrow });
    // This weekend: Saturday at 9am (if today is Sat/Sun, next Saturday)
    const weekend = new Date(now);
    const dayOfWeek = weekend.getDay();
    const daysUntilSat = dayOfWeek === 6 ? 7 : (dayOfWeek === 0 ? 6 : 6 - dayOfWeek);
    weekend.setDate(weekend.getDate() + daysUntilSat);
    weekend.setHours(9, 0, 0, 0);
    opts.push({ key: 'weekend', label: 'This weekend', sub: weekend.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' at 9:00 AM', date: weekend });
    // Next week: next Monday at 9am
    const nextWeek = new Date(now);
    const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
    nextWeek.setDate(nextWeek.getDate() + daysUntilMonday);
    nextWeek.setHours(9, 0, 0, 0);
    opts.push({ key: 'nextweek', label: 'Next week', sub: nextWeek.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' at 9:00 AM', date: nextWeek });
    return opts;
  }

  function openReply(msg, replyAll = false) {
    if (!msg) return;
    // Normalize a recipient (string or {name, email}) to a plain email
    const toEmail = (r) => {
      if (!r) return null;
      if (typeof r === 'string') return r.trim();
      if (typeof r === 'object') return r.email ? String(r.email).trim() : null;
      return null;
    };
    const replyTo = msg.reply_to || msg.from_address || '';
    let toList = [replyTo].filter(Boolean);
    if (replyAll) {
      const myAddrs = new Set([
        account.email_address.toLowerCase(),
        ...verifiedAliases.map(a => a.email_address.toLowerCase()),
      ]);
      const extraTos = (msg.to_addresses || [])
        .map(toEmail)
        .filter(Boolean)
        .filter(a => !myAddrs.has(a.toLowerCase()));
      toList = Array.from(new Set([...toList, ...extraTos]));
    }
    const subj = (msg.subject || '').match(/^re:/i) ? msg.subject : `Re: ${msg.subject || ''}`;
    const when = msg.internal_date ? new Date(msg.internal_date).toLocaleString() : '';
    const quoted = (msg.body_text || msg.snippet || '').split('\n').map(l => '> ' + l).join('\n');
    setComposeTo(toList.join(', '));
    setComposeSubject(subj);
    setComposeBody(`\n\nOn ${when}, ${msg.from_name || msg.from_address} wrote:\n${quoted}`);
    setComposeFrom(chooseReplyFrom(msg));
    setComposeReplyMeta({ message_id: msg.provider_message_id, thread_id: msg.provider_thread_id });
    setSendMsg('');
    setShowCompose(true);
  }

  async function handleSend(ev) {
    ev.preventDefault();
    setSending(true);
    setSendMsg('');
    try {
      const payload = {
        account_id: account.id,
        to: composeTo.split(',').map(s => s.trim()).filter(Boolean),
        subject: composeSubject,
        body_text: composeBody,
      };
      if (composeFrom && composeFrom !== account.email_address) {
        payload.from_address = composeFrom;
      }
      if (composeReplyMeta?.message_id) payload.reply_to_message_id = composeReplyMeta.message_id;
      if (composeReplyMeta?.thread_id) payload.in_reply_to_thread_id = composeReplyMeta.thread_id;
      const { data, error } = await supabase.functions.invoke('gmail-send', {
        body: payload,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error + (data.details ? ` — ${data.details}` : ''));
      setSendMsg('Sent.');
      setShowCompose(false);
      setComposeTo(''); setComposeSubject(''); setComposeBody(''); setComposeFrom(''); setComposeReplyMeta(null);
      // Trigger a sync so the sent message shows up
      runSync();
    } catch (err) {
      setSendMsg('Error: ' + (err.message || err));
    } finally {
      setSending(false);
    }
  }

  // Look up the sender's DISC profile via contact_id linkage (best-effort)
  function profileForEmail(email) {
    if (!email) return null;
    const contact = contacts.find(c => (c.email && c.email.toLowerCase() === email.toLowerCase()));
    if (!contact) return null;
    return profiles.find(p => p.contact_id === contact.id) || null;
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Math.floor((Date.now() - new Date(ts)) / 60000);
    if (diff < 1) return 'just now';
    if (diff < 60) return `${diff}m`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h`;
    return new Date(ts).toLocaleDateString();
  }

  function initials(name, email) {
    const s = name || email || '?';
    return s.replace(/[<>"]/g, '').slice(0, 2).toUpperCase();
  }

  function senderFromThread(thread) {
    // For inbox, show the most recent non-owner participant; for sent, show recipient.
    const myEmail = (account.email_address || '').toLowerCase();
    const myAliases = new Set([myEmail, ...verifiedAliases.map(a => a.email_address.toLowerCase())]);
    const parts = Array.isArray(thread.participants) ? thread.participants : [];
    // Normalize — some legacy rows may have strings instead of objects
    const normalized = parts.map(p => {
      if (typeof p === 'string') {
        const m = p.match(/^"?([^"<]+?)"?\s*<([^>]+)>/);
        if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
        return { name: null, email: p.toLowerCase() };
      }
      return { name: p?.name || null, email: (p?.email || '').toLowerCase() };
    }).filter(p => p.email);
    if (normalized.length === 0) return { name: null, email: null };
    // Find non-owner first
    const other = normalized.find(p => !myAliases.has(p.email));
    return other || normalized[0];
  }

  const unreadCount = threads.filter(t => t.has_unread).length;

  return (
    <div>
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
        <div>
          <h2>Inbox</h2>
          <p style={{fontSize:'13px'}}>
            <strong style={{color:'var(--text-1)'}}>{account.email_address}</strong>
            {' · '}
            {unreadCount > 0 ? `${unreadCount} unread` : 'all caught up'}
            {account.last_sync_at && <> · last sync: {timeAgo(account.last_sync_at)}</>}
            {account.last_sync_error && <> · <span style={{color:'var(--red)'}}>sync error</span></>}
          </p>
        </div>
        <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
          {syncMsg && <span style={{fontSize:'12px',color: syncMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)'}}>{syncMsg}</span>}
          <button className="btn btn-ghost btn-sm" onClick={() => runAliasesSync(false)} disabled={syncingAliases} title="Re-sync your Send-mail-as aliases from Gmail">
            {syncingAliases ? '↻ Syncing senders…' : `↻ Senders (${verifiedAliases.length})`}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={runBackfill} disabled={backfill?.running || syncing}
            title="Pull last 365 days of emails (excludes Promotions / Updates / Social). Safe to leave running in the background — it batches.">
            {backfill?.running ? `↻ Backfill (round ${backfill.round})` : '⤓ Pull 365d'}
          </button>
          <button className="btn btn-ghost" onClick={runSync} disabled={syncing}>{syncing ? 'Syncing…' : '↻ Sync'}</button>
          <button className="btn btn-primary" onClick={openCompose}>✏️ Compose</button>
        </div>
      </div>

      {backfill && (
        <div style={{padding:'10px 14px',marginBottom:'14px',borderRadius:'8px',
          background: backfill.error ? 'rgba(239,68,68,0.10)' : (backfill.running ? 'rgba(197,169,94,0.08)' : 'rgba(34,197,94,0.10)'),
          border: `1px solid ${backfill.error ? '#ef4444' : (backfill.running ? 'var(--accent)' : '#22c55e')}`,
          color: backfill.error ? '#ef4444' : (backfill.running ? 'var(--text-1)' : '#22c55e'),
          fontSize:'12px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px'}}>
          <span>{backfill.error ? `Backfill failed: ${backfill.error}` : backfill.message}</span>
          {!backfill.running && (
            <button onClick={() => setBackfill(null)} style={{background:'none',border:'none',color:'inherit',cursor:'pointer',fontSize:'14px'}}>×</button>
          )}
        </div>
      )}

      {!account.initial_sync_done && (
        <div className="panel" style={{marginBottom:'14px',background:'rgba(197, 169, 94, 0.08)',borderColor:'var(--accent)'}}>
          <div className="panel-body" style={{padding:'14px'}}>
            <p style={{margin:0,fontSize:'14px',color:'var(--text-1)'}}>
              <strong>First sync hasn't run yet.</strong> Tap <strong>Sync</strong> to pull your most recent messages.
            </p>
          </div>
        </div>
      )}

      <div style={{
        display: isMobileWidth ? 'block' : 'grid',
        gridTemplateColumns: selectedThread ? '1fr 1.4fr' : '1fr',
        gap: '18px'
      }}>
        <div style={{display: isMobileWidth && selectedThread ? 'none' : 'block'}}>
          <div className="panel">
            <div className="panel-header">
              <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                {['inbox','snoozed','sent'].map(t => (
                  <button key={t} className={`btn btn-sm ${tab===t?'btn-primary':'btn-ghost'}`} onClick={()=>{setTab(t); setSelectedThread(null);}}>
                    {t === 'inbox' ? 'Inbox' : t === 'snoozed' ? '⏰ Snoozed' : 'Sent'}
                    {t==='inbox' && unreadCount>0 && <span className="nav-badge" style={{marginLeft:'6px'}}>{unreadCount}</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="panel-body">
              {loadingThreads
                ? <div className="loading-screen" style={{minHeight:'200px'}}><div className="spinner"/></div>
                : threads.length === 0
                  ? <div className="empty-state"><div className="empty-icon">📭</div><p>{tab==='sent'?'No sent messages yet.':'Inbox is empty.'}</p></div>
                  : <div className="email-list">
                      {threads.map(thread => {
                        const sender = senderFromThread(thread);
                        const senderProfile = profileForEmail(sender.email);
                        return (
                          <div key={thread.id} className={`email-item ${thread.has_unread?'email-unread':''}`} onClick={()=>openThread(thread)} style={{cursor:'pointer'}}>
                            {thread.has_unread && <div className="unread-dot"/>}
                            <div className="email-avatar">{initials(sender.name, sender.email)}</div>
                            <div className="email-content" style={{minWidth:0}}>
                              <div className="email-from" style={{display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}}>
                                {(thread.labels || []).includes('STARRED') && (
                                  <span style={{color:'#f59e0b',fontSize:'12px',flexShrink:0}} title="Starred">★</span>
                                )}
                                <span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{sender.name || sender.email || '(unknown)'}</span>
                                {senderProfile && (
                                  <span className="pill pill-purple" style={{fontSize:'10px',padding:'2px 6px'}}>
                                    {senderProfile.primary_letter}{senderProfile.secondary_letter ? `/${senderProfile.secondary_letter}` : ''} · {senderProfile.confidence}
                                  </span>
                                )}
                                {thread.message_count > 1 && <span style={{color:'var(--text-3)',fontSize:'12px'}}>({thread.message_count})</span>}
                                {thread.snoozed_until && new Date(thread.snoozed_until) > new Date() && (
                                  <span style={{fontSize:'10px',color:'var(--accent)',padding:'2px 6px',background:'rgba(197,169,94,0.10)',borderRadius:'4px'}}>
                                    ⏰ until {new Date(thread.snoozed_until).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}
                                  </span>
                                )}
                              </div>
                              <div className="email-subject" style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{thread.subject || '(no subject)'}</div>
                              <div className="email-preview" style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{thread.snippet || ''}</div>
                            </div>
                            <span className="email-time" style={{flexShrink:0}}>{timeAgo(thread.last_message_at)}</span>
                          </div>
                        );
                      })}
                    </div>
              }
            </div>
          </div>
        </div>
        {selectedThread && (
          <div className="panel" ref={readingPaneRef} style={{display:'flex',flexDirection:'column'}}>
            {/* Sticky action bar at the top */}
            <div style={{
              position:'sticky', top:0, zIndex:5,
              background:'var(--bg-card)',
              borderBottom:'1px solid var(--border)',
              padding:'10px 14px',
              display:'flex',alignItems:'center',gap:'6px',flexWrap:'nowrap',
              overflow:'hidden'
            }}>
              <button className="btn btn-ghost btn-sm" onClick={()=>setSelectedThread(null)} style={{flexShrink:0,padding:'4px 10px',fontSize:'12px'}}
                title={isMobileWidth ? 'Back to inbox' : 'Close'}>
                ← {isMobileWidth ? 'Inbox' : 'Close'}
              </button>

              {selectedMessages.length > 0 && (() => {
                const latest = selectedMessages[selectedMessages.length - 1];
                // Per-message canReplyAll is computed where reply buttons render below.
                return (
                  <>
                    {/* Star — leftmost icon action, single emoji */}
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => modifyThread(isStarred ? 'unstar' : 'star')}
                      title={isStarred ? 'Unstar' : 'Star'}
                      style={{flexShrink:0,padding:'4px 8px',fontSize:'16px',color: isStarred ? '#f59e0b' : 'var(--text-2)'}}>
                      {isStarred ? '★' : '☆'}
                    </button>

                    {/* Reply — primary action, always visible */}
                    <button className="btn btn-primary btn-sm" onClick={() => openReply(latest, false)}
                      style={{flexShrink:0,padding:'4px 12px',fontSize:'12px'}}>
                      ↩ Reply
                    </button>

                    {/* Archive — only when not already archived */}
                    {tab !== 'sent' && (
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => modifyThread('archive', { removeFromList: true })}
                        title="Archive"
                        style={{flexShrink:0,padding:'4px 8px',fontSize:'14px'}}>
                        📥
                      </button>
                    )}

                    {/* Delete — keep visible since it's a frequent action */}
                    <button className="btn btn-ghost btn-sm" onClick={trashCurrentThread}
                      title="Delete (move to Trash)"
                      style={{flexShrink:0,padding:'4px 8px',fontSize:'14px',color:'var(--red)'}}>
                      🗑
                    </button>

                    {/* More menu — everything else (Gmail-style).
                        Rendered in a portal so it can't be clipped by the toolbar's
                        overflow:hidden (which is needed to prevent button overflow). */}
                    <div style={{position:'relative',marginLeft:'auto',flexShrink:0}}>
                      <button ref={moreButtonRef} className="btn btn-ghost btn-sm"
                        onClick={(e) => {
                          // Measure button position so the portal-rendered dropdown
                          // anchors below+right of it
                          const r = e.currentTarget.getBoundingClientRect();
                          setMoreMenuPos({
                            top: r.bottom + 4,
                            right: Math.max(8, window.innerWidth - r.right),
                          });
                          setShowMoreMenu(m => !m);
                          setShowSnoozePicker(false);
                        }}
                        title="More actions"
                        style={{padding:'4px 10px',fontSize:'16px',lineHeight:1}}>
                        ⋮
                      </button>
                    </div>
                    {showMoreMenu && createPortal(
                      <>
                        {/* Invisible backdrop captures clicks-outside to close */}
                        <div onClick={() => { setShowMoreMenu(false); setShowSnoozePicker(false); }}
                          style={{position:'fixed',inset:0,zIndex:9998,background:'transparent'}}/>
                        <div style={{
                          position:'fixed',
                          top: moreMenuPos.top,
                          right: moreMenuPos.right,
                          zIndex:9999,
                          background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'8px',
                          boxShadow:'0 8px 24px rgba(0,0,0,0.4)',
                          minWidth:'220px',padding:'4px'
                        }}>
                          {/* Reply all — always shown for menu consistency.
                              On solo-recipient threads this behaves identically to Reply. */}
                          <button
                            onClick={() => { openReply(latest, true); setShowMoreMenu(false); }}
                            style={{display:'block',width:'100%',textAlign:'left',padding:'10px 12px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',color:'var(--text-1)',fontSize:'13px'}}>
                            ↩↩ Reply all
                          </button>

                          {/* Forward */}
                          <button
                            onClick={() => { openForward(latest); setShowMoreMenu(false); }}
                            style={{display:'block',width:'100%',textAlign:'left',padding:'10px 12px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',color:'var(--text-1)',fontSize:'13px'}}>
                            ↪ Forward
                          </button>

                          <div style={{borderTop:'1px solid var(--border)',margin:'4px 0'}}/>

                          {/* Snooze — opens sub-popover */}
                          <div>
                            <button
                              onClick={() => setShowSnoozePicker(s => !s)}
                              style={{display:'flex',justifyContent:'space-between',alignItems:'center',width:'100%',textAlign:'left',padding:'10px 12px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',color:'var(--text-1)',fontSize:'13px'}}>
                              <span>⏰ Snooze</span>
                              <span style={{color:'var(--text-3)',fontSize:'11px'}}>{showSnoozePicker ? '▾' : '▸'}</span>
                            </button>
                            {showSnoozePicker && (
                              <div style={{paddingLeft:'12px'}}>
                                {snoozeOptions().map(opt => (
                                  <button key={opt.key}
                                    onClick={() => { snoozeThread(opt.date); setShowMoreMenu(false); }}
                                    style={{display:'block',width:'100%',textAlign:'left',padding:'8px 12px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',color:'var(--text-1)',fontSize:'12px'}}>
                                    <div>{opt.label}</div>
                                    <div style={{fontSize:'10px',color:'var(--text-3)'}}>{opt.sub}</div>
                                  </button>
                                ))}
                                <div style={{padding:'6px 12px'}}>
                                  <div style={{fontSize:'10px',color:'var(--text-3)',marginBottom:'4px',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.05em'}}>Pick date</div>
                                  <div style={{display:'flex',gap:'4px'}}>
                                    <input type="datetime-local" className="form-input"
                                      value={customSnoozeDate}
                                      onChange={e => setCustomSnoozeDate(e.target.value)}
                                      style={{padding:'4px 6px',fontSize:'11px',margin:0,flex:1}} />
                                    <button className="btn btn-primary btn-sm"
                                      disabled={!customSnoozeDate}
                                      onClick={() => { snoozeThread(new Date(customSnoozeDate)); setShowMoreMenu(false); }}
                                      style={{padding:'4px 8px',fontSize:'11px'}}>Go</button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Mark unread/read */}
                          <button
                            onClick={() => { modifyThread(isUnread ? 'mark_read' : 'mark_unread'); setShowMoreMenu(false); }}
                            style={{display:'block',width:'100%',textAlign:'left',padding:'10px 12px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',color:'var(--text-1)',fontSize:'13px'}}>
                            {isUnread ? '✓ Mark as read' : '○ Mark as unread'}
                          </button>

                          {/* Labels */}
                          <button
                            onClick={() => { setShowLabelPicker(true); setShowMoreMenu(false); }}
                            style={{display:'block',width:'100%',textAlign:'left',padding:'10px 12px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',color:'var(--text-1)',fontSize:'13px'}}>
                            🏷 Apply labels…
                          </button>

                          <div style={{borderTop:'1px solid var(--border)',margin:'4px 0'}}/>

                          {/* Mark as spam (destructive) */}
                          <button
                            onClick={() => { modifyThread('spam', { removeFromList: true }); setShowMoreMenu(false); }}
                            style={{display:'block',width:'100%',textAlign:'left',padding:'10px 12px',background:'none',border:'none',cursor:'pointer',borderRadius:'4px',color:'var(--red)',fontSize:'13px'}}>
                            ⚠ Mark as spam
                          </button>
                        </div>
                      </>,
                      document.body
                    )}
                  </>
                );
              })()}
            </div>

            {/* Subject line */}
            <div style={{padding:'14px 16px 6px',borderBottom:'1px solid var(--border)'}}>
              <h3 style={{margin:0,fontSize:'17px',fontWeight:600,color:'var(--text-1)',lineHeight:1.35,wordBreak:'break-word'}}>
                {selectedThread.subject || '(no subject)'}
              </h3>
            </div>

            <div className="panel-body" style={{padding:'0'}}>
              {loadingMessages
                ? <div className="loading-screen" style={{minHeight:'200px'}}><div className="spinner"/></div>
                : selectedMessages.length === 0
                  ? <p style={{color:'var(--text-2)',padding:'20px'}}>No messages found in this thread.</p>
                  : selectedMessages.map((msg, idx) => {
                      const senderProfile = profileForEmail(msg.from_address);
                      const sentTo = Array.isArray(msg.to_addresses) ? msg.to_addresses : [];
                      const fmtRecipient = (r) => {
                        if (typeof r === 'string') return r;
                        if (r && typeof r === 'object') return r.name ? `${r.name} <${r.email}>` : r.email;
                        return String(r);
                      };
                      const isLast = idx === selectedMessages.length - 1;
                      const canReplyAll = sentTo.length > 1 || (msg.cc_addresses || []).length > 0;
                      return (
                        <div key={msg.id} style={{borderBottom: isLast ? 'none' : '1px solid var(--border)'}}>
                          {/* Metadata card */}
                          <div style={{
                            padding:'12px 16px',
                            background:'var(--bg-base)',
                            borderBottom:'1px solid var(--border)'
                          }}>
                            <div style={{display:'flex',gap:'10px',alignItems:'flex-start',flexWrap:'wrap'}}>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom:'2px'}}>
                                  <span style={{fontWeight:600,color:'var(--text-1)',fontSize:'14px'}}>
                                    {msg.from_name || msg.from_address}
                                  </span>
                                  {senderProfile && (
                                    <span className="pill" style={{background:'rgba(197,169,94,0.12)',border:'1px solid var(--accent)',color:'var(--accent)',fontSize:'10px',padding:'2px 6px'}}>
                                      {senderProfile.primary_letter}{senderProfile.secondary_letter ? `/${senderProfile.secondary_letter}` : ''} · {senderProfile.confidence}
                                    </span>
                                  )}
                                </div>
                                {msg.from_name && (
                                  <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'4px',wordBreak:'break-word'}}>
                                    {msg.from_address}
                                  </div>
                                )}
                                {sentTo.length > 0 && (
                                  <div style={{fontSize:'11px',color:'var(--text-3)',wordBreak:'break-word',lineHeight:1.5}}>
                                    <span style={{color:'var(--text-3)'}}>to </span>
                                    {sentTo.map(fmtRecipient).join(', ')}
                                  </div>
                                )}
                              </div>
                              <div style={{fontSize:'11px',color:'var(--text-3)',whiteSpace:'nowrap',flexShrink:0}}>
                                {msg.internal_date ? new Date(msg.internal_date).toLocaleString(undefined, {
                                  month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'
                                }) : ''}
                              </div>
                            </div>
                          </div>

                          {/* Message body — prefer HTML (richer, clickable links, formatting).
                              Fall back to text with auto-linked URLs. Final fallback: snippet. */}
                          <div style={{padding:'14px 16px'}}>
                            {msg.body_html ? (
                              <EmailHtmlFrame html={msg.body_html} />
                            ) : msg.body_text ? (
                              <PlainTextBody text={msg.body_text} />
                            ) : (
                              <div style={{fontSize:'13.5px',lineHeight:'1.7',color:'var(--text-3)',fontStyle:'italic'}}>
                                {msg.snippet || '(no content)'}
                              </div>
                            )}
                          </div>

                          {/* Per-message reply buttons (Gmail-style: at bottom of each message in a thread) */}
                          {isLast && (
                            <div style={{display:'flex',gap:'6px',padding:'0 16px 16px',flexWrap:'wrap'}}>
                              <button className="btn btn-ghost btn-sm" onClick={() => openReply(msg, false)} style={{fontSize:'12px'}}>↩ Reply</button>
                              {canReplyAll && (
                                <button className="btn btn-ghost btn-sm" onClick={() => openReply(msg, true)} style={{fontSize:'12px'}}>↩↩ Reply all</button>
                              )}
                              <button className="btn btn-ghost btn-sm" onClick={() => openForward(msg)} style={{fontSize:'12px'}}>↪ Forward</button>
                            </div>
                          )}
                        </div>
                      );
                    })
              }
            </div>
          </div>
        )}
      </div>

      {showLabelPicker && selectedThread && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowLabelPicker(false)} style={{zIndex: 1100}}>
          <div className="modal" style={{maxWidth:'460px',width:'92%'}}>
            <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <h3 style={{margin:0}}>🏷 Apply labels</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowLabelPicker(false)}>✕</button>
            </div>
            <LabelPickerBody
              currentLabels={currentLabels}
              userLabels={userLabels}
              onApply={applyLabels}
              onRefresh={refreshLabels}
              onCancel={() => setShowLabelPicker(false)}
            />
          </div>
        </div>
      )}

      {showCompose && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget && setShowCompose(false)}>
          <div className="modal">
            <div className="modal-header">
              <h3>{composeReplyMeta ? 'Reply' : 'New message'}</h3>
              <button className="modal-close" onClick={()=>setShowCompose(false)}>×</button>
            </div>
            <form onSubmit={handleSend}>
              <div className="form-group">
                <label className="form-label" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span>From</span>
                  {verifiedAliases.length === 0 && (
                    <button type="button" onClick={() => runAliasesSync(false)} disabled={syncingAliases} className="btn btn-ghost btn-sm" style={{padding:'2px 8px',fontSize:'10px',color:'var(--accent)'}}>
                      {syncingAliases ? 'syncing…' : 'sync senders'}
                    </button>
                  )}
                </label>
                {verifiedAliases.length === 0 ? (
                  <div style={{padding:'8px 12px',background:'var(--bg-base)',borderRadius:'6px',fontSize:'12px',color:'var(--text-3)'}}>
                    Sending as <strong style={{color:'var(--text-1)'}}>{account.email_address}</strong> · click <strong>sync senders</strong> to load your Gmail aliases
                  </div>
                ) : (
                  <select
                    className="form-select"
                    value={composeFrom || (defaultAlias?.email_address || account.email_address)}
                    onChange={e => setComposeFrom(e.target.value)}
                  >
                    {verifiedAliases.map(a => (
                      <option key={a.email_address} value={a.email_address}>
                        {a.display_name ? `${a.display_name} <${a.email_address}>` : a.email_address}
                        {a.is_default ? ' · default' : ''}
                        {a.is_primary ? ' · primary' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="form-group"><label className="form-label">To</label><input className="form-input" type="text" value={composeTo} onChange={e=>setComposeTo(e.target.value)} placeholder="recipient@example.com (comma-separated for multiple)" required /></div>
              <div className="form-group"><label className="form-label">Subject</label><input className="form-input" value={composeSubject} onChange={e=>setComposeSubject(e.target.value)} placeholder="Subject" required /></div>
              <div className="form-group"><label className="form-label">Message</label><textarea className="form-textarea" value={composeBody} onChange={e=>setComposeBody(e.target.value)} placeholder="Write your message…" style={{minHeight:'200px'}} required /></div>
              {sendMsg && <p style={{fontSize:'13px',color: sendMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)',margin:'4px 0'}}>{sendMsg}</p>}
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={()=>setShowCompose(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={sending}>{sending?'Sending…':'Send'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────
function DashboardView({ tasks, setTasks, unreadEmailCount = 0, user, setView, robots, contacts = [], brain, defaultSystem, properties = [], events = [] }) {
  const [editTask, setEditTask] = useState(null);

  // Save edits to a task triggered from the dashboard. Mirrors the logic in
  // TasksView so behavior (priority system, task_contacts sync) is identical.
  async function handleTaskSave(data) {
    if (!editTask) return;
    const { _contact_ids, ...taskData } = data;
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
        notify("Task saved but contact links failed to update.", 'error');
        return;
      }
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
  const pending = tasks.filter(t=>!t.completed);
  const topTasks = sortTasks(pending.filter(isTopPriority));
  const today = new Date();
  const gr = today.getHours()<12?'Good morning':today.getHours()<17?'Good afternoon':'Good evening';
  const name = user?.user_metadata?.display_name?.trim() || user?.user_metadata?.full_name?.trim()?.split(/\s+/)[0] || user?.email?.split('@')[0] || 'there';
  const overdue = pending.filter(t=>t.due_date&&new Date(t.due_date)<today);
  const robot = robots[0];

  return (
    <div>
      <div className="page-header">
        <h2>{gr}, {name} 👋</h2>
        <p>{today.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</p>
      </div>
      <div className="cards-row">
        <div className="stat-card" style={{cursor:'pointer'}} onClick={()=>setView('tasks')}><div className="stat-label">Open Tasks</div><div className="stat-value">{pending.length}</div><div className="stat-sub">{topTasks.length} top priority</div></div>
        <div className="stat-card" style={{cursor:'pointer'}} onClick={()=>setView('inbox')}><div className="stat-label">Unread Email</div><div className="stat-value">{unreadEmailCount}</div><div className="stat-sub">in inbox</div></div>
        <div className="stat-card"><div className="stat-label">Done Today</div><div className="stat-value" style={{color:'var(--green)'}}>{tasks.filter(t=>t.completed&&t.updated_at&&new Date(t.updated_at).toDateString()===today.toDateString()).length}</div></div>
        <div className="stat-card"><div className="stat-label">Overdue</div><div className="stat-value" style={{color:overdue.length>0?'var(--red)':'var(--text-1)'}}>{overdue.length}</div></div>
      </div>
      <div className="dash-grid">
        <div className="panel">
          <div className="panel-header"><h3>🔥 Top Priority</h3><button className="btn btn-ghost btn-sm" onClick={()=>setView('tasks')}>All tasks</button></div>
          <div className="panel-body">
            {topTasks.length===0
              ? <div className="empty-state" style={{padding:'20px 0'}}><p>All clear — no top priority tasks.</p></div>
              : <div className="task-list">{topTasks.slice(0,5).map(t=>(
                  <div key={t.id} className="task-item" onClick={() => setEditTask(t)} style={{cursor:'pointer'}}>
                    <input
                      type="checkbox"
                      checked={!!t.completed}
                      onClick={(e) => toggleComplete(t, e)}
                      onChange={() => { /* handled by onClick */ }}
                      style={{flexShrink:0,width:'18px',height:'18px',cursor:'pointer',accentColor:'var(--accent)'}}
                      title={t.completed ? 'Mark as not done' : 'Mark as done'}
                    />
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
          <TaskModal
            onClose={() => setEditTask(null)}
            onSave={handleTaskSave}
            initial={editTask}
            defaultSystem={defaultSystem}
            brain={brain}
            contacts={contacts}
            properties={properties}
            events={events}
            userId={user.id}
          />
        )}
        {robot && (
          <div className="panel" style={{cursor:'pointer',transition:'border-color 0.15s'}} onClick={()=>setView('chat')}
            onMouseEnter={e=>e.currentTarget.style.borderColor='var(--accent)'}
            onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border)'}>
            <div className="panel-header"><h3>✦ Chat with {robot.name}</h3><span className="pill pill-purple">AI</span></div>
            <div className="panel-body" style={{textAlign:'center',padding:'28px 20px'}}>
              <div style={{fontSize:'36px',marginBottom:'10px'}}>{robot.avatar_emoji||'🤖'}</div>
              <p style={{fontSize:'13px',color:'var(--text-2)',marginBottom:'4px',fontWeight:600}}>{robot.name}</p>
              <p style={{fontSize:'12px',color:'var(--text-3)'}}>{robot.role}</p>
              <button className="btn btn-primary" style={{marginTop:'14px'}}>Start chatting →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// CONTACTS VIEW
// ─────────────────────────────────────────
// Contact detail modal: shows DISC profile, evidence trail, baseline test entry,
// and re-analyze. Replaces directly opening the edit form when clicking a contact.
// Recordings panel inside ContactDetailModal: list, upload, transcribe, view transcript.
function ContactRecordingsSection({ contact, userId, onTranscribed }) {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [uploadForm, setUploadForm] = useState({ open: false, title: '', firstSpeaker: 'me', recordedAt: new Date().toISOString().slice(0, 16), file: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from('recordings')
        .select('*').eq('contact_id', contact.id).order('recorded_at', { ascending: false });
      if (!cancelled) { setRecordings(data || []); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [contact.id]);

  async function refreshRecordings() {
    const { data } = await supabase.from('recordings')
      .select('*').eq('contact_id', contact.id).order('recorded_at', { ascending: false });
    setRecordings(data || []);
  }

  async function handleUpload(e) {
    e.preventDefault();
    if (!uploadForm.file) { setError('Pick an audio file first.'); return; }
    if (!uploadForm.title.trim()) { setError('Add a title.'); return; }
    if (uploadForm.file.size > 50 * 1024 * 1024) {
      setError(`File too large (${(uploadForm.file.size / 1024 / 1024).toFixed(1)} MB). Max 50 MB. Try compressing or splitting.`);
      return;
    }
    setError(null);
    setUploading(true);
    setUploadProgress(5);
    try {
      const { data: rec, error: insErr } = await supabase.from('recordings').insert({
        user_id: userId,
        contact_id: contact.id,
        title: uploadForm.title.trim(),
        mime_type: uploadForm.file.type || 'audio/mpeg',
        size_bytes: uploadForm.file.size,
        recorded_at: new Date(uploadForm.recordedAt).toISOString(),
        first_speaker: uploadForm.firstSpeaker,
        transcription_status: 'pending',
      }).select().single();
      if (insErr) throw new Error(`DB row failed: ${insErr.message}`);

      setUploadProgress(15);

      const safeFilename = uploadForm.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${userId}/${rec.id}/${safeFilename}`;
      const { error: upErr } = await supabase.storage.from('recordings').upload(path, uploadForm.file, {
        contentType: uploadForm.file.type || 'audio/mpeg',
        upsert: false,
      });
      if (upErr) {
        await supabase.from('recordings').delete().eq('id', rec.id);
        throw new Error(`Upload failed: ${upErr.message}`);
      }

      setUploadProgress(60);
      await supabase.from('recordings').update({ storage_path: path }).eq('id', rec.id);
      setUploadProgress(75);

      supabase.functions.invoke('recording-transcribe', {
        body: { recording_id: rec.id, user_id: userId },
      }).then(async () => {
        await refreshRecordings();
        if (onTranscribed) onTranscribed();
      }).catch(() => { /* error surfaces via the row's transcription_error */ });

      setUploadProgress(100);
      setUploadForm({ open: false, title: '', firstSpeaker: 'me', recordedAt: new Date().toISOString().slice(0, 16), file: null });
      await refreshRecordings();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setUploading(false);
      setTimeout(() => setUploadProgress(0), 1500);
    }
  }

  async function retranscribe(rec) {
    if (rec.audio_purged) { setError('Audio has been purged — cannot re-transcribe.'); return; }
    await supabase.from('recordings').update({ transcription_status: 'transcribing', transcription_error: null }).eq('id', rec.id);
    await refreshRecordings();
    try {
      await supabase.functions.invoke('recording-transcribe', { body: { recording_id: rec.id, user_id: userId } });
      await refreshRecordings();
      if (onTranscribed) onTranscribed();
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  async function deleteRecording(rec) {
    if (!window.confirm(`Delete "${rec.title}"? This removes the audio AND transcript.`)) return;
    if (rec.storage_path) {
      await supabase.storage.from('recordings').remove([rec.storage_path]).catch(() => {});
    }
    await supabase.from('recordings').delete().eq('id', rec.id);
    await refreshRecordings();
  }

  function statusBadge(s) {
    const map = {
      pending: { text: 'pending', color: 'var(--text-3)', bg: 'var(--bg-card)' },
      transcribing: { text: 'transcribing…', color: 'var(--accent)', bg: 'var(--accent-glow)' },
      ready: { text: '✓ ready', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
      error: { text: '⚠ error', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
      no_audio: { text: 'no audio', color: 'var(--text-3)', bg: 'var(--bg-card)' },
    };
    const m = map[s] || map.pending;
    return <span className="pill" style={{ fontSize: '10px', padding: '2px 7px', color: m.color, background: m.bg, border: `1px solid ${m.color}` }}>{m.text}</span>;
  }

  function fmtDuration(seconds) {
    if (!seconds) return null;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
          🎙 Recordings {recordings.length > 0 && <span style={{ marginLeft: '4px', color: 'var(--text-2)' }}>({recordings.length})</span>}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setUploadForm(f => ({ ...f, open: !f.open }))} style={{ fontSize: '11px' }}>
          {uploadForm.open ? '× Cancel' : '+ Upload audio'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '8px 10px', marginBottom: '8px', borderRadius: '6px', background: 'rgba(239,68,68,0.12)', border: '1px solid #ef4444', color: '#ef4444', fontSize: '11px' }}>
          {error}
        </div>
      )}

      {uploadForm.open && (
        <form onSubmit={handleUpload} style={{ padding: '12px', background: 'var(--bg-base)', borderRadius: '8px', border: '1px solid var(--border)', marginBottom: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              type="file"
              accept="audio/*,video/mp4,video/webm"
              onChange={e => setUploadForm(f => ({ ...f, file: e.target.files?.[0] || null, title: f.title || (e.target.files?.[0]?.name.replace(/\.[^.]+$/, '') || '') }))}
              style={{ fontSize: '12px', color: 'var(--text-2)' }}
              required
            />
            <input
              className="form-input"
              placeholder="Title (e.g. 'Discovery call with Sarah')"
              value={uploadForm.title}
              onChange={e => setUploadForm(f => ({ ...f, title: e.target.value }))}
              style={{ padding: '6px 10px', fontSize: '12px' }}
              required
            />
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-3)', display: 'block', marginBottom: '2px' }}>When recorded</label>
                <input type="datetime-local" className="form-input" value={uploadForm.recordedAt}
                  onChange={e => setUploadForm(f => ({ ...f, recordedAt: e.target.value }))}
                  style={{ padding: '6px 8px', fontSize: '12px' }} required />
              </div>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <label style={{ fontSize: '10px', color: 'var(--text-3)', display: 'block', marginBottom: '2px' }}>Who spoke first?</label>
                <select className="form-select" value={uploadForm.firstSpeaker}
                  onChange={e => setUploadForm(f => ({ ...f, firstSpeaker: e.target.value }))}
                  style={{ padding: '6px 8px', fontSize: '12px' }}>
                  <option value="me">I did</option>
                  <option value="contact">{contact.name || 'Contact'} did</option>
                </select>
              </div>
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-3)', lineHeight: 1.5 }}>
              Max 50 MB. Audio kept 90 days then auto-deleted; transcript stays forever. Whisper transcribes; speakers labeled by alternating-gap heuristic (you can edit later).
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={uploading}>
                {uploading ? `Uploading ${uploadProgress}%…` : 'Upload & transcribe'}
              </button>
              {uploadProgress > 0 && (
                <div style={{ flex: 1, height: '4px', background: 'var(--bg-card)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{ width: `${uploadProgress}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.3s' }} />
                </div>
              )}
            </div>
          </div>
        </form>
      )}

      {loading ? (
        <div style={{ padding: '8px', fontSize: '11px', color: 'var(--text-3)' }}>Loading…</div>
      ) : recordings.length === 0 ? (
        <div style={{ padding: '12px', background: 'var(--bg-base)', border: '1px dashed var(--border)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-3)', textAlign: 'center' }}>
          No recordings yet. Upload a call/meeting and Claude will fold it into the behavioral signal.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {recordings.map(r => {
            const isExpanded = expandedId === r.id;
            return (
              <div key={r.id} style={{ padding: '8px 10px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{r.title}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-3)', display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '2px' }}>
                      {r.recorded_at && <span>{new Date(r.recorded_at).toLocaleString()}</span>}
                      {r.duration_seconds && <span>· {fmtDuration(r.duration_seconds)}</span>}
                      {r.size_bytes && <span>· {(r.size_bytes / 1024 / 1024).toFixed(1)} MB</span>}
                      {r.audio_purged && <span style={{ color: '#f59e0b' }}>· audio purged</span>}
                    </div>
                  </div>
                  {statusBadge(r.transcription_status)}
                  {r.transcript_text && (
                    <button onClick={() => setExpandedId(isExpanded ? null : r.id)} className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', fontSize: '10px' }}>
                      {isExpanded ? 'hide' : 'view'}
                    </button>
                  )}
                  <button onClick={() => retranscribe(r)} className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', fontSize: '10px' }} title="Re-transcribe" disabled={r.audio_purged}>↻</button>
                  <button onClick={() => deleteRecording(r)} className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', fontSize: '10px', color: '#ef4444' }} title="Delete">×</button>
                </div>
                {r.transcription_error && (
                  <div style={{ marginTop: '6px', padding: '6px 8px', background: 'rgba(239,68,68,0.08)', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', fontSize: '10px' }}>
                    {r.transcription_error}
                  </div>
                )}
                {isExpanded && r.transcript_text && (
                  <div style={{ marginTop: '8px', padding: '10px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '11px', color: 'var(--text-1)', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: '320px', overflowY: 'auto' }}>
                    {r.transcript_text}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Contact detail modal: shows DISC profile, evidence trail, baseline test entry,
// and re-analyze. Replaces directly opening the edit form when clicking a contact.
function ContactDetailModal({ contact, profile, onClose, onEdit, onProfileUpdate, userId }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState(null);
  const [evidence, setEvidence] = useState([]);
  const [loadingEvidence, setLoadingEvidence] = useState(true);
  const [showBaselineForm, setShowBaselineForm] = useState(false);

  // Baseline form local state
  const [baseD, setBaseD] = useState(profile?.baseline_d_score ?? 50);
  const [baseI, setBaseI] = useState(profile?.baseline_i_score ?? 50);
  const [baseS, setBaseS] = useState(profile?.baseline_s_score ?? 50);
  const [baseC, setBaseC] = useState(profile?.baseline_c_score ?? 50);
  const [baseTakenAt, setBaseTakenAt] = useState(profile?.baseline_taken_at ? profile.baseline_taken_at.slice(0,10) : new Date().toISOString().slice(0,10));
  const [baseSource, setBaseSource] = useState(profile?.baseline_source || 'Prism Test');
  const [savingBase, setSavingBase] = useState(false);

  // Research flow state
  const [showResearchModal, setShowResearchModal] = useState(false);
  const [researchScope, setResearchScope] = useState('both');  // 'personal' | 'business' | 'both'
  const [researchStage, setResearchStage] = useState('idle');  // 'idle' | 'identifying' | 'choose_candidate' | 'researching' | 'done' | 'error'
  const [researchCandidates, setResearchCandidates] = useState([]);
  const [researchError, setResearchError] = useState(null);
  const [showResearchReport, setShowResearchReport] = useState(false);  // for viewing existing report

  // Linked tasks
  const [linkedTasks, setLinkedTasks] = useState([]);
  const [tasksExpanded, setTasksExpanded] = useState(false);

  // Pass 3: linked events (events.contact_id) + linked properties (property_contacts join)
  const [linkedEvents, setLinkedEvents] = useState([]);
  const [linkedProperties, setLinkedProperties] = useState([]);

  // Date-stamped notes (proper notes table — separate from contacts.notes pinned summary)
  const [dateNotes, setDateNotes] = useState([]);
  const [newNoteBody, setNewNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingNoteBody, setEditingNoteBody] = useState('');

  // Manual interaction logging
  const [showLogInteraction, setShowLogInteraction] = useState(false);
  const [interactionForm, setInteractionForm] = useState({
    channel: 'phone',
    direction: 'outbound',
    occurred_at: new Date().toISOString().slice(0, 16),
    brief: '',
  });
  const [interactions, setInteractions] = useState([]);

  // Load tasks, dated notes, interactions on mount
  useEffect(() => {
    if (!contact?.id) return;
    let cancelled = false;
    (async () => {
      // Tasks linked to this contact
      const { data: linkRows } = await supabase.from('task_contacts')
        .select('task_id').eq('contact_id', contact.id);
      if (linkRows && linkRows.length > 0) {
        const taskIds = linkRows.map(r => r.task_id);
        const { data: tasks } = await supabase.from('tasks')
          .select('*').in('id', taskIds).order('completed').order('due_date', { nullsFirst: false });
        if (!cancelled && tasks) setLinkedTasks(tasks);
      } else if (!cancelled) {
        setLinkedTasks([]);
      }

      // Dated notes
      const { data: notes } = await supabase.from('contact_notes')
        .select('*').eq('contact_id', contact.id).order('created_at', { ascending: false });
      if (!cancelled && notes) setDateNotes(notes);

      // Manual interactions
      const { data: ints } = await supabase.from('contact_interactions')
        .select('*').eq('contact_id', contact.id).order('occurred_at', { ascending: false }).limit(20);
      if (!cancelled && ints) setInteractions(ints);

      // Pass 3: linked events
      const { data: evs } = await supabase.from('events')
        .select('*').eq('contact_id', contact.id).order('start_at', { ascending: false }).limit(50);
      if (!cancelled && evs) setLinkedEvents(evs);

      // Pass 3: linked properties via property_contacts join
      const { data: pcRows } = await supabase.from('property_contacts')
        .select('property_id').eq('contact_id', contact.id);
      if (pcRows && pcRows.length > 0) {
        const propIds = pcRows.map(r => r.property_id);
        const { data: props } = await supabase.from('properties')
          .select('id, nickname, address, city, state, category, status').in('id', propIds);
        if (!cancelled && props) setLinkedProperties(props);
      } else if (!cancelled) {
        setLinkedProperties([]);
      }
    })();
    return () => { cancelled = true; };
  }, [contact?.id]);

  // Compute communication summary from contact fields (already populated by sync)
  function daysSince(ts) {
    if (!ts) return null;
    return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  }
  function formatRelative(ts) {
    const d = daysSince(ts);
    if (d === null) return '';
    if (d === 0) return 'today';
    if (d === 1) return 'yesterday';
    if (d < 7) return `${d}d ago`;
    if (d < 30) return `${Math.floor(d/7)}w ago`;
    if (d < 365) return `${Math.floor(d/30)}mo ago`;
    return `${Math.floor(d/365)}y ago`;
  }
  const lastIn = contact.last_inbound_at;
  const lastOut = contact.last_outbound_at;
  const lastDir = contact.last_communication_direction;
  const lastChannel = contact.last_communication_channel || 'email';
  const owedDays = (lastDir === 'inbound' && lastIn) ? daysSince(lastIn) : null;

  async function addDatedNote() {
    if (!newNoteBody.trim()) return;
    setSavingNote(true);
    try {
      const { data } = await supabase.from('contact_notes').insert({
        user_id: userId, contact_id: contact.id, body: newNoteBody.trim(),
      }).select().single();
      if (data) {
        setDateNotes(prev => [data, ...prev]);
        setNewNoteBody('');
      }
    } finally { setSavingNote(false); }
  }
  async function saveEditedNote() {
    if (!editingNoteId || !editingNoteBody.trim()) return;
    const { data } = await supabase.from('contact_notes').update({ body: editingNoteBody.trim() })
      .eq('id', editingNoteId).select().single();
    if (data) setDateNotes(prev => prev.map(n => n.id === data.id ? data : n));
    setEditingNoteId(null); setEditingNoteBody('');
  }
  async function deleteNote(id) {
    if (!window.confirm('Delete this note?')) return;
    await supabase.from('contact_notes').delete().eq('id', id);
    setDateNotes(prev => prev.filter(n => n.id !== id));
  }

  async function logInteraction() {
    if (!interactionForm.channel || !interactionForm.direction) return;
    const occurredAt = interactionForm.occurred_at
      ? new Date(interactionForm.occurred_at).toISOString()
      : new Date().toISOString();
    const { data: created } = await supabase.from('contact_interactions').insert({
      user_id: userId,
      contact_id: contact.id,
      channel: interactionForm.channel,
      direction: interactionForm.direction,
      occurred_at: occurredAt,
      brief: interactionForm.brief.trim() || null,
    }).select().single();
    if (created) {
      setInteractions(prev => [created, ...prev]);
      // Also bump contact's last_inbound/outbound + channel + direction if this is more recent
      const isMoreRecentInbound = interactionForm.direction === 'inbound' && (!lastIn || new Date(occurredAt) > new Date(lastIn));
      const isMoreRecentOutbound = interactionForm.direction === 'outbound' && (!lastOut || new Date(occurredAt) > new Date(lastOut));
      const patch = {};
      if (isMoreRecentInbound) patch.last_inbound_at = occurredAt;
      if (isMoreRecentOutbound) patch.last_outbound_at = occurredAt;
      // Recompute direction
      const newIn = patch.last_inbound_at || lastIn;
      const newOut = patch.last_outbound_at || lastOut;
      if (newIn || newOut) {
        patch.last_communication_channel = interactionForm.channel;
        patch.last_communication_direction = (!newOut || (newIn && new Date(newIn) > new Date(newOut))) ? 'inbound' : 'outbound';
      }
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from('contacts').update(patch).eq('id', contact.id);
        if (error) {
          notify("Couldn't update contact's last-contact info.", 'error');
        } else {
          // Update local contact object — caller may not refetch
          Object.assign(contact, patch);
        }
      }
      setShowLogInteraction(false);
      setInteractionForm({ channel: 'phone', direction: 'outbound', occurred_at: new Date().toISOString().slice(0, 16), brief: '' });
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingEvidence(true);
      const { data } = await supabase.from('disc_evidence')
        .select('*').eq('contact_id', contact.id).order('weight', { ascending: false }).limit(20);
      if (!cancelled) {
        setEvidence(data || []);
        setLoadingEvidence(false);
      }
    })();
    return () => { cancelled = true; };
  }, [contact.id]);

  async function reanalyze() {
    setAnalyzing(true); setAnalyzeMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke('disc-analyze', {
        body: { contact_id: contact.id, user_id: userId, force: true }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      // Reload profile + evidence
      const { data: freshProfile } = await supabase.from('profiles').select('*').eq('contact_id', contact.id).maybeSingle();
      const { data: freshEvidence } = await supabase.from('disc_evidence').select('*').eq('contact_id', contact.id).order('weight', { ascending: false }).limit(20);
      if (freshProfile) onProfileUpdate(freshProfile);
      if (freshEvidence) setEvidence(freshEvidence);
      setAnalyzeMsg({ type: 'ok', text: `Updated · ${data.status || 'ok'} · ${data.evidence_count || 0} pieces of evidence` });
    } catch (e) {
      setAnalyzeMsg({ type: 'error', text: 'Failed: ' + (e.message || e) });
    } finally {
      setAnalyzing(false);
      setTimeout(() => setAnalyzeMsg(null), 5000);
    }
  }

  async function saveBaseline() {
    const scores = { D: baseD, I: baseI, S: baseS, C: baseC };
    const primary = Object.keys(scores).reduce((a,b) => scores[a] > scores[b] ? a : b);
    const secondary = Object.keys(scores)
      .filter(k => k !== primary)
      .reduce((a,b) => scores[a] > scores[b] ? a : b);
    const showSecondary = scores[secondary] >= 50 && (scores[primary] - scores[secondary]) <= 25;
    setSavingBase(true);
    try {
      const payload = {
        baseline_d_score: baseD, baseline_i_score: baseI, baseline_s_score: baseS, baseline_c_score: baseC,
        baseline_primary: primary,
        baseline_secondary: showSecondary ? secondary : null,
        baseline_taken_at: baseTakenAt,
        baseline_source: baseSource || 'Prism Test',
        baseline_locked: true,
      };
      let upd;
      if (profile) {
        const { data } = await supabase.from('profiles').update(payload).eq('id', profile.id).select().single();
        upd = data;
      } else {
        const { data } = await supabase.from('profiles').insert({
          ...payload,
          user_id: userId, contact_id: contact.id, subject_kind: 'contact',
          confidence: 'high', source: 'manual',
          d_score: baseD, i_score: baseI, s_score: baseS, c_score: baseC,
          primary_letter: primary, secondary_letter: showSecondary ? secondary : null,
        }).select().single();
        upd = data;
      }
      if (upd) onProfileUpdate(upd);
      setShowBaselineForm(false);
      setAnalyzeMsg({ type: 'ok', text: 'Baseline test result saved.' });
      setTimeout(() => setAnalyzeMsg(null), 4000);
    } catch (e) {
      setAnalyzeMsg({ type: 'error', text: 'Save failed: ' + (e.message || e) });
      setTimeout(() => setAnalyzeMsg(null), 5000);
    } finally {
      setSavingBase(false);
    }
  }

  const hasBaseline = !!(profile && profile.baseline_d_score !== null && profile.baseline_d_score !== undefined);
  const hasInference = !!(profile && profile.last_analyzed_at);
  const hasResearch = !!(profile && profile.research_taken_at);
  const discBarColors = { D: '#ef4444', I: '#f59e0b', S: '#22c55e', C: '#3b82f6' };

  // Identify candidates for this contact, then either auto-run (locked) or
  // prompt for candidate selection (strong/weak/insufficient).
  async function startResearch() {
    setResearchStage('identifying');
    setResearchError(null);
    setResearchCandidates([]);
    try {
      const { data, error } = await supabase.functions.invoke('contact-identify', {
        body: { contact_id: contact.id },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      setResearchCandidates(data.candidates || []);
      if (data.confidence === 'insufficient') {
        setResearchError(data.message || 'Not enough info to identify this person safely. Add an email, phone, or employer to the contact.');
        setResearchStage('error');
        return;
      }
      if ((data.candidates || []).length === 0) {
        setResearchError('No matching public profiles found. Try adding more identifiers (email, phone, employer) to the contact.');
        setResearchStage('error');
        return;
      }
      if (data.confidence === 'locked' && data.candidates.length === 1) {
        // Auto-advance to research
        await runResearch(data.candidates[0], 'email' in (contact || {}) && contact.email ? 'email' : (contact.phone ? 'phone' : 'manual'));
      } else {
        // User picks
        setResearchStage('choose_candidate');
      }
    } catch (err) {
      setResearchError(err.message || String(err));
      setResearchStage('error');
    }
  }

  async function runResearch(candidate, matchedBy) {
    setResearchStage('researching');
    setResearchError(null);
    try {
      const { data, error } = await supabase.functions.invoke('contact-research', {
        body: {
          contact_id: contact.id,
          candidate,
          scope: researchScope,
          matched_by: matchedBy,
        },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      // Refresh profile to pick up the new research_* fields
      const { data: freshProfile } = await supabase.from('profiles')
        .select('*').eq('contact_id', contact.id).maybeSingle();
      if (freshProfile) onProfileUpdate(freshProfile);
      setResearchStage('done');
    } catch (err) {
      setResearchError(err.message || String(err));
      setResearchStage('error');
    }
  }

  // Copy research-derived DISC into baseline_* fields
  async function useResearchAsBaseline() {
    if (!profile || !profile.research_d_score) return;
    setSavingBase(true);
    try {
      const { data, error } = await supabase.from('profiles').update({
        baseline_d_score: profile.research_d_score,
        baseline_i_score: profile.research_i_score,
        baseline_s_score: profile.research_s_score,
        baseline_c_score: profile.research_c_score,
        baseline_primary: profile.research_primary,
        baseline_secondary: profile.research_secondary,
        baseline_source: `Research (${profile.research_scope}, ${profile.research_confidence})`,
        baseline_taken_at: profile.research_taken_at,
        baseline_locked: true,
      }).eq('id', profile.id).select().single();
      if (error) throw error;
      onProfileUpdate(data);
      setAnalyzeMsg({ type: 'ok', text: 'Research read copied to baseline.' });
      setTimeout(() => setAnalyzeMsg(null), 4000);
    } catch (e) {
      setAnalyzeMsg({ type: 'error', text: 'Copy failed: ' + (e.message || e) });
    } finally {
      setSavingBase(false);
    }
  }

  function discBars(d, i, s, c, label) {
    return (
      <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
        {label && <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600}}>{label}</div>}
        {[['D',d],['I',i],['S',s],['C',c]].map(([letter, val]) => (
          <div key={letter} style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <span style={{width:'14px',fontWeight:700,color:discBarColors[letter],fontSize:'12px'}}>{letter}</span>
            <div style={{flex:1,height:'8px',background:'var(--bg-base)',borderRadius:'4px',overflow:'hidden'}}>
              <div style={{height:'100%',width:`${val ?? 0}%`,background:discBarColors[letter],transition:'width 0.3s'}}/>
            </div>
            <span style={{minWidth:'28px',textAlign:'right',fontSize:'11px',fontFamily:'monospace',color:'var(--text-2)'}}>{val ?? '—'}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:'640px'}}>
        <div className="modal-header">
          <h3 style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <span>{contact.name || '(unnamed)'}</span>
            {profile?.primary_letter && (
              <span className="pill" style={{
                fontSize:'11px',padding:'2px 8px',
                background: discBarColors[profile.primary_letter],
                color:'#fff', fontWeight:700,
              }}>
                {profile.primary_letter}{profile.secondary_letter ? `/${profile.secondary_letter}` : ''}
                {profile.confidence_pct ? ` · ${profile.confidence_pct}%` : ''}
              </span>
            )}
          </h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{maxHeight:'70vh',overflowY:'auto',paddingRight:'4px'}}>
          {/* Contact essentials */}
          <div style={{marginBottom:'14px',fontSize:'13px',color:'var(--text-2)',lineHeight:1.6}}>
            {(contact.role || contact.company) && <div>{[contact.role, contact.company].filter(Boolean).join(' · ')}</div>}
            {contact.email && <div>📧 {contact.email}</div>}
            {contact.phone && <div>📞 {contact.phone}</div>}
            {contact.type && <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'4px'}}>Type: {contact.type}</div>}
          </div>

          {analyzeMsg && (
            <div style={{padding:'8px 12px',marginBottom:'14px',borderRadius:'6px',fontSize:'12px',
              background: analyzeMsg.type==='ok' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
              border:`1px solid ${analyzeMsg.type==='ok' ? '#22c55e' : '#ef4444'}`,
              color: analyzeMsg.type==='ok' ? '#22c55e' : '#ef4444'}}>{analyzeMsg.text}</div>
          )}

          {/* DISC display */}
          <div style={{padding:'14px',background:'var(--bg-base)',borderRadius:'10px',border:'1px solid var(--border)',marginBottom:'14px'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'12px',flexWrap:'wrap',gap:'8px'}}>
              <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)'}}>🎯 Behavioral Signal (DISC)</div>
              <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowResearchModal(true)} style={{fontSize:'11px'}}>
                  🔍 {hasResearch ? 'View research' : 'Research from web'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={reanalyze} disabled={analyzing} style={{fontSize:'11px'}}>
                  {analyzing ? '↻ Analyzing…' : '✨ Re-analyze now'}
                </button>
              </div>
            </div>

            {!hasInference && !hasBaseline && (
              <div style={{fontSize:'12px',color:'var(--text-3)',padding:'10px',background:'var(--bg-card)',borderRadius:'6px',border:'1px dashed var(--border)'}}>
                No analysis yet. Click <strong>Re-analyze now</strong> to infer from notes, emails, and observations. Or enter a baseline below if they've taken an official DISC test.
              </div>
            )}

            {hasInference && (
              <div style={{marginBottom: hasBaseline ? '14px' : 0}}>
                {discBars(profile.d_score, profile.i_score, profile.s_score, profile.c_score, hasBaseline ? 'Observed (from communications)' : null)}
                {profile.rationale && (
                  <div style={{fontSize:'12px',color:'var(--text-2)',marginTop:'10px',lineHeight:1.5,fontStyle:'italic'}}>{profile.rationale}</div>
                )}
                {profile.drift_note && (
                  <div style={{padding:'8px 10px',background:'rgba(245,158,11,0.12)',border:'1px solid #f59e0b',borderRadius:'6px',color:'#f59e0b',fontSize:'11px',marginTop:'8px',lineHeight:1.5}}>
                    <strong>Drift from baseline:</strong> {profile.drift_note}
                  </div>
                )}
                <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'8px',display:'flex',gap:'10px',flexWrap:'wrap'}}>
                  <span>Status: {profile.analysis_status}</span>
                  <span>Confidence: {profile.confidence_pct}%</span>
                  <span>{profile.signals_count} signals</span>
                  {profile.last_analyzed_at && <span>Updated: {new Date(profile.last_analyzed_at).toLocaleString()}</span>}
                </div>
                {(() => {
                  // Confidence floor hints — what's needed to reach the next tier.
                  const pct = profile.confidence_pct || 0;
                  const signals = profile.signals_count || 0;
                  if (pct >= 80) return null;
                  let hint = null;
                  if (pct < 40) {
                    const need = Math.max(0, 3 - signals);
                    hint = need > 0
                      ? `Currently provisional. Need ~${need} more piece${need === 1 ? '' : 's'} of evidence (notes or inbound emails) to reach medium confidence.`
                      : `Currently provisional. Evidence is sparse or mixed — more recent communications will sharpen the read.`;
                  } else if (pct < 80) {
                    const need = Math.max(0, 9 - signals);
                    hint = need > 0
                      ? `Medium confidence. Need ~${need} more piece${need === 1 ? '' : 's'} of varied evidence to reach high confidence.`
                      : `Medium confidence. The signals are consistent but not yet strong enough across contexts. A baseline test would lock it in.`;
                  }
                  return hint && (
                    <div style={{fontSize:'10px',color:'var(--accent)',marginTop:'6px',padding:'6px 10px',background:'var(--accent-glow)',border:'1px solid var(--accent-dim)',borderRadius:'4px',lineHeight:1.5}}>
                      💡 {hint}
                    </div>
                  );
                })()}
              </div>
            )}

            {hasBaseline && (
              <div style={{paddingTop: hasInference ? '14px' : 0, borderTop: hasInference ? '1px solid var(--border)' : 'none'}}>
                {discBars(profile.baseline_d_score, profile.baseline_i_score, profile.baseline_s_score, profile.baseline_c_score, `Baseline · ${profile.baseline_source || 'Prism Test'}${profile.baseline_taken_at ? ' · ' + new Date(profile.baseline_taken_at).toLocaleDateString() : ''}`)}
              </div>
            )}

            {hasResearch && profile.research_d_score !== null && profile.research_d_score !== undefined && (
              <div style={{paddingTop: (hasInference || hasBaseline) ? '14px' : 0, borderTop: (hasInference || hasBaseline) ? '1px solid var(--border)' : 'none'}}>
                {discBars(profile.research_d_score, profile.research_i_score, profile.research_s_score, profile.research_c_score,
                  `Research · ${profile.research_scope || 'both'} · ${profile.research_confidence || 'tentative'}${profile.research_taken_at ? ' · ' + new Date(profile.research_taken_at).toLocaleDateString() : ''}`)}
                {profile.research_summary && (
                  <div style={{fontSize:'11px',color:'var(--text-2)',marginTop:'8px',lineHeight:1.5,padding:'8px 10px',background:'var(--bg-card)',borderRadius:'6px'}}>
                    {profile.research_summary.split('\n').map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </div>
                )}
                <div style={{display:'flex',gap:'6px',marginTop:'8px',flexWrap:'wrap'}}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowResearchReport(true)} style={{fontSize:'11px'}}>
                    📄 View full report
                  </button>
                  {!hasBaseline && (
                    <button className="btn btn-ghost btn-sm" onClick={useResearchAsBaseline} disabled={savingBase} style={{fontSize:'11px'}}>
                      {savingBase ? '↻ Copying…' : '↑ Use as baseline'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Baseline entry */}
          <div style={{marginBottom:'14px'}}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowBaselineForm(s => !s)} style={{fontSize:'11px',width:'100%',justifyContent:'flex-start'}}>
              {showBaselineForm ? '▼ Hide' : (hasBaseline ? '▶ Update baseline test result' : '▶ Add official test result (Prism / DISC)')}
            </button>
            {showBaselineForm && (
              <div style={{padding:'14px',background:'var(--bg-base)',borderRadius:'8px',border:'1px solid var(--border)',marginTop:'8px'}}>
                <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'12px',lineHeight:1.5}}>
                  Enter the test results (0-100 per dimension). Claude will treat this as the trusted starting point and surface drift when communications show change.
                </div>
                {[['D',baseD,setBaseD],['I',baseI,setBaseI],['S',baseS,setBaseS],['C',baseC,setBaseC]].map(([letter, val, setter]) => (
                  <div key={letter} style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'8px'}}>
                    <span style={{width:'18px',fontWeight:700,color:discBarColors[letter]}}>{letter}</span>
                    <input type="range" min="0" max="100" value={val} onChange={e=>setter(parseInt(e.target.value))} style={{flex:1,accentColor:discBarColors[letter]}}/>
                    <input type="number" min="0" max="100" value={val} onChange={e=>setter(Math.max(0,Math.min(100,parseInt(e.target.value)||0)))} style={{width:'56px',padding:'4px 6px',fontSize:'12px',background:'var(--bg-card)',color:'var(--text-1)',border:'1px solid var(--border)',borderRadius:'4px'}}/>
                  </div>
                ))}
                <div style={{display:'flex',gap:'8px',marginTop:'12px',flexWrap:'wrap'}}>
                  <div style={{flex:1,minWidth:'140px'}}>
                    <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Test date</label>
                    <input type="date" value={baseTakenAt} onChange={e=>setBaseTakenAt(e.target.value)} className="form-input" style={{padding:'6px 8px',fontSize:'12px'}}/>
                  </div>
                  <div style={{flex:1,minWidth:'140px'}}>
                    <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Source</label>
                    <input type="text" value={baseSource} onChange={e=>setBaseSource(e.target.value)} placeholder="Prism Test" className="form-input" style={{padding:'6px 8px',fontSize:'12px'}}/>
                  </div>
                </div>
                <div style={{display:'flex',gap:'8px',marginTop:'10px',justifyContent:'flex-end'}}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowBaselineForm(false)}>Cancel</button>
                  <button className="btn btn-primary btn-sm" onClick={saveBaseline} disabled={savingBase}>{savingBase ? 'Saving…' : 'Save baseline'}</button>
                </div>
              </div>
            )}
          </div>

          {/* Recordings section */}
          <ContactRecordingsSection contact={contact} userId={userId} onTranscribed={reanalyze} />

          {/* Evidence trail */}
          {hasInference && (
            <div>
              <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,marginBottom:'8px'}}>What Claude considered</div>
              {loadingEvidence ? (
                <div style={{padding:'12px',color:'var(--text-3)',fontSize:'12px'}}>Loading evidence…</div>
              ) : evidence.length === 0 ? (
                <div style={{padding:'12px',background:'var(--bg-base)',border:'1px dashed var(--border)',borderRadius:'6px',color:'var(--text-3)',fontSize:'12px'}}>
                  No evidence pieces recorded.
                </div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
                  {evidence.map(e => {
                    const sigs = [
                      e.signals_d ? `D:${e.signals_d}` : null,
                      e.signals_i ? `I:${e.signals_i}` : null,
                      e.signals_s ? `S:${e.signals_s}` : null,
                      e.signals_c ? `C:${e.signals_c}` : null,
                    ].filter(Boolean);
                    return (
                      <div key={e.id} style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',fontSize:'11px'}}>
                        <div style={{display:'flex',gap:'6px',alignItems:'center',marginBottom:'2px',flexWrap:'wrap'}}>
                          <span style={{fontWeight:600,color:'var(--accent)',fontSize:'10px'}}>{e.source_kind}</span>
                          {sigs.length > 0 && <span style={{fontFamily:'monospace',color:'var(--text-2)',fontSize:'10px'}}>{sigs.join(' ')}</span>}
                          <span style={{color:'var(--text-3)',fontSize:'10px',marginLeft:'auto'}}>weight {Number(e.weight || 0).toFixed(2)}</span>
                        </div>
                        {e.reasoning && <div style={{color:'var(--text-1)',marginBottom:'4px',lineHeight:1.4}}>{e.reasoning}</div>}
                        {e.source_excerpt && (
                          <div style={{color:'var(--text-3)',fontSize:'10px',whiteSpace:'pre-wrap',lineHeight:1.4,maxHeight:'60px',overflow:'hidden',fontStyle:'italic'}}>
                            "{e.source_excerpt.slice(0, 240)}{e.source_excerpt.length > 240 ? '…' : ''}"
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ========== COMMUNICATION PANEL ========== */}
        <div style={{padding:'14px 16px',borderTop:'1px solid var(--border)',background:'var(--bg-base)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px'}}>
            <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)'}}>📡 Communication</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowLogInteraction(s => !s)} style={{fontSize:'11px'}}>
              {showLogInteraction ? '× Cancel' : '+ Log interaction'}
            </button>
          </div>
          {!lastIn && !lastOut && interactions.length === 0 && (
            <div style={{fontSize:'11px',color:'var(--text-3)',fontStyle:'italic'}}>
              No communication recorded yet. Connect email or log a phone/in-person interaction to start tracking.
            </div>
          )}
          {(lastIn || lastOut) && (
            <div style={{display:'flex',gap:'12px',flexWrap:'wrap',marginBottom:'8px'}}>
              <div style={{flex:'1 1 200px',padding:'10px',background: lastDir === 'inbound' ? 'rgba(245,158,11,0.10)' : 'var(--bg-card)', border:`1px solid ${lastDir === 'inbound' ? 'var(--yellow)' : 'var(--border)'}`, borderRadius:'6px'}}>
                <div style={{fontSize:'10px',color: lastDir === 'inbound' ? 'var(--yellow)' : 'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:600,marginBottom:'3px'}}>
                  ⬇ THEY → YOU {lastDir === 'inbound' ? '· awaiting your reply' : ''}
                </div>
                <div style={{fontSize:'12px',color:'var(--text-1)'}}>
                  {lastIn ? `${formatRelative(lastIn)} via ${lastChannel}` : '—'}
                </div>
                {lastIn && <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>{new Date(lastIn).toLocaleString()}</div>}
              </div>
              <div style={{flex:'1 1 200px',padding:'10px',background: lastDir === 'outbound' ? 'rgba(34,197,94,0.10)' : 'var(--bg-card)', border:`1px solid ${lastDir === 'outbound' ? '#22c55e' : 'var(--border)'}`, borderRadius:'6px'}}>
                <div style={{fontSize:'10px',color: lastDir === 'outbound' ? '#22c55e' : 'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:600,marginBottom:'3px'}}>
                  ⬆ YOU → THEM {lastDir === 'outbound' ? '· most recent' : ''}
                </div>
                <div style={{fontSize:'12px',color:'var(--text-1)'}}>
                  {lastOut ? `${formatRelative(lastOut)} via ${lastChannel}` : '—'}
                </div>
                {lastOut && <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>{new Date(lastOut).toLocaleString()}</div>}
              </div>
            </div>
          )}
          {owedDays !== null && owedDays >= 1 && (
            <div style={{padding:'8px 12px',background:'rgba(245,158,11,0.10)',border:'1px solid var(--yellow)',borderRadius:'6px',color:'var(--yellow)',fontSize:'12px',marginBottom:'8px'}}>
              ⚠ You may owe a reply — they wrote {owedDays} day{owedDays === 1 ? '' : 's'} ago and you haven't responded.
            </div>
          )}

          {showLogInteraction && (
            <div style={{padding:'10px',background:'var(--bg-card)',borderRadius:'6px',border:'1px solid var(--border)',marginBottom:'8px'}}>
              <div style={{display:'flex',gap:'8px',marginBottom:'6px',flexWrap:'wrap'}}>
                <select className="form-select" value={interactionForm.channel}
                  onChange={e => setInteractionForm(f => ({ ...f, channel: e.target.value }))}
                  style={{flex:'1 1 110px',padding:'6px',fontSize:'12px',margin:0}}>
                  <option value="phone">📞 Phone</option>
                  <option value="in_person">👤 In person</option>
                  <option value="text">💬 Text/SMS</option>
                  <option value="video">📹 Video call</option>
                  <option value="other">Other</option>
                </select>
                <select className="form-select" value={interactionForm.direction}
                  onChange={e => setInteractionForm(f => ({ ...f, direction: e.target.value }))}
                  style={{flex:'1 1 110px',padding:'6px',fontSize:'12px',margin:0}}>
                  <option value="outbound">I contacted them</option>
                  <option value="inbound">They contacted me</option>
                </select>
                <input type="datetime-local" className="form-input" value={interactionForm.occurred_at}
                  onChange={e => setInteractionForm(f => ({ ...f, occurred_at: e.target.value }))}
                  style={{flex:'1 1 160px',padding:'6px',fontSize:'12px',margin:0}} />
              </div>
              <input className="form-input" placeholder="Brief note (optional)…"
                value={interactionForm.brief}
                onChange={e => setInteractionForm(f => ({ ...f, brief: e.target.value }))}
                style={{fontSize:'12px',padding:'6px 10px',margin:0,marginBottom:'6px'}} />
              <button className="btn btn-primary btn-sm" onClick={logInteraction} style={{fontSize:'11px'}}>Save interaction</button>
            </div>
          )}
          {interactions.length > 0 && (
            <div style={{maxHeight:'120px',overflowY:'auto',fontSize:'11px',color:'var(--text-2)'}}>
              <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.05em',fontWeight:600,marginBottom:'4px'}}>Recent manual log</div>
              {interactions.slice(0, 5).map(i => (
                <div key={i.id} style={{padding:'4px 0',borderBottom:'1px solid var(--border)'}}>
                  {i.direction === 'outbound' ? '⬆' : '⬇'} {i.channel} · {formatRelative(i.occurred_at)}
                  {i.brief && <span style={{color:'var(--text-3)'}}> — {i.brief}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ========== LINKED TASKS PANEL ========== */}
        <div style={{padding:'14px 16px',borderTop:'1px solid var(--border)'}}>
          <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'8px'}}>
            ✅ Tasks ({linkedTasks.length})
          </div>
          {linkedTasks.length === 0 && (
            <div style={{fontSize:'11px',color:'var(--text-3)',fontStyle:'italic'}}>
              No tasks linked. Link this contact when creating or editing a task.
            </div>
          )}
          {(tasksExpanded ? linkedTasks : linkedTasks.slice(0, 3)).map(t => (
            <div key={t.id} style={{padding:'6px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',marginBottom:'4px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',fontSize:'12px'}}>
              <div style={{flex:1,minWidth:0,textDecoration: t.completed ? 'line-through' : 'none',color: t.completed ? 'var(--text-3)' : 'var(--text-1)'}}>
                {t.completed ? '✓ ' : '○ '}{t.title}
              </div>
              {t.due_date && (
                <span style={{fontSize:'10px',color:'var(--text-3)',whiteSpace:'nowrap'}}>
                  {new Date(t.due_date).toLocaleDateString()}
                </span>
              )}
            </div>
          ))}
          {linkedTasks.length > 3 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setTasksExpanded(e => !e)} style={{fontSize:'11px',marginTop:'4px'}}>
              {tasksExpanded ? '↑ Show fewer' : `↓ Show all ${linkedTasks.length}`}
            </button>
          )}
        </div>

        {/* ========== LINKED EVENTS PANEL (Pass 3) ========== */}
        <div style={{padding:'14px 16px',borderTop:'1px solid var(--border)'}}>
          <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'8px'}}>
            📅 Events ({linkedEvents.length})
          </div>
          {linkedEvents.length === 0 && (
            <div style={{fontSize:'11px',color:'var(--text-3)',fontStyle:'italic'}}>
              No events linked to this contact.
            </div>
          )}
          {linkedEvents.slice(0, 10).map(e => (
            <div key={e.id} style={{padding:'6px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',marginBottom:'4px',fontSize:'12px'}}>
              <div style={{color:'var(--text-1)'}}>{e.title}</div>
              <div style={{fontSize:'10px',color:'var(--text-3)'}}>{e.start_at ? new Date(e.start_at).toLocaleString() : '—'}</div>
            </div>
          ))}
          {linkedEvents.length > 10 && (
            <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'4px'}}>Showing 10 of {linkedEvents.length}.</div>
          )}
        </div>

        {/* ========== LINKED PROPERTIES PANEL (Pass 3) ========== */}
        {linkedProperties.length > 0 && (
          <div style={{padding:'14px 16px',borderTop:'1px solid var(--border)'}}>
            <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'8px'}}>
              🏠 Properties ({linkedProperties.length})
            </div>
            {linkedProperties.map(p => (
              <div key={p.id} style={{padding:'6px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',marginBottom:'4px',fontSize:'12px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px'}}>
                  <div style={{color:'var(--text-1)',fontWeight:500}}>{p.nickname || '(unnamed)'}</div>
                  <span style={{fontSize:'10px',color:'var(--text-3)',textTransform:'capitalize'}}>{p.category}</span>
                </div>
                {p.address && <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>{[p.address, p.city, p.state].filter(Boolean).join(', ')}</div>}
              </div>
            ))}
          </div>
        )}

        {/* ========== DATE-STAMPED NOTES PANEL ========== */}
        <div style={{padding:'14px 16px',borderTop:'1px solid var(--border)'}}>
          <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'8px'}}>
            📝 Dated notes ({dateNotes.length})
          </div>
          <div style={{display:'flex',gap:'6px',marginBottom:'8px'}}>
            <input className="form-input" placeholder="Add a note (stamped with today's date)…"
              value={newNoteBody} onChange={e => setNewNoteBody(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addDatedNote(); } }}
              style={{flex:1,padding:'6px 10px',fontSize:'12px',margin:0}} />
            <button className="btn btn-primary btn-sm" onClick={addDatedNote}
              disabled={savingNote || !newNoteBody.trim()} style={{fontSize:'11px',whiteSpace:'nowrap'}}>
              {savingNote ? '↻' : '+ Add'}
            </button>
          </div>
          {dateNotes.length === 0 && (
            <div style={{fontSize:'11px',color:'var(--text-3)',fontStyle:'italic'}}>
              No dated notes yet. (The contact's pinned summary above is separate from these.)
            </div>
          )}
          <div style={{maxHeight:'260px',overflowY:'auto'}}>
            {dateNotes.map(n => (
              <div key={n.id} style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',marginBottom:'6px',fontSize:'12px'}}>
                {editingNoteId === n.id ? (
                  <>
                    <textarea className="form-textarea" value={editingNoteBody}
                      onChange={e => setEditingNoteBody(e.target.value)}
                      style={{minHeight:'60px',fontSize:'12px',padding:'6px 8px',margin:0,marginBottom:'6px'}} />
                    <div style={{display:'flex',gap:'6px'}}>
                      <button className="btn btn-primary btn-sm" onClick={saveEditedNote} style={{fontSize:'11px'}}>Save</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setEditingNoteId(null); setEditingNoteBody(''); }} style={{fontSize:'11px'}}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'8px',marginBottom:'4px'}}>
                      <div style={{fontSize:'10px',color:'var(--text-3)',fontWeight:600}}>
                        {new Date(n.created_at).toLocaleString()}
                        {n.updated_at && new Date(n.updated_at).getTime() - new Date(n.created_at).getTime() > 1000 && (
                          <span style={{color:'var(--text-3)',fontWeight:400}}> · edited {formatRelative(n.updated_at)}</span>
                        )}
                      </div>
                      <div style={{display:'flex',gap:'4px'}}>
                        <button onClick={() => { setEditingNoteId(n.id); setEditingNoteBody(n.body); }}
                          style={{background:'none',border:'none',color:'var(--text-3)',cursor:'pointer',fontSize:'11px',padding:'0 4px'}}>edit</button>
                        <button onClick={() => deleteNote(n.id)}
                          style={{background:'none',border:'none',color:'var(--red)',cursor:'pointer',fontSize:'11px',padding:'0 4px'}}>delete</button>
                      </div>
                    </div>
                    <div style={{color:'var(--text-1)',whiteSpace:'pre-wrap',lineHeight:1.5}}>{n.body}</div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onEdit}>Edit contact</button>
          <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>

      {/* Research flow modal */}
      {showResearchModal && (
        <div className="modal-overlay" onClick={(e) => { if (researchStage !== 'identifying' && researchStage !== 'researching') { setShowResearchModal(false); setResearchStage('idle'); }}} style={{zIndex: 1100}}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{maxWidth:'600px',width:'92%'}}>
            <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <h3 style={{margin:0}}>🔍 Research {contact.name}</h3>
              <button className="btn btn-ghost btn-sm" disabled={researchStage === 'identifying' || researchStage === 'researching'}
                onClick={() => { setShowResearchModal(false); setResearchStage('idle'); }}>✕</button>
            </div>
            <div style={{padding:'16px'}}>
              {researchStage === 'idle' && (
                <div>
                  {/* 30-day cache notice */}
                  {hasResearch && profile?.research_taken_at && (() => {
                    const daysAgo = Math.floor((Date.now() - new Date(profile.research_taken_at).getTime()) / 86400000);
                    const isFresh = daysAgo < 30;
                    return (
                      <div style={{padding:'10px 12px',marginBottom:'12px',borderRadius:'6px',
                        background: isFresh ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.10)',
                        border: `1px solid ${isFresh ? '#22c55e' : 'var(--yellow)'}`,
                        fontSize:'12px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
                        <div style={{color: isFresh ? '#22c55e' : 'var(--yellow)'}}>
                          {isFresh
                            ? `✓ Researched ${daysAgo === 0 ? 'today' : `${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`} — usually still fresh.`
                            : `⚠ Researched ${daysAgo} days ago — may be stale.`}
                        </div>
                        <button className="btn btn-ghost btn-sm" style={{fontSize:'11px',padding:'4px 8px'}}
                          onClick={() => { setShowResearchModal(false); setShowResearchReport(true); }}>
                          View existing
                        </button>
                      </div>
                    );
                  })()}

                  <div style={{fontSize:'12px',color:'var(--text-2)',marginBottom:'12px',lineHeight:1.5}}>
                    I'll use public web sources (LinkedIn, company sites, news, social media if you choose) to build a profile and tentative behavioral read. Identity will be verified before deep research runs.
                  </div>

                  <div style={{marginBottom:'14px'}}>
                    <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,marginBottom:'6px'}}>Scope</div>
                    <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                      {[
                        {id:'personal', label:'👤 Personal', desc:'Social media, hobbies, community'},
                        {id:'business', label:'💼 Business', desc:'LinkedIn, company, press, licenses'},
                        {id:'both', label:'🔀 Both', desc:'Full profile with sections labeled'},
                      ].map(opt => (
                        <button key={opt.id} className={`btn ${researchScope === opt.id ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                          onClick={() => setResearchScope(opt.id)}
                          style={{flex:'1 1 140px',minWidth:0,padding:'10px',flexDirection:'column',alignItems:'flex-start',gap:'2px',textAlign:'left'}}>
                          <div style={{fontWeight:600}}>{opt.label}</div>
                          <div style={{fontSize:'10px',opacity:0.75,fontWeight:400}}>{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{padding:'10px',background:'var(--bg-base)',borderRadius:'6px',marginBottom:'14px',fontSize:'11px',lineHeight:1.5}}>
                    <div style={{color:'var(--text-3)',marginBottom:'4px',fontWeight:600}}>Identifiers we'll use:</div>
                    <div style={{color:'var(--text-2)'}}>
                      Name: {contact.name || '(none)'}<br />
                      {contact.email && <>Email: {contact.email}<br /></>}
                      {contact.phone && <>Phone: {contact.phone}<br /></>}
                      {contact.company && <>Company: {contact.company}<br /></>}
                      {contact.role && <>Role: {contact.role}</>}
                    </div>
                    {!contact.email && !contact.phone && (
                      <div style={{color:'var(--yellow)',marginTop:'6px',fontSize:'11px'}}>
                        ⚠️ Without an email or phone, we'll need to disambiguate from multiple candidates.
                      </div>
                    )}
                  </div>

                  <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
                    <button className="btn btn-ghost" onClick={() => setShowResearchModal(false)}>Cancel</button>
                    <button className="btn btn-primary" onClick={startResearch}>
                      {(contact.email || contact.phone) ? 'Run research' : 'Find candidates'}
                    </button>
                  </div>
                </div>
              )}

              {researchStage === 'identifying' && (
                <div style={{padding:'30px 20px',textAlign:'center'}}>
                  <div style={{fontSize:'14px',color:'var(--text-2)',marginBottom:'8px'}}>↻ Identifying…</div>
                  <div style={{fontSize:'11px',color:'var(--text-3)'}}>Searching public sources for a match to your identifiers.</div>
                </div>
              )}

              {researchStage === 'choose_candidate' && (
                <div>
                  <div style={{fontSize:'12px',color:'var(--text-2)',marginBottom:'12px',lineHeight:1.5}}>
                    Found {researchCandidates.length} possible {researchCandidates.length === 1 ? 'match' : 'matches'}. Pick the right person before we run the full research:
                  </div>
                  {researchCandidates.map((c, i) => (
                    <div key={i} style={{padding:'10px',marginBottom:'8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'8px',marginBottom:'6px'}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:600,fontSize:'13px'}}>{c.name}</div>
                          {c.headline && <div style={{fontSize:'11px',color:'var(--text-2)',marginTop:'2px'}}>{c.headline}</div>}
                          {c.location && <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'2px'}}>📍 {c.location}</div>}
                          {c.distinguishing_note && <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'4px',fontStyle:'italic'}}>{c.distinguishing_note}</div>}
                          {c.source_url && <a href={c.source_url} target="_blank" rel="noopener noreferrer" style={{fontSize:'10px',color:'var(--accent)',marginTop:'4px',display:'inline-block',wordBreak:'break-all'}}>{c.source_url}</a>}
                        </div>
                        <span style={{fontSize:'10px',padding:'2px 8px',borderRadius:'4px',background: c.match_strength === 'high' ? 'rgba(34,197,94,0.15)' : c.match_strength === 'medium' ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)', color: c.match_strength === 'high' ? '#22c55e' : c.match_strength === 'medium' ? '#f59e0b' : '#ef4444', whiteSpace:'nowrap'}}>
                          {c.match_strength || 'unknown'}
                        </span>
                      </div>
                      <button className="btn btn-primary btn-sm" style={{fontSize:'11px'}}
                        onClick={() => runResearch(c, 'manual')}>
                        ✓ Research this person
                      </button>
                    </div>
                  ))}
                  <button className="btn btn-ghost btn-sm" onClick={() => { setShowResearchModal(false); setResearchStage('idle'); }} style={{marginTop:'4px'}}>
                    None of these — cancel
                  </button>
                </div>
              )}

              {researchStage === 'researching' && (
                <div style={{padding:'30px 20px',textAlign:'center'}}>
                  <div style={{fontSize:'14px',color:'var(--text-2)',marginBottom:'8px'}}>↻ Researching…</div>
                  <div style={{fontSize:'11px',color:'var(--text-3)',lineHeight:1.5}}>
                    This takes 60-90 seconds. Claude is searching multiple sources, gathering evidence, and building the behavioral read.
                  </div>
                </div>
              )}

              {researchStage === 'done' && (
                <div style={{padding:'20px',textAlign:'center'}}>
                  <div style={{fontSize:'40px',marginBottom:'8px'}}>✓</div>
                  <div style={{fontSize:'14px',color:'var(--text-1)',marginBottom:'14px'}}>Research complete.</div>
                  <div style={{display:'flex',gap:'8px',justifyContent:'center'}}>
                    <button className="btn btn-primary btn-sm" onClick={() => { setShowResearchModal(false); setResearchStage('idle'); setShowResearchReport(true); }}>
                      View report
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setShowResearchModal(false); setResearchStage('idle'); }}>
                      Done
                    </button>
                  </div>
                </div>
              )}

              {researchStage === 'error' && (
                <div>
                  <div style={{padding:'10px',background:'rgba(239,68,68,0.10)',border:'1px solid #ef4444',borderRadius:'6px',color:'#ef4444',fontSize:'12px',lineHeight:1.5,marginBottom:'12px'}}>
                    {researchError}
                  </div>
                  <div style={{display:'flex',gap:'8px',justifyContent:'flex-end'}}>
                    <button className="btn btn-ghost" onClick={() => { setShowResearchModal(false); setResearchStage('idle'); }}>Close</button>
                    <button className="btn btn-primary" onClick={() => setResearchStage('idle')}>Try again</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Research report viewer */}
      {showResearchReport && profile?.research_full_report && (
        <div className="modal-overlay" onClick={() => setShowResearchReport(false)} style={{zIndex: 1100}}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{maxWidth:'820px',width:'94%',maxHeight:'90vh',display:'flex',flexDirection:'column'}}>
            <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div>
                <h3 style={{margin:0}}>Research report · {contact.name}</h3>
                <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'4px'}}>
                  Scope: {profile.research_scope || 'both'} · Generated {profile.research_taken_at ? new Date(profile.research_taken_at).toLocaleString() : ''}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowResearchReport(false)}>✕</button>
            </div>
            <div style={{padding:'16px',overflowY:'auto',flex:1,fontSize:'13px',lineHeight:1.7,color:'var(--text-1)',whiteSpace:'pre-wrap'}}>
              {profile.research_full_report}
            </div>
            <div style={{padding:'12px 16px',borderTop:'1px solid var(--border)',display:'flex',justifyContent:'space-between',gap:'8px'}}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowResearchReport(false); setShowResearchModal(true); }}>
                ↻ Re-run research
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setShowResearchReport(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ContactModal({ onClose, onSave, initial }) {
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState(initial?.type || 'lead');
  const [email, setEmail] = useState(initial?.email || '');
  const [phone, setPhone] = useState(initial?.phone || '');
  const [company, setCompany] = useState(initial?.company || '');
  const [role, setRole] = useState(initial?.role || '');
  const [priority, setPriority] = useState(initial?.priority || 'normal');
  const [notes, setNotes] = useState(initial?.notes || '');

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(), type, email: email.trim() || null, phone: phone.trim() || null,
      company: company.trim() || null, role: role.trim() || null, priority, notes: notes.trim() || null,
    });
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>{initial ? 'Edit Contact' : 'New Contact'}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={name} onChange={e=>setName(e.target.value)} autoFocus required /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Type</label>
              <select className="form-select" value={type} onChange={e=>setType(e.target.value)}>
                {CONTACT_TYPES.map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group"><label className="form-label">Priority</label>
              <select className="form-select" value={priority} onChange={e=>setPriority(e.target.value)}>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={email} onChange={e=>setEmail(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={phone} onChange={e=>setPhone(e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Company</label><input className="form-input" value={company} onChange={e=>setCompany(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Role</label><input className="form-input" value={role} onChange={e=>setRole(e.target.value)} /></div>
          </div>
          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Context, history, anything to remember…" /></div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save Contact</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// EMAIL → CONTACT LINK REVIEW
// Shows suggestions from the contact-link-emails edge function and lets the
// user link, pick a different contact, skip, or block the sender.
// ─────────────────────────────────────────
function EmailLinkReviewModal({ userId, contacts, setContacts, onClose, onChanged }) {
  const [suggestions, setSuggestions] = useState(null);
  const [newContactSuggestions, setNewContactSuggestions] = useState(null);
  const [busy, setBusy] = useState({});  // sender_email -> action label
  const [pickerFor, setPickerFor] = useState(null);  // sender_email when picking different contact
  const [pickerQuery, setPickerQuery] = useState('');
  // For "Add" on a new-contact suggestion
  const [addingNewFor, setAddingNewFor] = useState(null);
  const [newContactType, setNewContactType] = useState('lead');
  const [newContactName, setNewContactName] = useState('');

  const loadSuggestions = useCallback(async () => {
    setSuggestions(null);
    setNewContactSuggestions(null);
    const { data } = await supabase.functions.invoke('contact-link-emails', {
      body: { user_id: userId, apply_auto: false },
    });
    if (data?.ok) {
      setSuggestions(data.suggestions || []);
      setNewContactSuggestions(data.new_contact_suggestions || []);
      onChanged?.({
        link: data.suggestions_count || 0,
        new: data.new_contact_suggestions_count || 0,
      });
    } else {
      setSuggestions([]);
      setNewContactSuggestions([]);
    }
  }, [userId, onChanged]);

  useEffect(() => { loadSuggestions(); }, [loadSuggestions]);

  async function linkSenderToContact(senderEmail, senderName, contactId, msgMaxDate) {
    setBusy(b => ({ ...b, [senderEmail]: 'linking' }));
    try {
      // Set contact's email + last_contact_at
      const patch = { email: senderEmail };
      if (msgMaxDate) patch.last_contact_at = msgMaxDate;
      const { error } = await supabase.from('contacts').update(patch).eq('id', contactId);
      if (error) {
        notify("Couldn't link sender to contact. Try again.", 'error');
        return;
      }
      // Refresh contacts state
      const { data: fresh } = await supabase.from('contacts').select('*').eq('user_id', userId).order('name');
      if (fresh) setContacts(fresh);
      // Remove from local suggestion list (link AND new-contact, since linking covers both)
      let nextLink = [];
      let nextNew = (newContactSuggestions || []);
      setSuggestions(prev => {
        nextLink = (prev || []).filter(s => s.sender.email !== senderEmail);
        return nextLink;
      });
      setNewContactSuggestions(prev => {
        nextNew = (prev || []).filter(s => s.sender.email !== senderEmail);
        return nextNew;
      });
      setTimeout(() => onChanged?.({ link: nextLink.length, new: nextNew.length }), 0);
    } finally {
      setBusy(b => { const n = { ...b }; delete n[senderEmail]; return n; });
    }
  }

  async function dismissSuggestion(senderEmail, contactId, reason) {
    setBusy(b => ({ ...b, [senderEmail]: 'dismissing' }));
    try {
      await supabase.from('contact_link_dismissals').insert({
        user_id: userId,
        sender_email: senderEmail,
        contact_id: reason === 'block_sender' ? null : contactId,
        reason,
      });
      let nextLink = [];
      let nextNew = (newContactSuggestions || []);
      setSuggestions(prev => {
        nextLink = (prev || []).filter(s => {
          if (reason === 'block_sender') return s.sender.email !== senderEmail;
          return !(s.sender.email === senderEmail && s.contact.id === contactId);
        });
        return nextLink;
      });
      if (reason === 'block_sender') {
        setNewContactSuggestions(prev => {
          nextNew = (prev || []).filter(s => s.sender.email !== senderEmail);
          return nextNew;
        });
      }
      setTimeout(() => onChanged?.({ link: nextLink.length, new: nextNew.length }), 0);
    } finally {
      setBusy(b => { const n = { ...b }; delete n[senderEmail]; return n; });
    }
  }

  // Open the inline "Add" form for a new-contact suggestion
  function startAddingNew(suggestion) {
    setAddingNewFor(suggestion.sender.email);
    setNewContactName(suggestion.sender.name || '');
    setNewContactType('lead');
  }

  // Create the new contact from a suggestion
  async function createNewContact(suggestion) {
    const senderEmail = suggestion.sender.email;
    if (!newContactName.trim()) return;
    setBusy(b => ({ ...b, [senderEmail]: 'adding' }));
    try {
      const { data: created } = await supabase.from('contacts').insert({
        user_id: userId,
        name: newContactName.trim(),
        email: senderEmail,
        type: newContactType,
        priority: 'normal',
        last_contact_at: suggestion.sender.last_seen,
        notes: `Auto-suggested from ${suggestion.sender.msg_count} inbound email${suggestion.sender.msg_count === 1 ? '' : 's'}.`,
      }).select().single();
      if (created) {
        setContacts(prev => [created, ...prev]);
      }
      let nextNew = [];
      setNewContactSuggestions(prev => {
        nextNew = (prev || []).filter(s => s.sender.email !== senderEmail);
        return nextNew;
      });
      setAddingNewFor(null);
      setTimeout(() => onChanged?.({ link: (suggestions || []).length, new: nextNew.length }), 0);
    } finally {
      setBusy(b => { const n = { ...b }; delete n[senderEmail]; return n; });
    }
  }

  // Dismiss a new-contact suggestion
  async function dismissNewContact(senderEmail, reason) {
    setBusy(b => ({ ...b, [senderEmail]: 'dismissing' }));
    try {
      await supabase.from('contact_link_dismissals').insert({
        user_id: userId,
        sender_email: senderEmail,
        contact_id: null,
        reason,  // 'not_a_new_contact' or 'block_sender'
      });
      let nextNew = [];
      let nextLink = (suggestions || []);
      setNewContactSuggestions(prev => {
        nextNew = (prev || []).filter(s => s.sender.email !== senderEmail);
        return nextNew;
      });
      if (reason === 'block_sender') {
        setSuggestions(prev => {
          nextLink = (prev || []).filter(s => s.sender.email !== senderEmail);
          return nextLink;
        });
      }
      setTimeout(() => onChanged?.({ link: nextLink.length, new: nextNew.length }), 0);
    } finally {
      setBusy(b => { const n = { ...b }; delete n[senderEmail]; return n; });
    }
  }

  // Picker for "different contact"
  const filteredContacts = (contacts || [])
    .filter(c => c.name && !c.email)  // only show contacts without an email
    .filter(c => !pickerQuery || c.name.toLowerCase().includes(pickerQuery.toLowerCase()))
    .slice(0, 30);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{maxWidth:'720px',width:'92%',maxHeight:'85vh',display:'flex',flexDirection:'column'}}>
        <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'10px'}}>
          <div>
            <h3 style={{margin:0}}>Email senders</h3>
            <p style={{margin:'4px 0 0 0',fontSize:'12px',color:'var(--text-3)'}}>
              {suggestions === null ? 'Loading…' : (() => {
                const linkN = suggestions.length;
                const newN = (newContactSuggestions || []).length;
                if (linkN === 0 && newN === 0) return 'All caught up — no pending suggestions.';
                const parts = [];
                if (linkN > 0) parts.push(`${linkN} possible match${linkN === 1 ? '' : 'es'} to existing contacts`);
                if (newN > 0) parts.push(`${newN} potential new contact${newN === 1 ? '' : 's'}`);
                return parts.join(' · ') + '. Pick an action for each.';
              })()}
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div style={{padding:'0 16px 16px',overflowY:'auto',flex:1}}>
          {suggestions === null && <div style={{padding:'40px',textAlign:'center',color:'var(--text-3)'}}>Scanning…</div>}

          {suggestions && suggestions.length === 0 && (newContactSuggestions || []).length === 0 && (
            <div style={{padding:'40px 20px',textAlign:'center'}}>
              <div style={{fontSize:'32px',marginBottom:'8px'}}>✓</div>
              <div style={{color:'var(--text-2)',fontSize:'13px'}}>All caught up. Run scan again after new emails arrive.</div>
            </div>
          )}

          {suggestions && suggestions.length > 0 && (
            <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,margin:'12px 0 8px 0'}}>
              🔗 Possible matches to existing contacts ({suggestions.length})
            </div>
          )}

          {suggestions && suggestions.map(s => {
            const isPicker = pickerFor === s.sender.email;
            const isBusy = !!busy[s.sender.email];
            return (
              <div key={`${s.sender.email}|${s.contact.id}`} style={{padding:'12px',marginBottom:'10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'10px',flexWrap:'wrap',marginBottom:'10px'}}>
                  <div style={{flex:'1 1 280px',minWidth:0}}>
                    <div style={{fontSize:'12px',color:'var(--text-3)',marginBottom:'2px'}}>📧 SENDER</div>
                    <div style={{fontWeight:600,color:'var(--text-1)',fontSize:'14px'}}>{s.sender.name || '(no name)'}</div>
                    <div style={{fontSize:'12px',color:'var(--text-2)',wordBreak:'break-all'}}>{s.sender.email}</div>
                    <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'4px'}}>
                      {s.sender.msg_count} message{s.sender.msg_count === 1 ? '' : 's'}
                      {s.sender.last_seen && <> · last {new Date(s.sender.last_seen).toLocaleDateString()}</>}
                    </div>
                  </div>
                  <div style={{flex:'1 1 200px',minWidth:0}}>
                    <div style={{fontSize:'12px',color:'var(--text-3)',marginBottom:'2px'}}>👤 CONTACT</div>
                    <div style={{fontWeight:600,color:'var(--text-1)',fontSize:'14px'}}>{s.contact.name}</div>
                    <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'4px'}}>
                      {CONTACT_TYPE_LABELS[s.contact.type] || s.contact.type}
                      <span style={{marginLeft:'8px',color: s.score >= 90 ? 'var(--green)' : (s.score >= 75 ? 'var(--accent)' : 'var(--text-3)')}}>
                        score {s.score}{s.ambiguous && ' · ⚠️ ambiguous'}
                      </span>
                    </div>
                  </div>
                </div>

                {!isPicker && (
                  <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                    <button className="btn btn-primary btn-sm" disabled={isBusy}
                      onClick={() => linkSenderToContact(s.sender.email, s.sender.name, s.contact.id, s.sender.last_seen)}>
                      {busy[s.sender.email] === 'linking' ? '↻ Linking…' : '🔗 Link'}
                    </button>
                    <button className="btn btn-ghost btn-sm" disabled={isBusy}
                      onClick={() => { setPickerFor(s.sender.email); setPickerQuery(''); }}>
                      Different contact…
                    </button>
                    <button className="btn btn-ghost btn-sm" disabled={isBusy}
                      onClick={() => dismissSuggestion(s.sender.email, s.contact.id, 'not_a_match')}>
                      Skip
                    </button>
                    <button className="btn btn-ghost btn-sm" disabled={isBusy} style={{color:'var(--red)',marginLeft:'auto'}}
                      onClick={() => dismissSuggestion(s.sender.email, s.contact.id, 'block_sender')}
                      title="Mark this sender as not-a-real-person — won't be suggested for any contact again.">
                      🚫 Block sender
                    </button>
                  </div>
                )}

                {isPicker && (
                  <div style={{marginTop:'8px',padding:'10px',background:'var(--bg-panel)',borderRadius:'6px'}}>
                    <input className="form-input" autoFocus placeholder="Search contacts (without email)…"
                      value={pickerQuery} onChange={e => setPickerQuery(e.target.value)} style={{marginBottom:'8px'}} />
                    <div style={{maxHeight:'200px',overflowY:'auto'}}>
                      {filteredContacts.length === 0 ? (
                        <div style={{padding:'10px',textAlign:'center',color:'var(--text-3)',fontSize:'12px'}}>
                          No contacts match.
                        </div>
                      ) : filteredContacts.map(c => (
                        <button key={c.id} onClick={() => { setPickerFor(null); linkSenderToContact(s.sender.email, s.sender.name, c.id, s.sender.last_seen); }}
                          style={{display:'block',width:'100%',textAlign:'left',padding:'8px 10px',background:'transparent',border:'1px solid transparent',borderRadius:'4px',color:'var(--text-1)',fontSize:'13px',cursor:'pointer'}}
                          onMouseEnter={e=>e.currentTarget.style.background='var(--bg-hover)'}
                          onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                          {c.name} <span style={{fontSize:'11px',color:'var(--text-3)'}}>· {CONTACT_TYPE_LABELS[c.type] || c.type}</span>
                        </button>
                      ))}
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => setPickerFor(null)} style={{marginTop:'8px'}}>Cancel</button>
                  </div>
                )}
              </div>
            );
          })}

          {/* NEW-CONTACT SUGGESTIONS (Option B) */}
          {newContactSuggestions && newContactSuggestions.length > 0 && (
            <>
              <div style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,margin:'18px 0 8px 0'}}>
                ✨ Potential new contacts ({newContactSuggestions.length})
              </div>
              <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'10px',lineHeight:1.5}}>
                People who've emailed you 3+ times but aren't in your contacts yet. Spam and automated senders are filtered out, but review each before adding.
              </div>
              {newContactSuggestions.map(s => {
                const senderEmail = s.sender.email;
                const isAdding = addingNewFor === senderEmail;
                const isBusy = !!busy[senderEmail];
                return (
                  <div key={`new-${senderEmail}`} style={{padding:'12px',marginBottom:'10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'10px',flexWrap:'wrap',marginBottom:'10px'}}>
                      <div style={{flex:'1 1 280px',minWidth:0}}>
                        <div style={{fontSize:'12px',color:'var(--text-3)',marginBottom:'2px'}}>📧 SENDER</div>
                        <div style={{fontWeight:600,color:'var(--text-1)',fontSize:'14px'}}>{s.sender.name || '(no name)'}</div>
                        <div style={{fontSize:'12px',color:'var(--text-2)',wordBreak:'break-all'}}>{s.sender.email}</div>
                        {s.confidence_signals && s.confidence_signals.length > 0 && (
                          <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'6px',lineHeight:1.5}}>
                            {s.confidence_signals.map((sig, i) => (
                              <div key={i}>· {sig}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {!isAdding && (
                      <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                        <button className="btn btn-primary btn-sm" disabled={isBusy} onClick={() => startAddingNew(s)}>
                          ＋ Add to contacts
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={isBusy}
                          onClick={() => dismissNewContact(senderEmail, 'not_a_new_contact')}>
                          {busy[senderEmail] === 'dismissing' ? '↻ Skipping…' : 'Skip'}
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={isBusy}
                          onClick={() => dismissNewContact(senderEmail, 'block_sender')}
                          style={{color:'var(--red)'}}>
                          🚫 Block sender
                        </button>
                      </div>
                    )}

                    {isAdding && (
                      <div style={{padding:'10px',background:'var(--bg-card)',borderRadius:'6px',border:'1px solid var(--border)'}}>
                        <div style={{fontSize:'11px',color:'var(--text-3)',marginBottom:'8px',fontWeight:600}}>Review before adding:</div>
                        <div style={{display:'flex',gap:'8px',flexWrap:'wrap',marginBottom:'8px'}}>
                          <div style={{flex:'1 1 200px'}}>
                            <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Name</label>
                            <input className="form-input" value={newContactName} onChange={e=>setNewContactName(e.target.value)} style={{padding:'6px 10px',fontSize:'12px',margin:0,width:'100%'}} />
                          </div>
                          <div style={{flex:'1 1 200px'}}>
                            <label style={{fontSize:'10px',color:'var(--text-3)',display:'block',marginBottom:'2px'}}>Type</label>
                            <select className="form-select" value={newContactType} onChange={e=>setNewContactType(e.target.value)} style={{padding:'6px 8px',fontSize:'12px',margin:0,width:'100%'}}>
                              {CONTACT_TYPES.map(t => (
                                <option key={t.id} value={t.id}>{t.label}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div style={{display:'flex',gap:'6px'}}>
                          <button className="btn btn-primary btn-sm" disabled={isBusy || !newContactName.trim()} onClick={() => createNewContact(s)}>
                            {busy[senderEmail] === 'adding' ? '↻ Adding…' : '✓ Add'}
                          </button>
                          <button className="btn btn-ghost btn-sm" disabled={isBusy} onClick={() => setAddingNewFor(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div style={{padding:'12px 16px',borderTop:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <button className="btn btn-ghost btn-sm" onClick={loadSuggestions}>↻ Refresh</button>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function LabelPickerBody({ currentLabels, userLabels, onApply, onRefresh, onCancel }) {
  const [selected, setSelected] = useState(new Set(currentLabels.filter(l => !['INBOX','SENT','TRASH','SPAM','STARRED','UNREAD','IMPORTANT','DRAFT','CATEGORY_PERSONAL','CATEGORY_PROMOTIONS','CATEGORY_UPDATES','CATEGORY_SOCIAL','CATEGORY_FORUMS'].includes(l))));
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const filtered = query
    ? userLabels.filter(l => l.name.toLowerCase().includes(query.toLowerCase()))
    : userLabels;

  function toggle(labelId) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(labelId)) next.delete(labelId);
      else next.add(labelId);
      return next;
    });
  }

  async function handleRefresh() {
    setRefreshing(true);
    try { await onRefresh(); }
    finally { setRefreshing(false); }
  }

  function handleApply() {
    const initial = new Set(currentLabels.filter(l => userLabels.some(ul => ul.label_id === l)));
    const toAdd = Array.from(selected).filter(id => !initial.has(id));
    const toRemove = Array.from(initial).filter(id => !selected.has(id));
    onApply(toAdd, toRemove);
  }

  return (
    <div style={{padding:'14px',display:'flex',flexDirection:'column',gap:'10px'}}>
      <div style={{display:'flex',gap:'6px'}}>
        <input className="form-input" placeholder="Search labels…"
          value={query} onChange={e => setQuery(e.target.value)}
          style={{flex:1,fontSize:'12px',padding:'6px 10px',margin:0}} />
        <button className="btn btn-ghost btn-sm" onClick={handleRefresh} disabled={refreshing} title="Re-sync labels from Gmail">
          {refreshing ? '↻' : '↻ Sync'}
        </button>
      </div>
      <div style={{maxHeight:'320px',overflowY:'auto',border:'1px solid var(--border)',borderRadius:'6px'}}>
        {filtered.length === 0 && (
          <div style={{padding:'20px',textAlign:'center',color:'var(--text-3)',fontSize:'12px'}}>
            {userLabels.length === 0 ? 'No custom labels found. Click ↻ Sync to fetch from Gmail.' : 'No matches.'}
          </div>
        )}
        {filtered.map(l => {
          const isChecked = selected.has(l.label_id);
          return (
            <label key={l.id} style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 12px',cursor:'pointer',borderBottom:'1px solid var(--border)'}}>
              <input type="checkbox" checked={isChecked} onChange={() => toggle(l.label_id)} />
              <span style={{fontSize:'13px',color:'var(--text-1)',flex:1}}>{l.name}</span>
              {l.color?.backgroundColor && (
                <span style={{width:'12px',height:'12px',borderRadius:'2px',background:l.color.backgroundColor,flexShrink:0}}/>
              )}
            </label>
          );
        })}
      </div>
      <div style={{display:'flex',gap:'6px',justifyContent:'flex-end'}}>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={handleApply}>Apply</button>
      </div>
    </div>
  );
}

function ContactsView({ contacts, setContacts, userId, profiles, setProfiles }) {
  const [showModal, setShowModal] = useState(false);
  const [editContact, setEditContact] = useState(null);
  const [detailContact, setDetailContact] = useState(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('last_name');  // 'last_name' | 'first_name' | 'last_contact_oldest' | 'last_contact_newest' | 'recently_added'
  const [search, setSearch] = useState('');

  // Email-to-contact linking state
  const [linkSummary, setLinkSummary] = useState(null);  // { suggestions_count, auto_filled, auto_linked } or null when never scanned
  const [showLinkReview, setShowLinkReview] = useState(false);
  const [scanning, setScanning] = useState(false);

  // Phone extraction state
  const [extractingPhones, setExtractingPhones] = useState(false);
  const [phoneMsg, setPhoneMsg] = useState(null);

  // Duplicate detection state
  const [findingDupes, setFindingDupes] = useState(false);
  const [dupeGroups, setDupeGroups] = useState(null);  // null = never scanned; [] = scanned, none found
  const [showDupeReview, setShowDupeReview] = useState(false);

  // Load existing pending-suggestion count on mount (cheap dry-run)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke('contact-link-emails', {
          body: { user_id: userId, apply_auto: false },
        });
        if (!cancelled && data?.ok) {
          setLinkSummary({
            suggestions_count: data.suggestions_count || 0,
            new_contact_count: data.new_contact_suggestions_count || 0,
          });
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  async function runEmailLinkScan() {
    setScanning(true);
    try {
      const { data } = await supabase.functions.invoke('contact-link-emails', {
        body: { user_id: userId, apply_auto: true },
      });
      if (data?.ok) {
        setLinkSummary({
          suggestions_count: data.suggestions_count || 0,
          new_contact_count: data.new_contact_suggestions_count || 0,
          auto_linked: data.auto_linked,
          auto_filled: data.auto_filled,
          just_ran: true,
        });
        // Refresh contacts since some may have been auto-filled
        const { data: fresh } = await supabase.from('contacts').select('*').eq('user_id', userId).order('name');
        if (fresh) setContacts(fresh);
        const totalPending = (data.suggestions_count || 0) + (data.new_contact_suggestions_count || 0);
        if (totalPending > 0) setShowLinkReview(true);
      }
    } finally { setScanning(false); }
  }

  // Run signature-based phone extraction
  async function runPhoneExtraction() {
    setExtractingPhones(true);
    setPhoneMsg(null);
    try {
      const { data } = await supabase.functions.invoke('contact-extract-phones', {
        body: { user_id: userId, apply: true },
      });
      if (data?.ok) {
        const { data: fresh } = await supabase.from('contacts').select('*').eq('user_id', userId).order('name');
        if (fresh) setContacts(fresh);
        if (data.filled > 0) {
          setPhoneMsg({ type: 'ok', text: `Filled ${data.filled} phone${data.filled === 1 ? '' : 's'} from email signatures.` });
        } else {
          setPhoneMsg({ type: 'info', text: `No new phones found in signatures (scanned ${data.scanned_contacts} contacts without phones).` });
        }
      } else {
        setPhoneMsg({ type: 'error', text: data?.error || 'Extraction failed.' });
      }
    } catch (err) {
      setPhoneMsg({ type: 'error', text: 'Extraction failed: ' + (err.message || err) });
    } finally {
      setExtractingPhones(false);
      setTimeout(() => setPhoneMsg(null), 6000);
    }
  }

  // Find duplicate contacts (manual review only — never auto-merge)
  async function runDuplicateScan() {
    setFindingDupes(true);
    try {
      const { data } = await supabase.functions.invoke('contact-find-duplicates', {
        body: { user_id: userId },
      });
      if (data?.ok) {
        setDupeGroups(data.groups || []);
        if ((data.groups || []).length > 0) setShowDupeReview(true);
      } else {
        setDupeGroups([]);
      }
    } finally { setFindingDupes(false); }
  }

  // Load duplicate count on mount (cheap one-shot)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke('contact-find-duplicates', {
          body: { user_id: userId },
        });
        if (!cancelled && data?.ok) {
          setDupeGroups(data.groups || []);
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // O(1) lookup from contact_id → profile
  const profileByContact = useMemo(() => {
    const m = new Map();
    (profiles || []).forEach(p => { if (p.contact_id) m.set(p.contact_id, p); });
    return m;
  }, [profiles]);

  function handleProfileUpdate(updatedProfile) {
    setProfiles(prev => {
      const exists = prev.find(p => p.id === updatedProfile.id);
      return exists
        ? prev.map(p => p.id === updatedProfile.id ? updatedProfile : p)
        : [...prev, updatedProfile];
    });
  }

  // Extract last name for sorting: "John Smith" -> "Smith", "Bob Van Der Berg" -> "Berg", "Cher" -> "Cher"
  function lastNameKey(c) {
    const name = (c.name || '').trim();
    if (!name) return '\uffff'; // sort blanks to end
    const parts = name.split(/\s+/);
    const last = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    return last.toLowerCase();
  }
  function firstNameKey(c) {
    const name = (c.name || '').trim();
    if (!name) return '\uffff';
    return (name.split(/\s+/)[0] || '').toLowerCase();
  }
  function lastContactKey(c) {
    // Most recent "touch" — last_contact_at if present, else updated_at
    const ts = c.last_contact_at || c.updated_at || c.created_at || null;
    return ts ? new Date(ts).getTime() : 0;
  }

  const filtered = contacts.filter(c => {
    if (typeFilter !== 'all' && c.type !== typeFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (c.name||'').toLowerCase().includes(q) ||
             (c.company||'').toLowerCase().includes(q) ||
             (c.email||'').toLowerCase().includes(q) ||
             (c.notes||'').toLowerCase().includes(q);
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'last_name') {
      const la = lastNameKey(a), lb = lastNameKey(b);
      if (la !== lb) return la.localeCompare(lb);
      return firstNameKey(a).localeCompare(firstNameKey(b));
    }
    if (sortBy === 'first_name') {
      return firstNameKey(a).localeCompare(firstNameKey(b));
    }
    if (sortBy === 'last_contact_oldest') {
      // Oldest first — surfaces who you haven't reached out to recently
      return lastContactKey(a) - lastContactKey(b);
    }
    if (sortBy === 'last_contact_newest') {
      return lastContactKey(b) - lastContactKey(a);
    }
    if (sortBy === 'recently_added') {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    }
    return 0;
  });

  async function handleSave(data) {
    if (editContact) {
      const { data: updated, error } = await supabase.from('contacts').update(data).eq('id', editContact.id).select().single();
      if (error) {
        notify("Couldn't save contact. Try again.", 'error');
        return;
      }
      if (updated) setContacts(prev => prev.map(c => c.id === updated.id ? updated : c));
    } else {
      const { data: created, error } = await supabase.from('contacts').insert({ ...data, user_id: userId }).select().single();
      if (error) {
        notify("Couldn't create contact. Try again.", 'error');
        return;
      }
      if (created) setContacts(prev => [created, ...prev]);
    }
    setShowModal(false); setEditContact(null);
  }

  async function deleteContact(id) {
    if (!window.confirm('Delete this contact?')) return;
    // Snapshot for rollback
    const snapshot = contacts.find(c => c.id === id);
    setContacts(prev => prev.filter(c => c.id !== id));
    const { error } = await supabase.from('contacts').delete().eq('id', id);
    if (error) {
      // Rollback
      if (snapshot) setContacts(prev => [snapshot, ...prev.filter(c => c.id !== id)]);
      notify("Couldn't delete contact. Reverted.", 'error');
    }
  }

  return (
    <div>
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
        <div><h2>Contacts</h2><p>{contacts.length} total · {sorted.length} shown</p></div>
        <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
          <button className="btn btn-ghost btn-sm" onClick={runEmailLinkScan} disabled={scanning}
            title="Scan inbox for senders that may match your contacts. Safe auto-fills are applied immediately; ambiguous matches go to review.">
            {scanning ? '↻ Scanning…' : '🔗 Scan emails'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={runPhoneExtraction} disabled={extractingPhones}
            title="Extract phone numbers from email signatures and auto-fill empty contact.phone fields.">
            {extractingPhones ? '↻ Extracting…' : '📞 Extract phones'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={runDuplicateScan} disabled={findingDupes}
            title="Find likely duplicate contacts based on email, phone, or name+company. Surfaces for review — never auto-merges.">
            {findingDupes ? '↻ Scanning…' : '🔍 Find dupes'}
          </button>
          <button className="btn btn-primary" onClick={()=>{setEditContact(null);setShowModal(true);}}>+ New Contact</button>
        </div>
      </div>

      {/* Phone extraction feedback */}
      {phoneMsg && (
        <div style={{padding:'8px 12px',marginBottom:'10px',borderRadius:'8px',
          background: phoneMsg.type === 'ok' ? 'rgba(34,197,94,0.10)' : phoneMsg.type === 'error' ? 'rgba(239,68,68,0.10)' : 'rgba(197,169,94,0.08)',
          border: `1px solid ${phoneMsg.type === 'ok' ? '#22c55e' : phoneMsg.type === 'error' ? '#ef4444' : 'var(--accent)'}`,
          color: phoneMsg.type === 'ok' ? '#22c55e' : phoneMsg.type === 'error' ? '#ef4444' : 'var(--text-1)',
          fontSize:'12px'}}>
          {phoneMsg.text}
        </div>
      )}

      {/* Duplicate banner */}
      {dupeGroups && dupeGroups.length > 0 && (
        <div style={{padding:'10px 14px',marginBottom:'10px',background:'rgba(245,158,11,0.10)',border:'1px solid var(--yellow)',borderRadius:'8px',color:'var(--text-1)',fontSize:'12px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'8px'}}>
          <span>⚠️ <strong>{dupeGroups.length}</strong> likely duplicate group{dupeGroups.length === 1 ? '' : 's'} found.</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowDupeReview(true)} style={{color:'var(--yellow)'}}>Review →</button>
        </div>
      )}

      {/* Just-ran feedback */}
      {linkSummary?.just_ran && (linkSummary.auto_linked + linkSummary.auto_filled > 0) && (
        <div style={{padding:'10px 14px',marginBottom:'10px',background:'rgba(34, 197, 94, 0.10)',border:'1px solid #22c55e',borderRadius:'8px',color:'#22c55e',fontSize:'12px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span>
            ✓ Linked {linkSummary.auto_linked || 0} contact{linkSummary.auto_linked === 1 ? '' : 's'} via email match
            {linkSummary.auto_filled > 0 && <>, filled {linkSummary.auto_filled} new email{linkSummary.auto_filled === 1 ? '' : 's'}</>}.
          </span>
          <button onClick={() => setLinkSummary(s => ({ ...s, just_ran: false }))} style={{background:'none',border:'none',color:'inherit',cursor:'pointer',fontSize:'14px'}}>×</button>
        </div>
      )}

      {/* Pending suggestions banner */}
      {((linkSummary?.suggestions_count || 0) + (linkSummary?.new_contact_count || 0)) > 0 && (
        <div style={{padding:'10px 14px',marginBottom:'10px',background:'rgba(197, 169, 94, 0.08)',border:'1px solid var(--accent)',borderRadius:'8px',color:'var(--text-1)',fontSize:'12px',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:'8px'}}>
          <span>
            {(() => {
              const m = linkSummary.suggestions_count || 0;
              const n = linkSummary.new_contact_count || 0;
              const parts = [];
              if (m > 0) parts.push(<span key="link"><strong>{m}</strong> possible match{m === 1 ? '' : 'es'}</span>);
              if (n > 0) parts.push(<span key="new"><strong>{n}</strong> potential new contact{n === 1 ? '' : 's'}</span>);
              return parts.reduce((acc, p, i) => i === 0 ? [p] : [...acc, ' · ', p], []);
            })()}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowLinkReview(true)} style={{color:'var(--accent)'}}>Review →</button>
        </div>
      )}

      <div className="panel">
        <div className="panel-header" style={{flexDirection:'column',alignItems:'stretch',gap:'10px'}}>
          <input className="form-input" placeholder="Search contacts…" value={search} onChange={e=>setSearch(e.target.value)} style={{margin:0}} />
          <div style={{display:'flex',gap:'10px',flexWrap:'wrap',alignItems:'flex-end'}}>
            <div style={{flex:'1 1 220px',minWidth:0}}>
              <label style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,display:'block',marginBottom:'4px'}}>Filter by type</label>
              <select className="form-select" value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} style={{margin:0}}>
                <option value="all">👥 All ({contacts.length})</option>
                {CONTACT_TYPES.map(t => {
                  const count = contacts.filter(c => c.type === t.id).length;
                  if (count === 0) return null;
                  return <option key={t.id} value={t.id}>{t.icon} {t.label} ({count})</option>;
                })}
              </select>
            </div>
            <div style={{flex:'1 1 200px',minWidth:0}}>
              <label style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,display:'block',marginBottom:'4px'}}>Sort by</label>
              <select className="form-select" value={sortBy} onChange={e=>setSortBy(e.target.value)} style={{margin:0}}>
                <option value="last_name">Last name, first name</option>
                <option value="first_name">First name</option>
                <option value="last_contact_oldest">Last contact (oldest first) — overdue for reach-out</option>
                <option value="last_contact_newest">Last contact (newest first)</option>
                <option value="recently_added">Recently added</option>
              </select>
            </div>
          </div>
        </div>
        <div className="panel-body">
          {sorted.length === 0
            ? <div className="empty-state"><div className="empty-icon">👥</div><p>No contacts here.</p></div>
            : <div className="task-list">
                {sorted.map(c => {
                  const p = profileByContact.get(c.id);
                  const discColors = { D: '#ef4444', I: '#f59e0b', S: '#22c55e', C: '#3b82f6' };
                  return (
                    <div key={c.id} className="task-item" style={{cursor:'pointer'}} onClick={()=>setDetailContact(c)}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:600,color:'var(--text-1)',display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
                          {c.name}
                          <span className="task-priority" style={{background:'var(--bg-hover)',color:'var(--text-2)'}}>{CONTACT_TYPE_LABELS[c.type] || c.type}</span>
                          {p?.primary_letter && (
                            <span title={`DISC ${p.primary_letter}${p.secondary_letter ? '/' + p.secondary_letter : ''} · ${p.confidence_pct || 0}% confidence · ${p.analysis_status || 'ready'}`}
                              className="pill"
                              style={{
                                fontSize:'10px', padding:'2px 7px', fontWeight:700,
                                background: discColors[p.primary_letter],
                                color: '#fff',
                                opacity: p.analysis_status === 'provisional' ? 0.6 : 1,
                              }}>
                              {p.primary_letter}{p.secondary_letter ? `/${p.secondary_letter}` : ''}
                              {p.confidence_pct ? ` ${p.confidence_pct}%` : ''}
                              {p.analysis_status === 'provisional' ? ' · prov' : ''}
                              {p.analysis_status === 'baseline_only' ? ' · base' : ''}
                            </span>
                          )}
                          {p?.drift_note && (
                            <span title={p.drift_note} style={{fontSize:'12px',color:'#f59e0b'}}>⚠</span>
                          )}
                        </div>
                        {(c.company || c.role) && <div style={{fontSize:'13px',color:'var(--text-2)',marginTop:'2px'}}>{[c.role,c.company].filter(Boolean).join(' · ')}</div>}
                        {(c.email || c.phone) && <div style={{fontSize:'12px',color:'var(--text-3)',marginTop:'2px'}}>{[c.email,c.phone].filter(Boolean).join(' · ')}</div>}
                        {(() => {
                          // Subtle communication state line
                          if (!c.last_inbound_at && !c.last_outbound_at) return null;
                          const lin = c.last_inbound_at;
                          const lout = c.last_outbound_at;
                          const dir = c.last_communication_direction;
                          const rel = (ts) => {
                            const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
                            if (d === 0) return 'today';
                            if (d === 1) return '1d ago';
                            if (d < 7) return `${d}d ago`;
                            if (d < 30) return `${Math.floor(d/7)}w ago`;
                            if (d < 365) return `${Math.floor(d/30)}mo ago`;
                            return `${Math.floor(d/365)}y ago`;
                          };
                          if (dir === 'inbound' && lin) {
                            const days = Math.floor((Date.now() - new Date(lin).getTime()) / 86400000);
                            // Show owe-reply hint only if >= 1 day old
                            if (days >= 1) {
                              return <div style={{fontSize:'11px',color:'var(--yellow)',marginTop:'3px',opacity:0.85}}>⬇ they wrote {rel(lin)} · awaiting reply</div>;
                            }
                            return <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'3px'}}>⬇ they wrote {rel(lin)}</div>;
                          }
                          if (dir === 'outbound' && lout) {
                            return <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'3px'}}>⬆ you wrote {rel(lout)}</div>;
                          }
                          return null;
                        })()}
                      </div>
                      <div className="task-meta">
                        <span className={`task-priority priority-${c.priority==='urgent'?'high':c.priority==='normal'?'medium':c.priority}`}>{c.priority}</span>
                        <button className="task-delete" onClick={(e)=>{e.stopPropagation();deleteContact(c.id);}}>×</button>
                      </div>
                    </div>
                  );
                })}
              </div>
          }
        </div>
      </div>
      {showModal && <ContactModal onClose={()=>{setShowModal(false);setEditContact(null);}} onSave={handleSave} initial={editContact} />}
      {detailContact && (
        <ContactDetailModal
          contact={detailContact}
          profile={profileByContact.get(detailContact.id) || null}
          userId={userId}
          onClose={() => setDetailContact(null)}
          onEdit={() => { setEditContact(detailContact); setDetailContact(null); setShowModal(true); }}
          onProfileUpdate={handleProfileUpdate}
        />
      )}
      {showLinkReview && (
        <EmailLinkReviewModal
          userId={userId}
          contacts={contacts}
          setContacts={setContacts}
          onClose={() => setShowLinkReview(false)}
          onChanged={(counts) => setLinkSummary(prev => ({
            ...prev,
            suggestions_count: counts.link,
            new_contact_count: counts.new,
          }))}
        />
      )}
      {showDupeReview && (
        <DuplicateReviewModal
          groups={dupeGroups || []}
          userId={userId}
          contacts={contacts}
          setContacts={setContacts}
          onClose={() => setShowDupeReview(false)}
          onMerged={(remainingGroups) => setDupeGroups(remainingGroups)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// DUPLICATE REVIEW MODAL — surfaces likely duplicates, user picks canonical + merges
// Never auto-merges. Merge action: copies missing fields from non-canonical into
// canonical, deletes non-canonical, optionally re-points any FK references (notes,
// profiles, etc).
// ─────────────────────────────────────────
function DuplicateReviewModal({ groups, userId, contacts, setContacts, onClose, onMerged }) {
  const [localGroups, setLocalGroups] = useState(groups);
  const [selectedCanonical, setSelectedCanonical] = useState({});  // groupKey -> contactId
  const [merging, setMerging] = useState({});  // groupKey -> bool
  const [errorMsg, setErrorMsg] = useState(null);

  // Pre-populate selected canonical from suggested
  useEffect(() => {
    const init = {};
    for (const g of groups) {
      init[g.key] = g.suggested_canonical_id;
    }
    setSelectedCanonical(init);
  }, [groups]);

  async function mergeGroup(group) {
    const canonicalId = selectedCanonical[group.key];
    if (!canonicalId) return;
    const canonical = group.contacts.find(c => c.id === canonicalId);
    const others = group.contacts.filter(c => c.id !== canonicalId);
    if (!canonical || others.length === 0) return;

    setMerging(m => ({ ...m, [group.key]: true }));
    setErrorMsg(null);
    try {
      // Step 1: build a "filled" patch — copy any field from others where canonical is empty.
      const patch = {};
      const fillIfEmpty = (field) => {
        if (canonical[field]) return;
        for (const o of others) {
          if (o[field]) { patch[field] = o[field]; return; }
        }
      };
      ['email', 'phone', 'company', 'role', 'type', 'notes', 'last_contact_at'].forEach(fillIfEmpty);

      // For notes: if BOTH have notes, concatenate (canonical stays first)
      const canonicalNotes = (canonical.notes || '').trim();
      const otherNotes = others.map(o => (o.notes || '').trim()).filter(Boolean).join('\n\n---\n\n');
      if (canonicalNotes && otherNotes) {
        patch.notes = canonicalNotes + '\n\n---\nMerged from duplicate:\n' + otherNotes;
      }

      // Step 2: update canonical contact with merged fields
      if (Object.keys(patch).length > 0) {
        const { error: upErr } = await supabase.from('contacts').update(patch).eq('id', canonicalId);
        if (upErr) throw upErr;
      }

      // Step 3: re-point any profile rows from others to canonical (one profile per contact)
      // Strategy: if canonical already has a profile, keep it. Delete others' profiles.
      // If canonical has no profile but others do, re-point the first to canonical.
      const { data: canonicalProfile } = await supabase.from('profiles').select('id').eq('contact_id', canonicalId).maybeSingle();
      for (const o of others) {
        const { data: otherProfile } = await supabase.from('profiles').select('id').eq('contact_id', o.id).maybeSingle();
        if (!otherProfile) continue;
        if (canonicalProfile) {
          await supabase.from('profiles').delete().eq('id', otherProfile.id);
        } else {
          await supabase.from('profiles').update({ contact_id: canonicalId }).eq('id', otherProfile.id);
        }
      }

      // Step 4: delete the duplicates
      for (const o of others) {
        await supabase.from('contacts').delete().eq('id', o.id);
      }

      // Step 5: refresh contacts in parent + remove this group from list
      const { data: fresh } = await supabase.from('contacts').select('*').eq('user_id', userId).order('name');
      if (fresh) setContacts(fresh);
      const remaining = localGroups.filter(g => g.key !== group.key);
      setLocalGroups(remaining);
      onMerged?.(remaining);
    } catch (err) {
      setErrorMsg(`Merge failed: ${err.message || err}`);
    } finally {
      setMerging(m => { const n = { ...m }; delete n[group.key]; return n; });
    }
  }

  // Dismiss a group without merging (mark as "not duplicates")
  function skipGroup(group) {
    const remaining = localGroups.filter(g => g.key !== group.key);
    setLocalGroups(remaining);
    onMerged?.(remaining);
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{zIndex: 1100}}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{maxWidth:'780px',width:'94%',maxHeight:'90vh',display:'flex',flexDirection:'column'}}>
        <div className="modal-header" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <h3 style={{margin:0}}>Duplicate contacts</h3>
            <p style={{margin:'4px 0 0',fontSize:'12px',color:'var(--text-3)'}}>
              {localGroups.length === 0 ? 'All caught up.' : `${localGroups.length} group${localGroups.length === 1 ? '' : 's'} found. Pick the record to keep, then merge.`}
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div style={{padding:'0 16px 16px',overflowY:'auto',flex:1}}>
          {errorMsg && (
            <div style={{padding:'8px 12px',marginBottom:'10px',background:'rgba(239,68,68,0.10)',border:'1px solid #ef4444',borderRadius:'6px',color:'#ef4444',fontSize:'12px'}}>
              {errorMsg}
            </div>
          )}

          {localGroups.length === 0 && (
            <div style={{padding:'40px 20px',textAlign:'center'}}>
              <div style={{fontSize:'32px',marginBottom:'8px'}}>✓</div>
              <div style={{color:'var(--text-2)',fontSize:'13px'}}>No duplicate groups remaining.</div>
            </div>
          )}

          {localGroups.map(g => (
            <div key={g.key} style={{padding:'12px',marginBottom:'12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px',gap:'8px',flexWrap:'wrap'}}>
                <span style={{fontSize:'11px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.05em'}}>Match: {g.reason}</span>
                <span style={{fontSize:'11px',color:'var(--text-3)'}}>{g.contacts.length} records</span>
              </div>
              {g.contacts.map(c => {
                const isCanonical = selectedCanonical[g.key] === c.id;
                return (
                  <label key={c.id} style={{display:'flex',alignItems:'flex-start',gap:'10px',padding:'10px',marginBottom:'6px',
                    background: isCanonical ? 'rgba(197,169,94,0.10)' : 'var(--bg-card)',
                    border: isCanonical ? '1px solid var(--accent)' : '1px solid var(--border)',
                    borderRadius:'6px', cursor:'pointer'}}>
                    <input type="radio" name={`canon-${g.key}`} checked={isCanonical}
                      onChange={() => setSelectedCanonical(p => ({ ...p, [g.key]: c.id }))}
                      style={{marginTop:'3px',flexShrink:0}} />
                    <div style={{flex:1,minWidth:0,fontSize:'12px',lineHeight:1.6}}>
                      <div style={{fontWeight:600,color:'var(--text-1)'}}>{c.name || '(no name)'}</div>
                      <div style={{color:'var(--text-2)'}}>
                        {c.email && <>{c.email} · </>}
                        {c.phone && <>{c.phone} · </>}
                        {c.company && <>{c.company}{c.role ? `, ${c.role}` : ''} · </>}
                        <span style={{color:'var(--text-3)'}}>type: {CONTACT_TYPE_LABELS[c.type] || c.type}</span>
                      </div>
                      {c.notes && (
                        <div style={{color:'var(--text-3)',fontSize:'11px',marginTop:'4px',fontStyle:'italic',maxHeight:'40px',overflow:'hidden'}}>
                          {c.notes.substring(0, 150)}{c.notes.length > 150 ? '…' : ''}
                        </div>
                      )}
                      <div style={{color:'var(--text-3)',fontSize:'10px',marginTop:'4px'}}>
                        Completeness: {c.completeness_score} · Created {new Date(c.created_at).toLocaleDateString()}
                        {isCanonical && <span style={{color:'var(--accent)',marginLeft:'8px'}}>★ KEEP THIS ONE</span>}
                      </div>
                    </div>
                  </label>
                );
              })}
              <div style={{display:'flex',gap:'6px',marginTop:'10px',justifyContent:'flex-end'}}>
                <button className="btn btn-ghost btn-sm" onClick={() => skipGroup(g)} disabled={merging[g.key]}>
                  Not duplicates
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => mergeGroup(g)} disabled={merging[g.key]}>
                  {merging[g.key] ? '↻ Merging…' : `⚠ Merge ${g.contacts.length - 1} into selected`}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{padding:'12px 16px',borderTop:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontSize:'11px',color:'var(--text-3)'}}>Merging keeps the ★ record and deletes the others. Fields are copied from deleted records into ★ where ★ is empty.</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// PROPERTIES VIEW
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// PROPERTY DETAIL MODAL (Pass 3 Batch B)
//
// Read-mostly detail surface for a single property. Mirrors ContactDetailModal's
// pattern: shows linked contacts, tasks, events, investments, drawings, and
// dated notes. Edit button opens the existing PropertyModal for the field-level
// editing.
// ─────────────────────────────────────────
function PropertyDetailModal({ property, contacts, onClose, onEdit, onDeleted, userId }) {
  const [linkedContactIds, setLinkedContactIds] = useState([]);
  const [linkedTasks, setLinkedTasks] = useState([]);
  const [linkedEvents, setLinkedEvents] = useState([]);
  const [linkedInvestments, setLinkedInvestments] = useState([]);
  const [linkedDrawings, setLinkedDrawings] = useState([]);
  const [propertyNotes, setPropertyNotes] = useState([]);

  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactQuery, setContactQuery] = useState('');

  const [newNoteBody, setNewNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const [viewDrawing, setViewDrawing] = useState(null);

  const linkedContacts = useMemo(
    () => linkedContactIds.map(id => contacts.find(c => c.id === id)).filter(Boolean),
    [linkedContactIds, contacts]
  );

  useEffect(() => {
    if (!property?.id) return;
    let cancelled = false;
    (async () => {
      const [lcRes, ltRes, leRes, liRes, ldRes, lnRes] = await Promise.all([
        supabase.from('property_contacts').select('contact_id').eq('property_id', property.id),
        supabase.from('tasks').select('*').eq('property_id', property.id).order('completed').order('due_date', { nullsFirst: false }),
        supabase.from('events').select('*').eq('property_id', property.id).order('start_at', { ascending: false }).limit(50),
        supabase.from('investments').select('*').eq('property_id', property.id).order('created_at', { ascending: false }),
        supabase.from('drawings').select('id, title, shapes, units, px_per_unit, created_at').eq('property_id', property.id).order('created_at', { ascending: false }),
        supabase.from('property_notes').select('*').eq('property_id', property.id).order('created_at', { ascending: false }),
      ]);
      if (cancelled) return;
      setLinkedContactIds((lcRes.data || []).map(r => r.contact_id));
      setLinkedTasks(ltRes.data || []);
      setLinkedEvents(leRes.data || []);
      setLinkedInvestments(liRes.data || []);
      setLinkedDrawings(ldRes.data || []);
      setPropertyNotes(lnRes.data || []);
    })();
    return () => { cancelled = true; };
  }, [property?.id]);

  async function addContactLink(contactId) {
    const newIds = [...linkedContactIds, contactId];
    const { error } = await supabase.rpc('set_property_contacts', {
      p_property_id: property.id,
      p_contact_ids: newIds,
    });
    if (error) {
      if (window.__notify) window.__notify('Could not link contact: ' + error.message, 'error');
      return;
    }
    setLinkedContactIds(newIds);
    setShowContactPicker(false);
    setContactQuery('');
  }

  async function removeContactLink(contactId) {
    const newIds = linkedContactIds.filter(id => id !== contactId);
    const { error } = await supabase.rpc('set_property_contacts', {
      p_property_id: property.id,
      p_contact_ids: newIds,
    });
    if (error) {
      if (window.__notify) window.__notify('Could not unlink contact: ' + error.message, 'error');
      return;
    }
    setLinkedContactIds(newIds);
  }

  async function addDatedNote() {
    const body = newNoteBody.trim();
    if (!body || savingNote) return;
    setSavingNote(true);
    const { data, error } = await supabase.from('property_notes').insert({
      user_id: userId, property_id: property.id, body,
    }).select().single();
    setSavingNote(false);
    if (error) {
      if (window.__notify) window.__notify('Could not save note: ' + error.message, 'error');
      return;
    }
    setPropertyNotes(prev => [data, ...prev]);
    setNewNoteBody('');
  }

  async function deleteDatedNote(noteId) {
    const prev = propertyNotes;
    setPropertyNotes(p => p.filter(n => n.id !== noteId));
    const { error } = await supabase.from('property_notes').delete().eq('id', noteId);
    if (error) {
      setPropertyNotes(prev);
      if (window.__notify) window.__notify('Could not delete note: ' + error.message, 'error');
    }
  }

  async function handleDeleteProperty() {
    if (!window.confirm(`Delete ${property.nickname || 'this property'}? This removes the property and all its linked notes. Tasks/events stay but lose the link.`)) return;
    const { error } = await supabase.from('properties').delete().eq('id', property.id);
    if (error) {
      if (window.__notify) window.__notify('Could not delete: ' + error.message, 'error');
      return;
    }
    onDeleted?.(property.id);
    onClose();
  }

  const availableContacts = useMemo(() => {
    const linked = new Set(linkedContactIds);
    const q = contactQuery.toLowerCase().trim();
    return contacts
      .filter(c => !linked.has(c.id))
      .filter(c => !q || (c.name || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q))
      .slice(0, 20);
  }, [contacts, linkedContactIds, contactQuery]);

  const equity = property.current_value && property.loan_balance
    ? Number(property.current_value) - Number(property.loan_balance)
    : null;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:'620px',padding:0,maxHeight:'92vh',overflowY:'auto'}}>
        <div style={{padding:'16px 18px 14px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'10px',position:'sticky',top:0,background:'var(--bg-card)',zIndex:5}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom:'4px'}}>
              <h3 style={{margin:0,fontSize:'18px',color:'var(--text-1)'}}>{property.nickname || 'Untitled property'}</h3>
              {property.category && <span className="task-priority" style={{background:'var(--bg-hover)',color:'var(--text-2)',textTransform:'capitalize'}}>{property.category}</span>}
              {property.status && <span className="task-priority" style={{background:'var(--bg-hover)',color:'var(--text-2)'}}>{(property.status || '').replace('_', ' ')}</span>}
            </div>
            {property.address && (
              <div style={{fontSize:'13px',color:'var(--text-2)'}}>
                {[property.address, property.city, property.state, property.zip].filter(Boolean).join(', ')}
              </div>
            )}
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {(property.current_value || property.loan_balance || property.list_price) && (
          <div style={{padding:'10px 18px',borderBottom:'1px solid var(--border)',display:'flex',gap:'18px',flexWrap:'wrap',fontSize:'12px'}}>
            {property.list_price ? <div><span style={{color:'var(--text-3)'}}>List:</span> <strong style={{color:'var(--text-1)'}}>${Number(property.list_price).toLocaleString()}</strong></div> : null}
            {property.current_value ? <div><span style={{color:'var(--text-3)'}}>Value:</span> <strong style={{color:'var(--text-1)'}}>${Number(property.current_value).toLocaleString()}</strong></div> : null}
            {property.loan_balance ? <div><span style={{color:'var(--text-3)'}}>Loan:</span> <strong style={{color:'var(--text-1)'}}>${Number(property.loan_balance).toLocaleString()}</strong>{property.loan_rate ? <span style={{color:'var(--text-3)'}}> @ {property.loan_rate}%</span> : null}</div> : null}
            {equity !== null ? <div><span style={{color:'var(--text-3)'}}>Equity:</span> <strong style={{color:'var(--accent)'}}>${equity.toLocaleString()}</strong></div> : null}
          </div>
        )}

        <div style={{padding:'14px 18px',borderTop:'1px solid var(--border)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
            <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)'}}>👥 Contacts ({linkedContacts.length})</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowContactPicker(v => !v)} style={{fontSize:'11px'}}>
              {showContactPicker ? '× Cancel' : '+ Link'}
            </button>
          </div>
          {showContactPicker && (
            <div style={{padding:'8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',marginBottom:'8px'}}>
              <input className="form-input" placeholder="Search contacts…" value={contactQuery} onChange={e => setContactQuery(e.target.value)} autoFocus style={{fontSize:'12px',padding:'6px 8px',marginBottom:'6px'}} />
              <div style={{maxHeight:'180px',overflowY:'auto'}}>
                {availableContacts.length === 0 && (
                  <div style={{fontSize:'11px',color:'var(--text-3)',padding:'4px',fontStyle:'italic'}}>No contacts {contactQuery ? 'match' : 'available to link'}.</div>
                )}
                {availableContacts.map(c => (
                  <div key={c.id} onClick={() => addContactLink(c.id)} style={{padding:'6px 8px',cursor:'pointer',fontSize:'12px',borderRadius:'4px'}} onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    {c.name} {c.email && <span style={{color:'var(--text-3)'}}>· {c.email}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {linkedContacts.length === 0 && !showContactPicker && (
            <div style={{fontSize:'11px',color:'var(--text-3)',fontStyle:'italic'}}>No contacts linked.</div>
          )}
          {linkedContacts.map(c => (
            <div key={c.id} style={{padding:'6px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',marginBottom:'4px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',fontSize:'12px'}}>
              <div style={{flex:1,minWidth:0,color:'var(--text-1)'}}>
                {c.name} {c.email && <span style={{color:'var(--text-3)'}}>· {c.email}</span>}
              </div>
              <button onClick={() => removeContactLink(c.id)} title="Unlink" style={{background:'none',border:'none',color:'var(--text-3)',cursor:'pointer',fontSize:'14px',padding:'0 4px'}}>×</button>
            </div>
          ))}
        </div>

        <div style={{padding:'14px 18px',borderTop:'1px solid var(--border)'}}>
          <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'8px'}}>
            ✅ Tasks ({linkedTasks.length})
          </div>
          {linkedTasks.length === 0 ? (
            <div style={{fontSize:'11px',color:'var(--text-3)',fontStyle:'italic'}}>No tasks linked. Link this property when creating or editing a task.</div>
          ) : linkedTasks.map(t => (
            <div key={t.id} style={{padding:'6px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',marginBottom:'4px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:'8px',fontSize:'12px'}}>
              <div style={{flex:1,minWidth:0,textDecoration: t.completed ? 'line-through' : 'none',color: t.completed ? 'var(--text-3)' : 'var(--text-1)'}}>
                {t.completed ? '✓ ' : '○ '}{t.title}
              </div>
              {t.due_date && <span style={{fontSize:'10px',color:'var(--text-3)',whiteSpace:'nowrap'}}>{new Date(t.due_date).toLocaleDateString()}</span>}
            </div>
          ))}
        </div>

        <div style={{padding:'14px 18px',borderTop:'1px solid var(--border)'}}>
          <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'8px'}}>
            📅 Events ({linkedEvents.length})
          </div>
          {linkedEvents.length === 0 ? (
            <div style={{fontSize:'11px',color:'var(--text-3)',fontStyle:'italic'}}>No events linked.</div>
          ) : linkedEvents.slice(0, 10).map(e => (
            <div key={e.id} style={{padding:'6px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',marginBottom:'4px',fontSize:'12px'}}>
              <div style={{color:'var(--text-1)'}}>{e.title}</div>
              <div style={{fontSize:'10px',color:'var(--text-3)'}}>{e.start_at ? new Date(e.start_at).toLocaleString() : '—'}</div>
            </div>
          ))}
          {linkedEvents.length > 10 && <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'4px'}}>Showing 10 of {linkedEvents.length}.</div>}
        </div>

        {linkedInvestments.length > 0 && (
          <div style={{padding:'14px 18px',borderTop:'1px solid var(--border)'}}>
            <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'8px'}}>💰 Investments ({linkedInvestments.length})</div>
            {linkedInvestments.map(inv => (
              <div key={inv.id} style={{padding:'6px 8px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'4px',marginBottom:'4px',display:'flex',justifyContent:'space-between',gap:'8px',fontSize:'12px'}}>
                <div style={{color:'var(--text-1)'}}>{inv.label || inv.kind || 'Investment'}</div>
                {inv.amount && <span style={{color:'var(--accent)'}}>${Number(inv.amount).toLocaleString()}</span>}
              </div>
            ))}
          </div>
        )}

        {linkedDrawings.length > 0 && (
          <div style={{padding:'14px 18px',borderTop:'1px solid var(--border)'}}>
            <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'8px'}}>✏️ Drawings ({linkedDrawings.length})</div>
            {linkedDrawings.map(d => {
              const shapeCount = Array.isArray(d.shapes) ? d.shapes.length : 0;
              return (
                <div key={d.id} onClick={() => setViewDrawing(d)} style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',marginBottom:'4px',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:'12px'}}>
                  <div>
                    <div style={{color:'var(--text-1)',fontWeight:500}}>{d.title || 'Untitled drawing'}</div>
                    <div style={{fontSize:'10px',color:'var(--text-3)'}}>{shapeCount} shape{shapeCount === 1 ? '' : 's'} · {d.created_at ? new Date(d.created_at).toLocaleDateString() : '—'}</div>
                  </div>
                  <span style={{color:'var(--accent)',fontSize:'11px'}}>View ›</span>
                </div>
              );
            })}
          </div>
        )}

        <div style={{padding:'14px 18px',borderTop:'1px solid var(--border)'}}>
          <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'8px'}}>📝 Dated notes ({propertyNotes.length})</div>
          <div style={{display:'flex',gap:'6px',marginBottom:'8px'}}>
            <input className="form-input" placeholder="Add a note (stamped with today's date)…"
              value={newNoteBody} onChange={e => setNewNoteBody(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addDatedNote(); } }}
              style={{flex:1,padding:'6px 10px',fontSize:'12px',margin:0}} />
            <button className="btn btn-primary btn-sm" onClick={addDatedNote} disabled={savingNote || !newNoteBody.trim()} style={{fontSize:'11px',whiteSpace:'nowrap'}}>
              {savingNote ? '↻' : '+ Add'}
            </button>
          </div>
          {propertyNotes.length === 0 ? (
            <div style={{fontSize:'11px',color:'var(--text-3)',fontStyle:'italic'}}>No notes yet.</div>
          ) : propertyNotes.map(n => (
            <div key={n.id} style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',marginBottom:'4px',fontSize:'12px'}}>
              <div style={{color:'var(--text-1)',whiteSpace:'pre-wrap',marginBottom:'4px'}}>{n.body}</div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:'10px',color:'var(--text-3)'}}>{new Date(n.created_at).toLocaleString()}</span>
                <button onClick={() => deleteDatedNote(n.id)} title="Delete" style={{background:'none',border:'none',color:'var(--text-3)',cursor:'pointer',fontSize:'12px',padding:'0 4px'}}>×</button>
              </div>
            </div>
          ))}
        </div>

        {property.notes && (
          <div style={{padding:'14px 18px',borderTop:'1px solid var(--border)'}}>
            <div style={{fontSize:'13px',fontWeight:600,color:'var(--text-1)',marginBottom:'4px'}}>Note (on property record)</div>
            <div style={{fontSize:'12px',color:'var(--text-2)',whiteSpace:'pre-wrap'}}>{property.notes}</div>
          </div>
        )}

        <div style={{padding:'14px 18px',borderTop:'1px solid var(--border)',display:'flex',gap:'8px',justifyContent:'space-between'}}>
          <button className="btn btn-ghost btn-sm" onClick={handleDeleteProperty} style={{color:'var(--red)'}}>Delete property</button>
          <div style={{display:'flex',gap:'8px'}}>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
            <button className="btn btn-primary" onClick={onEdit}>Edit details</button>
          </div>
        </div>

        {viewDrawing && (
          <DrawingViewerModal drawing={viewDrawing} onClose={() => setViewDrawing(null)} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// DRAWING VIEWER MODAL — minimal read-only SVG renderer
// Restored per Q3a=C. Only renders the shape types Dara used: line, rect,
// circle, polyline, freehand. No editing, no panning/zooming.
// ─────────────────────────────────────────
function DrawingViewerModal({ drawing, onClose }) {
  // Memoize so the useMemo below doesn't see a new array on every render.
  const shapes = useMemo(
    () => Array.isArray(drawing.shapes) ? drawing.shapes : [],
    [drawing.shapes]
  );

  const bbox = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function note(x, y) {
      if (typeof x === 'number' && typeof y === 'number') {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    for (const s of shapes) {
      if (s.type === 'line' || s.type === 'dimension') { note(s.x1, s.y1); note(s.x2, s.y2); }
      else if (s.type === 'rect') { note(s.x, s.y); note((s.x || 0) + (s.w || 0), (s.y || 0) + (s.h || 0)); }
      else if (s.type === 'circle') { note((s.cx || 0) - (s.r || 0), (s.cy || 0) - (s.r || 0)); note((s.cx || 0) + (s.r || 0), (s.cy || 0) + (s.r || 0)); }
      else if ((s.type === 'polyline' || s.type === 'freehand') && Array.isArray(s.points)) { for (const p of s.points) note(p.x, p.y); }
      else if (s.type === 'text') { note(s.x, s.y); note((s.x || 0) + 50, (s.y || 0) + 14); }
    }
    if (minX === Infinity) return { x: 0, y: 0, w: 100, h: 100 };
    const pad = 20;
    return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
  }, [shapes]);

  function renderShape(s, i) {
    const stroke = s.stroke || s.color || '#e8eaf0';
    const fill = s.fillStyle && s.fillStyle !== 'none' ? (s.fillColor || stroke) : 'none';
    const sw = s.strokeWidth || 2;
    const common = { stroke, strokeWidth: sw, fill, key: s.id || i };
    if (s.type === 'line' || s.type === 'dimension') return <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...common} fill="none" />;
    if (s.type === 'rect') return <rect x={s.x} y={s.y} width={s.w} height={s.h} {...common} />;
    if (s.type === 'circle') return <circle cx={s.cx} cy={s.cy} r={s.r} {...common} />;
    if (s.type === 'polyline' && Array.isArray(s.points)) {
      const pts = s.points.map(p => `${p.x},${p.y}`).join(' ');
      return <polyline points={pts} {...common} fill="none" />;
    }
    if (s.type === 'freehand' && Array.isArray(s.points) && s.points.length >= 2) {
      const d = 'M ' + s.points.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ');
      return <path d={d} {...common} fill="none" />;
    }
    if (s.type === 'text') {
      return <text x={s.x} y={s.y} fill={s.color || stroke} fontSize={s.fontSize || 14} key={s.id || i}>{s.text || ''}</text>;
    }
    return null;
  }

  return (
    <div className="modal-overlay" style={{zIndex: 1500}} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{maxWidth:'820px',width:'94%',padding:0,maxHeight:'92vh',overflowY:'auto'}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <h3 style={{margin:0,fontSize:'16px',color:'var(--text-1)'}}>{drawing.title || 'Untitled drawing'}</h3>
            <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'2px'}}>
              {shapes.length} shape{shapes.length === 1 ? '' : 's'} · Read-only view
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{padding:'18px',background:'var(--bg-base)'}}>
          <div style={{background:'#1a1d26',borderRadius:'6px',padding:'12px',minHeight:'320px'}}>
            <svg viewBox={`${bbox.x} ${bbox.y} ${bbox.w} ${bbox.h}`} style={{width:'100%',height:'auto',maxHeight:'60vh',display:'block'}}>
              {shapes.map(renderShape)}
            </svg>
          </div>
          <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'8px',textAlign:'center'}}>
            Read-only viewer. The drafting editor is not currently available.
          </div>
        </div>
      </div>
    </div>
  );
}

function PropertyModal({ onClose, onSave, initial }) {
  const [nickname, setNickname] = useState(initial?.nickname || '');
  const [category, setCategory] = useState(initial?.category || 'listing');
  const [address, setAddress] = useState(initial?.address || '');
  const [city, setCity] = useState(initial?.city || '');
  const [state, setState] = useState(initial?.state || '');
  const [zip, setZip] = useState(initial?.zip || '');
  const [status, setStatus] = useState(initial?.status || 'active');
  const [list_price, setListPrice] = useState(initial?.list_price || '');
  const [purchase_price, setPurchasePrice] = useState(initial?.purchase_price || '');
  const [current_value, setCurrentValue] = useState(initial?.current_value || '');
  const [beds, setBeds] = useState(initial?.beds || '');
  const [baths, setBaths] = useState(initial?.baths || '');
  const [sqft, setSqft] = useState(initial?.sqft || '');
  const [lot_size, setLotSize] = useState(initial?.lot_size || '');
  const [year_built, setYearBuilt] = useState(initial?.year_built || '');
  const [loan_balance, setLoanBalance] = useState(initial?.loan_balance || '');
  const [loan_rate, setLoanRate] = useState(initial?.loan_rate || '');
  const [loan_holders, setLoanHolders] = useState(initial?.loan_holders || '');
  const [notes, setNotes] = useState(initial?.notes || '');

  const num = v => v === '' || v === null || v === undefined ? null : Number(v);
  const txt = v => (v ?? '').trim() || null;

  function handleSubmit(e) {
    e.preventDefault();
    if (!nickname.trim()) return;
    onSave({
      nickname: nickname.trim(), category,
      address: txt(address), city: txt(city), state: txt(state), zip: txt(zip),
      status,
      list_price: num(list_price), purchase_price: num(purchase_price), current_value: num(current_value),
      beds: num(beds), baths: num(baths), sqft: num(sqft), lot_size: num(lot_size), year_built: num(year_built),
      loan_balance: num(loan_balance), loan_rate: num(loan_rate), loan_holders: txt(loan_holders),
      notes: txt(notes),
    });
  }

  const equity = current_value && loan_balance ? Number(current_value) - Number(loan_balance) : null;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>{initial ? 'Edit Property' : 'New Property'}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label className="form-label">Nickname</label><input className="form-input" value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="Wellington, Villa Adriana…" autoFocus required /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Category</label>
              <select className="form-select" value={category} onChange={e=>setCategory(e.target.value)}>
                <option value="listing">Listing</option>
                <option value="investment">Investment</option>
                <option value="personal">Personal</option>
                <option value="rental">Rental</option>
              </select>
            </div>
            <div className="form-group"><label className="form-label">Status</label>
              <select className="form-select" value={status} onChange={e=>setStatus(e.target.value)}>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="closed">Closed</option>
                <option value="off_market">Off Market</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>
          <div className="form-group"><label className="form-label">Address</label><input className="form-input" value={address} onChange={e=>setAddress(e.target.value)} placeholder="Street address" /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">City</label><input className="form-input" value={city} onChange={e=>setCity(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">State</label><input className="form-input" value={state} onChange={e=>setState(e.target.value)} maxLength="2" /></div>
            <div className="form-group"><label className="form-label">ZIP</label><input className="form-input" value={zip} onChange={e=>setZip(e.target.value)} /></div>
          </div>

          <div style={{margin:'18px 0 8px',fontSize:'12px',fontWeight:600,color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'0.5px'}}>Valuation</div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Purchase Price ($)</label><input className="form-input" type="number" value={purchase_price} onChange={e=>setPurchasePrice(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Current Value ($)</label><input className="form-input" type="number" value={current_value} onChange={e=>setCurrentValue(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">List Price ($)</label><input className="form-input" type="number" value={list_price} onChange={e=>setListPrice(e.target.value)} /></div>
          </div>

          <div style={{margin:'18px 0 8px',fontSize:'12px',fontWeight:600,color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'0.5px'}}>Mortgage</div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Loan Balance ($)</label><input className="form-input" type="number" value={loan_balance} onChange={e=>setLoanBalance(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Rate (%)</label><input className="form-input" type="number" step="0.01" value={loan_rate} onChange={e=>setLoanRate(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Loan Holder(s)</label><input className="form-input" value={loan_holders} onChange={e=>setLoanHolders(e.target.value)} placeholder="Self / Spouse / Children" /></div>
          </div>
          {equity !== null && (
            <div style={{padding:'8px 12px',background:'var(--bg-hover)',borderRadius:'6px',marginBottom:'12px',fontSize:'13px',color:'var(--text-2)'}}>
              Equity: <strong style={{color:'var(--accent)'}}>${equity.toLocaleString()}</strong>
            </div>
          )}

          <div style={{margin:'18px 0 8px',fontSize:'12px',fontWeight:600,color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'0.5px'}}>Details</div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Beds</label><input className="form-input" type="number" value={beds} onChange={e=>setBeds(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Baths</label><input className="form-input" type="number" step="0.5" value={baths} onChange={e=>setBaths(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Sq Ft</label><input className="form-input" type="number" value={sqft} onChange={e=>setSqft(e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Lot Size (acres)</label><input className="form-input" type="number" step="0.01" value={lot_size} onChange={e=>setLotSize(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Year Built</label><input className="form-input" type="number" value={year_built} onChange={e=>setYearBuilt(e.target.value)} /></div>
          </div>

          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={notes} onChange={e=>setNotes(e.target.value)} /></div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save Property</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PropertiesView({ properties, setProperties, userId, contacts }) {
  const [showModal, setShowModal] = useState(false);
  const [editProp, setEditProp] = useState(null);
  const [detailProp, setDetailProp] = useState(null);
  const [catFilter, setCatFilter] = useState('all');

  const CATS = [
    { id: 'all', label: 'All', icon: '🏠' },
    { id: 'listing', label: 'Listings', icon: '🏡' },
    { id: 'investment', label: 'Investments', icon: '💰' },
    { id: 'personal', label: 'Personal', icon: '🏘️' },
    { id: 'rental', label: 'Rentals', icon: '🔑' },
  ];

  const filtered = catFilter === 'all' ? properties : properties.filter(p => p.category === catFilter);

  async function handleSave(data) {
    if (editProp) {
      const { data: u } = await supabase.from('properties').update(data).eq('id', editProp.id).select().single();
      if (u) setProperties(prev => prev.map(p => p.id === u.id ? u : p));
    } else {
      const { data: c } = await supabase.from('properties').insert({ ...data, user_id: userId }).select().single();
      if (c) setProperties(prev => [c, ...prev]);
    }
    setShowModal(false); setEditProp(null);
  }

  return (
    <div>
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
        <div><h2>Properties</h2><p>{properties.length} total · {filtered.length} shown</p></div>
        <button className="btn btn-primary" onClick={()=>{setEditProp(null);setShowModal(true);}}>+ New Property</button>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Properties</h3>
          <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
            {CATS.map(c => (
              <button key={c.id} className={`btn btn-sm ${catFilter===c.id?'btn-primary':'btn-ghost'}`} onClick={()=>setCatFilter(c.id)}>{c.icon} {c.label}</button>
            ))}
          </div>
        </div>
        <div className="panel-body">
          {filtered.length === 0
            ? <div className="empty-state"><div className="empty-icon">🏠</div><p>No properties here.</p></div>
            : <div className="task-list">
                {filtered.map(p => {
                  const equity = p.current_value && p.loan_balance ? Number(p.current_value) - Number(p.loan_balance) : null;
                  return (
                  <div key={p.id} className="task-item" style={{cursor:'pointer'}} onClick={()=>setDetailProp(p)}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:600,color:'var(--text-1)',display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
                        {p.nickname}
                        <span className="task-priority" style={{background:'var(--bg-hover)',color:'var(--text-2)',textTransform:'capitalize'}}>{p.category}</span>
                      </div>
                      {p.address && <div style={{fontSize:'13px',color:'var(--text-2)',marginTop:'2px'}}>{[p.address,p.city,p.state,p.zip].filter(Boolean).join(', ')}</div>}
                      <div style={{fontSize:'12px',color:'var(--text-3)',marginTop:'2px',display:'flex',gap:'10px',flexWrap:'wrap'}}>
                        {p.category === 'listing' && p.list_price && <span>List ${Number(p.list_price).toLocaleString()}</span>}
                        {p.current_value && <span>Value ${Number(p.current_value).toLocaleString()}</span>}
                        {p.loan_balance && <span>Loan ${Number(p.loan_balance).toLocaleString()}{p.loan_rate?` @ ${p.loan_rate}%`:''}</span>}
                        {equity !== null && <span style={{color:'var(--accent)'}}>Equity ${equity.toLocaleString()}</span>}
                      </div>
                    </div>
                    <div className="task-meta">
                      <span className="task-priority" style={{background:'var(--bg-hover)',color:'var(--text-2)'}}>{(p.status||'').replace('_',' ')}</span>
                    </div>
                  </div>
                  );
                })}
              </div>
          }
        </div>
      </div>
      {showModal && <PropertyModal onClose={()=>{setShowModal(false);setEditProp(null);}} onSave={handleSave} initial={editProp} />}
      {detailProp && (
        <PropertyDetailModal
          property={detailProp}
          contacts={contacts || []}
          onClose={() => setDetailProp(null)}
          onEdit={() => { setEditProp(detailProp); setShowModal(true); setDetailProp(null); }}
          onDeleted={(id) => setProperties(prev => prev.filter(p => p.id !== id))}
          userId={userId}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// INVESTMENTS VIEW
// ─────────────────────────────────────────
function InvestmentModal({ onClose, onSave, initial, properties }) {
  const [name, setName] = useState(initial?.name || '');
  const [kind, setKind] = useState(initial?.kind || 'deal');
  const [stage, setStage] = useState(initial?.stage || 'screening');
  const [property_id, setPropertyId] = useState(initial?.property_id || '');
  const [amount, setAmount] = useState(initial?.amount || '');
  const [income_ytd, setIncomeYtd] = useState(initial?.income_ytd || '');
  const [expense_ytd, setExpenseYtd] = useState(initial?.expense_ytd || '');
  const [due_date, setDueDate] = useState(initial?.due_date || '');
  const [notes, setNotes] = useState(initial?.notes || '');

  function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(), kind, stage, property_id: property_id || null,
      amount: amount ? Number(amount) : null,
      income_ytd: income_ytd ? Number(income_ytd) : null,
      expense_ytd: expense_ytd ? Number(expense_ytd) : null,
      due_date: due_date || null, notes: notes.trim() || null,
    });
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>{initial ? 'Edit Investment' : 'New Investment'}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={name} onChange={e=>setName(e.target.value)} autoFocus required /></div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Kind</label>
              <select className="form-select" value={kind} onChange={e=>setKind(e.target.value)}>
                <option value="deal">Deal</option>
                <option value="pnl">P&L</option>
                <option value="partner_comm">Partner Comm</option>
              </select>
            </div>
            <div className="form-group"><label className="form-label">Stage</label>
              <select className="form-select" value={stage} onChange={e=>setStage(e.target.value)}>
                <option value="screening">Screening</option>
                <option value="due_diligence">Due Diligence</option>
                <option value="under_contract">Under Contract</option>
                <option value="active">Active</option>
                <option value="exited">Exited</option>
                <option value="dead">Dead</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Linked Property</label>
              <select className="form-select" value={property_id} onChange={e=>setPropertyId(e.target.value)}>
                <option value="">— None —</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.nickname}</option>)}
              </select>
            </div>
            <div className="form-group"><label className="form-label">Amount ($)</label><input className="form-input" type="number" value={amount} onChange={e=>setAmount(e.target.value)} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Income YTD</label><input className="form-input" type="number" value={income_ytd} onChange={e=>setIncomeYtd(e.target.value)} /></div>
            <div className="form-group"><label className="form-label">Expense YTD</label><input className="form-input" type="number" value={expense_ytd} onChange={e=>setExpenseYtd(e.target.value)} /></div>
          </div>
          <div className="form-group"><label className="form-label">Due Date</label><input className="form-input" type="date" value={due_date} onChange={e=>setDueDate(e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={notes} onChange={e=>setNotes(e.target.value)} /></div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save Investment</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InvestmentsView({ investments, setInvestments, properties, userId }) {
  const [showModal, setShowModal] = useState(false);
  const [editInv, setEditInv] = useState(null);
  const [stageFilter, setStageFilter] = useState('all');

  const STAGES = [
    { id: 'all', label: 'All' },
    { id: 'screening', label: 'Screening' },
    { id: 'due_diligence', label: 'Due Dil' },
    { id: 'under_contract', label: 'Under Contract' },
    { id: 'active', label: 'Active' },
    { id: 'exited', label: 'Exited' },
    { id: 'dead', label: 'Dead' },
  ];

  const filtered = stageFilter === 'all' ? investments : investments.filter(i => i.stage === stageFilter);

  // Roll-ups (active only)
  const active = investments.filter(i => i.stage === 'active');
  const totalAmount = active.reduce((s,i) => s + Number(i.amount||0), 0);
  const totalIncome = active.reduce((s,i) => s + Number(i.income_ytd||0), 0);
  const totalExpense = active.reduce((s,i) => s + Number(i.expense_ytd||0), 0);
  const netYtd = totalIncome - totalExpense;

  async function handleSave(data) {
    if (editInv) {
      const { data: u } = await supabase.from('investments').update(data).eq('id', editInv.id).select().single();
      if (u) setInvestments(prev => prev.map(i => i.id === u.id ? u : i));
    } else {
      const { data: c } = await supabase.from('investments').insert({ ...data, user_id: userId }).select().single();
      if (c) setInvestments(prev => [c, ...prev]);
    }
    setShowModal(false); setEditInv(null);
  }

  async function deleteInv(id) {
    if (!window.confirm('Delete this investment?')) return;
    await supabase.from('investments').delete().eq('id', id);
    setInvestments(prev => prev.filter(i => i.id !== id));
  }

  return (
    <div>
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
        <div><h2>Investments</h2><p>{investments.length} total · {active.length} active</p></div>
        <button className="btn btn-primary" onClick={()=>{setEditInv(null);setShowModal(true);}}>+ New Investment</button>
      </div>

      <div className="cards-row">
        <div className="stat-card"><div className="stat-label">Active Capital</div><div className="stat-value">${totalAmount.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-label">Income YTD</div><div className="stat-value" style={{color:'var(--green)'}}>${totalIncome.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-label">Expense YTD</div><div className="stat-value" style={{color:'var(--red)'}}>${totalExpense.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-label">Net YTD</div><div className="stat-value" style={{color: netYtd>=0?'var(--green)':'var(--red)'}}>${netYtd.toLocaleString()}</div></div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Investments</h3>
          <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
            {STAGES.map(s => (
              <button key={s.id} className={`btn btn-sm ${stageFilter===s.id?'btn-primary':'btn-ghost'}`} onClick={()=>setStageFilter(s.id)}>{s.label}</button>
            ))}
          </div>
        </div>
        <div className="panel-body">
          {filtered.length === 0
            ? <div className="empty-state"><div className="empty-icon">💰</div><p>No investments here.</p></div>
            : <div className="task-list">
                {filtered.map(i => {
                  const linkedProp = properties.find(p => p.id === i.property_id);
                  return (
                    <div key={i.id} className="task-item" style={{cursor:'pointer'}} onClick={()=>{setEditInv(i);setShowModal(true);}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:600,color:'var(--text-1)',display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
                          {i.name}
                          <span className="task-priority" style={{background:'var(--bg-hover)',color:'var(--text-2)',textTransform:'capitalize'}}>{(i.stage||'').replace('_',' ')}</span>
                          <span className="task-priority" style={{background:'var(--bg-hover)',color:'var(--text-3)',fontSize:'11px'}}>{(i.kind||'').replace('_',' ')}</span>
                        </div>
                        {linkedProp && <div style={{fontSize:'13px',color:'var(--text-2)',marginTop:'2px'}}>📍 {linkedProp.nickname}</div>}
                        {i.amount && <div style={{fontSize:'12px',color:'var(--text-3)',marginTop:'2px'}}>${Number(i.amount).toLocaleString()}</div>}
                      </div>
                      <div className="task-meta">
                        <button className="task-delete" onClick={(e)=>{e.stopPropagation();deleteInv(i.id);}}>×</button>
                      </div>
                    </div>
                  );
                })}
              </div>
          }
        </div>
      </div>
      {showModal && <InvestmentModal onClose={()=>{setShowModal(false);setEditInv(null);}} onSave={handleSave} initial={editInv} properties={properties} />}
    </div>
  );
}


// ─────────────────────────────────────────
// BRAIN VIEW (Soul / Memory / Playbooks / Decisions / Lessons / North Star)
// Hybrid search (FTS + trigram), tags, strength, streak gamification
// ─────────────────────────────────────────
function BrainEntryModal({ onClose, onSave, initial, defaultType }) {
  const [type, setType] = useState(initial?.type || defaultType || 'memory');
  const [title, setTitle] = useState(initial?.title || '');
  const [content, setContent] = useState(initial?.content || '');
  const [event_date, setEventDate] = useState(initial?.event_date || '');
  const [pinned, setPinned] = useState(initial?.pinned || false);
  const [tagsRaw, setTagsRaw] = useState((initial?.tags || []).join(', '));
  const [strength, setStrength] = useState(initial?.strength ?? 50);

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
    onSave({
      type, title: title.trim(), content: content.trim() || null,
      event_date: event_date || null, pinned, tags, strength,
    });
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>{initial ? 'Edit Brain Entry' : 'New Brain Entry'}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Type</label>
              <select className="form-select" value={type} onChange={e=>setType(e.target.value)}>
                <option value="north-star">🎯 North Star</option>
                <option value="soul">🪞 Soul</option>
                <option value="memory">📖 Memory</option>
                <option value="playbook">📚 Playbook</option>
                <option value="decision">⚖️ Decision</option>
                <option value="lesson">💡 Lesson</option>
              </select>
            </div>
            <div className="form-group"><label className="form-label">Date (optional)</label><input className="form-input" type="date" value={event_date} onChange={e=>setEventDate(e.target.value)} /></div>
          </div>
          <div className="form-group"><label className="form-label">Title</label><input className="form-input" value={title} onChange={e=>setTitle(e.target.value)} autoFocus required /></div>
          <div className="form-group"><label className="form-label">Content</label><textarea className="form-textarea" value={content} onChange={e=>setContent(e.target.value)} style={{minHeight:'180px'}} placeholder="What is this? Why does it matter? What's the action?" /></div>
          <div className="form-group">
            <label className="form-label">Tags <span style={{color:'var(--text-3)',fontWeight:400,fontSize:'11px'}}>(comma-separated, e.g. alex, succession, recruiting)</span></label>
            <input className="form-input" value={tagsRaw} onChange={e=>setTagsRaw(e.target.value)} placeholder="tag1, tag2, tag3" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Strength <span style={{color:'var(--accent)',fontWeight:700,fontSize:'13px'}}>{strength}</span></label>
              <input type="range" min="0" max="100" step="5" value={strength} onChange={e=>setStrength(parseInt(e.target.value))} style={{width:'100%',accentColor:'var(--accent)'}} />
              <div style={{display:'flex',justifyContent:'space-between',fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>
                <span>passing</span><span>core belief</span>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer',marginTop:'24px'}}>
                <input type="checkbox" checked={pinned} onChange={e=>setPinned(e.target.checked)} />
                📌 Pin to top
              </label>
            </div>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save Entry</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Compute current streak: consecutive days (ending today or yesterday) with ≥1 brain entry
function computeBrainStreak(brain) {
  if (!brain || brain.length === 0) return { current: 0, longest: 0, today: false };
  const days = new Set();
  for (const b of brain) {
    if (!b.created_at) continue;
    const d = new Date(b.created_at);
    days.add(d.toISOString().slice(0,10));
  }
  const today = new Date().toISOString().slice(0,10);
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0,10);
  const hitToday = days.has(today);
  // Start from today or yesterday
  let cursor = hitToday ? today : (days.has(yesterday) ? yesterday : null);
  let current = 0;
  while (cursor && days.has(cursor)) {
    current++;
    const prev = new Date(new Date(cursor).getTime() - 864e5);
    cursor = prev.toISOString().slice(0,10);
  }
  // Longest streak across all data
  const sortedDays = [...days].sort();
  let longest = 0, run = 0, prev = null;
  for (const d of sortedDays) {
    if (prev) {
      const gap = (new Date(d) - new Date(prev)) / 864e5;
      run = gap === 1 ? run + 1 : 1;
    } else { run = 1; }
    longest = Math.max(longest, run);
    prev = d;
  }
  return { current, longest, today: hitToday };
}

function BrainView({ brain, setBrain, userId, tasks = [], events = [] }) {
  const [showModal, setShowModal] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [activeTab, setActiveTab] = useState('north-star');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null); // null = not searching, [] = no results
  const [searchLoading, setSearchLoading] = useState(false);
  const [semanticMode, setSemanticMode] = useState(false);

  const TABS = [
    { id: 'north-star', label: 'North Star', icon: '🎯' },
    { id: 'soul',       label: 'Soul',       icon: '🪞' },
    { id: 'memory',     label: 'Memory',     icon: '📖' },
    { id: 'playbook',   label: 'Playbooks',  icon: '📚' },
    { id: 'decision',   label: 'Decisions',  icon: '⚖️' },
    { id: 'lesson',     label: 'Lessons',    icon: '💡' },
  ];

  // STREAK: consecutive days with at least one brain entry
  const streak = computeBrainStreak(brain);
  const totalTags = new Set(brain.flatMap(b => b.tags || [])).size;
  const pinnedCount = brain.filter(b => b.pinned).length;

  // Debounced hybrid search
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) { setSearchResults(null); return; }
    setSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        if (semanticMode) {
          // Semantic search via edge function (will work once embeddings are populated)
          const { data, error } = await supabase.functions.invoke('brain-semantic-search', {
            body: { query: q, user_id: userId, limit: 25 }
          });
          if (error) {
            console.warn('Semantic search not available, falling back to hybrid:', error.message);
            const { data: fallback } = await supabase.rpc('search_brain', { p_query: q, p_user_id: userId, p_limit: 25 });
            setSearchResults(fallback || []);
          } else {
            setSearchResults(data?.results || []);
          }
        } else {
          const { data, error } = await supabase.rpc('search_brain', { p_query: q, p_user_id: userId, p_limit: 25 });
          if (error) console.error(error);
          setSearchResults(data || []);
        }
      } catch (e) {
        console.error('Search error:', e);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [searchQuery, semanticMode, userId]);

  const tabEntries = brain.filter(b => b.type === activeTab);
  const sorted = [...tabEntries].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if ((b.strength || 50) !== (a.strength || 50)) return (b.strength || 50) - (a.strength || 50);
    const aD = a.event_date || a.created_at;
    const bD = b.event_date || b.created_at;
    return new Date(bD) - new Date(aD);
  });

  const inSearchMode = searchResults !== null;
  const displayEntries = inSearchMode ? searchResults : sorted;

  async function handleSave(data) {
    if (editEntry) {
      const { data: u, error } = await supabase.from('brain').update(data).eq('id', editEntry.id).select().single();
      if (error) { notify("Couldn't save entry. Try again.", 'error'); return; }
      if (u) setBrain(prev => prev.map(x => x.id === u.id ? u : x));
    } else {
      const { data: c, error } = await supabase.from('brain').insert({ ...data, user_id: userId }).select().single();
      if (error) { notify("Couldn't create entry. Try again.", 'error'); return; }
      if (c) setBrain(prev => [c, ...prev]);
    }
    setShowModal(false); setEditEntry(null);
    // Trigger background embedding generation (silent — fails gracefully if function not deployed)
    try {
      const id = editEntry?.id;
      if (id || true) {
        supabase.functions.invoke('brain-embed', { body: { id: id || null, all_missing: !id } }).catch(()=>{});
      }
    } catch (e) {}
  }

  async function deleteEntry(id) {
    if (!window.confirm('Delete this entry?')) return;
    // Snapshot for rollback
    const snapshot = brain.find(x => x.id === id);
    setBrain(prev => prev.filter(x => x.id !== id));
    const { error } = await supabase.from('brain').delete().eq('id', id);
    if (error) {
      if (snapshot) setBrain(prev => [snapshot, ...prev.filter(x => x.id !== id)]);
      notify("Couldn't delete entry. Reverted.", 'error');
    }
  }

  async function togglePin(entry, e) {
    e.stopPropagation();
    const { data: u, error } = await supabase.from('brain').update({ pinned: !entry.pinned }).eq('id', entry.id).select().single();
    if (error) { notify("Couldn't update pin state.", 'error'); return; }
    if (u) setBrain(prev => prev.map(x => x.id === u.id ? u : x));
  }

  const currentTab = TABS.find(t => t.id === activeTab);
  const typeLabel = (t) => TABS.find(x => x.id === t)?.icon + ' ' + TABS.find(x => x.id === t)?.label;

  return (
    <div>
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
        <div><h2>🧠 Brain</h2><p>Your operating memory · {brain.length} entries · {totalTags} unique tags</p></div>
        <button className="btn btn-primary" onClick={()=>{setEditEntry(null);setShowModal(true);}}>+ New Entry</button>
      </div>

      {/* STREAK + STATS BANNER — subtle gamification in brand gold */}
      <div style={{
        display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:'10px',
        marginBottom:'14px'
      }}>
        <div style={{padding:'12px 14px',background:'linear-gradient(135deg, var(--accent-glow) 0%, transparent 100%)',border:'1px solid var(--accent-dim)',borderRadius:'10px'}}>
          <div style={{fontSize:'10px',color:'var(--accent)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,marginBottom:'4px'}}>Capture streak</div>
          <div style={{display:'flex',alignItems:'baseline',gap:'6px'}}>
            <span style={{fontSize:'24px',fontWeight:700,color:'var(--text-1)',fontFamily:'monospace'}}>{streak.current}</span>
            <span style={{fontSize:'11px',color:'var(--text-3)'}}>day{streak.current!==1?'s':''}</span>
            {streak.today && <span title="Logged today" style={{marginLeft:'auto',color:'var(--accent)',fontSize:'14px'}}>●</span>}
          </div>
          <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>best: {streak.longest} days</div>
        </div>
        <div style={{padding:'12px 14px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px'}}>
          <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,marginBottom:'4px'}}>Pinned</div>
          <div style={{fontSize:'24px',fontWeight:700,color:'var(--text-1)',fontFamily:'monospace'}}>{pinnedCount}</div>
          <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>core references</div>
        </div>
        <div style={{padding:'12px 14px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px'}}>
          <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,marginBottom:'4px'}}>Memory entries</div>
          <div style={{fontSize:'24px',fontWeight:700,color:'var(--text-1)',fontFamily:'monospace'}}>{brain.filter(b=>b.type==='memory').length}</div>
          <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>facts about people, tools, decisions</div>
        </div>
        <div style={{padding:'12px 14px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:'10px'}}>
          <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',fontWeight:600,marginBottom:'4px'}}>Playbooks</div>
          <div style={{fontSize:'24px',fontWeight:700,color:'var(--text-1)',fontFamily:'monospace'}}>{brain.filter(b=>b.type==='playbook').length}</div>
          <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'2px'}}>repeatable plays</div>
        </div>
      </div>

      {/* SEARCH BAR — works across all types */}
      <div style={{marginBottom:'14px',position:'relative'}}>
        <div style={{position:'relative'}}>
          <span style={{position:'absolute',left:'14px',top:'50%',transform:'translateY(-50%)',color:'var(--text-3)',fontSize:'14px',pointerEvents:'none'}}>🔍</span>
          <input
            className="form-input"
            placeholder={semanticMode ? 'Ask anything (semantic) — "decisions about Alex"' : 'Search across all entries — title, content, tags'}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{paddingLeft:'40px',paddingRight:searchQuery?'80px':'14px',fontSize:'14px',height:'44px',background:'var(--bg-card)'}}
          />
          {searchQuery && (
            <button onClick={()=>setSearchQuery('')} className="btn btn-ghost btn-sm" style={{position:'absolute',right:'8px',top:'50%',transform:'translateY(-50%)',padding:'4px 10px'}}>clear</button>
          )}
        </div>
        <div style={{display:'flex',gap:'8px',marginTop:'8px',alignItems:'center',flexWrap:'wrap'}}>
          <label style={{display:'flex',alignItems:'center',gap:'6px',cursor:'pointer',fontSize:'11px',color:'var(--text-2)'}}>
            <input type="checkbox" checked={semanticMode} onChange={e=>setSemanticMode(e.target.checked)} style={{accentColor:'var(--accent)'}} />
            Semantic mode <span style={{color:'var(--text-3)'}}>(meaning-based, requires embeddings)</span>
          </label>
          {searchLoading && <span style={{fontSize:'11px',color:'var(--accent)'}}>searching…</span>}
          {inSearchMode && !searchLoading && (
            <span style={{fontSize:'11px',color:'var(--text-3)',marginLeft:'auto'}}>
              {displayEntries.length} {displayEntries.length===1?'match':'matches'}
            </span>
          )}
        </div>
      </div>

      <div className="panel">
        {!inSearchMode && (
          <div className="panel-header" style={{flexDirection:'column',alignItems:'stretch',gap:'10px'}}>
            <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
              {TABS.map(t => {
                const count = brain.filter(b => b.type === t.id).length;
                return (
                  <button key={t.id} className={`btn btn-sm ${activeTab===t.id?'btn-primary':'btn-ghost'}`} onClick={()=>setActiveTab(t.id)}>
                    {t.icon} {t.label}{count > 0 && <span style={{marginLeft:'6px',opacity:0.7}}>({count})</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="panel-body">
          {displayEntries.length === 0
            ? <div className="empty-state">
                <div className="empty-icon">{inSearchMode ? '🔍' : currentTab?.icon}</div>
                <p>{inSearchMode ? `No matches for "${searchQuery}".` : `Nothing in ${currentTab?.label} yet.`}</p>
              </div>
            : <div className="task-list">
                {displayEntries.map(entry => {
                  const strength = entry.strength ?? 50;
                  // Pass 3 Finding #2: reverse view — count tasks referencing this brain entry
                  const derivedTaskCount = tasks.filter(t => t.brain_entry_id === entry.id).length;
                  const derivedTaskCompleted = tasks.filter(t => t.brain_entry_id === entry.id && t.completed).length;
                  // Pass 4 Finding #6: events linked to this brain entry
                  const derivedEventCount = events.filter(e => e.brain_entry_id === entry.id).length;
                  return (
                    <div key={entry.id} className="task-item" style={{cursor:'pointer',flexDirection:'column',alignItems:'stretch',gap:'8px'}} onClick={()=>{setEditEntry(entry);setShowModal(true);}}>
                      <div style={{display:'flex',alignItems:'center',gap:'8px',width:'100%'}}>
                        {/* Strength dot — color & opacity scale with strength */}
                        <span title={`Strength: ${strength}`} style={{
                          width:'8px',height:'8px',borderRadius:'50%',
                          background:'var(--accent)',
                          opacity: 0.25 + (strength/100)*0.75,
                          flexShrink:0,
                          boxShadow: strength >= 80 ? '0 0 8px var(--accent-glow)' : 'none'
                        }}/>
                        <div style={{flex:1,fontWeight:600,color:'var(--text-1)',lineHeight:1.35}}>
                          {entry.pinned && <span title="Pinned" style={{marginRight:'6px',color:'var(--accent)'}}>📌</span>}
                          {inSearchMode && <span className="pill" style={{marginRight:'8px',fontSize:'10px',background:'var(--bg-base)',border:'1px solid var(--border)',color:'var(--text-3)'}}>{typeLabel(entry.type)}</span>}
                          {entry.title}
                        </div>
                        <div className="task-meta">
                          {derivedTaskCount > 0 && (
                            <span
                              title={`${derivedTaskCount} task${derivedTaskCount === 1 ? '' : 's'} linked${derivedTaskCompleted > 0 ? ` · ${derivedTaskCompleted} done` : ''}`}
                              style={{fontSize:'10px',color:'var(--text-3)',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'10px',padding:'2px 6px',whiteSpace:'nowrap'}}>
                              ✅ {derivedTaskCompleted > 0 ? `${derivedTaskCompleted}/${derivedTaskCount}` : derivedTaskCount}
                            </span>
                          )}
                          {derivedEventCount > 0 && (
                            <span
                              title={`${derivedEventCount} event${derivedEventCount === 1 ? '' : 's'} linked`}
                              style={{fontSize:'10px',color:'var(--text-3)',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'10px',padding:'2px 6px',whiteSpace:'nowrap'}}>
                              📅 {derivedEventCount}
                            </span>
                          )}
                          {entry.event_date && <span className="task-due">{entry.event_date}</span>}
                          <button className="task-delete" style={{color:entry.pinned?'var(--accent)':undefined}} onClick={(e)=>togglePin(entry,e)} title="Pin">{entry.pinned ? '★' : '☆'}</button>
                          <button className="task-delete" onClick={(e)=>{e.stopPropagation();deleteEntry(entry.id);}}>×</button>
                        </div>
                      </div>
                      {entry.content && <div style={{fontSize:'13px',color:'var(--text-2)',whiteSpace:'pre-wrap',lineHeight:1.5,paddingLeft:'18px'}}>{entry.content.length > 240 ? entry.content.slice(0,240) + '…' : entry.content}</div>}
                      {entry.tags && entry.tags.length > 0 && (
                        <div style={{display:'flex',gap:'4px',flexWrap:'wrap',paddingLeft:'18px'}}>
                          {entry.tags.map(tag => (
                            <span key={tag} className="pill" style={{fontSize:'10px',background:'var(--bg-base)',border:'1px solid var(--border)',color:'var(--text-2)',padding:'2px 8px'}}>{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
          }
        </div>
      </div>
      {showModal && <BrainEntryModal onClose={()=>{setShowModal(false);setEditEntry(null);}} onSave={handleSave} initial={editEntry} defaultType={activeTab} />}
    </div>
  );
}


// ─────────────────────────────────────────
// CALENDAR VIEW — month grid + Google Calendar sync
// ─────────────────────────────────────────
function pad2(n){ return String(n).padStart(2,'0'); }
function ymd(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function startOfMonthGrid(year, month) {
  // month: 0-indexed. Returns the Sunday on/before the 1st.
  const first = new Date(year, month, 1);
  const d = new Date(first);
  d.setDate(1 - first.getDay());
  return d;
}
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function EventModal({ onClose, onSave, onDelete, initial, defaultDate, brain, contacts, properties = [] }) {
  const init = initial || {};
  const startInit = init.start_at ? new Date(init.start_at) : (defaultDate ? new Date(defaultDate + 'T09:00:00') : new Date());
  const endInit = init.end_at ? new Date(init.end_at) : new Date(startInit.getTime() + 60*60*1000);
  const [title, setTitle] = useState(init.title || '');
  const [allDay, setAllDay] = useState(init.all_day || false);
  const [startDate, setStartDate] = useState(ymd(startInit));
  const [startTime, setStartTime] = useState(`${pad2(startInit.getHours())}:${pad2(startInit.getMinutes())}`);
  const [endDate, setEndDate] = useState(ymd(endInit));
  const [endTime, setEndTime] = useState(`${pad2(endInit.getHours())}:${pad2(endInit.getMinutes())}`);
  const [location, setLocation] = useState(init.location || '');
  const [description, setDescription] = useState(init.description || '');
  const [contactId, setContactId] = useState(init.contact_id || '');
  const [brainEntryId, setBrainEntryId] = useState(init.brain_entry_id || '');
  const [propertyId, setPropertyId] = useState(init.property_id || '');

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const start_at = allDay ? `${startDate}T00:00:00` : `${startDate}T${startTime}:00`;
    const end_at = allDay ? `${endDate}T00:00:00` : `${endDate}T${endTime}:00`;
    onSave({
      title: title.trim(),
      all_day: allDay,
      start_at: new Date(start_at).toISOString(),
      end_at: new Date(end_at).toISOString(),
      location: location.trim() || null,
      description: description.trim() || null,
      contact_id: contactId || null,
      brain_entry_id: brainEntryId || null,
      property_id: propertyId || null,
    });
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>{initial ? 'Edit Event' : 'New Event'}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label className="form-label">Title</label><input className="form-input" value={title} onChange={e=>setTitle(e.target.value)} placeholder="What's happening?" autoFocus required /></div>
          <div className="form-group">
            <label className="form-label" style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}}>
              <input type="checkbox" checked={allDay} onChange={e=>setAllDay(e.target.checked)} /> All-day
            </label>
          </div>
          <div className="form-row">
            <div className="form-group" style={{flex:1}}><label className="form-label">Start date</label><input className="form-input" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} required /></div>
            {!allDay && <div className="form-group" style={{flex:1}}><label className="form-label">Start time</label><input className="form-input" type="time" value={startTime} onChange={e=>setStartTime(e.target.value)} /></div>}
          </div>
          <div className="form-row">
            <div className="form-group" style={{flex:1}}><label className="form-label">End date</label><input className="form-input" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} /></div>
            {!allDay && <div className="form-group" style={{flex:1}}><label className="form-label">End time</label><input className="form-input" type="time" value={endTime} onChange={e=>setEndTime(e.target.value)} /></div>}
          </div>
          <div className="form-group"><label className="form-label">Location</label><input className="form-input" value={location} onChange={e=>setLocation(e.target.value)} placeholder="Optional" /></div>
          {contacts && contacts.length > 0 && (
            <div className="form-group">
              <label className="form-label">Linked contact</label>
              <select className="form-select" value={contactId} onChange={e=>setContactId(e.target.value)}>
                <option value="">— None —</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name || c.full_name || c.email || 'Contact'}</option>)}
              </select>
            </div>
          )}
          {brain && brain.length > 0 && (
            <div className="form-group">
              <label className="form-label">Brain context</label>
              <select className="form-select" value={brainEntryId} onChange={e=>setBrainEntryId(e.target.value)}>
                <option value="">— None —</option>
                {['playbook','decision','memory'].map(type => {
                  const entries = brain.filter(b => b.type === type);
                  if (!entries.length) return null;
                  return <optgroup key={type} label={type.toUpperCase()}>
                    {entries.map(b => <option key={b.id} value={b.id}>{b.title.slice(0,60)}</option>)}
                  </optgroup>;
                })}
              </select>
            </div>
          )}
          {properties && properties.length > 0 && (
            <div className="form-group">
              <label className="form-label">Property</label>
              <select className="form-select" value={propertyId} onChange={e=>setPropertyId(e.target.value)}>
                <option value="">— None —</option>
                {properties.map(p => (
                  <option key={p.id} value={p.id}>{p.nickname || p.address || '(unnamed)'}</option>
                ))}
              </select>
            </div>
          )}
          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={description} onChange={e=>setDescription(e.target.value)} placeholder="Optional details…" /></div>
          <div className="modal-actions" style={{justifyContent:'space-between'}}>
            <div>
              {initial && <button type="button" className="btn btn-ghost" style={{color:'var(--red)'}} onClick={()=>onDelete(initial)}>Delete</button>}
            </div>
            <div style={{display:'flex',gap:'8px'}}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save Event</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function CalendarView({ events, setEvents, userId, brain, contacts, emailAccounts, properties = [] }) {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [showModal, setShowModal] = useState(false);
  const [editEvent, setEditEvent] = useState(null);
  const [modalDate, setModalDate] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [flash, setFlash] = useState(null);

  const googleAccounts = (emailAccounts || []).filter(a => a.provider === 'google' && a.is_active);
  // The calendar account: one tagged with 'calendar' purpose, or any with calendar scope
  const calendarAccount = googleAccounts.find(a => (a.purposes || []).includes('calendar'))
    || googleAccounts.find(a => (a.scopes || []).some(s => s.includes('calendar')));
  const hasCalendarScope = !!calendarAccount;

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const gridStart = startOfMonthGrid(year, month);
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }

  function eventsForDay(d) {
    const key = ymd(d);
    return events.filter(ev => {
      const s = new Date(ev.start_at);
      return ymd(s) === key;
    }).sort((a,b) => new Date(a.start_at) - new Date(b.start_at));
  }

  async function handleSave(data) {
    const payload = { ...data, user_id: userId, sync_status: hasCalendarScope ? 'pending_push' : 'local' };
    if (editEvent) {
      const { data: u, error } = await supabase.from('events').update({ ...data, sync_status: editEvent.google_event_id ? 'pending_push' : (hasCalendarScope ? 'pending_push' : 'local') }).eq('id', editEvent.id).select().single();
      if (error) { notify("Couldn't save event. Try again.", 'error'); return; }
      if (u) setEvents(prev => prev.map(e => e.id === u.id ? u : e));
    } else {
      const { data: c, error } = await supabase.from('events').insert(payload).select().single();
      if (error) { notify("Couldn't create event. Try again.", 'error'); return; }
      if (c) setEvents(prev => [...prev, c]);
    }
    setShowModal(false); setEditEvent(null);
    // Auto-push to Google if connected
    if (hasCalendarScope) syncCalendar('push', true);
  }

  async function handleDelete(ev) {
    if (!window.confirm('Delete this event?')) return;
    // If synced to Google, delete there too (fire-and-forget; we'll surface DB errors below)
    if (ev.google_event_id && hasCalendarScope) {
      try {
        await supabase.functions.invoke('calendar-delete', { body: { event_id: ev.id } }).catch(()=>{});
      } catch(_) {}
    }
    // Snapshot for rollback
    const snapshot = ev;
    setEvents(prev => prev.filter(e => e.id !== ev.id));
    const { error } = await supabase.from('events').delete().eq('id', ev.id);
    if (error) {
      setEvents(prev => [snapshot, ...prev.filter(e => e.id !== ev.id)]);
      notify("Couldn't delete event. Reverted.", 'error');
      return;
    }
    setShowModal(false); setEditEvent(null);
  }

  async function syncCalendar(direction = 'both', silent = false) {
    if (!hasCalendarScope) {
      setFlash({ type:'error', text:'Connect Google Calendar first (Settings or the button above).' });
      setTimeout(()=>setFlash(null), 4000);
      return;
    }
    if (!silent) setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('calendar-sync', {
        body: { user_id: userId, direction }
      });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      // Reload events
      const { data: fresh } = await supabase.from('events').select('*').order('start_at', { ascending: true });
      if (fresh) setEvents(fresh);
      if (!silent) {
        setFlash({ type:'ok', text:`Synced · ${data.pulled} in, ${data.pushed} out${data.deleted?`, ${data.deleted} removed`:''}` });
        setTimeout(()=>setFlash(null), 4000);
      }
    } catch (e) {
      if (!silent) {
        setFlash({ type:'error', text:`Sync failed: ${e.message}` });
        setTimeout(()=>setFlash(null), 5000);
      }
    } finally {
      if (!silent) setSyncing(false);
    }
  }

  async function connectGoogle() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setFlash({type:'error',text:'Not signed in.'}); return; }
      const { data, error } = await supabase.functions.invoke('google-oauth-start', {
        body: { return_to: window.location.origin + window.location.pathname, purpose: 'calendar' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error + (data.details ? ` — ${data.details}` : ''));
      if (!data?.url) throw new Error('No URL returned.');
      window.location.href = data.url;
    } catch (e) {
      setFlash({ type:'error', text: e.message });
      setTimeout(()=>setFlash(null), 5000);
    }
  }

  const monthEvents = events.filter(ev => {
    const s = new Date(ev.start_at);
    return s.getFullYear() === year && s.getMonth() === month;
  });

  return (
    <div>
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
        <div><h2>📅 Calendar</h2><p>{monthEvents.length} events in {MONTH_NAMES[month]} · {events.length} total</p></div>
        <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
          {hasCalendarScope ? (
            <button className="btn btn-ghost" onClick={()=>syncCalendar('both')} disabled={syncing}>
              {syncing ? '↻ Syncing…' : `↻ Sync ${calendarAccount.email_address}`}
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={connectGoogle} style={{borderColor:'var(--accent-dim)',color:'var(--accent)'}}>
              🔗 Connect Calendar Account
            </button>
          )}
          <button className="btn btn-primary" onClick={()=>{setEditEvent(null);setModalDate(ymd(today));setShowModal(true);}}>+ New Event</button>
        </div>
      </div>

      {flash && (
        <div style={{padding:'10px 14px',marginBottom:'14px',borderRadius:'8px',
          background: flash.type==='ok'?'rgba(34,197,94,0.12)':'rgba(239,68,68,0.12)',
          border:`1px solid ${flash.type==='ok'?'#22c55e':'#ef4444'}`,
          color: flash.type==='ok'?'#22c55e':'#ef4444', fontSize:'13px'}}>{flash.text}</div>
      )}

      {!hasCalendarScope && (
        <div style={{padding:'12px 14px',marginBottom:'14px',borderRadius:'8px',background:'var(--accent-glow)',border:'1px solid var(--accent-dim)',color:'var(--text-2)',fontSize:'12px',lineHeight:1.6}}>
          <strong style={{color:'var(--accent)'}}>Connect your calendar account.</strong> Click <strong>Connect Calendar Account</strong> above and sign in with the Google account you want to use for your calendar. This can be the same account you use for email, or a separate one. Once connected, your Google Calendar syncs both ways automatically.
          {googleAccounts.length > 0 && (
            <div style={{marginTop:'6px',color:'var(--text-3)'}}>
              Currently connected Google {googleAccounts.length === 1 ? 'account' : 'accounts'}: {googleAccounts.map(a => `${a.email_address} (${(a.purposes||['email']).join('+')})`).join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Month navigation */}
      <div className="panel">
        <div className="panel-header" style={{justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <button className="btn btn-ghost btn-sm" onClick={()=>setCursor(new Date(year, month-1, 1))}>‹</button>
            <h3 style={{minWidth:'160px',textAlign:'center',fontSize:'15px'}}>{MONTH_NAMES[month]} {year}</h3>
            <button className="btn btn-ghost btn-sm" onClick={()=>setCursor(new Date(year, month+1, 1))}>›</button>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={()=>setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</button>
        </div>
        <div className="panel-body" style={{padding:'10px'}}>
          {/* DOW header */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:'4px',marginBottom:'4px'}}>
            {DOW.map(d => <div key={d} style={{textAlign:'center',fontSize:'10px',fontWeight:600,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.05em',padding:'4px'}}>{d}</div>)}
          </div>
          {/* Grid */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:'4px'}}>
            {cells.map((d, i) => {
              const inMonth = d.getMonth() === month;
              const isToday = ymd(d) === ymd(today);
              const dayEvents = eventsForDay(d);
              return (
                <div key={i}
                  onClick={()=>{setEditEvent(null);setModalDate(ymd(d));setShowModal(true);}}
                  style={{
                    minHeight:'84px', padding:'4px 6px', borderRadius:'8px', cursor:'pointer',
                    background: isToday ? 'var(--accent-glow)' : (inMonth ? 'var(--bg-base)' : 'transparent'),
                    border: isToday ? '1px solid var(--accent)' : '1px solid var(--border)',
                    opacity: inMonth ? 1 : 0.4,
                    display:'flex', flexDirection:'column', gap:'2px', overflow:'hidden'
                  }}>
                  <div style={{fontSize:'11px',fontWeight:isToday?700:500,color:isToday?'var(--accent)':'var(--text-2)',textAlign:'right'}}>{d.getDate()}</div>
                  {dayEvents.slice(0,3).map(ev => (
                    <div key={ev.id}
                      onClick={(e)=>{e.stopPropagation();setEditEvent(ev);setModalDate(null);setShowModal(true);}}
                      title={ev.title}
                      style={{
                        fontSize:'10px', padding:'1px 4px', borderRadius:'3px',
                        background: ev.google_event_id ? 'var(--accent-dim)' : 'var(--bg-hover)',
                        color:'var(--text-1)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                        borderLeft: `2px solid ${ev.google_event_id ? 'var(--accent)' : 'var(--text-3)'}`
                      }}>
                      {!ev.all_day && <span style={{color:'var(--text-3)',marginRight:'3px'}}>{pad2(new Date(ev.start_at).getHours())}:{pad2(new Date(ev.start_at).getMinutes())}</span>}
                      {ev.title}
                    </div>
                  ))}
                  {dayEvents.length > 3 && <div style={{fontSize:'9px',color:'var(--text-3)',paddingLeft:'4px'}}>+{dayEvents.length-3} more</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Upcoming list */}
      <div className="panel">
        <div className="panel-header"><h3>Upcoming</h3></div>
        <div className="panel-body">
          {(() => {
            const upcoming = events
              .filter(ev => new Date(ev.end_at || ev.start_at) >= new Date(today.getFullYear(),today.getMonth(),today.getDate()))
              .sort((a,b)=>new Date(a.start_at)-new Date(b.start_at))
              .slice(0,10);
            if (upcoming.length === 0) return <div className="empty-state"><div className="empty-icon">📅</div><p>No upcoming events. Click a day to add one.</p></div>;
            return <div className="task-list">
              {upcoming.map(ev => {
                const s = new Date(ev.start_at);
                return (
                  <div key={ev.id} className="task-item" style={{cursor:'pointer'}} onClick={()=>{setEditEvent(ev);setModalDate(null);setShowModal(true);}}>
                    <div style={{minWidth:'52px',textAlign:'center'}}>
                      <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase'}}>{MONTH_NAMES[s.getMonth()].slice(0,3)}</div>
                      <div style={{fontSize:'18px',fontWeight:700,color:'var(--text-1)',lineHeight:1}}>{s.getDate()}</div>
                    </div>
                    <span className="task-text">
                      {ev.title}
                      {ev.google_event_id && <span title="Synced with Google" style={{marginLeft:'6px',fontSize:'10px',color:'var(--accent)'}}>●</span>}
                      {ev.location && <span style={{display:'block',fontSize:'11px',color:'var(--text-3)'}}>📍 {ev.location}</span>}
                    </span>
                    <div className="task-meta">
                      <span className="task-due">{ev.all_day ? 'All day' : `${pad2(s.getHours())}:${pad2(s.getMinutes())}`}</span>
                    </div>
                  </div>
                );
              })}
            </div>;
          })()}
        </div>
      </div>

      {showModal && <EventModal
        onClose={()=>{setShowModal(false);setEditEvent(null);}}
        onSave={handleSave}
        onDelete={handleDelete}
        initial={editEvent}
        defaultDate={modalDate}
        brain={brain}
        contacts={contacts}
        properties={properties}
      />}
    </div>
  );
}


// ─────────────────────────────────────────
// PLAYBOOKS VIEW — Triggerable, step-aware playbooks
// ─────────────────────────────────────────
function PlaybooksView({ brain, playbookSteps, setPlaybookSteps, playbookRuns, setPlaybookRuns, tasks, setTasks, userId, setView, setTaskFilter, events = [] }) {
  const playbooks = brain.filter(b => b.type === 'playbook');
  const [parsingId, setParsingId] = useState(null);
  const [runningId, setRunningId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedRunId, setExpandedRunId] = useState(null);  // Pass 4 #7
  const [showRunModal, setShowRunModal] = useState(null); // playbook obj
  const [runNote, setRunNote] = useState('');
  const [flash, setFlash] = useState(null);

  function stepsFor(pbId) {
    return playbookSteps.filter(s => s.brain_entry_id === pbId).sort((a,b) => a.step_order - b.step_order);
  }
  function runsFor(pbId) {
    return playbookRuns.filter(r => r.brain_entry_id === pbId);
  }
  const totalRuns = playbookRuns.length;
  const last7dRuns = playbookRuns.filter(r => (new Date(r.created_at) > new Date(Date.now() - 7*864e5))).length;

  async function reparse(playbook) {
    setParsingId(playbook.id);
    try {
      const { data, error } = await supabase.functions.invoke('playbook-parse', {
        body: { brain_entry_id: playbook.id, user_id: userId }
      });
      if (error || data?.error) {
        setFlash({ type: 'error', text: `Parse failed: ${error?.message || data?.error}` });
      } else {
        // Refresh steps from DB
        const { data: refreshed } = await supabase.from('playbook_steps').select('*').order('step_order', { ascending: true });
        if (refreshed) setPlaybookSteps(refreshed);
        setFlash({ type: 'ok', text: `Re-parsed ${data.parsed} steps for ${playbook.title.replace(/^PLAYBOOK\s*[—-]\s*/i,'')}` });
      }
    } catch (e) {
      setFlash({ type: 'error', text: e.message });
    } finally {
      setParsingId(null);
      setTimeout(() => setFlash(null), 4000);
    }
  }

  async function runPlaybook(playbook, note) {
    setRunningId(playbook.id);
    try {
      const { data, error } = await supabase.rpc('run_playbook', {
        p_brain_entry_id: playbook.id,
        p_user_id: userId,
        p_trigger_note: note || null,
        p_context: {}
      });
      if (error) throw error;
      const tasksCreated = data?.tasks_created || 0;
      // Reload tasks and runs from DB to get fresh data with the new rows
      const [tRes, rRes] = await Promise.all([
        supabase.from('tasks').select('*').order('created_at', { ascending: false }),
        supabase.from('playbook_runs').select('*').order('created_at', { ascending: false }).limit(50),
      ]);
      if (tRes.data) setTasks(tRes.data);
      if (rRes.data) setPlaybookRuns(rRes.data);
      setShowRunModal(null);
      setRunNote('');
      setFlash({ type: 'ok', text: `▶ ${playbook.title.replace(/^PLAYBOOK\s*[—-]\s*/i,'')} launched — ${tasksCreated} tasks created` });
    } catch (e) {
      setFlash({ type: 'error', text: `Run failed: ${e.message}` });
    } finally {
      setRunningId(null);
      setTimeout(() => setFlash(null), 5000);
    }
  }

  function quadColor(q) {
    return { A: '#ef4444', B: 'var(--accent)', C: '#f59e0b', D: '#6b7280' }[q] || 'var(--text-3)';
  }

  return (
    <div>
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
        <div><h2>📚 Playbooks</h2><p>Your repeatable plays · {playbooks.length} playbooks · {totalRuns} total runs · {last7dRuns} this week</p></div>
      </div>

      {flash && (
        <div style={{
          padding:'10px 14px',
          marginBottom:'14px',
          borderRadius:'8px',
          background: flash.type === 'ok' ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
          border: `1px solid ${flash.type === 'ok' ? '#22c55e' : '#ef4444'}`,
          color: flash.type === 'ok' ? '#22c55e' : '#ef4444',
          fontSize: '13px'
        }}>{flash.text}</div>
      )}

      {playbooks.length === 0 ? (
        <div className="panel"><div className="panel-body"><div className="empty-state">
          <div className="empty-icon">📚</div>
          <p>No playbooks yet. Create one in the Brain (type = Playbook).</p>
        </div></div></div>
      ) : (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(420px, 1fr))', gap:'14px'}}>
          {playbooks.map(pb => {
            const steps = stepsFor(pb.id);
            const runs = runsFor(pb.id);
            const cleanTitle = pb.title.replace(/^PLAYBOOK\s*[—-]\s*/i, '');
            const isExpanded = expandedId === pb.id;
            return (
              <div key={pb.id} className="panel" style={{display:'flex',flexDirection:'column'}}>
                <div className="panel-body" style={{display:'flex',flexDirection:'column',gap:'12px'}}>
                  <div>
                    <div style={{display:'flex',alignItems:'flex-start',gap:'8px',justifyContent:'space-between'}}>
                      <h3 style={{margin:0, color:'var(--text-1)', fontSize:'16px', fontWeight:700, lineHeight:1.3}}>{cleanTitle}</h3>
                      {pb.pinned && <span title="Pinned" style={{color:'var(--accent)',fontSize:'12px'}}>📌</span>}
                    </div>
                    <div style={{display:'flex',gap:'10px',marginTop:'6px',fontSize:'11px',color:'var(--text-3)'}}>
                      <span>{steps.length} {steps.length===1?'step':'steps'}</span>
                      <span>·</span>
                      <span>{runs.length} run{runs.length===1?'':'s'}</span>
                      {runs[0] && <><span>·</span><span>last: {new Date(runs[0].created_at).toLocaleDateString()}</span></>}
                    </div>
                  </div>

                  <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
                    <button
                      className="btn btn-primary"
                      onClick={() => setShowRunModal(pb)}
                      disabled={steps.length === 0 || runningId === pb.id}
                      style={{flex:1, minWidth:'120px'}}
                    >
                      {runningId === pb.id ? 'Launching…' : '▶ Run Playbook'}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setExpandedId(isExpanded ? null : pb.id)}
                    >
                      {isExpanded ? 'Hide steps' : 'View steps'}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => reparse(pb)}
                      disabled={parsingId === pb.id}
                      title="Re-parse with Claude — use if you've edited the playbook content in Brain"
                    >
                      {parsingId === pb.id ? 'Parsing…' : '↻ Re-parse'}
                    </button>
                  </div>

                  {steps.length === 0 && (
                    <div style={{fontSize:'12px',color:'var(--text-3)',padding:'10px',background:'var(--bg-base)',borderRadius:'6px',border:'1px dashed var(--border)'}}>
                      No structured steps yet. Click <strong>↻ Re-parse</strong> to extract steps from the playbook prose.
                    </div>
                  )}

                  {isExpanded && steps.length > 0 && (
                    <div style={{display:'flex',flexDirection:'column',gap:'8px',marginTop:'2px'}}>
                      {steps.map(s => (
                        <div key={s.id} style={{padding:'10px 12px',background:'var(--bg-base)',borderRadius:'6px',border:'1px solid var(--border)'}}>
                          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                            <span title={`Quadrant ${s.default_quadrant}`} style={{
                              fontSize:'10px',fontWeight:700,
                              color: quadColor(s.default_quadrant),
                              border:`1px solid ${quadColor(s.default_quadrant)}`,
                              borderRadius:'4px',padding:'1px 5px',
                              minWidth:'18px',textAlign:'center'
                            }}>{s.default_quadrant}</span>
                            <span style={{fontWeight:600,color:'var(--text-1)',fontSize:'13px',flex:1}}>{s.step_order}. {s.title}</span>
                            {s.due_offset_days !== null && s.due_offset_days !== undefined && (
                              <span style={{fontSize:'10px',color:'var(--text-3)',fontFamily:'monospace'}}>+{s.due_offset_days}d</span>
                            )}
                          </div>
                          {s.detail && <div style={{fontSize:'11px',color:'var(--text-2)',marginTop:'4px',paddingLeft:'30px',lineHeight:1.4}}>{s.detail}</div>}
                          {(s.owner || s.timing) && (
                            <div style={{fontSize:'10px',color:'var(--text-3)',marginTop:'4px',paddingLeft:'30px',display:'flex',gap:'12px'}}>
                              {s.owner && <span>👤 {s.owner}</span>}
                              {s.timing && <span>⏱ {s.timing}</span>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {runs.length > 0 && (
                    <div style={{borderTop:'1px solid var(--border)',paddingTop:'10px',marginTop:'2px'}}>
                      <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'6px'}}>Recent runs</div>
                      {runs.slice(0, 3).map(r => {
                        const isOpen = expandedRunId === r.id;
                        // Pass 4 #7: spawned tasks + events for this run
                        const spawnedTasks = tasks.filter(t => t.playbook_run_id === r.id);
                        const spawnedEvents = events.filter(e => e.playbook_run_id === r.id);
                        const totalSpawned = spawnedTasks.length + spawnedEvents.length;
                        return (
                          <div key={r.id} style={{padding:'2px 0'}}>
                            <div
                              onClick={() => setExpandedRunId(isOpen ? null : r.id)}
                              style={{display:'flex',gap:'8px',fontSize:'11px',color:'var(--text-2)',cursor: totalSpawned > 0 ? 'pointer' : 'default',alignItems:'center'}}>
                              <span style={{color:'var(--text-3)'}}>{new Date(r.created_at).toLocaleDateString()}</span>
                              <span>{r.tasks_created} tasks</span>
                              {r.trigger_note && <span style={{color:'var(--text-3)',fontStyle:'italic'}}>· {r.trigger_note.slice(0,40)}{r.trigger_note.length>40?'…':''}</span>}
                              {totalSpawned > 0 && (
                                <span style={{color:'var(--accent)',fontSize:'10px',marginLeft:'auto'}}>{isOpen ? '▾' : '▸'}</span>
                              )}
                            </div>
                            {isOpen && totalSpawned > 0 && (
                              <div style={{padding:'6px 10px 6px 16px',background:'var(--bg-base)',borderRadius:'4px',marginTop:'4px',border:'1px solid var(--border)'}}>
                                {spawnedTasks.length > 0 && (
                                  <>
                                    <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'3px'}}>Tasks ({spawnedTasks.length})</div>
                                    {spawnedTasks.map(t => (
                                      <div key={t.id} style={{fontSize:'11px',color: t.completed ? 'var(--text-3)' : 'var(--text-1)',textDecoration: t.completed ? 'line-through' : 'none',padding:'2px 0'}}>
                                        {t.completed ? '✓' : '○'} {t.title}
                                      </div>
                                    ))}
                                  </>
                                )}
                                {spawnedEvents.length > 0 && (
                                  <>
                                    <div style={{fontSize:'10px',color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.05em',marginTop: spawnedTasks.length > 0 ? '6px' : '0',marginBottom:'3px'}}>Events ({spawnedEvents.length})</div>
                                    {spawnedEvents.map(ev => (
                                      <div key={ev.id} style={{fontSize:'11px',color:'var(--text-1)',padding:'2px 0'}}>
                                        📅 {ev.title} {ev.start_at && <span style={{color:'var(--text-3)',fontSize:'10px'}}>· {new Date(ev.start_at).toLocaleDateString()}</span>}
                                      </div>
                                    ))}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Run Playbook modal */}
      {showRunModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowRunModal(null)}>
          <div className="modal">
            <div className="modal-header">
              <h3>▶ Run Playbook</h3>
              <button className="modal-close" onClick={() => setShowRunModal(null)}>×</button>
            </div>
            <div style={{padding:'0 0 14px'}}>
              <div style={{padding:'12px 14px',background:'var(--bg-base)',border:'1px solid var(--accent-dim)',borderRadius:'8px',marginBottom:'14px'}}>
                <div style={{fontSize:'10px',color:'var(--accent)',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:'6px',fontWeight:700}}>Playbook</div>
                <div style={{fontSize:'14px',color:'var(--text-1)',fontWeight:600}}>{showRunModal.title.replace(/^PLAYBOOK\s*[—-]\s*/i,'')}</div>
                <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'6px'}}>
                  Will create {stepsFor(showRunModal.id).length} tasks scheduled across the next {Math.max(0, ...stepsFor(showRunModal.id).map(s=>s.due_offset_days||0))} days.
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Context note <span style={{color:'var(--text-3)',fontWeight:400,fontSize:'11px'}}>(who/what this run is for — optional)</span></label>
                <input className="form-input" value={runNote} onChange={e=>setRunNote(e.target.value)} placeholder='e.g. "123 Oak St listing", "Buyer: Smith", "Recruit: Anvar"' autoFocus />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowRunModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => runPlaybook(showRunModal, runNote)} disabled={runningId !== null}>
                {runningId ? 'Launching…' : '▶ Launch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function NotesView({ notes, setNotes, userId }) {
  const [selected, setSelected] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const saveTimer = useRef(null);
  const bodyRef = useRef(null);

  // Open a note
  function openNote(note) {
    setSelected(note);
    setEditTitle(note.title);
    setEditBody(note.body || '');
    setTimeout(() => bodyRef.current?.focus(), 80);
  }

  // New blank note
  async function createNote() {
    const { data } = await supabase.from('notes')
      .insert({ user_id: userId, title: 'Untitled', body: '', pinned: false })
      .select().single();
    if (data) {
      setNotes(prev => [data, ...prev]);
      openNote(data);
    }
  }

  // Auto-save with debounce
  function scheduleAutoSave(newTitle, newBody) {
    if (!selected) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      const { data: updated } = await supabase.from('notes')
        .update({ title: newTitle || 'Untitled', body: newBody })
        .eq('id', selected.id).select().single();
      if (updated) {
        setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
        setSelected(updated);
      }
      setSaving(false);
    }, 600);
  }

  function handleTitleChange(e) {
    setEditTitle(e.target.value);
    scheduleAutoSave(e.target.value, editBody);
  }
  function handleBodyChange(e) {
    setEditBody(e.target.value);
    scheduleAutoSave(editTitle, e.target.value);
  }

  async function togglePin(note, e) {
    e.stopPropagation();
    const { data: updated, error } = await supabase.from('notes')
      .update({ pinned: !note.pinned }).eq('id', note.id).select().single();
    if (error) { notify("Couldn't update pin state.", 'error'); return; }
    if (updated) setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
  }

  async function deleteNote(note, e) {
    e.stopPropagation();
    if (!window.confirm(`Delete "${note.title}"?`)) return;
    const snapshot = note;
    setNotes(prev => prev.filter(n => n.id !== note.id));
    if (selected?.id === note.id) { setSelected(null); setEditTitle(''); setEditBody(''); }
    const { error } = await supabase.from('notes').delete().eq('id', note.id);
    if (error) {
      setNotes(prev => [snapshot, ...prev.filter(n => n.id !== note.id)]);
      notify("Couldn't delete note. Reverted.", 'error');
    }
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Math.floor((Date.now() - new Date(ts)) / 60000);
    if (diff < 1) return 'just now';
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    if (diff < 10080) return `${Math.floor(diff / 1440)}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  const filtered = notes.filter(n =>
    n.title.toLowerCase().includes(search.toLowerCase()) ||
    (n.body || '').toLowerCase().includes(search.toLowerCase())
  );
  const pinned = filtered.filter(n => n.pinned);
  const unpinned = filtered.filter(n => !n.pinned);
  const sorted = [...pinned, ...unpinned];

  return (
    <div style={{ display: 'flex', gap: '18px', height: 'calc(100dvh - 64px)' }}>

      {/* ── LEFT: note list ── */}
      <div style={{ width: '260px', minWidth: '260px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: '22px', fontWeight: 700 }}>Notes</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '2px' }}>{notes.length} note{notes.length !== 1 ? 's' : ''}</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={createNote}>+ New</button>
        </div>

        {/* Search */}
        <input
          className="form-input"
          placeholder="Search notes…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ fontSize: '13px' }}
        />

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {sorted.length === 0 && (
            <div className="empty-state"><div className="empty-icon">📝</div><p>No notes yet.<br/>Hit + New to start.</p></div>
          )}
          {sorted.map(note => (
            <div
              key={note.id}
              onClick={() => openNote(note)}
              style={{
                background: selected?.id === note.id ? 'var(--accent-glow)' : 'var(--bg-card)',
                border: `1px solid ${selected?.id === note.id ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: '10px', padding: '12px 14px', cursor: 'pointer',
                transition: 'all 0.12s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {note.pinned && <span style={{ color: 'var(--accent)', marginRight: '4px' }}>📌</span>}
                    {note.title || 'Untitled'}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--text-3)', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {note.body?.slice(0, 50) || 'Empty note'}
                  </div>
                  <div style={{ fontSize: '10.5px', color: 'var(--text-3)', marginTop: '4px' }}>{timeAgo(note.updated_at)}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0 }}>
                  <button
                    onClick={e => togglePin(note, e)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', opacity: note.pinned ? 1 : 0.3, padding: '1px' }}
                    title={note.pinned ? 'Unpin' : 'Pin'}
                  >📌</button>
                  <button
                    onClick={e => deleteNote(note, e)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--text-3)', padding: '1px' }}
                    title="Delete"
                  >🗑</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── RIGHT: editor ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', minWidth: 0 }}>
        {!selected ? (
          <div className="empty-state" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div className="empty-icon">📝</div>
            <p>Select a note or create a new one</p>
            <button className="btn btn-primary" style={{ marginTop: '14px' }} onClick={createNote}>+ New Note</button>
          </div>
        ) : (
          <>
            {/* Editor header */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
              <input
                className="form-input"
                value={editTitle}
                onChange={handleTitleChange}
                placeholder="Note title…"
                style={{ fontSize: '16px', fontWeight: 700, background: 'transparent', border: '1px solid transparent', padding: '6px 8px', flex: 1 }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'transparent'}
              />
              <span style={{ fontSize: '11px', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                {saving ? '💾 Saving…' : '✓ Saved'}
              </span>
            </div>

            {/* Body */}
            <textarea
              ref={bodyRef}
              value={editBody}
              onChange={handleBodyChange}
              placeholder="Start writing…&#10;&#10;Use this space for project notes, build ideas, meeting notes — anything you want to save."
              style={{
                flex: 1, resize: 'none', background: 'transparent', border: 'none',
                outline: 'none', padding: '20px', fontSize: '14px', lineHeight: '1.75',
                color: 'var(--text-1)', fontFamily: 'inherit',
                overflowY: 'auto', WebkitOverflowScrolling: 'touch',
              }}
            />

            {/* Footer */}
            <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>
                {editBody.split(/\s+/).filter(Boolean).length} words · {editBody.length} chars
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-3)' }}>
                Last updated {timeAgo(selected?.updated_at)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// PRISM VIEW — DISC profiles + voice cards (Phase Zero foundation)
// ─────────────────────────────────────────
const DISC_LETTERS = ['D', 'I', 'S', 'C'];
const DISC_NAMES = { D: 'Dominant', I: 'Influencing', S: 'Steady', C: 'Conscientious' };
const CONFIDENCE_LEVELS = ['high', 'medium', 'low', 'unknown'];
const PROFILE_SOURCES = ['manual', 'first_light', 'full_spectrum', 'prism_read', 'behavioral_signal'];

function PrismView({ profiles, setProfiles, voiceCards, setVoiceCards, contacts, userId }) {
  const [activeTab, setActiveTab] = useState('owner');

  const ownerProfile = profiles.find(p => p.subject_kind === 'owner') || null;
  const contactProfiles = profiles.filter(p => p.subject_kind === 'contact');
  const activeVoiceCard = voiceCards.find(v => v.is_active) || voiceCards[0] || null;

  return (
    <div>
      <div className="page-header">
        <h2>✦ Prism</h2>
        <p>Behavioral foundation — DISC profiles and the platform voice that everything else builds on.</p>
      </div>

      <div className="panel">
        <div className="panel-header" style={{flexDirection:'column',alignItems:'stretch',gap:'10px'}}>
          <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
            <button className={`btn btn-sm ${activeTab==='owner'?'btn-primary':'btn-ghost'}`} onClick={()=>setActiveTab('owner')}>
              👤 Owner Profile
            </button>
            <button className={`btn btn-sm ${activeTab==='voice'?'btn-primary':'btn-ghost'}`} onClick={()=>setActiveTab('voice')}>
              🎙️ Voice Card
            </button>
            <button className={`btn btn-sm ${activeTab==='contacts'?'btn-primary':'btn-ghost'}`} onClick={()=>setActiveTab('contacts')}>
              👥 Contact Profiles <span style={{marginLeft:'6px',opacity:0.7}}>({contactProfiles.length})</span>
            </button>
            <button className={`btn btn-sm ${activeTab==='validate'?'btn-primary':'btn-ghost'}`} onClick={()=>setActiveTab('validate')}>
              ✓ Validate
            </button>
          </div>
        </div>
        <div className="panel-body">
          {activeTab === 'owner' && (
            <OwnerProfilePanel
              profile={ownerProfile}
              setProfiles={setProfiles}
              userId={userId}
            />
          )}
          {activeTab === 'voice' && (
            <VoiceCardPanel
              card={activeVoiceCard}
              setVoiceCards={setVoiceCards}
              userId={userId}
            />
          )}
          {activeTab === 'contacts' && (
            <ContactProfilesPanel
              profiles={contactProfiles}
              contacts={contacts}
              setProfiles={setProfiles}
              userId={userId}
            />
          )}
          {activeTab === 'validate' && (
            <ValidatePanel
              ownerProfile={ownerProfile}
              voiceCard={activeVoiceCard}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function DiscScoreInput({ label, value, onChange }) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:'4px',flex:1,minWidth:'80px'}}>
      <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>{label}</label>
      <input
        type="number"
        min="0"
        max="100"
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)))}
        style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px'}}
      />
    </div>
  );
}

function deriveLetters(d, i, s, c) {
  const arr = [['D', d], ['I', i], ['S', s], ['C', c]].filter(([, v]) => typeof v === 'number');
  if (arr.length === 0) return { primary: null, secondary: null };
  arr.sort((a, b) => b[1] - a[1]);
  return { primary: arr[0][0], secondary: arr[1]?.[0] ?? null };
}

function OwnerProfilePanel({ profile, setProfiles, userId }) {
  const [d, setD] = useState(profile?.d_score ?? null);
  const [i, setI] = useState(profile?.i_score ?? null);
  const [s, setS] = useState(profile?.s_score ?? null);
  const [c, setC] = useState(profile?.c_score ?? null);
  const [confidence, setConfidence] = useState(profile?.confidence || 'medium');
  const [source, setSource] = useState(profile?.source || 'manual');
  const [rationale, setRationale] = useState(profile?.rationale || '');
  const [primaryOverride, setPrimaryOverride] = useState(profile?.primary_letter || '');
  const [secondaryOverride, setSecondaryOverride] = useState(profile?.secondary_letter || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // Recompute when profile from props changes (after save)
  useEffect(() => {
    if (!profile) return;
    setD(profile.d_score ?? null);
    setI(profile.i_score ?? null);
    setS(profile.s_score ?? null);
    setC(profile.c_score ?? null);
    setConfidence(profile.confidence || 'medium');
    setSource(profile.source || 'manual');
    setRationale(profile.rationale || '');
    setPrimaryOverride(profile.primary_letter || '');
    setSecondaryOverride(profile.secondary_letter || '');
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const derived = deriveLetters(d, i, s, c);
  const primary = primaryOverride || derived.primary;
  const secondary = secondaryOverride || derived.secondary;

  async function handleSave() {
    setSaving(true);
    setMsg('');
    const payload = {
      d_score: d,
      i_score: i,
      s_score: s,
      c_score: c,
      primary_letter: primary,
      secondary_letter: secondary && secondary !== primary ? secondary : null,
      confidence,
      source,
      rationale: rationale || null,
      updated_at: new Date().toISOString(),
    };
    try {
      if (profile) {
        const { data, error } = await supabase
          .from('profiles')
          .update(payload)
          .eq('id', profile.id)
          .select()
          .single();
        if (error) throw error;
        setProfiles(prev => prev.map(p => p.id === data.id ? data : p));
      } else {
        const { data, error } = await supabase
          .from('profiles')
          .insert({ ...payload, user_id: userId, subject_kind: 'owner' })
          .select()
          .single();
        if (error) throw error;
        setProfiles(prev => [...prev, data]);
      }
      setMsg('Saved.');
      setTimeout(() => setMsg(''), 2500);
    } catch (err) {
      setMsg('Error: ' + (err.message || err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'18px',maxWidth:'720px'}}>
      <div>
        <h3 style={{margin:'0 0 4px',fontSize:'16px',color:'var(--text-1)'}}>Your DISC profile</h3>
        <p style={{margin:0,fontSize:'13px',color:'var(--text-2)'}}>
          This profile drives how every assistant speaks to you, and how every draft is shaped.
        </p>
      </div>

      <div style={{display:'flex',gap:'12px',flexWrap:'wrap'}}>
        <DiscScoreInput label="D — Dominant" value={d} onChange={setD} />
        <DiscScoreInput label="I — Influencing" value={i} onChange={setI} />
        <DiscScoreInput label="S — Steady" value={s} onChange={setS} />
        <DiscScoreInput label="C — Conscientious" value={c} onChange={setC} />
      </div>

      <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:'200px',display:'flex',flexDirection:'column',gap:'4px'}}>
          <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>Primary (auto from scores)</label>
          <select
            value={primaryOverride || (derived.primary ?? '')}
            onChange={e => setPrimaryOverride(e.target.value)}
            style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px'}}
          >
            <option value="">(none)</option>
            {DISC_LETTERS.map(l => <option key={l} value={l}>{l} — {DISC_NAMES[l]}</option>)}
          </select>
        </div>
        <div style={{flex:1,minWidth:'200px',display:'flex',flexDirection:'column',gap:'4px'}}>
          <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>Secondary</label>
          <select
            value={secondaryOverride || (derived.secondary ?? '')}
            onChange={e => setSecondaryOverride(e.target.value)}
            style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px'}}
          >
            <option value="">(none)</option>
            {DISC_LETTERS.filter(l => l !== (primaryOverride || derived.primary)).map(l => <option key={l} value={l}>{l} — {DISC_NAMES[l]}</option>)}
          </select>
        </div>
      </div>

      <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:'200px',display:'flex',flexDirection:'column',gap:'4px'}}>
          <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>Confidence</label>
          <select
            value={confidence}
            onChange={e => setConfidence(e.target.value)}
            style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px'}}
          >
            {CONFIDENCE_LEVELS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{flex:1,minWidth:'200px',display:'flex',flexDirection:'column',gap:'4px'}}>
          <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>Source</label>
          <select
            value={source}
            onChange={e => setSource(e.target.value)}
            style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px'}}
          >
            {PROFILE_SOURCES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </div>
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
        <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>Notes / rationale</label>
        <textarea
          value={rationale}
          onChange={e => setRationale(e.target.value)}
          rows={5}
          placeholder="What's true about your behavioral style that the assistant should know — adaptive vs natural, work mode vs personal mode, communication preferences…"
          style={{padding:'10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px',fontFamily:'inherit',resize:'vertical'}}
        />
      </div>

      <div style={{display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
        {msg && <span style={{fontSize:'13px',color: msg.startsWith('Error') ? 'var(--red)' : 'var(--green)'}}>{msg}</span>}
      </div>

      {primary && (
        <div style={{padding:'12px 14px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
          <div style={{fontSize:'12px',color:'var(--text-2)',marginBottom:'4px',fontWeight:600}}>Current profile snapshot</div>
          <div style={{fontSize:'14px',color:'var(--text-1)'}}>
            <strong>{primary}{secondary && secondary !== primary ? `/${secondary}` : ''}</strong>
            {' · '}
            D:{d ?? '—'} I:{i ?? '—'} S:{s ?? '—'} C:{c ?? '—'}
            {' · '}
            <span style={{color:'var(--text-2)'}}>confidence: {confidence}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function VoiceCardPanel({ card, setVoiceCards, userId }) {
  const [name, setName] = useState(card?.name || 'The Concierge');
  const [kind, setKind] = useState(card?.kind || 'platform');
  const [body, setBody] = useState(card?.body || '');
  const [isActive, setIsActive] = useState(card?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!card) return;
    setName(card.name || 'The Concierge');
    setKind(card.kind || 'platform');
    setBody(card.body || '');
    setIsActive(card.is_active ?? true);
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    setSaving(true);
    setMsg('');
    const payload = {
      name,
      kind,
      body,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    };
    try {
      if (card) {
        const { data, error } = await supabase
          .from('voice_cards')
          .update(payload)
          .eq('id', card.id)
          .select()
          .single();
        if (error) throw error;
        setVoiceCards(prev => prev.map(v => v.id === data.id ? data : v));
      } else {
        const { data, error } = await supabase
          .from('voice_cards')
          .insert({ ...payload, user_id: userId })
          .select()
          .single();
        if (error) throw error;
        setVoiceCards(prev => [...prev, data]);
      }
      setMsg('Saved.');
      setTimeout(() => setMsg(''), 2500);
    } catch (err) {
      setMsg('Error: ' + (err.message || err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'18px',maxWidth:'900px'}}>
      <div>
        <h3 style={{margin:'0 0 4px',fontSize:'16px',color:'var(--text-1)'}}>The active voice card</h3>
        <p style={{margin:0,fontSize:'13px',color:'var(--text-2)'}}>
          This text is injected into every assistant prompt and drafting call. Edits take effect on the next message.
        </p>
      </div>

      <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
        <div style={{flex:2,minWidth:'200px',display:'flex',flexDirection:'column',gap:'4px'}}>
          <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px'}}
          />
        </div>
        <div style={{flex:1,minWidth:'150px',display:'flex',flexDirection:'column',gap:'4px'}}>
          <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>Kind</label>
          <select
            value={kind}
            onChange={e => setKind(e.target.value)}
            style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px'}}
          >
            <option value="platform">platform</option>
            <option value="agent">agent</option>
          </select>
        </div>
        <div style={{minWidth:'120px',display:'flex',flexDirection:'column',gap:'4px',justifyContent:'flex-end'}}>
          <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600,display:'flex',alignItems:'center',gap:'6px'}}>
            <input
              type="checkbox"
              checked={isActive}
              onChange={e => setIsActive(e.target.checked)}
              style={{margin:0}}
            />
            Active
          </label>
        </div>
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
        <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>
          Voice card body ({body.length.toLocaleString()} chars)
        </label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={22}
          style={{padding:'12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'13px',fontFamily:'ui-monospace, Menlo, Monaco, Consolas, monospace',lineHeight:1.55,resize:'vertical',whiteSpace:'pre-wrap'}}
        />
      </div>

      <div style={{display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save voice card'}
        </button>
        {msg && <span style={{fontSize:'13px',color: msg.startsWith('Error') ? 'var(--red)' : 'var(--green)'}}>{msg}</span>}
      </div>
    </div>
  );
}

function ContactProfilesPanel({ profiles, contacts, setProfiles, userId }) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
      <p style={{margin:0,fontSize:'13px',color:'var(--text-2)'}}>
        Behavioral profiles inferred from public data or communications history. Confidence is always shown — these are best guesses, not facts.
      </p>
      {profiles.length === 0
        ? <div className="empty-state"><div className="empty-icon">👥</div><p>No contact profiles yet. They'll appear here as Prism Read runs against your contacts.</p></div>
        : <div className="task-list">
            {profiles.map(p => {
              const contact = p.contact_id ? contacts.find(c => c.id === p.contact_id) : null;
              const name = contact?.name || contact?.full_name || `Profile ${p.id.slice(0, 8)}`;
              return (
                <div key={p.id} className="task-item" style={{flexDirection:'column',alignItems:'stretch',gap:'6px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'10px',width:'100%'}}>
                    <div style={{flex:1,fontWeight:600,color:'var(--text-1)'}}>{name}</div>
                    <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
                      <span className="pill pill-purple">{p.primary_letter}{p.secondary_letter ? `/${p.secondary_letter}` : ''}</span>
                      <span style={{fontSize:'12px',color:'var(--text-2)'}}>conf: {p.confidence}</span>
                    </div>
                  </div>
                  <div style={{fontSize:'12px',color:'var(--text-2)'}}>
                    D:{p.d_score ?? '—'} · I:{p.i_score ?? '—'} · S:{p.s_score ?? '—'} · C:{p.c_score ?? '—'}
                    {p.source && <> · <span style={{color:'var(--text-3)'}}>{p.source.replace('_', ' ')}</span></>}
                  </div>
                  {p.rationale && <div style={{fontSize:'13px',color:'var(--text-2)',whiteSpace:'pre-wrap',lineHeight:1.5}}>{p.rationale}</div>}
                </div>
              );
            })}
          </div>
      }
    </div>
  );
}

const SAMPLE_SCENARIOS = [
  {
    id: 'pushback',
    label: 'Someone pushing back on a key decision',
    prompt: "A client/colleague just messaged: 'I'm not sure about your recommendation — I want to go in a different direction.' Draft a reply that gives them a real answer, holds your ground where you should, and offers one clear next step.",
  },
  {
    id: 'coach_setback',
    label: 'Coaching someone through a real setback',
    prompt: "A teammate just lost something they worked hard on — a pitch, a project, a client. They sent: 'Lost it. I'm done.' Coach them. They need honesty, not a pep talk.",
  },
  {
    id: 'high_c_detail',
    label: 'Detail-oriented person dissecting your proposal',
    prompt: "A high-C (detail-oriented, data-driven) reviewer wants to challenge every line of your proposal — there are 14 minor items. Draft a message that respects their thoroughness and steers them to the 2-3 items that actually matter.",
  },
];

function ValidatePanel({ ownerProfile, voiceCard }) {
  const [selectedScenario, setSelectedScenario] = useState(SAMPLE_SCENARIOS[0].id);
  const [customPrompt, setCustomPrompt] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [output, setOutput] = useState('');
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');

  async function generate() {
    setGenerating(true);
    setOutput('');
    setMeta(null);
    setError('');
    const scenario = SAMPLE_SCENARIOS.find(s => s.id === selectedScenario);
    const prompt = useCustom && customPrompt.trim() ? customPrompt.trim() : scenario.prompt;

    try {
      // Get the active robot to call robot-chat
      const { data: robots } = await supabase
        .from('robots')
        .select('id')
        .eq('active', true)
        .limit(1);
      if (!robots || robots.length === 0) {
        setError('No active robot found. Add one in the database first.');
        setGenerating(false);
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error: invokeError } = await supabase.functions.invoke('robot-chat', {
        body: {
          robot_id: robots[0].id,
          user_id: user?.id,
          message: prompt,
          history: [],
        },
      });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(data.error);
      setOutput(data?.response || '(empty response)');
      setMeta(data?.meta || null);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'18px',maxWidth:'820px'}}>
      <div>
        <h3 style={{margin:'0 0 4px',fontSize:'16px',color:'var(--text-1)'}}>Validate the voice</h3>
        <p style={{margin:0,fontSize:'13px',color:'var(--text-2)'}}>
          Generate a sample response and confirm it reads as The Concierge — warm, savvy, coach-like, professional. If it sounds generic or AI-flat, the voice card needs tightening.
        </p>
      </div>

      <div style={{padding:'12px 14px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
        <div style={{fontSize:'12px',color:'var(--text-2)',marginBottom:'4px',fontWeight:600}}>Current foundation</div>
        <div style={{fontSize:'13px',color:'var(--text-1)'}}>
          Voice card: <strong>{voiceCard?.name || '(none loaded)'}</strong>
          {voiceCard && <span style={{color:'var(--text-2)'}}> · {voiceCard.is_active ? 'active' : 'inactive'} · {voiceCard.body?.length || 0} chars</span>}
        </div>
        <div style={{fontSize:'13px',color:'var(--text-1)',marginTop:'4px'}}>
          Owner profile: <strong>{ownerProfile ? `${ownerProfile.primary_letter}${ownerProfile.secondary_letter ? '/' + ownerProfile.secondary_letter : ''}` : '(none loaded)'}</strong>
          {ownerProfile && <span style={{color:'var(--text-2)'}}> · confidence: {ownerProfile.confidence}</span>}
        </div>
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
        <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600,display:'flex',alignItems:'center',gap:'8px'}}>
          <input type="checkbox" checked={!useCustom} onChange={e => setUseCustom(!e.target.checked)} />
          Use a preset scenario
        </label>
        {!useCustom ? (
          <select
            value={selectedScenario}
            onChange={e => setSelectedScenario(e.target.value)}
            style={{padding:'10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px'}}
          >
            {SAMPLE_SCENARIOS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        ) : (
          <textarea
            value={customPrompt}
            onChange={e => setCustomPrompt(e.target.value)}
            rows={4}
            placeholder="Describe the situation you want the assistant to respond to…"
            style={{padding:'10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px',fontFamily:'inherit',resize:'vertical'}}
          />
        )}
      </div>

      <div>
        <button className="btn btn-primary" onClick={generate} disabled={generating}>
          {generating ? 'Generating…' : 'Generate sample'}
        </button>
      </div>

      {error && (
        <div style={{padding:'12px 14px',background:'rgba(239, 68, 68, 0.1)',border:'1px solid var(--red)',borderRadius:'8px',color:'var(--red)',fontSize:'13px'}}>
          {error}
        </div>
      )}

      {output && (
        <div style={{padding:'14px 16px',background:'var(--bg-base)',border:'1px solid var(--accent)',borderRadius:'8px'}}>
          <div style={{fontSize:'12px',color:'var(--text-2)',marginBottom:'8px',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.5px'}}>Sample output</div>
          <div style={{fontSize:'14px',color:'var(--text-1)',whiteSpace:'pre-wrap',lineHeight:1.6}}>{output}</div>
          {meta && (
            <div style={{marginTop:'12px',paddingTop:'10px',borderTop:'1px solid var(--border)',fontSize:'12px',color:'var(--text-3)'}}>
              Layers applied → voice: <strong style={{color:'var(--text-2)'}}>{meta.voice_card || 'none'}</strong>
              {' · '}
              owner: <strong style={{color:'var(--text-2)'}}>{meta.owner_primary || 'none'}</strong>
              {meta.owner_confidence && <> ({meta.owner_confidence})</>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmailAccountsPanel({ emailAccounts, setEmailAccounts }) {
  const [connecting, setConnecting] = useState(false);
  const [connectingPurpose, setConnectingPurpose] = useState(null);
  const [err, setErr] = useState('');

  async function startConnect(purpose = 'email') {
    setConnecting(true);
    setConnectingPurpose(purpose);
    setErr('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in.');
      const { data, error } = await supabase.functions.invoke('google-oauth-start', {
        body: { return_to: window.location.origin + window.location.pathname, purpose },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error + (data.details ? ` — ${data.details}` : ''));
      if (!data?.url) throw new Error('No URL returned.');
      window.location.href = data.url;
    } catch (e) {
      setErr(e.message || String(e));
      setConnecting(false);
      setConnectingPurpose(null);
    }
  }

  async function disconnect(id) {
    if (!window.confirm('Disconnect this Google account? Synced messages and events will remain in the database, but future sync will stop.')) return;
    await supabase.from('email_accounts').update({ is_active: false }).eq('id', id);
    setEmailAccounts(prev => prev.map(a => a.id === id ? { ...a, is_active: false } : a));
  }

  function purposeBadges(purposes) {
    const list = purposes || [];
    return list.map(p => (
      <span key={p} className="pill" style={{
        fontSize:'10px', padding:'2px 6px',
        background: p === 'calendar' ? 'rgba(197,169,94,0.15)' : 'rgba(34,197,94,0.12)',
        color: p === 'calendar' ? 'var(--accent)' : 'var(--green)',
        border: `1px solid ${p === 'calendar' ? 'var(--accent-dim)' : '#22c55e'}`,
      }}>{p === 'calendar' ? '📅 calendar' : '📧 email'}</span>
    ));
  }

  return (
    <div className="panel" style={{marginBottom:'18px'}}>
      <div className="panel-header"><h3>🔗 Connected Google Accounts</h3></div>
      <div className="panel-body">
        <p style={{fontSize:'13px',color:'var(--text-2)',margin:'0 0 14px',lineHeight:1.5}}>
          Connect Google for email (Gmail) and/or calendar. You can connect different accounts for different purposes — for example, a work account for email and a personal account for calendar.
        </p>
        {emailAccounts.length === 0
          ? <p style={{fontSize:'13px',color:'var(--text-3)',marginBottom:'14px'}}>No accounts connected yet.</p>
          : (
            <div style={{display:'flex',flexDirection:'column',gap:'8px',marginBottom:'14px'}}>
              {emailAccounts.map(a => (
                <div key={a.id} style={{padding:'10px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px',display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
                  <span style={{fontSize:'18px'}}>{(a.purposes||[]).includes('calendar') ? '📅' : '📧'}</span>
                  <div style={{flex:1,minWidth:'160px'}}>
                    <div style={{fontWeight:600,color:'var(--text-1)',fontSize:'14px',display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}}>
                      {a.email_address}
                      {purposeBadges(a.purposes)}
                    </div>
                    <div style={{fontSize:'12px',color:'var(--text-2)'}}>
                      {a.provider} · {a.is_active ? 'active' : 'inactive'}
                      {a.last_sync_at && <> · synced {new Date(a.last_sync_at).toLocaleString()}</>}
                    </div>
                    {a.last_sync_error && (
                      <div style={{fontSize:'12px',color:'var(--red)',marginTop:'2px'}}>Last error: {a.last_sync_error.slice(0, 200)}</div>
                    )}
                  </div>
                  {a.is_active && (
                    <button className="btn btn-ghost btn-sm" onClick={()=>disconnect(a.id)}>Disconnect</button>
                  )}
                </div>
              ))}
            </div>
          )
        }
        {err && (
          <div style={{padding:'10px 12px',background:'rgba(239, 68, 68, 0.1)',border:'1px solid var(--red)',borderRadius:'8px',color:'var(--red)',fontSize:'13px',marginBottom:'12px'}}>
            {err}
          </div>
        )}
        <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
          <button className="btn btn-primary" onClick={() => startConnect('email')} disabled={connecting}>
            {connecting && connectingPurpose === 'email' ? 'Opening Google…' : '+ Connect Gmail'}
          </button>
          <button className="btn btn-ghost" onClick={() => startConnect('calendar')} disabled={connecting} style={{borderColor:'var(--accent-dim)',color:'var(--accent)'}}>
            {connecting && connectingPurpose === 'calendar' ? 'Opening Google…' : '+ Connect Calendar'}
          </button>
        </div>
      </div>
    </div>
  );
}


// ─────────────────────────────────────────
// SETTINGS VIEW
function EmailAliasesPanel({ emailAliases, setEmailAliases, emailAccounts, userId }) {
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(null);   // alias id currently being updated
  const [editingName, setEditingName] = useState(null);  // {id, value}
  const [msg, setMsg] = useState(null);

  // The email-purpose Google account (only it has a sendAs list)
  const emailAccount =
    emailAccounts.find(a => a.is_active && (a.purposes || []).includes('email')) ||
    emailAccounts.find(a => a.is_active && (a.scopes || []).some(s => s.includes('gmail')));

  const aliases = (emailAliases || []).slice().sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return a.email_address.localeCompare(b.email_address);
  });

  function flash(text, type = 'ok') {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 4000);
  }

  async function syncAliases() {
    if (!emailAccount) { flash('Connect a Gmail account first.', 'error'); return; }
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('gmail-aliases-sync', {
        body: { user_id: userId, account_id: emailAccount.id }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const { data: fresh } = await supabase.from('email_aliases').select('*').order('email_address', { ascending: true });
      if (fresh) setEmailAliases(fresh);
      flash(`Synced ${data.synced} sender ${data.synced === 1 ? 'address' : 'addresses'} from Gmail.`);
    } catch (e) {
      flash('Sync failed: ' + (e.message || e), 'error');
    } finally {
      setSyncing(false);
    }
  }

  async function setDefault(alias) {
    if (alias.is_default) return;
    setBusy(alias.id);
    try {
      // The DB trigger clears is_default on other rows when we set this one.
      const { error } = await supabase.from('email_aliases').update({ is_default: true }).eq('id', alias.id);
      if (error) throw error;
      setEmailAliases(prev => prev.map(a => ({ ...a, is_default: a.id === alias.id })));
      flash(`Default sender set to ${alias.email_address}.`);
    } catch (e) {
      flash('Failed: ' + (e.message || e), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function saveName(alias, newName) {
    const cleaned = (newName || '').trim();
    if (cleaned === (alias.display_name || '')) {
      setEditingName(null);
      return;
    }
    setBusy(alias.id);
    try {
      const { error } = await supabase.from('email_aliases').update({ display_name: cleaned || null }).eq('id', alias.id);
      if (error) throw error;
      setEmailAliases(prev => prev.map(a => a.id === alias.id ? { ...a, display_name: cleaned || null } : a));
      flash(`Display name updated for ${alias.email_address}.`);
      setEditingName(null);
    } catch (e) {
      flash('Failed: ' + (e.message || e), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel" style={{marginBottom:'18px'}}>
      <div className="panel-header" style={{justifyContent:'space-between'}}>
        <h3>✉️ Sender Addresses</h3>
        <button className="btn btn-ghost btn-sm" onClick={syncAliases} disabled={syncing || !emailAccount}>
          {syncing ? '↻ Syncing…' : '↻ Sync from Gmail'}
        </button>
      </div>
      <div className="panel-body">
        <p style={{fontSize:'13px',color:'var(--text-2)',margin:'0 0 14px',lineHeight:1.5}}>
          These are the addresses you can send mail "From" inside Prism. They mirror the <strong>Send mail as</strong> list in your Gmail Settings. The address marked <strong style={{color:'var(--accent)'}}>default</strong> is pre-selected in Compose; replies override it to match whatever address the original was sent to.
        </p>

        {msg && (
          <div style={{padding:'10px 12px',marginBottom:'12px',borderRadius:'6px',fontSize:'12px',
            background: msg.type === 'ok' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
            border: `1px solid ${msg.type === 'ok' ? '#22c55e' : '#ef4444'}`,
            color: msg.type === 'ok' ? '#22c55e' : '#ef4444'}}>{msg.text}</div>
        )}

        {!emailAccount && (
          <div style={{padding:'12px',background:'var(--bg-base)',border:'1px dashed var(--border)',borderRadius:'8px',fontSize:'12px',color:'var(--text-3)'}}>
            Connect a Gmail account above first — sender addresses are pulled from that account's Gmail Settings.
          </div>
        )}

        {emailAccount && aliases.length === 0 && (
          <div style={{padding:'12px',background:'var(--bg-base)',border:'1px dashed var(--border)',borderRadius:'8px',fontSize:'12px',color:'var(--text-3)'}}>
            No sender addresses synced yet. Click <strong>Sync from Gmail</strong> above.
          </div>
        )}

        {aliases.length > 0 && (
          <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
            {aliases.map(a => {
              const isEditing = editingName?.id === a.id;
              return (
                <div key={a.id} style={{
                  padding:'12px',
                  background: a.is_default ? 'var(--accent-glow)' : 'var(--bg-base)',
                  border: `1px solid ${a.is_default ? 'var(--accent-dim)' : 'var(--border)'}`,
                  borderRadius:'8px',
                  display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap'
                }}>
                  <div style={{flex:1, minWidth:'200px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap',marginBottom:'4px'}}>
                      <span style={{fontWeight:600,color:'var(--text-1)',fontSize:'14px'}}>{a.email_address}</span>
                      {a.is_default && <span className="pill" style={{fontSize:'10px',padding:'2px 6px',background:'var(--accent)',color:'var(--bg-base)',fontWeight:700}}>DEFAULT</span>}
                      {a.is_primary && <span className="pill" style={{fontSize:'10px',padding:'2px 6px',background:'var(--bg-card)',color:'var(--text-2)',border:'1px solid var(--border)'}}>primary</span>}
                      {!a.verified && <span className="pill" style={{fontSize:'10px',padding:'2px 6px',background:'rgba(239,68,68,0.15)',color:'var(--red)',border:'1px solid var(--red)'}}>unverified</span>}
                    </div>
                    {isEditing ? (
                      <div style={{display:'flex',gap:'4px',alignItems:'center'}}>
                        <input
                          className="form-input"
                          autoFocus
                          value={editingName.value}
                          onChange={e => setEditingName({ ...editingName, value: e.target.value })}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); saveName(a, editingName.value); }
                            if (e.key === 'Escape') setEditingName(null);
                          }}
                          placeholder="Display name (e.g. Your Name)"
                          style={{padding:'4px 8px',fontSize:'12px',height:'auto'}}
                        />
                        <button className="btn btn-ghost btn-sm" onClick={() => saveName(a, editingName.value)} disabled={busy === a.id} style={{padding:'4px 8px',fontSize:'11px'}}>Save</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditingName(null)} style={{padding:'4px 8px',fontSize:'11px'}}>×</button>
                      </div>
                    ) : (
                      <div style={{fontSize:'12px',color:'var(--text-3)',display:'flex',alignItems:'center',gap:'6px'}}>
                        <span>{a.display_name || <em style={{opacity:0.6}}>no display name</em>}</span>
                        <button onClick={() => setEditingName({ id: a.id, value: a.display_name || '' })} style={{background:'none',border:'none',color:'var(--accent)',cursor:'pointer',fontSize:'11px',padding:0}}>edit</button>
                      </div>
                    )}
                  </div>
                  {!a.is_default && a.verified && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setDefault(a)} disabled={busy === a.id}
                      style={{borderColor:'var(--accent-dim)',color:'var(--accent)',fontSize:'11px'}}>
                      {busy === a.id ? '…' : 'Set as default'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p style={{fontSize:'11px',color:'var(--text-3)',marginTop:'14px',lineHeight:1.5}}>
          To add or remove an alias, change it in <a href="https://mail.google.com/mail/u/0/#settings/accounts" target="_blank" rel="noreferrer" style={{color:'var(--accent)'}}>Gmail Settings → Accounts → Send mail as</a>, then click Sync from Gmail above.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// SETTINGS VIEW
// ─────────────────────────────────────────
function SettingsView({ user, priorityPref, onPriorityPrefChange, emailAccounts, setEmailAccounts, emailAliases, setEmailAliases, userId, userSettings, setUserSettings }) {
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [displayName, setDisplayName] = useState(user?.user_metadata?.display_name || user?.user_metadata?.full_name?.split(/\s+/)[0] || '');
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState('');
  const [prefMsg, setPrefMsg] = useState('');
  const [savingPref, setSavingPref] = useState(false);

  // Pass 2 Batch C/D: "About you" editing + module visibility — all backed by user_settings.
  const [profession, setProfession] = useState(userSettings?.profession || '');
  const [assistantContext, setAssistantContext] = useState(userSettings?.assistant_context || '');
  const [timezone, setTimezone] = useState(userSettings?.timezone || '');
  const [savingAbout, setSavingAbout] = useState(false);
  const [aboutMsg, setAboutMsg] = useState('');

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
    }
  }, [userSettings]);

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

  return (
    <div>
      <div className="page-header"><h2>Settings</h2><p>Manage your account</p></div>
      <div style={{maxWidth:'480px'}}>
        <div className="panel" style={{marginBottom:'18px'}}>
          <div className="panel-header"><h3>Profile</h3></div>
          <div className="panel-body">
            {nameMsg&&<div className={nameMsg.startsWith('Error')?'auth-error':'auth-success'} style={{marginBottom:'12px'}}>{nameMsg}</div>}
            <form onSubmit={handleNameSave}>
              <div className="form-group"><label className="form-label">Display Name</label><input className="form-input" value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="What should we call you?" maxLength={60} /></div>
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
              <button className="btn btn-primary" disabled={savingAbout}>{savingAbout?'Saving…':'Save'}</button>
            </form>
          </div>
        </div>
        <div className="panel" style={{marginBottom:'18px'}}>
          <div className="panel-header"><h3>Module visibility</h3></div>
          <div className="panel-body">
            {moduleMsg && <div className={moduleMsg.startsWith('Error')?'auth-error':'auth-success'} style={{marginBottom:'12px'}}>{moduleMsg}</div>}
            <p style={{fontSize:'13px',color:'var(--text-2)',margin:'0 0 14px',lineHeight:1.5}}>
              Hide modules from your sidebar if you don't use them. Your data stays — you can re-enable any time.
            </p>
            <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
                <div>
                  <div style={{fontWeight:600,color:'var(--text-1)',fontSize:'14px'}}>🏠 Properties</div>
                  <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'2px'}}>Real estate tracking module</div>
                </div>
                <label style={{position:'relative',display:'inline-block',width:'46px',height:'24px',cursor:'pointer'}}>
                  <input
                    type="checkbox"
                    checked={propsVisible}
                    onChange={e => toggleModule('properties', e.target.checked)}
                    style={{opacity:0,width:0,height:0}}
                  />
                  <span style={{
                    position:'absolute',top:0,left:0,right:0,bottom:0,
                    background: propsVisible ? 'var(--accent)' : 'var(--border)',
                    borderRadius:'24px',transition:'background 0.15s',
                  }} />
                  <span style={{
                    position:'absolute',top:'3px',left: propsVisible ? '24px' : '3px',
                    width:'18px',height:'18px',background:'#fff',borderRadius:'50%',
                    transition:'left 0.15s',
                  }} />
                </label>
              </div>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
                <div>
                  <div style={{fontWeight:600,color:'var(--text-1)',fontSize:'14px'}}>💰 Investments</div>
                  <div style={{fontSize:'11px',color:'var(--text-3)',marginTop:'2px'}}>Investment portfolio module</div>
                </div>
                <label style={{position:'relative',display:'inline-block',width:'46px',height:'24px',cursor:'pointer'}}>
                  <input
                    type="checkbox"
                    checked={invVisible}
                    onChange={e => toggleModule('investments', e.target.checked)}
                    style={{opacity:0,width:0,height:0}}
                  />
                  <span style={{
                    position:'absolute',top:0,left:0,right:0,bottom:0,
                    background: invVisible ? 'var(--accent)' : 'var(--border)',
                    borderRadius:'24px',transition:'background 0.15s',
                  }} />
                  <span style={{
                    position:'absolute',top:'3px',left: invVisible ? '24px' : '3px',
                    width:'18px',height:'18px',background:'#fff',borderRadius:'50%',
                    transition:'left 0.15s',
                  }} />
                </label>
              </div>
            </div>
          </div>
        </div>
        <EmailAccountsPanel emailAccounts={emailAccounts || []} setEmailAccounts={setEmailAccounts} />
        <EmailAliasesPanel emailAliases={emailAliases || []} setEmailAliases={setEmailAliases} emailAccounts={emailAccounts || []} userId={userId} />
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
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('dashboard');
  const [tasks, setTasks] = useState([]);
  const [robots, setRobots] = useState([]);
  const [notes, setNotes] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [properties, setProperties] = useState([]);
  const [investments, setInvestments] = useState([]);
  const [brain, setBrain] = useState([]);
  const [events, setEvents] = useState([]);
  const [emailAliases, setEmailAliases] = useState([]);
  const [playbookSteps, setPlaybookSteps] = useState([]);
  const [playbookRuns, setPlaybookRuns] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [voiceCards, setVoiceCards] = useState([]);
  const [emailAccounts, setEmailAccounts] = useState([]);
  // Pass 2 Batch C — user_settings: drives the onboarding modal + future Settings.
  const [userSettings, setUserSettings] = useState(null);
  // Dashboard "Unread Email" tile — count of unread inbox threads (excludes snoozed)
  const [unreadEmailCount, setUnreadEmailCount] = useState(0);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
    if (tv === 'sequence' || tv === 'matrix') setTaskViewMode(tv);
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
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  const loadData = useCallback(async () => {
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
      ['tasks',          supabase.from('tasks').select('*').order('created_at', { ascending: false }).limit(500)],
      ['robots',         supabase.from('robots').select('*').eq('active', true).order('created_at', { ascending: true })],
      ['notes',          supabase.from('notes').select('*').order('updated_at', { ascending: false }).limit(500)],
      ['contacts',       supabase.from('contacts').select('*').order('created_at', { ascending: false }).limit(1000)],
      ['properties',     supabase.from('properties').select('*').order('created_at', { ascending: false })],
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
    ];

    const results = await Promise.allSettled(queries.map(([_, q]) => q));
    const byKey = Object.fromEntries(queries.map(([k], i) => [k, results[i]]));

    // Apply each result — failures noted in console; user sees a single toast if any
    const failed = [];
    function take(key, setter) {
      const r = byKey[key];
      if (r && r.status === 'fulfilled' && r.value && !r.value.error) {
        setter(r.value);
      } else {
        failed.push(key);
      }
    }
    take('tasks',         res => setTasks(res.data || []));
    take('robots',        res => setRobots(res.data || []));
    take('notes',         res => setNotes(res.data || []));
    take('contacts',      res => setContacts(res.data || []));
    take('properties',    res => setProperties(res.data || []));
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

    if (failed.length > 0) {
      console.warn('loadData: queries failed:', failed);
      notify(`Couldn't load: ${failed.join(', ')}. Some screens may be stale.`, 'error');
    }
    setDataLoaded(true);
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
    setDataLoaded(false);
  }

  const navigate = (id) => { setView(id); setSidebarOpen(false); };

  if (loading) return <div className="loading-screen"><div className="spinner"/><p>Loading…</p></div>;
  if (!session) return <AuthScreen />;

  const user = session.user;
  const openTaskCount = tasks.filter(t=>!t.completed).length;

  const NAV_ALL = [
    { id: 'dashboard',   icon: '⚡', label: 'Dashboard' },
    { id: 'tasks',       icon: '✅', label: 'Tasks',       badge: openTaskCount || null },
    { id: 'calendar',    icon: '📅', label: 'Calendar',    badge: null },
    { id: 'inbox',       icon: '📬', label: 'Inbox',       badge: unreadEmailCount || null },
    { id: 'contacts',    icon: '👥', label: 'Contacts',    badge: contacts.length || null },
    { id: 'properties',  icon: '🏠', label: 'Properties',  badge: properties.length || null },
    { id: 'investments', icon: '💰', label: 'Investments', badge: investments.length || null },
    { id: 'brain',       icon: '🧠', label: 'Brain',       badge: brain.length || null },
    { id: 'playbooks',   icon: '📚', label: 'Playbooks',   badge: brain.filter(b=>b.type==='playbook').length || null },
    { id: 'notes',       icon: '📝', label: 'Notes',       badge: null },
    { id: 'chat',        icon: '✦',  label: robots[0]?.name || 'Assistant', badge: null },
    { id: 'prism',       icon: '✦',  label: 'Prism Profile', badge: null },
    { id: 'settings',    icon: '⚙️',  label: 'Settings' },
  ];

  // Pass 2 Batch D — Finding #9: filter nav by user_settings.module_visibility.
  // Default is visible (per Q5=yes): only hide when explicitly set to false.
  const mv = userSettings?.module_visibility || {};
  const NAV = NAV_ALL.filter(item => mv[item.id] !== false);

  return (
    <div className="app-shell" style={{flexDirection:'column'}}>
      {/* Mobile header */}
      <div className="mobile-header">
        <div className="mobile-header-logo"><span>Prism</span></div>
        <button className="hamburger" onClick={() => setSidebarOpen(o => !o)} aria-label="Menu">
          {sidebarOpen ? '✕' : '☰'}
        </button>
      </div>

      <div style={{display:'flex',flex:1,overflow:'hidden'}}>
        {/* Overlay */}
        {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

        {/* Sidebar */}
        <nav className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-logo">
            <h1><span>Prism</span></h1>
            <p>Personal OS</p>
          </div>
          <div className="sidebar-nav">
            <div className="nav-section-label">Workspace</div>
            {NAV.map(item => (
              <div key={item.id} className={`nav-item ${view===item.id?'active':''}`} onClick={()=>navigate(item.id)}>
                <span className="icon">{item.icon}</span>
                {item.label}
                {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
              </div>
            ))}
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
        <main className="main-content">
          {gmailConnectedFlash && (
            <div style={{padding:'10px 14px',marginBottom:'14px',background:'rgba(34, 197, 94, 0.1)',border:'1px solid var(--green)',borderRadius:'8px',color:'var(--green)',fontSize:'13px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span>✓ Connected <strong>{gmailConnectedFlash.email}</strong> for <strong>{gmailConnectedFlash.purposeLabel}</strong>. {gmailConnectedFlash.nextStep}</span>
              <button className="btn btn-ghost btn-sm" onClick={()=>setGmailConnectedFlash(null)}>×</button>
            </div>
          )}
          {!dataLoaded
            ? <div className="loading-screen" style={{height:'60vh'}}><div className="spinner"/></div>
            : view==='dashboard'   ? <DashboardView tasks={tasks} setTasks={setTasks} unreadEmailCount={unreadEmailCount} user={user} setView={setView} robots={robots} contacts={contacts} brain={brain} defaultSystem={priorityPref} properties={properties} events={events}/>
            : view==='tasks'       ? <TasksView tasks={tasks} setTasks={setTasks} userId={user.id} defaultSystem={priorityPref} taskFilter={taskFilter} setTaskFilter={onTaskFilterChange} taskViewMode={taskViewMode} setTaskViewMode={onTaskViewModeChange} brain={brain} contacts={contacts} properties={properties} events={events}/>
            : view==='inbox'       ? <InboxView emailAccounts={emailAccounts} setEmailAccounts={setEmailAccounts} emailAliases={emailAliases} setEmailAliases={setEmailAliases} profiles={profiles} contacts={contacts} userId={user.id} setView={setView} reloadData={loadData}/>
            : view==='contacts'    ? <ContactsView contacts={contacts} setContacts={setContacts} userId={user.id} profiles={profiles} setProfiles={setProfiles}/>
            : view==='properties'  ? <PropertiesView properties={properties} setProperties={setProperties} userId={user.id} contacts={contacts}/>
            : view==='investments' ? <InvestmentsView investments={investments} setInvestments={setInvestments} properties={properties} userId={user.id}/>
            : view==='brain'       ? <BrainView brain={brain} setBrain={setBrain} userId={user.id} tasks={tasks} events={events}/>
            : view==='playbooks'   ? <PlaybooksView brain={brain} playbookSteps={playbookSteps} setPlaybookSteps={setPlaybookSteps} playbookRuns={playbookRuns} setPlaybookRuns={setPlaybookRuns} tasks={tasks} setTasks={setTasks} userId={user.id} setView={setView} setTaskFilter={onTaskFilterChange} events={events}/>
            : view==='calendar'    ? <CalendarView events={events} setEvents={setEvents} userId={user.id} brain={brain} contacts={contacts} emailAccounts={emailAccounts} properties={properties}/>
            : view==='notes'       ? <NotesView notes={notes} setNotes={setNotes} userId={user.id}/>
            : view==='chat'        ? <ChatView robots={robots} userId={user.id}/>
            : view==='prism'       ? <PrismView profiles={profiles} setProfiles={setProfiles} voiceCards={voiceCards} setVoiceCards={setVoiceCards} contacts={contacts} userId={user.id}/>
            : view==='settings'    ? <SettingsView user={user} priorityPref={priorityPref} onPriorityPrefChange={setPriorityPref} emailAccounts={emailAccounts} setEmailAccounts={setEmailAccounts} emailAliases={emailAliases} setEmailAliases={setEmailAliases} userId={user.id} userSettings={userSettings} setUserSettings={setUserSettings}/>
            : null
          }
        </main>
      </div>
      <ToastHost />
      {/* Pass 2 Batch C: Blocking onboarding modal for new users (and existing
          users on first run after this ships). Only mounts once user_settings
          has been fetched (avoids flashing the modal before we know). */}
      {dataLoaded && userSettings && userSettings.onboarding_complete === false && (
        <OnboardingModal
          userId={user.id}
          userEmail={user.email}
          onComplete={() => { loadData(); }}
        />
      )}
    </div>
  );
}
