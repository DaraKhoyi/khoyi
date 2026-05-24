import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from './dataService';
import { jsPDF } from 'jspdf';
import * as pdfjsLib from 'pdfjs-dist';
import './index.css';

// pdf.js worker. We serve the worker from /public/pdf.worker.min.mjs so it
// loads same-origin and doesn't depend on a third-party CDN. The file is
// copied from node_modules/pdfjs-dist/build/pdf.worker.min.mjs at commit time.
// If you bump pdfjs-dist, also re-copy public/pdf.worker.min.mjs.
pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL || ''}/pdf.worker.min.mjs`;

const PLATFORM_ADMIN_EMAIL = 'dara@brokerdara.com';

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
          <h1>My<span>Life</span></h1>
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
          <div className="auth-switch"><a onClick={()=>switchMode('reset')}>Forgot password?</a> · <a onClick={()=>switchMode('signup')}>Create account</a></div>
        </>}
        {mode === 'signup' && <>
          <h2>Create account</h2>
          <p>Get started with MyLife</p>
          {error && <div className="auth-error">{error}</div>}
          {success && <div className="auth-success">{success}</div>}
          <form onSubmit={handleSignup}>
            <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required /></div>
            <div className="form-group"><label className="form-label">Password</label><input className="form-input" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required /></div>
            <button className="btn btn-primary" style={{width:'100%'}} disabled={loading}>{loading ? 'Creating…' : 'Create Account'}</button>
          </form>
          <div className="auth-switch">Already have an account? <a onClick={()=>switchMode('login')}>Sign in</a></div>
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
          <div className="auth-switch"><a onClick={()=>switchMode('login')}>Back to sign in</a></div>
        </>}
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

  // Load conversation history
  useEffect(() => {
    if (!robot || !userId) { setLoadingHistory(false); return; }
    supabase
      .from('robot_conversations')
      .select('messages')
      .eq('user_id', userId)
      .eq('robot_id', robot.id)
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
  }, [robot?.id, userId]);

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
// Sort key for Eisenhower: A1 < A2 < B1 < ... Simple-system tasks sort after
// using high(0)/medium(1)/low(2). Tasks with no priority info sort last.
function taskSortKey(t) {
  if (t.priority_system === 'eisenhower' && t.eisenhower_quadrant) {
    const qIdx = { A:0, B:1, C:2, D:3 }[t.eisenhower_quadrant] ?? 4;
    return [0, qIdx, t.eisenhower_rank ?? 999];
  }
  const pIdx = { high:0, medium:1, low:2 }[t.priority] ?? 3;
  return [1, pIdx, 0];
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

// ─────────────────────────────────────────
// TASK MODAL
// ─────────────────────────────────────────
function TaskModal({ onClose, onSave, initial, defaultSystem }) {
  const initialSystem = initial?.priority_system || defaultSystem || 'eisenhower';
  const [title, setTitle] = useState(initial?.title || '');
  const [system, setSystem] = useState(initialSystem);
  const [priority, setPriority] = useState(initial?.priority || 'medium');
  const [quadrant, setQuadrant] = useState(initial?.eisenhower_quadrant || 'A');
  const [rank, setRank] = useState(initial?.eisenhower_rank ?? 1);
  const [due_date, setDueDate] = useState(initial?.due_date || '');
  const [notes, setNotes] = useState(initial?.notes || '');

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const base = { title: title.trim(), due_date: due_date || null, notes: notes.trim(), priority_system: system };
    if (system === 'eisenhower') {
      const r = Math.max(1, parseInt(rank, 10) || 1);
      onSave({ ...base, priority: 'medium', eisenhower_quadrant: quadrant, eisenhower_rank: r });
    } else {
      onSave({ ...base, priority, eisenhower_quadrant: null, eisenhower_rank: null });
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
                <label className="form-label">Quadrant</label>
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
              <label className="form-label">Priority</label>
              <select className="form-select" value={priority} onChange={e=>setPriority(e.target.value)}>
                <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
            </div>
          )}
          <div className="form-group"><label className="form-label">Due Date</label><input className="form-input" type="date" value={due_date} onChange={e=>setDueDate(e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Notes</label><textarea className="form-textarea" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional details…" /></div>
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
function TasksView({ tasks, setTasks, userId, defaultSystem }) {
  const [showModal, setShowModal] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [filter, setFilter] = useState('all');

  const filtered = sortTasks(tasks.filter(t => filter === 'all' ? true : filter === 'done' ? t.completed : !t.completed));
  const topCount = tasks.filter(t => !t.completed && isTopPriority(t)).length;
  const stats = { total: tasks.length, done: tasks.filter(t=>t.completed).length, top: topCount };

  async function handleSave(data) {
    if (editTask) {
      const { data: updated } = await supabase.from('tasks').update(data).eq('id', editTask.id).select().single();
      if (updated) setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
    } else {
      const { data: created } = await supabase.from('tasks').insert({ ...data, user_id: userId, completed: false }).select().single();
      if (created) setTasks(prev => [created, ...prev]);
    }
    setShowModal(false); setEditTask(null);
  }
  async function toggleTask(task) {
    const { data: u } = await supabase.from('tasks').update({ completed: !task.completed }).eq('id', task.id).select().single();
    if (u) setTasks(prev => prev.map(t => t.id === u.id ? u : t));
  }
  async function deleteTask(id) {
    await supabase.from('tasks').delete().eq('id', id);
    setTasks(prev => prev.filter(t => t.id !== id));
  }

  return (
    <div>
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}} >
        <div><h2>Tasks</h2><p>{stats.done} of {stats.total} complete{stats.top > 0 ? ` · ${stats.top} top priority` : ''}</p></div>
        <button className="btn btn-primary" onClick={()=>{setEditTask(null);setShowModal(true);}}>+ New Task</button>
      </div>
      <div className="cards-row">
        <div className="stat-card"><div className="stat-label">Total</div><div className="stat-value">{stats.total}</div></div>
        <div className="stat-card"><div className="stat-label">Done</div><div className="stat-value" style={{color:'var(--green)'}}>{stats.done}</div></div>
        <div className="stat-card"><div className="stat-label">Top Priority</div><div className="stat-value" style={{color:'var(--red)'}}>{stats.top}</div></div>
        <div className="stat-card"><div className="stat-label">Open</div><div className="stat-value">{stats.total-stats.done}</div></div>
      </div>
      <div className="panel">
        <div className="panel-header">
          <h3>Task List</h3>
          <div style={{display:'flex',gap:'6px'}}>
            {['all','active','done'].map(f=>(
              <button key={f} className={`btn btn-sm ${filter===f?'btn-primary':'btn-ghost'}`} onClick={()=>setFilter(f)}>{f.charAt(0).toUpperCase()+f.slice(1)}</button>
            ))}
          </div>
        </div>
        <div className="panel-body">
          {filtered.length === 0
            ? <div className="empty-state"><div className="empty-icon">✅</div><p>No tasks here.</p></div>
            : <div className="task-list">
                {filtered.map(task=>(
                  <div key={task.id} className={`task-item ${task.completed?'done':''}`}>
                    <div className={`task-check ${task.completed?'checked':''}`} onClick={()=>toggleTask(task)} />
                    <span className="task-text" style={{cursor:'pointer'}} onClick={()=>{setEditTask(task);setShowModal(true);}}>{task.title}</span>
                    <div className="task-meta">
                      <span className={`task-priority ${priorityClass(task)}`}>{priorityLabel(task)}</span>
                      {task.due_date && <span className="task-due">{task.due_date}</span>}
                      <button className="task-delete" onClick={()=>deleteTask(task.id)}>×</button>
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>
      </div>
      {showModal && <TaskModal onClose={()=>{setShowModal(false);setEditTask(null);}} onSave={handleSave} initial={editTask} defaultSystem={defaultSystem} />}
    </div>
  );
}

// ─────────────────────────────────────────
// INBOX VIEW — Gmail-aware (Phase Two)
// Reads from email_threads/email_messages when an account is connected;
// falls back to legacy `emails` table when no account is set up yet.
// ─────────────────────────────────────────
function InboxView({ emails, setEmails, emailAccounts, setEmailAccounts, profiles, contacts, userId }) {
  const primaryAccount = emailAccounts.find(a => a.is_active) || emailAccounts[0] || null;
  const usingGmail = !!primaryAccount;

  if (usingGmail) {
    return <GmailInboxView account={primaryAccount} setEmailAccounts={setEmailAccounts} profiles={profiles} contacts={contacts} userId={userId} />;
  }
  return <LegacyInboxView emails={emails} setEmails={setEmails} userId={userId} />;
}

// ─── Legacy fake-email inbox (the original) ─────────────────────
function LegacyInboxView({ emails, setEmails, userId }) {
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('inbox');

  const unread = emails.filter(e=>!e.read&&(e.folder==='inbox'||!e.folder)).length;
  const visible = tab==='inbox' ? emails.filter(e=>e.folder==='inbox'||!e.folder) : emails.filter(e=>e.folder==='sent');

  function initials(addr) { return addr ? addr.split('@')[0].slice(0,2).toUpperCase() : '?'; }
  function timeAgo(ts) {
    if (!ts) return '';
    const diff = Math.floor((Date.now()-new Date(ts))/60000);
    if (diff<1) return 'just now'; if (diff<60) return `${diff}m`; if (diff<1440) return `${Math.floor(diff/60)}h`;
    return new Date(ts).toLocaleDateString();
  }

  async function markRead(email) {
    if (!email.read) await supabase.from('emails').update({read:true}).eq('id',email.id);
    setEmails(prev=>prev.map(e=>e.id===email.id?{...e,read:true}:e));
    setSelected({...email,read:true});
  }
  async function handleSend(ev) {
    ev.preventDefault(); setSending(true);
    const { data: sent } = await supabase.from('emails').insert({ user_id:userId, from_address:PLATFORM_ADMIN_EMAIL, to_address:composeTo, subject:composeSubject, body:composeBody, folder:'sent', read:true }).select().single();
    if (sent) setEmails(prev=>[sent,...prev]);
    setShowCompose(false); setComposeTo(''); setComposeSubject(''); setComposeBody(''); setSending(false);
  }
  async function deleteEmail(id) {
    await supabase.from('emails').delete().eq('id',id);
    setEmails(prev=>prev.filter(e=>e.id!==id));
    if (selected?.id===id) setSelected(null);
  }

  return (
    <div>
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
        <div><h2>Inbox</h2><p>{unread} unread · <span style={{color:'var(--text-3)'}}>not connected to Gmail yet — using local archive</span></p></div>
        <button className="btn btn-primary" onClick={()=>setShowCompose(true)}>✏️ Compose</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:selected?'1fr 1.4fr':'1fr',gap:'18px'}}>
        <div>
          <div className="panel">
            <div className="panel-header">
              <div style={{display:'flex',gap:'6px'}}>
                {['inbox','sent'].map(t=>(
                  <button key={t} className={`btn btn-sm ${tab===t?'btn-primary':'btn-ghost'}`} onClick={()=>{setTab(t);setSelected(null);}}>
                    {t.charAt(0).toUpperCase()+t.slice(1)}
                    {t==='inbox'&&unread>0&&<span className="nav-badge" style={{marginLeft:'6px'}}>{unread}</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="panel-body">
              {visible.length===0
                ? <div className="empty-state"><div className="empty-icon">📭</div><p>No messages here.</p><p style={{fontSize:'13px',color:'var(--text-3)',marginTop:'8px'}}>Connect Gmail in Settings to see real email.</p></div>
                : <div className="email-list">
                    {visible.map(email=>(
                      <div key={email.id} className={`email-item ${!email.read?'email-unread':''}`} onClick={()=>markRead(email)}>
                        {!email.read&&<div className="unread-dot"/>}
                        <div className="email-avatar">{initials(tab==='inbox'?email.from_address:email.to_address)}</div>
                        <div className="email-content">
                          <div className="email-from">{tab==='inbox'?email.from_address:`To: ${email.to_address}`}</div>
                          <div className="email-subject">{email.subject||'(no subject)'}</div>
                          <div className="email-preview">{email.body?.slice(0,80)||''}</div>
                        </div>
                        <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:'4px',flexShrink:0}}>
                          <span className="email-time">{timeAgo(email.created_at)}</span>
                          <button className="btn-icon" style={{color:'var(--red)',fontSize:'13px'}} onClick={ev=>{ev.stopPropagation();deleteEmail(email.id);}}>🗑</button>
                        </div>
                      </div>
                    ))}
                  </div>
              }
            </div>
          </div>
        </div>
        {selected&&(
          <div className="panel">
            <div className="panel-header">
              <h3 style={{maxWidth:'80%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{selected.subject||'(no subject)'}</h3>
              <button className="btn btn-ghost btn-sm" onClick={()=>setSelected(null)}>Close</button>
            </div>
            <div className="panel-body">
              <div style={{display:'flex',gap:'6px',marginBottom:'14px',flexWrap:'wrap'}}>
                <span className="pill pill-purple">From: {selected.from_address}</span>
                {selected.to_address&&<span className="pill pill-green">To: {selected.to_address}</span>}
              </div>
              <div style={{fontSize:'13.5px',lineHeight:'1.7',color:'var(--text-1)',whiteSpace:'pre-wrap'}}>{selected.body}</div>
            </div>
          </div>
        )}
      </div>
      {showCompose&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setShowCompose(false)}>
          <div className="modal">
            <div className="modal-header"><h3>New Message</h3><button className="modal-close" onClick={()=>setShowCompose(false)}>×</button></div>
            <form onSubmit={handleSend}>
              <div className="form-group"><label className="form-label">To</label><input className="form-input" type="email" value={composeTo} onChange={e=>setComposeTo(e.target.value)} placeholder="recipient@example.com" required /></div>
              <div className="form-group"><label className="form-label">Subject</label><input className="form-input" value={composeSubject} onChange={e=>setComposeSubject(e.target.value)} placeholder="Subject" /></div>
              <div className="form-group"><label className="form-label">Message</label><textarea className="form-textarea" value={composeBody} onChange={e=>setComposeBody(e.target.value)} placeholder="Write your message…" style={{minHeight:'130px'}} required /></div>
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

// ─── Gmail inbox ─────────────────────────────────────────────────
function GmailInboxView({ account, setEmailAccounts, profiles, contacts, userId }) {
  const [threads, setThreads] = useState([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [tab, setTab] = useState('inbox');
  const [selectedThread, setSelectedThread] = useState(null);
  const [selectedMessages, setSelectedMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState('');

  const loadThreads = useCallback(async () => {
    setLoadingThreads(true);
    // Filter by label: inbox tab → INBOX label; sent → SENT label
    let q = supabase
      .from('email_threads')
      .select('*')
      .eq('account_id', account.id)
      .order('last_message_at', { ascending: false })
      .limit(50);
    const { data } = await q;
    const labelFilter = tab === 'sent' ? 'SENT' : 'INBOX';
    const filtered = (data || []).filter(t => Array.isArray(t.labels) && t.labels.includes(labelFilter));
    setThreads(filtered);
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

  async function handleSend(ev) {
    ev.preventDefault();
    setSending(true);
    setSendMsg('');
    try {
      const { data, error } = await supabase.functions.invoke('gmail-send', {
        body: {
          account_id: account.id,
          to: composeTo.split(',').map(s => s.trim()).filter(Boolean),
          subject: composeSubject,
          body_text: composeBody,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setSendMsg('Sent.');
      setShowCompose(false);
      setComposeTo(''); setComposeSubject(''); setComposeBody('');
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
    if (!thread.participants || thread.participants.length === 0) return { name: null, email: null };
    if (tab === 'sent') {
      const recip = thread.participants.find(p => p.email !== account.email_address);
      return recip || thread.participants[0];
    }
    const sender = thread.participants.find(p => p.email !== account.email_address);
    return sender || thread.participants[0];
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
          <button className="btn btn-ghost" onClick={runSync} disabled={syncing}>{syncing ? 'Syncing…' : '↻ Sync'}</button>
          <button className="btn btn-primary" onClick={() => setShowCompose(true)}>✏️ Compose</button>
        </div>
      </div>

      {!account.initial_sync_done && (
        <div className="panel" style={{marginBottom:'14px',background:'rgba(197, 169, 94, 0.08)',borderColor:'var(--accent)'}}>
          <div className="panel-body" style={{padding:'14px'}}>
            <p style={{margin:0,fontSize:'14px',color:'var(--text-1)'}}>
              <strong>First sync hasn't run yet.</strong> Tap <strong>Sync</strong> to pull your most recent messages.
            </p>
          </div>
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns:selectedThread?'1fr 1.4fr':'1fr',gap:'18px'}}>
        <div>
          <div className="panel">
            <div className="panel-header">
              <div style={{display:'flex',gap:'6px'}}>
                {['inbox','sent'].map(t => (
                  <button key={t} className={`btn btn-sm ${tab===t?'btn-primary':'btn-ghost'}`} onClick={()=>{setTab(t); setSelectedThread(null);}}>
                    {t.charAt(0).toUpperCase()+t.slice(1)}
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
                                <span style={{overflow:'hidden',textOverflow:'ellipsis'}}>{sender.name || sender.email || '(unknown)'}</span>
                                {senderProfile && (
                                  <span className="pill pill-purple" style={{fontSize:'10px',padding:'2px 6px'}}>
                                    {senderProfile.primary_letter}{senderProfile.secondary_letter ? `/${senderProfile.secondary_letter}` : ''} · {senderProfile.confidence}
                                  </span>
                                )}
                                {thread.message_count > 1 && <span style={{color:'var(--text-3)',fontSize:'12px'}}>({thread.message_count})</span>}
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
          <div className="panel">
            <div className="panel-header">
              <h3 style={{maxWidth:'80%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{selectedThread.subject || '(no subject)'}</h3>
              <button className="btn btn-ghost btn-sm" onClick={()=>setSelectedThread(null)}>Close</button>
            </div>
            <div className="panel-body">
              {loadingMessages
                ? <div className="loading-screen" style={{minHeight:'200px'}}><div className="spinner"/></div>
                : selectedMessages.length === 0
                  ? <p style={{color:'var(--text-2)'}}>No messages found in this thread.</p>
                  : selectedMessages.map(msg => {
                      const senderProfile = profileForEmail(msg.from_address);
                      return (
                        <div key={msg.id} style={{marginBottom:'18px',paddingBottom:'14px',borderBottom:'1px solid var(--border)'}}>
                          <div style={{display:'flex',gap:'6px',marginBottom:'10px',flexWrap:'wrap',alignItems:'center'}}>
                            <span className="pill pill-purple">From: {msg.from_name || msg.from_address}</span>
                            {senderProfile && (
                              <span className="pill" style={{background:'var(--bg-base)',border:'1px solid var(--accent)',color:'var(--accent)',fontSize:'11px'}}>
                                {senderProfile.primary_letter}{senderProfile.secondary_letter ? `/${senderProfile.secondary_letter}` : ''} · {senderProfile.confidence}
                              </span>
                            )}
                            <span style={{fontSize:'12px',color:'var(--text-3)',marginLeft:'auto'}}>{msg.internal_date ? new Date(msg.internal_date).toLocaleString() : ''}</span>
                          </div>
                          <div style={{fontSize:'13.5px',lineHeight:'1.7',color:'var(--text-1)',whiteSpace:'pre-wrap'}}>
                            {msg.body_text || (msg.body_html ? '(HTML message — text version not available)' : msg.snippet || '')}
                          </div>
                        </div>
                      );
                    })
              }
            </div>
          </div>
        )}
      </div>

      {showCompose && (
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget && setShowCompose(false)}>
          <div className="modal">
            <div className="modal-header">
              <h3>New message · from {account.email_address}</h3>
              <button className="modal-close" onClick={()=>setShowCompose(false)}>×</button>
            </div>
            <form onSubmit={handleSend}>
              <div className="form-group"><label className="form-label">To</label><input className="form-input" type="text" value={composeTo} onChange={e=>setComposeTo(e.target.value)} placeholder="recipient@example.com (comma-separated for multiple)" required /></div>
              <div className="form-group"><label className="form-label">Subject</label><input className="form-input" value={composeSubject} onChange={e=>setComposeSubject(e.target.value)} placeholder="Subject" required /></div>
              <div className="form-group"><label className="form-label">Message</label><textarea className="form-textarea" value={composeBody} onChange={e=>setComposeBody(e.target.value)} placeholder="Write your message…" style={{minHeight:'160px'}} required /></div>
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
function DashboardView({ tasks, emails, user, setView, robots }) {
  const pending = tasks.filter(t=>!t.completed);
  const topTasks = sortTasks(pending.filter(isTopPriority));
  const unread = emails.filter(e=>!e.read&&(e.folder==='inbox'||!e.folder));
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
        <div className="stat-card" style={{cursor:'pointer'}} onClick={()=>setView('inbox')}><div className="stat-label">Unread Email</div><div className="stat-value">{unread.length}</div><div className="stat-sub">in inbox</div></div>
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
                  <div key={t.id} className="task-item"><div className="task-check"/><span className="task-text">{t.title}</span><div className="task-meta"><span className={`task-priority ${priorityClass(t)}`}>{priorityLabel(t)}</span>{t.due_date&&<span className="task-due">{t.due_date}</span>}</div></div>
                ))}</div>
            }
          </div>
        </div>
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
// DRAFT VIEW (2D drafting)
// ─────────────────────────────────────────

// Unit helpers
const UNIT_LABEL = { ft: 'ft', in: 'in', m: 'm', mm: 'mm' };

function formatLength(px, units, pxPerUnit) {
  const u = px / pxPerUnit;
  if (units === 'ft') {
    // Format as feet and inches, e.g., 24'-6"
    const totalIn = u * 12;
    const ft = Math.floor(totalIn / 12);
    const inches = totalIn - ft * 12;
    const inRounded = Math.round(inches * 10) / 10;
    if (Math.abs(inRounded) < 0.05) return `${ft}'-0"`;
    if (inRounded === 12) return `${ft + 1}'-0"`;
    return `${ft}'-${inRounded % 1 === 0 ? inRounded.toFixed(0) : inRounded.toFixed(1)}"`;
  }
  if (units === 'in') return `${u.toFixed(2)}"`;
  if (units === 'm') return `${u.toFixed(2)} m`;
  if (units === 'mm') return `${Math.round(u)} mm`;
  return `${u.toFixed(2)} ${units}`;
}

// Build a flat list of snap candidates for all shapes
// Each candidate: { x, y, kind: 'endpoint' | 'midpoint' | 'center' | 'quadrant' | 'vertex' | 'intersection' }
// Compute axis-aligned bounding box of a single shape. Returns null if no extent.
function shapeBoundingBox(s, blocks) {
  switch (s.type) {
    case 'line':
    case 'dimension':
      return {
        minX: Math.min(s.x1, s.x2), maxX: Math.max(s.x1, s.x2),
        minY: Math.min(s.y1, s.y2), maxY: Math.max(s.y1, s.y2),
      };
    case 'rect':
    case 'image': {
      const rot = s.rotation || 0;
      if (rot === 0) {
        return { minX: s.x, minY: s.y, maxX: s.x + s.w, maxY: s.y + s.h };
      }
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      const rad = (rot * Math.PI) / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const corners = [
        [s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]
      ].map(([px, py]) => {
        const dx = px - cx, dy = py - cy;
        return { x: cx + dx * cos + dy * sin, y: cy - dx * sin + dy * cos };
      });
      const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    }
    case 'circle':
      return { minX: s.cx - s.r, minY: s.cy - s.r, maxX: s.cx + s.r, maxY: s.cy + s.r };
    case 'text': {
      const fs = s.fontSize || 18;
      const w = (s.text?.length || 1) * fs * 0.6;
      return { minX: s.x, minY: s.y - fs / 2, maxX: s.x + w, maxY: s.y + fs / 2 };
    }
    case 'polyline':
    case 'freehand': {
      if (!s.points || s.points.length === 0) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of s.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { minX, minY, maxX, maxY };
    }
    case 'bezier': {
      const xs = [s.x1, s.x2, s.cx];
      const ys = [s.y1, s.y2, s.cy];
      return {
        minX: Math.min(...xs), maxX: Math.max(...xs),
        minY: Math.min(...ys), maxY: Math.max(...ys),
      };
    }
    case 'instance': {
      if (!blocks) return { minX: s.x - 5, minY: s.y - 5, maxX: s.x + 5, maxY: s.y + 5 };
      const block = blocks.find(b => b.id === s.blockId);
      if (!block) return { minX: s.x - 5, minY: s.y - 5, maxX: s.x + 5, maxY: s.y + 5 };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const bs of block.shapes) {
        const transformed = transformShapeForInstance(bs, s);
        const sub = shapeBoundingBox(transformed, blocks);
        if (!sub) continue;
        if (sub.minX < minX) minX = sub.minX;
        if (sub.minY < minY) minY = sub.minY;
        if (sub.maxX > maxX) maxX = sub.maxX;
        if (sub.maxY > maxY) maxY = sub.maxY;
      }
      if (!Number.isFinite(minX)) return { minX: s.x - 5, minY: s.y - 5, maxX: s.x + 5, maxY: s.y + 5 };
      return { minX, minY, maxX, maxY };
    }
    default:
      return null;
  }
}

function unionBoundingBox(shapes, blocks) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    const bb = shapeBoundingBox(s, blocks);
    if (!bb) continue;
    if (bb.minX < minX) minX = bb.minX;
    if (bb.minY < minY) minY = bb.minY;
    if (bb.maxX > maxX) maxX = bb.maxX;
    if (bb.maxY > maxY) maxY = bb.maxY;
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function fitViewBox(bbox, svgAspect, padding = 0.1) {
  if (!bbox) return { x: 0, y: 0, w: 1200, h: 800 };
  const w = bbox.maxX - bbox.minX;
  const h = bbox.maxY - bbox.minY;
  if (w < 1 && h < 1) {
    return { x: bbox.minX - 100, y: bbox.minY - 100, w: 200, h: 200 };
  }
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  let fitW = w * (1 + 2 * padding);
  let fitH = h * (1 + 2 * padding);
  const bbAspect = fitW / fitH;
  if (bbAspect > svgAspect) fitH = fitW / svgAspect;
  else fitW = fitH * svgAspect;
  return { x: cx - fitW / 2, y: cy - fitH / 2, w: fitW, h: fitH };
}

function shapeIntersectsRect(s, selRect, blocks, selectionMode = 'crossing') {
  const bb = shapeBoundingBox(s, blocks);
  if (!bb) return false;
  if (selectionMode === 'window') {
    return bb.minX >= selRect.minX && bb.maxX <= selRect.maxX
        && bb.minY >= selRect.minY && bb.maxY <= selRect.maxY;
  }
  return !(bb.maxX < selRect.minX || bb.minX > selRect.maxX ||
           bb.maxY < selRect.minY || bb.minY > selRect.maxY);
}

function distanceAngle(anchor, cursor, pxPerUnit) {
  const dx = cursor.x - anchor.x;
  const dy = cursor.y - anchor.y;
  const distPx = Math.hypot(dx, dy);
  const rad = Math.atan2(-dy, dx);
  let deg = (rad * 180) / Math.PI;
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return { distPx, distUnits: distPx / pxPerUnit, angleDeg: deg };
}

function getSnapPoints(shapes, isShapeVisible, blocks) {
  const pts = [];
  // Helper to add snap points for a single shape (used both for top-level shapes
  // and for the sub-shapes inside an expanded block instance).
  const addPointsFor = (s) => {
    if (s.type === 'line' || s.type === 'dimension') {
      pts.push({ x: s.x1, y: s.y1, kind: 'endpoint' });
      pts.push({ x: s.x2, y: s.y2, kind: 'endpoint' });
      pts.push({ x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2, kind: 'midpoint' });
    } else if (s.type === 'image') {
      // Skip images for snapping — they're reference backgrounds, not
      // geometry. Snapping to image corners while drafting would pull the
      // cursor away from the user's intended drawing.
      return;
    } else if (s.type === 'rect') {
      const rot = s.rotation || 0;
      if (rot === 0) {
        const x2 = s.x + s.w, y2 = s.y + s.h;
        pts.push({ x: s.x, y: s.y, kind: 'endpoint' });
        pts.push({ x: x2, y: s.y, kind: 'endpoint' });
        pts.push({ x: x2, y: y2, kind: 'endpoint' });
        pts.push({ x: s.x, y: y2, kind: 'endpoint' });
        pts.push({ x: s.x + s.w / 2, y: s.y, kind: 'midpoint' });
        pts.push({ x: x2, y: s.y + s.h / 2, kind: 'midpoint' });
        pts.push({ x: s.x + s.w / 2, y: y2, kind: 'midpoint' });
        pts.push({ x: s.x, y: s.y + s.h / 2, kind: 'midpoint' });
        pts.push({ x: s.x + s.w / 2, y: s.y + s.h / 2, kind: 'center' });
      } else {
        const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
        const rad = (rot * Math.PI) / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const rotPt = (px, py) => {
          const dx = px - cx, dy = py - cy;
          return { x: cx + dx * cos + dy * sin, y: cy - dx * sin + dy * cos };
        };
        const x2 = s.x + s.w, y2 = s.y + s.h;
        const corners = [[s.x, s.y], [x2, s.y], [x2, y2], [s.x, y2]];
        for (const [px, py] of corners) {
          const p = rotPt(px, py);
          pts.push({ ...p, kind: 'endpoint' });
        }
        const mids = [
          [s.x + s.w / 2, s.y], [x2, s.y + s.h / 2],
          [s.x + s.w / 2, y2], [s.x, s.y + s.h / 2]
        ];
        for (const [px, py] of mids) {
          const p = rotPt(px, py);
          pts.push({ ...p, kind: 'midpoint' });
        }
        pts.push({ x: cx, y: cy, kind: 'center' });
      }
    } else if (s.type === 'circle') {
      pts.push({ x: s.cx, y: s.cy, kind: 'center' });
      pts.push({ x: s.cx + s.r, y: s.cy, kind: 'quadrant' });
      pts.push({ x: s.cx - s.r, y: s.cy, kind: 'quadrant' });
      pts.push({ x: s.cx, y: s.cy + s.r, kind: 'quadrant' });
      pts.push({ x: s.cx, y: s.cy - s.r, kind: 'quadrant' });
    } else if (s.type === 'polyline' || s.type === 'freehand') {
      if (!s.points) return;
      for (let i = 0; i < s.points.length; i++) {
        pts.push({ x: s.points[i].x, y: s.points[i].y, kind: 'vertex' });
        if (i < s.points.length - 1) {
          const a = s.points[i], b = s.points[i + 1];
          pts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, kind: 'midpoint' });
        }
      }
    } else if (s.type === 'bezier') {
      pts.push({ x: s.x1, y: s.y1, kind: 'endpoint' });
      pts.push({ x: s.x2, y: s.y2, kind: 'endpoint' });
    } else if (s.type === 'text') {
      pts.push({ x: s.x, y: s.y, kind: 'vertex' });
    }
  };
  for (const s of shapes) {
    if (!isShapeVisible(s)) continue;
    if (s.type === 'instance') {
      // Insertion point itself snaps
      pts.push({ x: s.x, y: s.y, kind: 'vertex' });
      // And every sub-shape of the expanded instance
      if (blocks) {
        const sub = expandInstance(s, blocks);
        for (const es of sub) addPointsFor(es);
      }
      continue;
    }
    addPointsFor(s);
  }
  return pts;
}

// Find the closest snap point within worldTol of p
function findSnap(p, snapPoints, worldTol) {
  let best = null;
  let bestD = worldTol;
  for (const sp of snapPoints) {
    const d = Math.hypot(sp.x - p.x, sp.y - p.y);
    if (d < bestD) { bestD = d; best = sp; }
  }
  return best;
}

// Apply ortho constraint: lock p to horizontal or vertical from anchor
function applyOrtho(anchor, p) {
  if (!anchor) return p;
  const dx = Math.abs(p.x - anchor.x);
  const dy = Math.abs(p.y - anchor.y);
  if (dx > dy) return { x: p.x, y: anchor.y };
  return { x: anchor.x, y: p.y };
}

// Line-line intersection. Returns {x,y,tA,tB} or null. tA/tB are parameters along each line.
function lineIntersect(a1, a2, b1, b2) {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (Math.abs(d) < 1e-9) return null; // parallel
  const tA = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
  const tB = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d;
  return {
    x: a1.x + tA * (a2.x - a1.x),
    y: a1.y + tA * (a2.y - a1.y),
    tA, tB,
  };
}

function DraftView({ drawings, setDrawings, userId }) {
  const [activeId, setActiveId] = useState(null);
  const [tool, setTool] = useState('select');
  const [color, setColor] = useState('#e8eaf0');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [shapes, setShapes] = useState([]);
  const [draft, setDraft] = useState(null);
  const [polyPending, setPolyPending] = useState(null); // active polyline being built (multi-click)
  const [previewPoint, setPreviewPoint] = useState(null); // cursor pos for poly preview segment
  const [editingTextId, setEditingTextId] = useState(null);
  const [layers, setLayers] = useState([{ id: 'default', name: 'Layer 1', color: '#e8eaf0', visible: true, locked: false }]);
  const [activeLayerId, setActiveLayerId] = useState('default');
  const [moving, setMoving] = useState(null); // { startX, startY, originalShapes: [...] } during drag
  // Handle-drag state. When set, mousemove updates just one feature of one
  // shape instead of translating the whole thing. The `endpoint` field
  // identifies which handle:
  //   line/dimension: 'a' | 'b' (start/end)
  //   rect/image:     'tl' | 'tr' | 'br' | 'bl' (corner)
  //   polyline/freehand: number (vertex index)
  //   circle:         'r' (radius point)
  //   bezier:         'a' | 'b' | 'c' (start, end, control)
  // preDragSnap holds the pre-drag state for undo and Escape-to-cancel.
  const [endpointDrag, setEndpointDrag] = useState(null);
  const [freehandPoints, setFreehandPoints] = useState(null); // array of points during freehand stroke
  // Transient hint shown when the user clicks a shape on a locked layer — so
  // they understand why their click "didn't do anything." Cleared on next
  // click or after a short timeout.
  const [lockedLayerHint, setLockedLayerHint] = useState(null);
  const [offsetMode, setOffsetMode] = useState(false); // when true, next click defines offset vector
  const [offsetAnchor, setOffsetAnchor] = useState(null); // {x,y} reference point for offset
  const [showLayersPanel, setShowLayersPanel] = useState(false);
  const [units, setUnits] = useState('ft');
  const [pxPerUnit, setPxPerUnit] = useState(20);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [orthoEnabled, setOrthoEnabled] = useState(false);
  const [snapHit, setSnapHit] = useState(null); // {x,y,kind} when cursor is near a snap target
  const [trimMode, setTrimMode] = useState(false);
  const [extendMode, setExtendMode] = useState(null); // null | { stage: 'pickEnd', shapeId, endpointKey } | { stage: 'pickTarget', ... }
  // Tier 2 state
  const [paramInput, setParamInput] = useState(null); // null | { value: string, anchor: {x,y}, cursor: {x,y} }
  const [mirrorMode, setMirrorMode] = useState(null); // null | { stage: 'pickP1' } | { stage: 'pickP2', p1: {x,y} }
  const [showArrayDialog, setShowArrayDialog] = useState(false);
  const [showRotateDialog, setShowRotateDialog] = useState(false);
  const [showScaleDialog, setShowScaleDialog] = useState(false);
  // Tier 3 state
  const [blocks, setBlocks] = useState([]);
  const [showBlocksPanel, setShowBlocksPanel] = useState(false);
  const [showCreateBlockDialog, setShowCreateBlockDialog] = useState(false);
  const [insertBlockId, setInsertBlockId] = useState(null);
  // Block-edit mode: when non-null, the canvas is showing the block's interior shapes
  // for editing. savedShapes holds the top-level shapes to restore on exit.
  const [blockEditMode, setBlockEditMode] = useState(null);
  const [showPdfDialog, setShowPdfDialog] = useState(false);
  const fileInputRef = useRef(null);
  const imageFileInputRef = useRef(null);
  // Calibration: when set, the user clicks two points on a reference image
  // and enters the real-world distance between them to set drawing scale.
  // Shape: null | { imageId, stage: 'pickP1'|'pickP2'|'enterDistance', p1?, p2? }
  const [calibrateMode, setCalibrateMode] = useState(null);
  // Multi-select: selectedIds is the source of truth. selectedId mirrors selectedIds[0]
  // for backwards-compat with single-shape ops (offset, mirror, rotate, array, etc).
  const [selectedIds, setSelectedIds] = useState([]);
  const selectedId = selectedIds[0] || null;
  const setSelectedId = (id) => setSelectedIds(id == null ? [] : [id]);
  // Drag-select state: null | { start: {x,y}, current: {x,y}, additive: bool }
  const [dragSelect, setDragSelect] = useState(null);
  // Undo/redo history. Snapshots capture {shapes, layers, blocks}.
  // selectedIds, viewBox, tool, etc. are UI state and not part of history.
  const HISTORY_MAX = 50;
  const [historyPast, setHistoryPast] = useState([]);
  const [historyFuture, setHistoryFuture] = useState([]);
  // Ref mirror of latest state so pushHistory always reads current values.
  const stateRef = useRef({ shapes: [], layers: [], blocks: [] });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('Untitled Drawing');
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 1200, h: 800 });
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [panMode, setPanMode] = useState(false);
  const svgRef = useRef(null);
  const panStart = useRef(null);

  const active = drawings.find(d => d.id === activeId);
  const GRID = 20;

  // Keep stateRef in sync with the latest mutable state.
  useEffect(() => {
    stateRef.current = { shapes, layers, blocks };
  }, [shapes, layers, blocks]);

  // Snapshot helpers
  function deepSnap() {
    return {
      shapes: JSON.parse(JSON.stringify(stateRef.current.shapes)),
      layers: JSON.parse(JSON.stringify(stateRef.current.layers)),
      blocks: JSON.parse(JSON.stringify(stateRef.current.blocks)),
    };
  }
  // Call BEFORE any state mutation that should be undoable.
  function pushHistory() {
    const snap = deepSnap();
    setHistoryPast(prev => {
      const next = [...prev, snap];
      while (next.length > HISTORY_MAX) next.shift();
      return next;
    });
    setHistoryFuture([]);
  }
  function undo() {
    if (historyPast.length === 0) return;
    const prev = historyPast[historyPast.length - 1];
    const currentSnap = deepSnap();
    setHistoryPast(p => p.slice(0, -1));
    setHistoryFuture(f => [...f, currentSnap]);
    setShapes(prev.shapes);
    setLayers(prev.layers);
    setBlocks(prev.blocks);
    setSelectedIds([]);
    setDirty(true);
  }
  function redo() {
    if (historyFuture.length === 0) return;
    const next = historyFuture[historyFuture.length - 1];
    const currentSnap = deepSnap();
    setHistoryFuture(f => f.slice(0, -1));
    setHistoryPast(p => [...p, currentSnap]);
    setShapes(next.shapes);
    setLayers(next.layers);
    setBlocks(next.blocks);
    setSelectedIds([]);
    setDirty(true);
  }
  const canUndo = historyPast.length > 0;
  const canRedo = historyFuture.length > 0;

  useEffect(() => {
    if (active) {
      const raw = active.shapes;
      const loadedShapes = (raw && Array.isArray(raw.shapes)) ? raw.shapes : (Array.isArray(raw) ? raw : []);
      const loadedLayers = (raw && Array.isArray(raw.layers) && raw.layers.length)
        ? raw.layers
        : [{ id: 'default', name: 'Layer 1', color: '#e8eaf0', visible: true, locked: false }];
      setShapes(loadedShapes.map(s => ({ ...s, layer: s.layer || loadedLayers[0].id })));
      setLayers(loadedLayers);
      setActiveLayerId(loadedLayers[0].id);
      setUnits(active.units || 'ft');
      setPxPerUnit(active.px_per_unit || 20);
      setBlocks(Array.isArray(active.blocks) ? active.blocks : []);
      setTitle(active.title || 'Untitled Drawing');
      setDirty(false);
      setSelectedId(null);
      setViewBox({ x: 0, y: 0, w: 1200, h: 800 });
      // Reset all transient editing state so opening a new drawing starts clean
      setDraft(null);
      setPolyPending(null);
      setPreviewPoint(null);
      setEditingTextId(null);
      setMoving(null);
      setFreehandPoints(null);
      setOffsetMode(false);
      setOffsetAnchor(null);
      setTrimMode(false);
      setExtendMode(null);
      setMirrorMode(null);
      setParamInput(null);
      setInsertBlockId(null);
      setSnapHit(null);
      setDragSelect(null);
      setHistoryPast([]);
      setHistoryFuture([]);
      setBlockEditMode(null);
    }
  }, [activeId]); // eslint-disable-line

  function svgPoint(e) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX);
    const clientY = e.clientY ?? (e.touches && e.touches[0]?.clientY);
    const x = viewBox.x + ((clientX - rect.left) / rect.width) * viewBox.w;
    const y = viewBox.y + ((clientY - rect.top) / rect.height) * viewBox.h;
    if (snapToGrid && tool !== 'select') {
      return { x: Math.round(x / GRID) * GRID, y: Math.round(y / GRID) * GRID };
    }
    return { x, y };
  }

  // World tolerance for snapping: 10 screen px → world px = 10 * (viewBox.w / svgWidth)
  function worldSnapTolerance() {
    const svg = svgRef.current;
    if (!svg) return 10;
    const r = svg.getBoundingClientRect();
    return (10 * viewBox.w) / r.width;
  }

  // Resolve a raw mouse event into a final point, applying:
  //   1. Object snap (if enabled and a candidate is within tolerance) — takes priority
  //   2. Otherwise, ortho lock against `orthoAnchor` (if active)
  //   3. Otherwise, grid snap (if enabled and not in select mode)
  // Also updates the snap-hit indicator.
  function resolvePoint(e, orthoAnchor) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX);
    const clientY = e.clientY ?? (e.touches && e.touches[0]?.clientY);
    const rawX = viewBox.x + ((clientX - rect.left) / rect.width) * viewBox.w;
    const rawY = viewBox.y + ((clientY - rect.top) / rect.height) * viewBox.h;
    let p = { x: rawX, y: rawY };

    if (snapEnabled) {
      const hit = findSnap(p, snapPointsCache, worldSnapTolerance());
      if (hit) {
        setSnapHit(hit);
        return { x: hit.x, y: hit.y, _snapped: true };
      }
    }
    setSnapHit(null);

    if (orthoEnabled && orthoAnchor) {
      p = applyOrtho(orthoAnchor, p);
    }

    if (snapToGrid && tool !== 'select') {
      p = { x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID };
    }
    return p;
  }

  // Layer helpers — using a Map for O(1) lookup instead of layers.find per shape
  const layerById = useMemo(() => {
    const m = new Map();
    for (const l of layers) m.set(l.id, l);
    return m;
  }, [layers]);
  function isShapeInteractable(s) {
    const l = layerById.get(s.layer || 'default');
    return l ? (l.visible && !l.locked) : true;
  }
  function isShapeVisible(s) {
    const l = layerById.get(s.layer || 'default');
    return l ? l.visible : true;
  }

  // Memoized snap-points list. Recomputed only when shapes/layers/blocks change,
  // so mousemove doesn't re-expand every block instance on every event.
  const snapPointsCache = useMemo(() => {
    return getSnapPoints(shapes, isShapeVisible, blocks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapes, layers, blocks]);

  // O(1) selection lookups during render — avoids selectedIds.includes per shape.
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // O(1) shape lookups by id — replaces the dozen shapes.find(s => s.id === ...)
  // calls scattered through mutation handlers and render-time dialogs. Rebuilt
  // only when shapes change.
  const shapeById = useMemo(() => {
    const m = new Map();
    for (const s of shapes) m.set(s.id, s);
    return m;
  }, [shapes]);

  function handleMouseDown(e) {
    if (panMode || e.button === 1 || (e.button === 0 && e.altKey)) {
      panStart.current = { mx: e.clientX, my: e.clientY, vx: viewBox.x, vy: viewBox.y };
      return;
    }

    // Determine ortho anchor (the "previous point") for this click
    let orthoAnchor = null;
    if (polyPending) {
      if (polyPending.type === 'polyline' && polyPending.points.length > 0) {
        orthoAnchor = polyPending.points[polyPending.points.length - 1];
      } else if (polyPending.type === 'dimension') {
        orthoAnchor = { x: polyPending.x1, y: polyPending.y1 };
      } else if (polyPending.type === 'bezier' && polyPending.stage === 1) {
        orthoAnchor = { x: polyPending.x1, y: polyPending.y1 };
      }
    }
    const p = resolvePoint(e, orthoAnchor);

    // Trim mode: click on a line to trim it
    if (trimMode) {
      handleTrimClick(p);
      return;
    }
    if (extendMode) {
      handleExtendClick(p);
      return;
    }
    // Mirror mode: collect two points defining the axis
    if (mirrorMode) {
      if (mirrorMode.stage === 'pickP1') {
        setMirrorMode({ stage: 'pickP2', p1: p });
        return;
      }
      if (mirrorMode.stage === 'pickP2') {
        const original = shapeById.get(selectedId);
        if (original && (p.x !== mirrorMode.p1.x || p.y !== mirrorMode.p1.y)) {
          pushHistory();
          const reflected = cloneShapeWithNewId(mirrorShape(original, { a: mirrorMode.p1, b: p }));
          reflected.layer = activeLayerId;
          setShapes(prev => [...prev, reflected]);
          setSelectedId(reflected.id);
          setDirty(true);
        }
        setMirrorMode(null);
        return;
      }
    }

    // Calibrate mode: pick two points on the reference image, then prompt
    // for the real-world distance between them and rescale the image.
    if (calibrateMode) {
      if (calibrateMode.stage === 'pickP1') {
        setCalibrateMode({ ...calibrateMode, stage: 'pickP2', p1: p });
        return;
      }
      if (calibrateMode.stage === 'pickP2') {
        const p1 = calibrateMode.p1;
        const p2 = p;
        const pxDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (pxDist < 1) {
          window.alert('The two points are too close together. Try again.');
          setCalibrateMode({ imageId: calibrateMode.imageId, stage: 'pickP1' });
          return;
        }
        // Prompt for real-world distance + unit
        const input = window.prompt(
          `Real-world distance between the two points?\n` +
          `Examples: "20 ft", "6.5 m", "100 in", "2.5 yd"\n\n` +
          `(Current drawing units: ${units})`,
          `10 ${units}`
        );
        if (!input) {
          setCalibrateMode(null);
          return;
        }
        // Parse "<number> <unit>" with the unit optional (defaults to drawing units)
        const m = input.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*(in|inch|inches|ft|feet|m|meter|meters|cm|centimeter|centimeters|mm|millimeter|millimeters|yd|yard|yards)?$/i);
        if (!m) {
          window.alert(`Couldn't parse "${input}". Use a number, optionally followed by a unit (e.g. "20 ft").`);
          setCalibrateMode(null);
          return;
        }
        const realValue = parseFloat(m[1]);
        if (!isFinite(realValue) || realValue <= 0) {
          window.alert('Distance must be a positive number.');
          setCalibrateMode(null);
          return;
        }
        // Normalize unit aliases. If omitted, assume drawing's current units.
        const unitInput = (m[2] || units).toLowerCase();
        const unitMap = {
          'in': 'in', 'inch': 'in', 'inches': 'in',
          'ft': 'ft', 'feet': 'ft', 'foot': 'ft',
          'm': 'm', 'meter': 'm', 'meters': 'm',
          'cm': 'cm', 'centimeter': 'cm', 'centimeters': 'cm',
          'mm': 'mm', 'millimeter': 'mm', 'millimeters': 'mm',
          'yd': 'yd', 'yard': 'yd', 'yards': 'yd',
        };
        const inputUnit = unitMap[unitInput] || units;
        // Convert real-world distance to inches (canonical), then to drawing px.
        const inPerUnit = { 'in': 1, 'ft': 12, 'yd': 36, 'm': 39.3701, 'cm': 0.393701, 'mm': 0.0393701 };
        const realInches = realValue * (inPerUnit[inputUnit] || 1);
        const drawingPxPerInch = pxPerUnit / (inPerUnit[units] || 1);
        const targetPxDist = realInches * drawingPxPerInch;
        const factor = targetPxDist / pxDist;
        if (!isFinite(factor) || factor <= 0) {
          window.alert('Calibration produced an invalid scale factor.');
          setCalibrateMode(null);
          return;
        }
        // Scale the image around p1 so the two points keep their on-screen
        // anchor positions correctly. We scale around p1; p2 moves outward
        // to the new distance. (Choosing p1 as the pivot keeps one of the
        // user's clicked points exactly where they put it.)
        const img = shapeById.get(calibrateMode.imageId);
        if (!img) {
          setCalibrateMode(null);
          return;
        }
        pushHistory();
        const scaled = scaleShape(img, factor, p1);
        setShapes(prev => prev.map(s => s.id === img.id ? scaled : s));
        setDirty(true);
        setCalibrateMode(null);
        return;
      }
    }

    // Block insert mode: this click places an instance
    if (insertBlockId) {
      pushHistory();
      const id = 'sh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      const newInst = {
        id, type: 'instance', blockId: insertBlockId,
        x: p.x, y: p.y, rotation: 0, scale: 1,
        layer: activeLayerId,
      };
      setShapes(prev => [...prev, newInst]);
      setSelectedId(id);
      setDirty(true);
      setInsertBlockId(null);
      return;
    }

    // Offset mode: this click defines the offset vector
    if (offsetMode && selectedId && offsetAnchor) {
      const dx = p.x - offsetAnchor.x;
      const dy = p.y - offsetAnchor.y;
      const original = shapeById.get(selectedId);
      if (original && (dx !== 0 || dy !== 0)) {
        pushHistory();
        const copy = cloneShapeWithNewId(translateShape(original, dx, dy));
        copy.layer = activeLayerId;
        setShapes(prev => [...prev, copy]);
        setSelectedId(copy.id);
        setDirty(true);
      }
      setOffsetMode(false);
      setOffsetAnchor(null);
      return;
    }

    if (tool === 'select') {
      // Hit-test priority matches render z-order: non-images first (reverse
      // insertion order = visually-on-top first), images last (since they
      // render behind everything else as base/reference layers). Without this,
      // clicking a vector shape that visually overlaps an image could still
      // hit the image first if the image happens to come later in `shapes`.
      const nonImages = [...shapes].filter(s => s.type !== 'image').reverse();
      const images = [...shapes].filter(s => s.type === 'image').reverse();
      // Strict first pass: 10 screen-pixel tolerance.
      let hit = [...nonImages, ...images].find(s => isShapeInteractable(s) && hitTest(s, p));
      // Lenient second pass for vector shapes only, with a generous 18 screen-pixel
      // tolerance. CAD selection traditionally accepts near-misses; this catches
      // the "I clearly clicked the line but nothing happened" frustration.
      // Images are excluded — they already fill their bounds, no need for slop.
      if (!hit) {
        const screenW = svgRef.current?.getBoundingClientRect().width || 1;
        const lenientTol = Math.max(5, (18 * viewBox.w) / screenW);
        hit = nonImages.find(s => isShapeInteractable(s) && hitTest(s, p, lenientTol));
      }
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      if (hit) {
        if (lockedLayerHint) setLockedLayerHint(null);
        let newSelection;
        if (additive) {
          if (selectedIds.includes(hit.id)) {
            newSelection = selectedIds.filter(id => id !== hit.id);
          } else {
            newSelection = [...selectedIds, hit.id];
          }
        } else if (selectedIds.includes(hit.id) && selectedIds.length > 1) {
          newSelection = selectedIds;
        } else {
          newSelection = [hit.id];
        }
        setSelectedIds(newSelection);
        const originalById = {};
        for (const id of newSelection) {
          const s = shapeById.get(id);
          if (s) originalById[id] = s;
        }
        setMoving({ startX: p.x, startY: p.y, originalById, preDragSnap: deepSnap() });
      } else {
        // No hit. Before falling through to drag-select, check whether the
        // user actually CLICKED on a shape that lives on a locked layer.
        // Helps explain "I clicked the line but nothing happened" — usually
        // because the layer (or the Reference layer holding an imported PDF)
        // is locked.
        const screenW = svgRef.current?.getBoundingClientRect().width || 1;
        const hintTol = Math.max(5, (18 * viewBox.w) / screenW);
        const lockedHit = [...nonImages, ...images].find(s => {
          const l = layerById.get(s.layer || 'default');
          if (!l || !l.visible || !l.locked) return false;
          return hitTest(s, p, hintTol);
        });
        if (lockedHit) {
          const l = layerById.get(lockedHit.layer || 'default');
          const ts = Date.now();
          setLockedLayerHint({
            text: `That shape is on "${l?.name || 'a locked layer'}" — unlock it in the Layers panel to select.`,
            timestamp: ts,
          });
          setTimeout(() => {
            // Only clear if the same hint is still showing (no newer hint came along)
            setLockedLayerHint(prev => (prev && prev.timestamp === ts) ? null : prev);
          }, 4000);
        }
        if (!additive) setSelectedIds([]);
        setDragSelect({ start: p, current: p, additive });
      }
      return;
    }

    const id = 'sh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    if (tool === 'line') setDraft({ id, type: 'line', x1: p.x, y1: p.y, x2: p.x, y2: p.y, stroke: color, strokeWidth, layer: activeLayerId });
    if (tool === 'rect') setDraft({ id, type: 'rect', x: p.x, y: p.y, w: 0, h: 0, rotation: 0, stroke: color, strokeWidth, fill: 'none', layer: activeLayerId });
    if (tool === 'circle') setDraft({ id, type: 'circle', cx: p.x, cy: p.y, r: 0, stroke: color, strokeWidth, fill: 'none', layer: activeLayerId });
    if (tool === 'polyline') {
      if (polyPending) {
        setPolyPending({ ...polyPending, points: [...polyPending.points, p] });
      } else {
        setPolyPending({ id, type: 'polyline', points: [p], stroke: color, strokeWidth, fill: 'none', layer: activeLayerId });
      }
      return;
    }
    if (tool === 'dimension') {
      if (polyPending && polyPending.type === 'dimension') {
        const finished = { ...polyPending, x2: p.x, y2: p.y };
        const len = Math.hypot(finished.x2 - finished.x1, finished.y2 - finished.y1);
        if (len > 0) {
          pushHistory();
          setShapes(prev => [...prev, finished]);
          setDirty(true);
        }
        setPolyPending(null);
      } else {
        setPolyPending({ id, type: 'dimension', x1: p.x, y1: p.y, x2: p.x, y2: p.y, stroke: color, strokeWidth, layer: activeLayerId });
      }
      return;
    }
    if (tool === 'bezier') {
      if (!polyPending) {
        setPolyPending({ id, type: 'bezier', stage: 1, x1: p.x, y1: p.y, x2: p.x, y2: p.y, cx: p.x, cy: p.y, stroke: color, strokeWidth, fill: 'none', layer: activeLayerId });
      } else if (polyPending.stage === 1) {
        setPolyPending({ ...polyPending, stage: 2, x2: p.x, y2: p.y });
      } else if (polyPending.stage === 2) {
        pushHistory();
        const finished = { ...polyPending, cx: p.x, cy: p.y };
        delete finished.stage;
        setShapes(prev => [...prev, finished]);
        setDirty(true);
        setPolyPending(null);
      }
      return;
    }
    if (tool === 'freehand') {
      setFreehandPoints([p]);
      return;
    }
    if (tool === 'text') {
      pushHistory();
      const newText = { id, type: 'text', x: p.x, y: p.y, text: 'Text', stroke: color, fontSize: Math.max(14, strokeWidth * 6), layer: activeLayerId };
      setShapes(prev => [...prev, newText]);
      setSelectedId(id);
      setEditingTextId(id);
      setDirty(true);
      setTool('select');
      return;
    }
  }

  function handleMouseMove(e) {
    // Handle-drag: route by shape type. The `endpoint` value tells us which
    // handle is being dragged (see comment near endpointDrag state).
    if (endpointDrag) {
      const s = shapeById.get(endpointDrag.shapeId);
      if (!s) return;

      if (s.type === 'line' || s.type === 'dimension') {
        const anchor = endpointDrag.endpoint === 'a'
          ? { x: s.x2, y: s.y2 }
          : { x: s.x1, y: s.y1 };
        const p = resolvePoint(e, anchor);
        setShapes(prev => prev.map(sh => {
          if (sh.id !== endpointDrag.shapeId) return sh;
          return endpointDrag.endpoint === 'a'
            ? { ...sh, x1: p.x, y1: p.y }
            : { ...sh, x2: p.x, y2: p.y };
        }));
        return;
      }

      if (s.type === 'circle') {
        // Radius handle: new radius = distance from center to mouse.
        // Anchor for ortho is the center, which keeps the dashed ortho lines
        // pointing through the center if the user holds Shift/ortho.
        const p = resolvePoint(e, { x: s.cx, y: s.cy });
        const newR = Math.max(0.5, Math.hypot(p.x - s.cx, p.y - s.cy));
        setShapes(prev => prev.map(sh =>
          sh.id === endpointDrag.shapeId ? { ...sh, r: newR } : sh
        ));
        return;
      }

      if (s.type === 'polyline' || s.type === 'freehand') {
        const idx = endpointDrag.endpoint;
        if (typeof idx !== 'number' || !s.points || !s.points[idx]) return;
        // Anchor for ortho is the previous vertex (or next if dragging the first)
        const anchorIdx = idx > 0 ? idx - 1 : (s.points.length > 1 ? 1 : idx);
        const anchorPt = s.points[anchorIdx];
        const p = resolvePoint(e, anchorPt);
        setShapes(prev => prev.map(sh => {
          if (sh.id !== endpointDrag.shapeId) return sh;
          const newPoints = sh.points.map((pt, i) => i === idx ? { x: p.x, y: p.y } : pt);
          return { ...sh, points: newPoints };
        }));
        return;
      }

      if (s.type === 'bezier') {
        let anchor;
        if (endpointDrag.endpoint === 'a') anchor = { x: s.x2, y: s.y2 };
        else if (endpointDrag.endpoint === 'b') anchor = { x: s.x1, y: s.y1 };
        else anchor = { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
        const p = resolvePoint(e, anchor);
        setShapes(prev => prev.map(sh => {
          if (sh.id !== endpointDrag.shapeId) return sh;
          if (endpointDrag.endpoint === 'a') return { ...sh, x1: p.x, y1: p.y };
          if (endpointDrag.endpoint === 'b') return { ...sh, x2: p.x, y2: p.y };
          return { ...sh, cx: p.x, cy: p.y };
        }));
        return;
      }

      if (s.type === 'rect' || s.type === 'image') {
        // Drag a corner. The opposite corner stays fixed in SCREEN space;
        // we recompute x/y/w/h from the two diagonal corners. For rotated
        // rects we work in the rect's local axes: project the diagonal onto
        // the local u (x-axis) and v (y-axis) vectors.
        const rot = s.rotation || 0;
        const rad = (rot * Math.PI) / 180;
        const cosR = Math.cos(rad), sinR = Math.sin(rad);
        // Local frame axes in screen coords (matches our rotatePoint convention)
        const ux = cosR,  uy = -sinR;
        const vx = sinR,  vy =  cosR;
        const cx0 = s.x + s.w / 2, cy0 = s.y + s.h / 2;
        const localToScreen = (px, py) => {
          const dx = px - cx0, dy = py - cy0;
          return {
            x: cx0 + dx * cosR + dy * sinR,
            y: cy0 - dx * sinR + dy * cosR,
          };
        };
        const localCorners = {
          tl: { x: s.x,         y: s.y         },
          tr: { x: s.x + s.w,   y: s.y         },
          br: { x: s.x + s.w,   y: s.y + s.h   },
          bl: { x: s.x,         y: s.y + s.h   },
        };
        const opposite = { tl: 'br', tr: 'bl', br: 'tl', bl: 'tr' }[endpointDrag.endpoint];
        if (!localCorners[endpointDrag.endpoint] || !opposite) return;
        const fixedScreen = localToScreen(localCorners[opposite].x, localCorners[opposite].y);
        const mouse = resolvePoint(e, fixedScreen);
        const ddx = mouse.x - fixedScreen.x;
        const ddy = mouse.y - fixedScreen.y;
        let signedW = ddx * ux + ddy * uy;
        let signedH = ddx * vx + ddy * vy;
        // Aspect-ratio constraint: images default to locked aspect (so a
        // floor-plan import isn't accidentally warped). Rects default to free.
        // Modifier reverses each: Shift FREES image aspect, Shift LOCKS rect.
        const baseLock = s.type === 'image';
        const lockAspect = e.shiftKey ? !baseLock : baseLock;
        if (lockAspect && s.w > 0 && s.h > 0) {
          const targetRatio = s.w / s.h;
          // Use the larger of |signedW| or |signedH * ratio| to set the size
          // along the dominant axis, then derive the other.
          const absW = Math.abs(signedW);
          const absH = Math.abs(signedH);
          if (absW / Math.max(targetRatio, 1e-9) >= absH) {
            signedH = Math.sign(signedH || 1) * (absW / targetRatio);
          } else {
            signedW = Math.sign(signedW || 1) * (absH * targetRatio);
          }
        }
        const newW = Math.max(0.5, Math.abs(signedW));
        const newH = Math.max(0.5, Math.abs(signedH));
        // New center: midpoint of fixed and the (possibly aspect-corrected) dragged point.
        const correctedDx = signedW * ux + signedH * vx;
        const correctedDy = signedW * uy + signedH * vy;
        const newCx = fixedScreen.x + correctedDx / 2;
        const newCy = fixedScreen.y + correctedDy / 2;
        const newX = newCx - newW / 2;
        const newY = newCy - newH / 2;
        setShapes(prev => prev.map(sh =>
          sh.id === endpointDrag.shapeId
            ? { ...sh, x: newX, y: newY, w: newW, h: newH }
            : sh
        ));
        return;
      }

      // Unknown shape type — ignore drag
      return;
    }
    if (dragSelect) {
      const p = svgPoint(e);
      setDragSelect(prev => prev ? { ...prev, current: p } : prev);
      return;
    }
    if (panStart.current && svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      // Defensive: if the SVG hasn't been laid out yet (zero size), bail
      // rather than dividing by zero and producing NaN/Infinity in viewBox,
      // which would render the canvas blank.
      if (rect.width <= 0 || rect.height <= 0) return;
      const dx = ((e.clientX - panStart.current.mx) / rect.width) * viewBox.w;
      const dy = ((e.clientY - panStart.current.my) / rect.height) * viewBox.h;
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      const nextX = panStart.current.vx - dx;
      const nextY = panStart.current.vy - dy;
      if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return;
      setViewBox(v => ({ ...v, x: nextX, y: nextY }));
      return;
    }
    // Determine ortho anchor for in-flight tools
    let orthoAnchor = null;
    if (draft) {
      if (draft.type === 'line') orthoAnchor = { x: draft.x1, y: draft.y1 };
      else if (draft.type === 'rect') orthoAnchor = { x: draft.x, y: draft.y };
      else if (draft.type === 'circle') orthoAnchor = { x: draft.cx, y: draft.cy };
    } else if (polyPending) {
      if (polyPending.type === 'polyline' && polyPending.points.length > 0) {
        orthoAnchor = polyPending.points[polyPending.points.length - 1];
      } else if (polyPending.type === 'dimension') {
        orthoAnchor = { x: polyPending.x1, y: polyPending.y1 };
      } else if (polyPending.type === 'bezier' && polyPending.stage === 1) {
        orthoAnchor = { x: polyPending.x1, y: polyPending.y1 };
      }
    } else if (moving) {
      orthoAnchor = { x: moving.startX, y: moving.startY };
    } else if (offsetMode) {
      orthoAnchor = offsetAnchor;
    }
    // Track cursor for block-insert preview
    if (insertBlockId) {
      const p = resolvePoint(e, orthoAnchor);
      setPreviewPoint(p);
      return;
    }
    // Track mouse for offset preview
    if (offsetMode) {
      const p = resolvePoint(e, orthoAnchor);
      setPreviewPoint(p);
      return;
    }
    // Mirror preview
    if (mirrorMode) {
      const p = resolvePoint(e, orthoAnchor);
      setPreviewPoint(p);
      return;
    }
    // Parametric input: track cursor for direction
    if (paramInput) {
      const p = resolvePoint(e, orthoAnchor);
      setPreviewPoint(p);
      setParamInput(prev => prev ? { ...prev, cursor: p } : prev);
      return;
    }
    // Dragging a shape (move)
    if (moving) {
      const p = resolvePoint(e, orthoAnchor);
      const dx = p.x - moving.startX;
      const dy = p.y - moving.startY;
      setShapes(prev => prev.map(s => {
        const original = moving.originalById[s.id];
        return original ? translateShape(original, dx, dy) : s;
      }));
      return;
    }
    // Freehand stroke (no snap/ortho — purpose is to be organic)
    if (freehandPoints) {
      const p = svgPoint(e);
      const last = freehandPoints[freehandPoints.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 2) {
        setFreehandPoints(prev => [...prev, p]);
      }
      return;
    }
    if (polyPending) {
      const p = resolvePoint(e, orthoAnchor);
      setPreviewPoint(p);
      return;
    }
    if (!draft) {
      // Idle: still show snap indicator under cursor
      if (snapEnabled) {
        const svg = svgRef.current;
        if (svg) {
          const rect = svg.getBoundingClientRect();
          const rawX = viewBox.x + ((e.clientX - rect.left) / rect.width) * viewBox.w;
          const rawY = viewBox.y + ((e.clientY - rect.top) / rect.height) * viewBox.h;
          const hit = findSnap({ x: rawX, y: rawY }, snapPointsCache, worldSnapTolerance());
          setSnapHit(hit);
        }
      }
      return;
    }
    const p = resolvePoint(e, orthoAnchor);
    if (draft.type === 'line') setDraft({ ...draft, x2: p.x, y2: p.y });
    if (draft.type === 'rect') setDraft({ ...draft, w: p.x - draft.x, h: p.y - draft.y });
    if (draft.type === 'circle') {
      const r = Math.hypot(p.x - draft.cx, p.y - draft.cy);
      setDraft({ ...draft, r });
    }
  }

  function handleMouseUp() {
    if (panStart.current) { panStart.current = null; return; }
    if (endpointDrag) {
      // Commit a single history entry IF the shape actually changed vs the
      // pre-drag snapshot. Use JSON equality on the shape itself; cheap and
      // works for any shape type without per-type comparison code.
      const snap = endpointDrag.preDragSnap;
      const before = snap.shapes.find(s => s.id === endpointDrag.shapeId);
      const after = shapeById.get(endpointDrag.shapeId);
      const moved = before && after && JSON.stringify(before) !== JSON.stringify(after);
      if (moved) {
        setHistoryPast(prev => {
          const next = [...prev, snap];
          while (next.length > HISTORY_MAX) next.shift();
          return next;
        });
        setHistoryFuture([]);
        setDirty(true);
      }
      setEndpointDrag(null);
      return;
    }
    if (dragSelect) {
      const { start, current, additive } = dragSelect;
      const selRect = {
        minX: Math.min(start.x, current.x),
        maxX: Math.max(start.x, current.x),
        minY: Math.min(start.y, current.y),
        maxY: Math.max(start.y, current.y),
      };
      const w = selRect.maxX - selRect.minX, h = selRect.maxY - selRect.minY;
      if (w < 4 && h < 4) {
        setDragSelect(null);
        return;
      }
      // L→R = window mode (fully enclosed); R→L = crossing mode (any overlap)
      const mode = (current.x >= start.x) ? 'window' : 'crossing';
      const hits = shapes.filter(s => isShapeInteractable(s) && shapeIntersectsRect(s, selRect, blocks, mode));
      const ids = hits.map(s => s.id);
      if (additive) {
        const merged = Array.from(new Set([...selectedIds, ...ids]));
        setSelectedIds(merged);
      } else {
        setSelectedIds(ids);
      }
      setDragSelect(null);
      return;
    }
    if (moving) {
      const ids = Object.keys(moving.originalById);
      let actuallyMoved = false;
      for (const id of ids) {
        const original = moving.originalById[id];
        const current = shapeById.get(id);
        if (!current) continue;
        if (current.type === 'rect' && (current.x !== original.x || current.y !== original.y)) actuallyMoved = true;
        else if (current.type === 'circle' && (current.cx !== original.cx || current.cy !== original.cy)) actuallyMoved = true;
        else if ((current.type === 'line' || current.type === 'dimension') && (current.x1 !== original.x1 || current.y1 !== original.y1)) actuallyMoved = true;
        else if (current.type === 'text' && (current.x !== original.x || current.y !== original.y)) actuallyMoved = true;
        else if (current.type === 'bezier' && (current.x1 !== original.x1 || current.y1 !== original.y1)) actuallyMoved = true;
        else if (current.type === 'instance' && (current.x !== original.x || current.y !== original.y)) actuallyMoved = true;
        else if ((current.type === 'polyline' || current.type === 'freehand') && current.points[0] && original.points[0] && (current.points[0].x !== original.points[0].x || current.points[0].y !== original.points[0].y)) actuallyMoved = true;
      }
      if (actuallyMoved) {
        if (moving.preDragSnap) {
          setHistoryPast(prev => {
            const next = [...prev, moving.preDragSnap];
            while (next.length > HISTORY_MAX) next.shift();
            return next;
          });
          setHistoryFuture([]);
        }
        setDirty(true);
      }
      setMoving(null);
      return;
    }
    if (freehandPoints) {
      if (freehandPoints.length >= 2) {
        pushHistory();
        const id = 'sh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        setShapes(prev => [...prev, {
          id, type: 'freehand',
          points: freehandPoints,
          stroke: color, strokeWidth,
          fill: 'none',
          layer: activeLayerId,
        }]);
        setDirty(true);
      }
      setFreehandPoints(null);
      return;
    }
    if (!draft) return;
    let final = draft;
    if (draft.type === 'rect' && (draft.w < 0 || draft.h < 0)) {
      final = {
        ...draft,
        x: draft.w < 0 ? draft.x + draft.w : draft.x,
        y: draft.h < 0 ? draft.y + draft.h : draft.y,
        w: Math.abs(draft.w),
        h: Math.abs(draft.h),
      };
    }
    const isZero = (final.type === 'line' && final.x1 === final.x2 && final.y1 === final.y2)
                || (final.type === 'rect' && (final.w === 0 || final.h === 0))
                || (final.type === 'circle' && final.r === 0);
    if (!isZero) {
      pushHistory();
      setShapes(prev => [...prev, final]);
      setDirty(true);
    }
    setDraft(null);
  }

  function hitTest(s, p, tolOverride) {
    // Tolerance scales with zoom — 10 screen pixels in world units by default.
    // Without this, zoomed-out shapes are nearly impossible to click and zoomed-in
    // shapes accept clicks from absurdly far away. tolOverride lets callers ask
    // for a larger tolerance (e.g. a lenient second-pass after a strict miss).
    const screenPxToWorld = (svgRef.current?.getBoundingClientRect().width || 1);
    const tol = tolOverride != null
      ? tolOverride
      : Math.max(3, (10 * viewBox.w) / screenPxToWorld);
    if (s.type === 'instance') {
      const sub = expandInstance(s, blocks);
      if (Math.hypot(p.x - s.x, p.y - s.y) <= tol * 2) return true;
      return sub.some(es => hitTest(es, p));
    }
    if (s.type === 'line') {
      const { x1, y1, x2, y2 } = s;
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = dx*dx + dy*dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x-x1)*dx + (p.y-y1)*dy) / len2));
      const px = x1 + t*dx, py = y1 + t*dy;
      return Math.hypot(p.x - px, p.y - py) <= tol;
    }
    if (s.type === 'image') {
      // Images are clickable anywhere inside their (rotated) bounds, not just
      // on the edge — they're filled raster content, so users expect the whole
      // thing to be a hit target.
      const rot = s.rotation || 0;
      let lp = p;
      if (rot !== 0) {
        const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
        const rad = (-rot * Math.PI) / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const dx = p.x - cx, dy = p.y - cy;
        lp = { x: cx + dx * cos + dy * sin, y: cy - dx * sin + dy * cos };
      }
      return lp.x >= s.x - tol && lp.x <= s.x + s.w + tol
          && lp.y >= s.y - tol && lp.y <= s.y + s.h + tol;
    }
    if (s.type === 'rect') {
      const rot = s.rotation || 0;
      let lp = p;
      if (rot !== 0) {
        const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
        // Inverse-rotate the click point into the rect's local frame
        const rad = (-rot * Math.PI) / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const dx = p.x - cx, dy = p.y - cy;
        lp = { x: cx + dx * cos + dy * sin, y: cy - dx * sin + dy * cos };
      }
      const on = (a, b) => Math.abs(a - b) <= tol;
      const inX = lp.x >= s.x - tol && lp.x <= s.x + s.w + tol;
      const inY = lp.y >= s.y - tol && lp.y <= s.y + s.h + tol;
      if (!inX || !inY) return false;
      return on(lp.x, s.x) || on(lp.x, s.x + s.w) || on(lp.y, s.y) || on(lp.y, s.y + s.h);
    }
    if (s.type === 'circle') {
      const d = Math.hypot(p.x - s.cx, p.y - s.cy);
      return Math.abs(d - s.r) <= tol;
    }
    if (s.type === 'polyline') {
      if (!s.points) return false;
      // hit if near any segment
      for (let i = 0; i < s.points.length - 1; i++) {
        const a = s.points[i], b = s.points[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx*dx + dy*dy || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
        const px = a.x + t * dx, py = a.y + t * dy;
        if (Math.hypot(p.x - px, p.y - py) <= tol) return true;
      }
      return false;
    }
    if (s.type === 'dimension') {
      const { x1, y1, x2, y2 } = s;
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = dx*dx + dy*dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x-x1)*dx + (p.y-y1)*dy) / len2));
      const px = x1 + t*dx, py = y1 + t*dy;
      return Math.hypot(p.x - px, p.y - py) <= tol;
    }
    if (s.type === 'text') {
      // approximate bbox: ~0.6 * fontSize per char, fontSize tall, centered vertically
      const fs = s.fontSize || 18;
      const w = (s.text?.length || 1) * fs * 0.6;
      return p.x >= s.x - tol && p.x <= s.x + w + tol
          && p.y >= s.y - fs/2 - tol && p.y <= s.y + fs/2 + tol;
    }
    if (s.type === 'bezier') {
      // Sample 30 points along the quadratic curve and check distance
      for (let i = 0; i <= 30; i++) {
        const t = i / 30;
        const mt = 1 - t;
        const x = mt*mt*s.x1 + 2*mt*t*s.cx + t*t*s.x2;
        const y = mt*mt*s.y1 + 2*mt*t*s.cy + t*t*s.y2;
        if (Math.hypot(p.x - x, p.y - y) <= tol) return true;
      }
      return false;
    }
    if (s.type === 'freehand') {
      if (!s.points) return false;
      for (let i = 0; i < s.points.length - 1; i++) {
        const a = s.points[i], b = s.points[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx*dx + dy*dy || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
        const px = a.x + t * dx, py = a.y + t * dy;
        if (Math.hypot(p.x - px, p.y - py) <= tol) return true;
      }
      return false;
    }
    return false;
  }

  // ─── Trim ───
  // Click on a line. Find the click parameter tClick along the line, and the two intersection
  // params (with other lines) closest to tClick on either side. Remove the segment between
  // those bounds. If only one bound exists, just shorten that end. If none, do nothing.
  function handleTrimClick(p) {
    // Find line under cursor
    const target = [...shapes].reverse().find(s =>
      s.type === 'line' && isShapeInteractable(s) && hitTest(s, p)
    );
    if (!target) return;

    const a1 = { x: target.x1, y: target.y1 };
    const a2 = { x: target.x2, y: target.y2 };
    const dx = a2.x - a1.x, dy = a2.y - a1.y;
    const len2 = dx*dx + dy*dy || 1;
    const tClick = ((p.x - a1.x) * dx + (p.y - a1.y) * dy) / len2;

    // Collect all intersection parameters with other lines that lie within target's segment
    const intersections = [];
    for (const other of shapes) {
      if (other.id === target.id) continue;
      if (other.type !== 'line') continue;
      if (!isShapeVisible(other)) continue;
      const b1 = { x: other.x1, y: other.y1 };
      const b2 = { x: other.x2, y: other.y2 };
      const xx = lineIntersect(a1, a2, b1, b2);
      if (!xx) continue;
      // Must lie on the OTHER segment (0..1) and on TARGET segment (0..1)
      if (xx.tA <= 0 || xx.tA >= 1) continue;
      if (xx.tB < -1e-6 || xx.tB > 1 + 1e-6) continue;
      intersections.push(xx.tA);
    }

    if (intersections.length === 0) return; // no cutter

    pushHistory();

    // Find bounds: nearest intersection below tClick and nearest above
    let lower = null, upper = null;
    for (const t of intersections) {
      if (t < tClick) { if (lower === null || t > lower) lower = t; }
      if (t > tClick) { if (upper === null || t < upper) upper = t; }
    }

    setShapes(prev => {
      const next = prev.filter(s => s.id !== target.id);
      const rid = () => 'sh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      if (lower !== null && upper !== null) {
        // Split into two pieces: [0, lower] and [upper, 1]
        const pLow = { x: a1.x + lower * dx, y: a1.y + lower * dy };
        const pUp = { x: a1.x + upper * dx, y: a1.y + upper * dy };
        next.push({ ...target, id: rid(), x2: pLow.x, y2: pLow.y });
        next.push({ ...target, id: rid(), x1: pUp.x, y1: pUp.y });
      } else if (upper !== null) {
        // Click was before the first intersection: keep right side
        const pUp = { x: a1.x + upper * dx, y: a1.y + upper * dy };
        next.push({ ...target, x1: pUp.x, y1: pUp.y });
      } else if (lower !== null) {
        // Click was after the last intersection: keep left side
        const pLow = { x: a1.x + lower * dx, y: a1.y + lower * dy };
        next.push({ ...target, x2: pLow.x, y2: pLow.y });
      }
      return next;
    });
    setDirty(true);
  }

  // ─── Extend ───
  // Stage 1: click near an endpoint of a line — store which endpoint.
  // Stage 2: click a target line — extend the chosen endpoint to the intersection with target.
  function handleExtendClick(p) {
    if (!extendMode || extendMode.stage === 'pickEnd') {
      // Find the nearest line endpoint to p
      let best = null, bestD = worldSnapTolerance() * 3;
      for (const s of shapes) {
        if (s.type !== 'line') continue;
        if (!isShapeInteractable(s)) continue;
        const dStart = Math.hypot(p.x - s.x1, p.y - s.y1);
        const dEnd = Math.hypot(p.x - s.x2, p.y - s.y2);
        if (dStart < bestD) { bestD = dStart; best = { shape: s, endpoint: 'start' }; }
        if (dEnd < bestD) { bestD = dEnd; best = { shape: s, endpoint: 'end' }; }
      }
      if (best) {
        setExtendMode({ stage: 'pickTarget', shapeId: best.shape.id, endpoint: best.endpoint });
      }
      return;
    }
    if (extendMode.stage === 'pickTarget') {
      const src = shapeById.get(extendMode.shapeId);
      if (!src) { setExtendMode(null); return; }
      const target = [...shapes].reverse().find(s =>
        s.id !== src.id && s.type === 'line' && isShapeInteractable(s) && hitTest(s, p)
      );
      if (!target) return;
      const xx = lineIntersect(
        { x: src.x1, y: src.y1 }, { x: src.x2, y: src.y2 },
        { x: target.x1, y: target.y1 }, { x: target.x2, y: target.y2 }
      );
      if (!xx) return;
      pushHistory();
      const newPoint = { x: xx.x, y: xx.y };
      setShapes(prev => prev.map(s => {
        if (s.id !== src.id) return s;
        if (extendMode.endpoint === 'start') return { ...s, x1: newPoint.x, y1: newPoint.y };
        return { ...s, x2: newPoint.x, y2: newPoint.y };
      }));
      setDirty(true);
      setExtendMode(null);
    }
  }

  function currentAnchor() {
    if (draft) {
      if (draft.type === 'line') return { x: draft.x1, y: draft.y1 };
      if (draft.type === 'rect') return { x: draft.x, y: draft.y };
      if (draft.type === 'circle') return { x: draft.cx, y: draft.cy };
    }
    if (polyPending) {
      if (polyPending.type === 'polyline' && polyPending.points.length > 0)
        return polyPending.points[polyPending.points.length - 1];
      if (polyPending.type === 'dimension') return { x: polyPending.x1, y: polyPending.y1 };
      if (polyPending.type === 'bezier' && polyPending.stage === 1)
        return { x: polyPending.x1, y: polyPending.y1 };
    }
    return null;
  }

  function commitParametric() {
    if (!paramInput) return;
    const parsed = parseParametric(paramInput.value);
    if (!parsed) { setParamInput(null); return; }
    const target = applyParametric(parsed, paramInput.anchor, paramInput.cursor, pxPerUnit);
    if (!target) { setParamInput(null); return; }

    // Push history once for whichever branch commits. (Polyline-extend and bezier
    // stage-1 advancement don't add a final shape, but they still produce a state
    // change worth tracking in history.)
    pushHistory();

    // Apply target to current draft/polyPending
    if (draft) {
      if (draft.type === 'line') {
        const final = { ...draft, x2: target.x, y2: target.y };
        if (final.x1 !== final.x2 || final.y1 !== final.y2) {
          setShapes(prev => [...prev, final]);
          setDirty(true);
        }
        setDraft(null);
      } else if (draft.type === 'rect') {
        const w = target.x - draft.x, h = target.y - draft.y;
        let final = { ...draft, w, h };
        if (final.w < 0 || final.h < 0) {
          final = {
            ...final,
            x: final.w < 0 ? final.x + final.w : final.x,
            y: final.h < 0 ? final.y + final.h : final.y,
            w: Math.abs(final.w), h: Math.abs(final.h),
          };
        }
        if (final.w > 0 && final.h > 0) {
          setShapes(prev => [...prev, final]);
          setDirty(true);
        }
        setDraft(null);
      } else if (draft.type === 'circle') {
        const r = Math.hypot(target.x - draft.cx, target.y - draft.cy);
        if (r > 0) {
          setShapes(prev => [...prev, { ...draft, r }]);
          setDirty(true);
        }
        setDraft(null);
      }
    } else if (polyPending) {
      if (polyPending.type === 'polyline') {
        setPolyPending({ ...polyPending, points: [...polyPending.points, target] });
      } else if (polyPending.type === 'dimension') {
        const final = { ...polyPending, x2: target.x, y2: target.y };
        const len = Math.hypot(final.x2 - final.x1, final.y2 - final.y1);
        if (len > 0) {
          setShapes(prev => [...prev, final]);
          setDirty(true);
        }
        setPolyPending(null);
      } else if (polyPending.type === 'bezier' && polyPending.stage === 1) {
        setPolyPending({ ...polyPending, stage: 2, x2: target.x, y2: target.y });
      }
    }
    setParamInput(null);
  }

  function startOffset() {
    if (!selectedId) return;
    const sel = shapeById.get(selectedId);
    if (!sel) return;
    // Anchor = a natural reference point on the shape
    let anchor;
    switch (sel.type) {
      case 'instance': anchor = { x: sel.x, y: sel.y }; break;
      case 'rect': anchor = { x: sel.x + sel.w / 2, y: sel.y + sel.h / 2 }; break;
      case 'circle': anchor = { x: sel.cx, y: sel.cy }; break;
      case 'line':
      case 'dimension': anchor = { x: (sel.x1 + sel.x2) / 2, y: (sel.y1 + sel.y2) / 2 }; break;
      case 'bezier': anchor = { x: (sel.x1 + sel.x2) / 2, y: (sel.y1 + sel.y2) / 2 }; break;
      case 'text': anchor = { x: sel.x, y: sel.y }; break;
      case 'polyline':
      case 'freehand': anchor = sel.points[0]; break;
      default: anchor = { x: 0, y: 0 };
    }
    setOffsetAnchor(anchor);
    setOffsetMode(true);
    setTool('select');
  }

  function offsetByVector(dx, dy) {
    if (!selectedId) return;
    const original = shapeById.get(selectedId);
    if (!original) return;
    pushHistory();
    const copy = cloneShapeWithNewId(translateShape(original, dx, dy));
    copy.layer = activeLayerId;
    setShapes(prev => [...prev, copy]);
    setSelectedId(copy.id);
    setDirty(true);
  }

  function duplicateSelected() {
    if (selectedIds.length === 0) return;
    const newCopies = [];
    for (const id of selectedIds) {
      const original = shapeById.get(id);
      if (!original) continue;
      const copy = cloneShapeWithNewId(translateShape(original, 20, 20));
      copy.layer = activeLayerId;
      newCopies.push(copy);
    }
    if (newCopies.length === 0) return;
    pushHistory();
    setShapes(prev => [...prev, ...newCopies]);
    setSelectedIds(newCopies.map(c => c.id));
    setDirty(true);
  }

  // Layer ops
  function addLayer() {
    pushHistory();
    const n = layers.length + 1;
    const newL = { id: 'l_' + Date.now(), name: `Layer ${n}`, color: '#e8eaf0', visible: true, locked: false };
    setLayers(prev => [...prev, newL]);
    setActiveLayerId(newL.id);
    setDirty(true);
  }
  function deleteLayer(id) {
    if (layers.length <= 1) return;
    if (!window.confirm('Delete this layer and all its shapes?')) return;
    pushHistory();
    setShapes(prev => prev.filter(s => (s.layer || 'default') !== id));
    setLayers(prev => prev.filter(l => l.id !== id));
    if (activeLayerId === id) {
      const remaining = layers.filter(l => l.id !== id);
      setActiveLayerId(remaining[0].id);
    }
    setDirty(true);
  }
  function toggleLayerVisible(id) {
    pushHistory();
    setLayers(prev => prev.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
    setDirty(true);
  }
  function toggleLayerLocked(id) {
    pushHistory();
    setLayers(prev => prev.map(l => l.id === id ? { ...l, locked: !l.locked } : l));
    setDirty(true);
  }
  function renameLayer(id, name) {
    pushHistory();
    setLayers(prev => prev.map(l => l.id === id ? { ...l, name } : l));
    setDirty(true);
  }

  function finalizePoly() {
    if (!polyPending) return;
    if (polyPending.type === 'polyline' && polyPending.points.length >= 2) {
      pushHistory();
      setShapes(prev => [...prev, polyPending]);
      setDirty(true);
    }
    setPolyPending(null);
    setPreviewPoint(null);
  }

  function cancelPoly() {
    setPolyPending(null);
    setPreviewPoint(null);
  }

  function deleteSelected() {
    if (selectedIds.length === 0) return;
    pushHistory();
    const idSet = new Set(selectedIds);
    setShapes(prev => prev.filter(s => !idSet.has(s.id)));
    setSelectedIds([]);
    setDirty(true);
  }

  function clearAll() {
    if (!window.confirm('Clear all shapes?')) return;
    pushHistory();
    setShapes([]);
    setSelectedIds([]);
    setDirty(true);
  }

  useEffect(() => {
    function onKey(e) {
      if (!active) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Parametric input: typing digit/minus while an anchor exists opens the input.
      // Subsequent keypresses while paramInput is open are intercepted by the input itself.
      if (!paramInput && !showArrayDialog && !showRotateDialog && !showScaleDialog && !editingTextId
          && (e.key.match(/^[0-9.-]$/) || e.key === ',' || e.key === '<')) {
        const anchor = currentAnchor();
        if (anchor) {
          e.preventDefault();
          // Use last known cursor for direction (previewPoint, or anchor itself as fallback)
          setParamInput({ value: e.key, anchor, cursor: previewPoint || anchor });
          return;
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (dirty && !saving && !blockEditMode) saveDrawing();
      }
      if ((e.ctrlKey || e.metaKey) && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) { e.preventDefault(); redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && selectedId) { e.preventDefault(); duplicateSelected(); }
      // Bare-letter shortcuts: skip when Ctrl/Cmd is held so browser shortcuts
      // (Ctrl+R reload, Ctrl+F find, Ctrl+D bookmark, etc.) work normally and
      // don't silently flip the active tool.
      if (!e.ctrlKey && !e.metaKey) {
        if (e.key === 'v') setTool('select');
        if (e.key === 'l') setTool('line');
        if (e.key === 'r') setTool('rect');
        if (e.key === 'c') setTool('circle');
        if (e.key === 'p') setTool('polyline');
        if (e.key === 'd') setTool('dimension');
        if (e.key === 't') setTool('text');
        if (e.key === 'a') setTool('bezier');
        if (e.key === 'f') setTool('freehand');
        if (e.key === 'z') fitToView();
        if (e.key === 'o' && selectedId) startOffset();
      }
      if (e.key === 'Enter') { e.preventDefault(); finalizePoly(); }
      if (e.key === 'Escape') {
        // If editing a block, Escape cancels the edit (discards changes).
        // Do this first since other state may also be set during a block edit.
        if (blockEditMode) {
          exitBlockEdit(false);
          return;
        }
        setSelectedId(null); setDraft(null); cancelPoly(); setEditingTextId(null);
        if (offsetMode) { setOffsetMode(false); setOffsetAnchor(null); }
        if (trimMode) setTrimMode(false);
        if (extendMode) setExtendMode(null);
        if (mirrorMode) setMirrorMode(null);
        if (calibrateMode) setCalibrateMode(null);
        if (paramInput) setParamInput(null);
        if (insertBlockId) setInsertBlockId(null);
        if (panMode) setPanMode(false);
        if (moving) {
          // Revert in-progress drag to original positions
          setShapes(prev => prev.map(s => moving.originalById[s.id] || s));
          setMoving(null);
        }
        if (freehandPoints) setFreehandPoints(null);
        if (dragSelect) setDragSelect(null);
        if (endpointDrag) {
          // Revert in-progress endpoint drag back to its pre-drag state
          const snap = endpointDrag.preDragSnap;
          setShapes(snap.shapes);
          setEndpointDrag(null);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line

  // Global mouseup: if the user releases the button OUTSIDE the SVG (e.g.
  // dragged a pan past the canvas edge and let go in the toolbar / outside
  // the window), the SVG's onMouseUp never fires. Without this listener
  // panStart.current stays non-null and a subsequent mouseenter+move would
  // misbehave. We always clear pan state here as a safety net.
  useEffect(() => {
    function onWindowMouseUp() {
      if (panStart.current) panStart.current = null;
      // If an endpoint drag is in flight but the release happened outside the
      // SVG, we'd otherwise leak the drag state. Clear it here as a safety
      // net so the next click starts cleanly.
      setEndpointDrag(prev => prev ? null : prev);
    }
    window.addEventListener('mouseup', onWindowMouseUp);
    window.addEventListener('blur', onWindowMouseUp);
    return () => {
      window.removeEventListener('mouseup', onWindowMouseUp);
      window.removeEventListener('blur', onWindowMouseUp);
    };
  }, []);

  // Self-healing viewBox: if any code path ever lands an invalid viewBox
  // into state (NaN, Infinity, zero size), snap back to a sane view so the
  // user isn't stuck staring at a blank canvas needing a page reload.
  useEffect(() => {
    const { x, y, w, h } = viewBox;
    const bad = !Number.isFinite(x) || !Number.isFinite(y) ||
                !Number.isFinite(w) || !Number.isFinite(h) ||
                w <= 0 || h <= 0;
    if (bad) {
      setViewBox({ x: 0, y: 0, w: 1200, h: 800 });
    }
  }, [viewBox]);

  function handleWheel(e) {
    e.preventDefault();
    if (!svgRef.current) return;
    // Cancel any in-flight pan — combining pan with wheel-zoom is
    // incoherent because panStart's captured (vx, vy) becomes stale after
    // the zoom changes the viewBox. Just end the pan so the next mousedown
    // starts a clean one.
    if (panStart.current) panStart.current = null;
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const mx = viewBox.x + ((e.clientX - rect.left) / rect.width) * viewBox.w;
    const my = viewBox.y + ((e.clientY - rect.top) / rect.height) * viewBox.h;
    const next = {
      x: mx - (mx - viewBox.x) * factor,
      y: my - (my - viewBox.y) * factor,
      w: viewBox.w * factor,
      h: viewBox.h * factor,
    };
    if (!Number.isFinite(next.x) || !Number.isFinite(next.y) ||
        !Number.isFinite(next.w) || !Number.isFinite(next.h) ||
        next.w <= 0 || next.h <= 0) return;
    setViewBox(next);
  }

  async function newDrawing() {
    try {
      const { data, error } = await supabase.from('drawings').insert({
        user_id: userId, title: 'Untitled Drawing', shapes: []
      }).select().single();
      if (error) {
        window.alert(`Could not create drawing: ${error.message}.`);
        return;
      }
      if (data) {
        setDrawings(prev => [data, ...prev]);
        setActiveId(data.id);
      }
    } catch (err) {
      window.alert(`Could not create drawing: ${err.message}.`);
    }
  }

  async function saveDrawing() {
    if (!active) return;
    if (blockEditMode) {
      window.alert('Finish editing the block first (click Done or Cancel), then save.');
      return;
    }
    setSaving(true);
    const payload = { shapes, layers };
    // Size check — image data URLs balloon the row. Compute size from the
    // actual payload sent to Supabase (title/units/px_per_unit/shapes/blocks).
    // Warn (but allow) at 4 MB; Supabase REST request body limits + network
    // reliability degrade above this for typical connections.
    const fullPayload = { title, units, px_per_unit: pxPerUnit, shapes: payload, blocks };
    const serialized = JSON.stringify(fullPayload);
    const sizeMB = serialized.length / (1024 * 1024);
    if (sizeMB > 4) {
      const ok = window.confirm(
        `This drawing is large (${sizeMB.toFixed(1)} MB), mostly due to embedded reference images. ` +
        `Save may be slow or fail. Consider deleting unused images or lowering their resolution.\n\n` +
        `Save anyway?`
      );
      if (!ok) { setSaving(false); return; }
    }
    try {
      const { data, error } = await supabase.from('drawings').update({
        title, units, px_per_unit: pxPerUnit, shapes: payload, blocks
      }).eq('id', active.id).select().single();
      if (error) {
        window.alert(`Save failed: ${error.message}. Your work is still here — try again in a moment.`);
      } else if (data) {
        setDrawings(prev => prev.map(d => d.id === data.id ? data : d));
        setDirty(false);
      }
    } catch (err) {
      window.alert(`Save failed: ${err.message}. Your work is still here — try again in a moment.`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteDrawing(id) {
    if (!window.confirm('Delete this drawing?')) return;
    try {
      const { error } = await supabase.from('drawings').delete().eq('id', id);
      if (error) {
        window.alert(`Delete failed: ${error.message}. The drawing is still here — try again in a moment.`);
        return;
      }
      setDrawings(prev => prev.filter(d => d.id !== id));
      if (activeId === id) setActiveId(null);
    } catch (err) {
      window.alert(`Delete failed: ${err.message}. The drawing is still here — try again in a moment.`);
    }
  }

  function exportPNG() {
    if (!svgRef.current) return;
    const svgEl = svgRef.current.cloneNode(true);
    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', viewBox.x);
    bg.setAttribute('y', viewBox.y);
    bg.setAttribute('width', viewBox.w);
    bg.setAttribute('height', viewBox.h);
    bg.setAttribute('fill', 'white');
    svgEl.insertBefore(bg, svgEl.firstChild);
    svgEl.querySelectorAll('[stroke]').forEach(n => {
      const s = n.getAttribute('stroke');
      if (s === '#e8eaf0') n.setAttribute('stroke', '#111');
    });
    const xml = new XMLSerializer().serializeToString(svgEl);
    const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = 2;
      canvas.width = viewBox.w * scale;
      canvas.height = viewBox.h * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${title.replace(/[^a-z0-9]+/gi, '_')}.png`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      }, 'image/png');
    };
    img.src = url;
  }

  function resetView() {
    setViewBox({ x: 0, y: 0, w: 1200, h: 800 });
  }

  function fitToView() {
    const visibleShapes = shapes.filter(isShapeVisible);
    const bbox = unionBoundingBox(visibleShapes, blocks);
    const svg = svgRef.current;
    const aspect = svg ? (svg.getBoundingClientRect().width / svg.getBoundingClientRect().height) : 1.5;
    setViewBox(fitViewBox(bbox, aspect));
  }

  function getExportShapes() {
    const out = [];
    for (const s of shapes) {
      if (!isShapeVisible(s)) continue;
      if (s.type === 'instance') {
        out.push(...expandInstance(s, blocks));
      } else {
        out.push(s);
      }
    }
    return out;
  }

  function exportDXF() {
    const dxfText = dxfWrite(getExportShapes());
    const blob = new Blob([dxfText], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]+/gi, '_')}.dxf`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function handleDxfImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        const imported = dxfParse(text);
        if (imported.length === 0) {
          window.alert('No supported entities found in the DXF file. Currently supported: LINE, LWPOLYLINE, CIRCLE, TEXT.');
          return;
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const s of imported) {
          if (s.type === 'line') { minX = Math.min(minX, s.x1, s.x2); minY = Math.min(minY, s.y1, s.y2); maxX = Math.max(maxX, s.x1, s.x2); maxY = Math.max(maxY, s.y1, s.y2); }
          else if (s.type === 'rect') { minX = Math.min(minX, s.x); minY = Math.min(minY, s.y); maxX = Math.max(maxX, s.x + s.w); maxY = Math.max(maxY, s.y + s.h); }
          else if (s.type === 'circle') { minX = Math.min(minX, s.cx - s.r); minY = Math.min(minY, s.cy - s.r); maxX = Math.max(maxX, s.cx + s.r); maxY = Math.max(maxY, s.cy + s.r); }
          else if (s.type === 'polyline') { for (const p of s.points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); } }
          else if (s.type === 'text') { minX = Math.min(minX, s.x); minY = Math.min(minY, s.y); maxX = Math.max(maxX, s.x + 50); maxY = Math.max(maxY, s.y + 20); }
        }
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        const dx = 600 - cx, dy = 400 - cy;
        const adjusted = imported.map(s => ({ ...translateShape(s, dx, dy), layer: activeLayerId }));
        pushHistory();
        setShapes(prev => [...prev, ...adjusted]);
        setDirty(true);
        window.alert(`Imported ${adjusted.length} shape${adjusted.length === 1 ? '' : 's'} from DXF.`);
      } catch (err) {
        window.alert('Failed to parse DXF file: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // Import a raster (PNG/JPG/WebP) or PDF as an image shape. PDFs are rasterized
  // to a PNG data URL via pdf.js (page 1 only; users can re-import for other
  // pages). Images land at the viewBox center, sized so longest dimension is
  // ~60% of the visible area. Goes onto its own "Reference" layer (created if
  // needed), locked so it doesn't interfere with snapping while drafting.
  async function handleImageImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const filename = file.name || 'image';
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const isPdf = ext === 'pdf' || file.type === 'application/pdf';
    try {
      let dataUrl, nativeW, nativeH;
      if (isPdf) {
        // Rasterize page 1 of the PDF at a resolution that gives reasonable
        // tracing quality (~1500px on the long edge) without blowing up file size.
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        const page = await pdf.getPage(1);
        const baseViewport = page.getViewport({ scale: 1 });
        const longEdge = Math.max(baseViewport.width, baseViewport.height);
        const targetLong = 1500;
        const scale = Math.min(3, Math.max(1, targetLong / longEdge));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d');
        // White background — most PDFs are transparent and would render black on dark mode
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        nativeW = canvas.width;
        nativeH = canvas.height;
        if (pdf.numPages > 1) {
          // Inform the user we only got page 1; not blocking
          setTimeout(() => window.alert(`Imported page 1 of ${pdf.numPages}. To import another page, re-import and we'll add a page selector in a future update.`), 100);
        }
      } else if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) || file.type.startsWith('image/')) {
        // Read straight to data URL, then load to get native dimensions
        dataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => reject(new Error('Could not read file'));
          r.readAsDataURL(file);
        });
        const img = await new Promise((resolve, reject) => {
          const i = new Image();
          i.onload = () => resolve(i);
          i.onerror = () => reject(new Error('Image failed to load — file may be corrupt or unsupported'));
          i.src = dataUrl;
        });
        nativeW = img.naturalWidth;
        nativeH = img.naturalHeight;
      } else {
        window.alert(`Unsupported file type: ${ext || file.type}. Use PDF, PNG, JPG, or WebP.`);
        e.target.value = '';
        return;
      }

      // Place the image at the viewBox center, scaled so its longest dimension
      // is ~60% of the viewBox's longest dimension. The user can rescale
      // freely afterward, or use Calibrate to set real-world scale.
      const vbLong = Math.max(viewBox.w, viewBox.h);
      const imgLong = Math.max(nativeW, nativeH);
      const placeScale = (vbLong * 0.6) / imgLong;
      const w = nativeW * placeScale;
      const h = nativeH * placeScale;
      const cx = viewBox.x + viewBox.w / 2;
      const cy = viewBox.y + viewBox.h / 2;

      // Ensure there's a "Reference" layer for imported images. Use a
      // functional setLayers so two rapid imports (the second running before
      // React has flushed the first's setLayers) don't both create a new
      // layer. We assign the new layer's id BEFORE setLayers in case we
      // create it; the functional update is the source of truth for whether
      // it actually gets added.
      const refLayerCandidateId = 'l_ref_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      let refLayerIdToUse = refLayerCandidateId;
      const refLayerCandidate = {
        id: refLayerCandidateId,
        name: 'Reference',
        color: '#888888',
        visible: true,
        locked: false,
      };
      // Check current state (closure) for the most-likely-correct id to assign
      // to the image. setLayers below will reconcile if the closure was stale.
      const existingInClosure = layers.find(l => l.name === 'Reference');
      if (existingInClosure) refLayerIdToUse = existingInClosure.id;

      const id = 'sh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      const newImage = {
        id,
        type: 'image',
        src: dataUrl,
        x: cx - w / 2,
        y: cy - h / 2,
        w, h,
        rotation: 0,
        opacity: 0.7,
        nativeW, nativeH,
        filename,
        layer: refLayerIdToUse,
      };

      pushHistory();
      // Functional update: if a Reference layer already exists in the latest
      // state, keep it; otherwise add ours. If the layer already exists with
      // a DIFFERENT id than the closure-derived one we assigned to the image,
      // we need to relabel the image's layer to match. Do that by reading
      // the resolved id from the setLayers updater and applying it to the
      // shape via setShapes (also functional).
      let resolvedRefLayerId = refLayerIdToUse;
      setLayers(prev => {
        const existing = prev.find(l => l.name === 'Reference');
        if (existing) {
          resolvedRefLayerId = existing.id;
          return prev;
        }
        resolvedRefLayerId = refLayerCandidate.id;
        return [...prev, refLayerCandidate];
      });
      setShapes(prev => [...prev, { ...newImage, layer: resolvedRefLayerId }]);
      setSelectedIds([id]);
      setDirty(true);
    } catch (err) {
      window.alert('Failed to import file: ' + (err.message || String(err)));
    } finally {
      e.target.value = '';
    }
  }

  function createBlockFromSelection(name) {
    if (!selectedId) return;
    const sel = shapeById.get(selectedId);
    if (!sel) return;
    if (sel.type === 'instance') {
      window.alert('Cannot create a block from an instance. Select a regular shape.');
      return;
    }
    pushHistory();
    const c = shapeCenter(sel);
    const normalized = translateShape(sel, -c.x, -c.y);
    const blockId = 'blk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const newBlock = {
      id: blockId,
      name: name || `Block ${blocks.length + 1}`,
      shapes: [{ ...normalized, id: 's1' }],
    };
    setBlocks(prev => [...prev, newBlock]);
    const instId = 'sh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const inst = {
      id: instId, type: 'instance', blockId,
      x: c.x, y: c.y, rotation: 0, scale: 1,
      layer: sel.layer || activeLayerId,
    };
    setShapes(prev => prev.map(s => s.id === selectedId ? inst : s));
    setSelectedId(instId);
    setDirty(true);
  }

  function deleteBlock(blockId) {
    const instCount = shapes.filter(s => s.type === 'instance' && s.blockId === blockId).length;
    if (instCount > 0) {
      if (!window.confirm(`This block has ${instCount} instance${instCount === 1 ? '' : 's'} on the canvas. Delete the block and all its instances?`)) return;
      pushHistory();
      setShapes(prev => prev.filter(s => !(s.type === 'instance' && s.blockId === blockId)));
    } else {
      pushHistory();
    }
    setBlocks(prev => prev.filter(b => b.id !== blockId));
    setDirty(true);
  }

  function renameBlock(blockId, name) {
    pushHistory();
    setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, name } : b));
    setDirty(true);
  }

  // ─── Block edit mode ──────────────────────────────────────────────
  // Opens the block's interior shapes for editing. On exit, the block
  // definition is updated and all instances reflect the change.
  function enterBlockEdit(blockId) {
    const block = blocks.find(b => b.id === blockId);
    if (!block) return;
    // Push history first so the whole edit session is undoable
    pushHistory();
    // Save current top-level shapes for restoration; load block's shapes for editing
    const savedShapes = shapes;
    setBlockEditMode({ blockId, savedShapes });
    // Deep clone block's shapes so editing them doesn't mutate the original
    // until the user clicks Done. Also normalize ids to avoid collisions with
    // top-level ones (defensive).
    const editorShapes = JSON.parse(JSON.stringify(block.shapes));
    setShapes(editorShapes);
    setSelectedIds([]);
    // Reset transient state that doesn't make sense in the new context
    setDraft(null);
    setPolyPending(null);
    setMoving(null);
    setFreehandPoints(null);
    setInsertBlockId(null);
    setShowBlocksPanel(false);
    // Fit to view the block's contents
    const bbox = unionBoundingBox(editorShapes, blocks);
    const svg = svgRef.current;
    const aspect = svg ? (svg.getBoundingClientRect().width / svg.getBoundingClientRect().height) : 1.5;
    setViewBox(fitViewBox(bbox, aspect));
  }

  function exitBlockEdit(save) {
    if (!blockEditMode) return;
    if (save) {
      // Write the editor shapes back into the block definition.
      // Strip the layer property from block shapes since blocks aren't layered.
      const newBlockShapes = shapes.map((s, i) => {
        const { layer, ...rest } = s;
        return { ...rest, id: rest.id || ('s' + (i + 1)) };
      });
      setBlocks(prev => prev.map(b =>
        b.id === blockEditMode.blockId ? { ...b, shapes: newBlockShapes } : b
      ));
    }
    // Restore top-level shapes
    setShapes(blockEditMode.savedShapes);
    setBlockEditMode(null);
    setSelectedIds([]);
    setDirty(true);
    // Reset viewbox to defaults — the user can re-fit if desired
    setViewBox({ x: 0, y: 0, w: 1200, h: 800 });
  }

  function exportPdf(paperSize, pdfScale) {
    let expanded = getExportShapes();
    if (expanded.length === 0) {
      window.alert('Nothing to export.');
      return;
    }
    // Render images first so vector geometry overlays them in the export.
    expanded = expanded.slice().sort((a, b) => {
      const aImg = a.type === 'image' ? 0 : 1;
      const bImg = b.type === 'image' ? 0 : 1;
      return aImg - bImg;
    });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of expanded) {
      if (s.type === 'line' || s.type === 'dimension') { minX = Math.min(minX, s.x1, s.x2); minY = Math.min(minY, s.y1, s.y2); maxX = Math.max(maxX, s.x1, s.x2); maxY = Math.max(maxY, s.y1, s.y2); }
      else if (s.type === 'rect' || s.type === 'image') {
        const bb = shapeBoundingBox(s);
        if (bb) { minX = Math.min(minX, bb.minX); minY = Math.min(minY, bb.minY); maxX = Math.max(maxX, bb.maxX); maxY = Math.max(maxY, bb.maxY); }
      }
      else if (s.type === 'circle') { minX = Math.min(minX, s.cx - s.r); minY = Math.min(minY, s.cy - s.r); maxX = Math.max(maxX, s.cx + s.r); maxY = Math.max(maxY, s.cy + s.r); }
      else if (s.type === 'polyline' || s.type === 'freehand') { for (const p of (s.points || [])) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); } }
      else if (s.type === 'bezier') { minX = Math.min(minX, s.x1, s.x2, s.cx); minY = Math.min(minY, s.y1, s.y2, s.cy); maxX = Math.max(maxX, s.x1, s.x2, s.cx); maxY = Math.max(maxY, s.y1, s.y2, s.cy); }
      else if (s.type === 'text') { minX = Math.min(minX, s.x); minY = Math.min(minY, s.y); maxX = Math.max(maxX, s.x + 100); maxY = Math.max(maxY, s.y + 20); }
    }
    if (!Number.isFinite(minX)) {
      window.alert('Nothing to export.');
      return;
    }
    const paperWPts = paperSize.w * 72;
    const paperHPts = paperSize.h * 72;
    // jsPDF infers orientation from format dimensions; passing orientation
    // explicitly when format is already explicit can cause double-rotation.
    const pdf = new jsPDF({ unit: 'pt', format: [paperWPts, paperHPts] });
    const k = computePdfTransform(units, pxPerUnit, pdfScale);
    const drawWpt = (maxX - minX) * k;
    const drawHpt = (maxY - minY) * k;
    const margin = 36;
    const availW = paperWPts - margin * 2;
    const availH = paperHPts - margin * 2;
    if (drawWpt > availW || drawHpt > availH) {
      if (!window.confirm(`Drawing is ${(drawWpt/72).toFixed(1)}" × ${(drawHpt/72).toFixed(1)}" at this scale — too large for paper. Continue anyway (drawing will be cropped at paper edge)?`)) {
        return;
      }
    }
    const drawCxPx = (minX + maxX) / 2, drawCyPx = (minY + maxY) / 2;
    const paperCxPt = paperWPts / 2, paperCyPt = paperHPts / 2;
    const px2pt = (px, py) => ({
      x: (px - drawCxPx) * k + paperCxPt,
      y: (py - drawCyPx) * k + paperCyPt,
    });
    pdf.setDrawColor(0); pdf.setTextColor(0);
    for (const s of expanded) {
      pdf.setLineWidth(Math.max(0.3, (s.strokeWidth || 1) * 0.5));
      if (s.type === 'image') {
        // Reference images render at axis-aligned bbox with their opacity.
        // jsPDF addImage doesn't smoothly handle arbitrary rotation; for a
        // rotated reference image we render axis-aligned (the underlying
        // drafted geometry is what matters in the export).
        const tl = px2pt(s.x, s.y);
        const wPt = s.w * k, hPt = s.h * k;
        const opacity = s.opacity != null ? s.opacity : 0.7;
        const format = (s.src && s.src.startsWith('data:image/png')) ? 'PNG' : 'JPEG';
        try {
          if (pdf.GState && pdf.setGState) {
            pdf.setGState(new pdf.GState({ opacity }));
          }
          pdf.addImage(s.src, format, tl.x, tl.y, wPt, hPt);
          if (pdf.GState && pdf.setGState) {
            pdf.setGState(new pdf.GState({ opacity: 1 }));
          }
        } catch (err) {
          console.warn('Failed to embed image in PDF:', err && err.message);
        }
      } else if (s.type === 'line' || s.type === 'dimension') {
        const p1 = px2pt(s.x1, s.y1); const p2 = px2pt(s.x2, s.y2);
        pdf.line(p1.x, p1.y, p2.x, p2.y);
        if (s.type === 'dimension') {
          const lenPx = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
          const lbl = formatLength(lenPx, units, pxPerUnit);
          const midX = (p1.x + p2.x) / 2; const midY = (p1.y + p2.y) / 2;
          pdf.setFontSize(8);
          pdf.text(lbl, midX, midY - 4, { align: 'center' });
        }
      } else if (s.type === 'rect') {
        const rot = s.rotation || 0;
        if (rot === 0) {
          const tl = px2pt(s.x, s.y);
          pdf.rect(tl.x, tl.y, s.w * k, s.h * k);
        } else {
          // Rotated rect: 4 line segments connecting the rotated corners
          const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
          const rad = (rot * Math.PI) / 180;
          const cos = Math.cos(rad), sin = Math.sin(rad);
          const rotPt = (px, py) => {
            const dx = px - cx, dy = py - cy;
            return { x: cx + dx * cos + dy * sin, y: cy - dx * sin + dy * cos };
          };
          const corners = [
            rotPt(s.x, s.y),
            rotPt(s.x + s.w, s.y),
            rotPt(s.x + s.w, s.y + s.h),
            rotPt(s.x, s.y + s.h),
          ];
          for (let i = 0; i < 4; i++) {
            const a = px2pt(corners[i].x, corners[i].y);
            const b = px2pt(corners[(i + 1) % 4].x, corners[(i + 1) % 4].y);
            pdf.line(a.x, a.y, b.x, b.y);
          }
        }
      } else if (s.type === 'circle') {
        const c = px2pt(s.cx, s.cy);
        pdf.circle(c.x, c.y, s.r * k);
      } else if (s.type === 'polyline' || s.type === 'freehand') {
        if (!s.points || s.points.length < 2) continue;
        for (let i = 0; i + 1 < s.points.length; i++) {
          const p1 = px2pt(s.points[i].x, s.points[i].y);
          const p2 = px2pt(s.points[i + 1].x, s.points[i + 1].y);
          pdf.line(p1.x, p1.y, p2.x, p2.y);
        }
      } else if (s.type === 'text') {
        const p = px2pt(s.x, s.y);
        pdf.setFontSize(Math.max(6, (s.fontSize || 18) * k * 0.5));
        pdf.text(s.text || '', p.x, p.y);
      } else if (s.type === 'bezier') {
        const steps = 16;
        let prev = px2pt(s.x1, s.y1);
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const mt = 1 - t;
          const bx = mt*mt*s.x1 + 2*mt*t*s.cx + t*t*s.x2;
          const by = mt*mt*s.y1 + 2*mt*t*s.cy + t*t*s.y2;
          const cur = px2pt(bx, by);
          pdf.line(prev.x, prev.y, cur.x, cur.y);
          prev = cur;
        }
      }
    }
    pdf.setFontSize(7);
    pdf.setTextColor(120);
    const scaleLabel = `Scale: ${pdfScale.paperLen} ${pdfScale.paperUnit} = ${pdfScale.drawingLen} ${pdfScale.drawingUnit}`;
    pdf.text(`${title}   ·   ${scaleLabel}`, paperWPts - margin, paperHPts - 12, { align: 'right' });
    pdf.save(`${title.replace(/[^a-z0-9]+/gi, '_')}.pdf`);
  }

  if (!active) {
    return (
      <div>
        <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
          <div><h2>Draft</h2><p>{drawings.length} {drawings.length === 1 ? 'drawing' : 'drawings'}</p></div>
          <button className="btn btn-primary" onClick={newDrawing}>+ New Drawing</button>
        </div>
        <div className="panel">
          <div className="panel-header"><h3>Drawings</h3></div>
          <div className="panel-body">
            {drawings.length === 0
              ? <div className="empty-state"><div className="empty-icon">✏️</div><p>No drawings yet. Create one to start sketching.</p></div>
              : <div className="task-list">
                  {drawings.map(d => (
                    <div key={d.id} className="task-item">
                      <span className="task-text" style={{cursor:'pointer'}} onClick={() => setActiveId(d.id)}>
                        ✏️ {d.title}
                      </span>
                      <div className="task-meta">
                        <span className="task-due">{(() => {
                          const r = d.shapes;
                          if (Array.isArray(r)) return r.length;
                          if (r && Array.isArray(r.shapes)) return r.shapes.length;
                          return 0;
                        })()} shapes</span>
                        <span className="task-due">{new Date(d.updated_at).toLocaleDateString()}</span>
                        <button className="task-delete" onClick={() => deleteDrawing(d.id)}>×</button>
                      </div>
                    </div>
                  ))}
                </div>
            }
          </div>
        </div>
      </div>
    );
  }

  const tools = [
    { id: 'select',    icon: '↖',  label: 'Select (V) — drag to move' },
    { id: 'line',      icon: '╱',  label: 'Line (L)' },
    { id: 'rect',      icon: '▭',  label: 'Rectangle (R)' },
    { id: 'circle',    icon: '○',  label: 'Circle (C)' },
    { id: 'polyline',  icon: '⌒',  label: 'Polyline (P) — click points, Enter or double-click to finish' },
    { id: 'bezier',    icon: '∿',  label: 'Curve (A) — click start, end, then control point' },
    { id: 'freehand',  icon: '✎',  label: 'Freehand (F) — click and drag to draw' },
    { id: 'dimension', icon: '↔',  label: 'Dimension (D) — click two points to measure' },
    { id: 'text',      icon: 'T',  label: 'Text (T) — click to place' },
  ];

  return (
    <div style={{position:'relative'}}>
      <div className="page-header" style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
          <button className="btn btn-ghost btn-sm" onClick={() => { if (dirty && !window.confirm('Discard unsaved changes?')) return; setActiveId(null); }}>← Back</button>
          <input
            className="form-input"
            style={{width:'auto',minWidth:'200px',fontSize:'18px',fontWeight:600}}
            value={title}
            onChange={e => { setTitle(e.target.value); setDirty(true); }}
          />
          {dirty && <span style={{color:'var(--yellow)',fontSize:'12px'}}>● unsaved</span>}
          <div style={{display:'flex',alignItems:'center',gap:'4px',marginLeft:'auto',fontSize:'12px',color:'var(--text-2)'}}>
            <span>Units</span>
            <select
              value={units}
              onChange={e => { setUnits(e.target.value); setDirty(true); }}
              className="form-input"
              style={{padding:'2px 6px',fontSize:'12px',width:'auto'}}
            >
              <option value="ft">ft (feet/inches)</option>
              <option value="in">in (inches)</option>
              <option value="m">m (meters)</option>
              <option value="mm">mm (millimeters)</option>
            </select>
            <span style={{marginLeft:'8px'}}>1 {UNIT_LABEL[units]} =</span>
            <input
              type="number"
              value={pxPerUnit}
              onChange={e => {
                const v = Number(e.target.value);
                if (v > 0) { setPxPerUnit(v); setDirty(true); }
              }}
              min="0.1"
              step="0.1"
              className="form-input"
              style={{padding:'2px 6px',fontSize:'12px',width:'60px'}}
            />
            <span>px</span>
          </div>
        </div>
        <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
          <button className="btn btn-sm btn-ghost" onClick={exportPNG}>⬇ PNG</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setShowPdfDialog(true)} title="Export as scaled PDF">⬇ PDF</button>
          <button className="btn btn-sm btn-ghost" onClick={exportDXF} title="Export as DXF (for AutoCAD)">⬇ DXF</button>
          <button className="btn btn-sm btn-ghost" onClick={() => fileInputRef.current?.click()} title="Import DXF file">⬆ DXF</button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".dxf"
            style={{display:'none'}}
            onChange={handleDxfImport}
          />
          <button className="btn btn-sm btn-ghost" onClick={() => imageFileInputRef.current?.click()} title="Import PDF or image as reference background">⬆ Image/PDF</button>
          <input
            ref={imageFileInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,application/pdf,image/*"
            style={{display:'none'}}
            onChange={handleImageImport}
          />
          <button className="btn btn-sm btn-primary" onClick={saveDrawing} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="panel" style={{padding:0,overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'center',gap:'6px',padding:'8px 12px',borderBottom:'1px solid var(--border)',flexWrap:'wrap',background:'var(--bg-base)'}}>
          {tools.map(t => (
            <button
              key={t.id}
              title={t.label}
              className={`btn btn-sm ${tool===t.id?'btn-primary':'btn-ghost'}`}
              onClick={() => { if (polyPending) cancelPoly(); setTool(t.id); }}
              style={{minWidth:'36px',fontSize:'16px'}}
            >{t.icon}</button>
          ))}
          <div style={{width:'1px',height:'24px',background:'var(--border)',margin:'0 4px'}} />
          <label style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'12px',color:'var(--text-2)'}}>
            Color
            <input type="color" value={color} onChange={e => setColor(e.target.value)} style={{width:'28px',height:'28px',border:'none',background:'transparent',cursor:'pointer',padding:0}} />
          </label>
          <label style={{display:'flex',alignItems:'center',gap:'6px',fontSize:'12px',color:'var(--text-2)'}}>
            Width
            <input type="range" min="1" max="10" value={strokeWidth} onChange={e => setStrokeWidth(Number(e.target.value))} style={{width:'70px'}} />
            <span style={{width:'14px',textAlign:'right'}}>{strokeWidth}</span>
          </label>
          <div style={{width:'1px',height:'24px',background:'var(--border)',margin:'0 4px'}} />
          <button className={`btn btn-sm ${showGrid?'btn-primary':'btn-ghost'}`} onClick={() => setShowGrid(g => !g)} title="Toggle grid">⊞</button>
          <button className={`btn btn-sm ${snapToGrid?'btn-primary':'btn-ghost'}`} onClick={() => setSnapToGrid(s => !s)} title="Snap to grid">⊕</button>
          <button className={`btn btn-sm ${snapEnabled?'btn-primary':'btn-ghost'}`} onClick={() => setSnapEnabled(s => !s)} title="Object snap (endpoints, midpoints, centers)">◈</button>
          <button className={`btn btn-sm ${orthoEnabled?'btn-primary':'btn-ghost'}`} onClick={() => setOrthoEnabled(o => !o)} title="Ortho mode — constrain to 0°/90°">⊥</button>
          <button className={`btn btn-sm ${panMode?'btn-primary':'btn-ghost'}`} onClick={() => setPanMode(p => !p)} title="Pan mode (or hold Alt and drag)">✋</button>
          <div style={{width:'1px',height:'24px',background:'var(--border)',margin:'0 4px'}} />
          <button className={`btn btn-sm ${trimMode?'btn-primary':'btn-ghost'}`} onClick={() => { setTrimMode(t => !t); setExtendMode(null); }} title="Trim — click a line to cut it at intersections">✂</button>
          <button className={`btn btn-sm ${extendMode?'btn-primary':'btn-ghost'}`} onClick={() => { setExtendMode(extendMode ? null : { stage: 'pickEnd' }); setTrimMode(false); }} title="Extend — click line endpoint, then click target line">↦</button>
          <div style={{width:'1px',height:'24px',background:'var(--border)',margin:'0 4px'}} />
          <button className="btn btn-sm btn-ghost" onClick={undo} title="Undo (Ctrl+Z)">↶</button>
          <button className="btn btn-sm btn-ghost" onClick={duplicateSelected} disabled={!selectedId} title="Duplicate (Ctrl/Cmd+D)">⎘</button>
          <button className={`btn btn-sm ${offsetMode?'btn-primary':'btn-ghost'}`} onClick={startOffset} disabled={!selectedId} title="Offset copy (O) — click on canvas to place duplicate">↗</button>
          <button className={`btn btn-sm ${mirrorMode?'btn-primary':'btn-ghost'}`} onClick={() => setMirrorMode(mirrorMode ? null : { stage: 'pickP1' })} disabled={!selectedId} title="Mirror — click two points to define reflection axis">⇋</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setShowArrayDialog(true)} disabled={!selectedId} title="Array — rows × cols grid">⊟</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setShowRotateDialog(true)} disabled={!selectedId} title="Rotate by angle">↻</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setShowScaleDialog(true)} disabled={!selectedId} title="Scale (resize)">⤢</button>
          <button className="btn btn-sm btn-ghost" onClick={deleteSelected} disabled={!selectedId}>Delete</button>
          <button className="btn btn-sm btn-ghost" onClick={clearAll}>Clear</button>
          <button className={`btn btn-sm ${showLayersPanel?'btn-primary':'btn-ghost'}`} onClick={() => setShowLayersPanel(s => !s)} title="Layers">▤</button>
          <button className={`btn btn-sm ${showBlocksPanel?'btn-primary':'btn-ghost'}`} onClick={() => setShowBlocksPanel(s => !s)} title="Blocks (reusable symbols)">◫</button>
          <button className="btn btn-sm btn-ghost" onClick={undo} disabled={!canUndo} title={canUndo ? "Undo (Ctrl+Z)" : "Nothing to undo"} style={{opacity: canUndo ? 1 : 0.4}}>↶</button>
          <button className="btn btn-sm btn-ghost" onClick={redo} disabled={!canRedo} title={canRedo ? "Redo (Ctrl+Shift+Z)" : "Nothing to redo"} style={{opacity: canRedo ? 1 : 0.4}}>↷</button>
          <button className="btn btn-sm btn-ghost" onClick={fitToView} title="Fit all visible shapes to view (Z)">⊡</button>
          <button className="btn btn-sm btn-ghost" onClick={resetView} title="Reset view">⌂</button>
          <span style={{marginLeft:'auto',fontSize:'11px',color:'var(--text-3)',display:'flex',gap:'10px',alignItems:'center'}}>
            {(() => {
              const a = currentAnchor();
              if (a && previewPoint) {
                const da = distanceAngle(a, previewPoint, pxPerUnit);
                return <span style={{color:'var(--accent)',fontFamily:'monospace'}}>
                  {formatLength(da.distPx, units, pxPerUnit)} @ {da.angleDeg.toFixed(1)}°
                </span>;
              }
              return null;
            })()}
            {selectedIds.length > 1 && <span style={{color:'var(--text-2)'}}>{selectedIds.length} selected</span>}
            <span>{shapes.length} shape{shapes.length===1?'':'s'} · zoom {Math.round(1200/viewBox.w*100)}%</span>
          </span>
        </div>

        <div style={{background:'var(--bg-base)',position:'relative'}}>
          <svg
            ref={svgRef}
            viewBox={(() => {
              // Defensive: if viewBox state ever goes to NaN/Infinity/zero
              // (e.g. from a race we didn't anticipate), fall back to the
              // initial view so the canvas keeps rendering. Better to show
              // something at a default zoom than a blank screen requiring
              // a page refresh.
              const { x, y, w, h } = viewBox;
              const ok = Number.isFinite(x) && Number.isFinite(y) &&
                         Number.isFinite(w) && Number.isFinite(h) &&
                         w > 0 && h > 0;
              return ok ? `${x} ${y} ${w} ${h}` : `0 0 1200 800`;
            })()}
            style={{
              display:'block',
              width:'100%',
              height:'min(70vh, 700px)',
              cursor: panStart.current ? 'grabbing' : panMode ? 'grab' : dragSelect ? 'crosshair' : moving ? 'move' : (trimMode || extendMode) ? 'pointer' : insertBlockId ? 'copy' : offsetMode ? 'copy' : tool==='select' ? 'default' : 'crosshair',
              touchAction:'none',
              userSelect:'none',
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onDoubleClick={(e) => {
              if (polyPending) { finalizePoly(); return; }
              if (tool === 'select') {
                const p = svgPoint(e);
                const hit = [...shapes].reverse().find(s => s.type === 'text' && hitTest(s, p));
                if (hit) { setSelectedId(hit.id); setEditingTextId(hit.id); }
              }
            }}
            onWheel={handleWheel}
          >
            <defs>
              <pattern id="grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
                <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke="#252a38" strokeWidth="0.5" opacity="0.6" />
              </pattern>
              {/* Generate a pattern for each unique (fillStyle, fillColor) used by shapes */}
              {(() => {
                const used = new Set();
                shapes.forEach(s => {
                  if (s.fillStyle && s.fillStyle !== 'none' && s.fillStyle !== 'solid') {
                    used.add(`${s.fillStyle}|${s.fillColor || s.stroke}`);
                  }
                });
                return Array.from(used).map(key => {
                  const [style, color] = key.split('|');
                  const id = `pattern-${style}-${color.replace('#', '')}`;
                  if (style === 'hatch') {
                    return (
                      <pattern key={id} id={id} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <line x1="0" y1="0" x2="0" y2="8" stroke={color} strokeWidth="1" />
                      </pattern>
                    );
                  }
                  if (style === 'crosshatch') {
                    return (
                      <pattern key={id} id={id} width="8" height="8" patternUnits="userSpaceOnUse">
                        <path d="M 0 4 L 8 4 M 4 0 L 4 8" stroke={color} strokeWidth="1" />
                      </pattern>
                    );
                  }
                  if (style === 'dots') {
                    return (
                      <pattern key={id} id={id} width="6" height="6" patternUnits="userSpaceOnUse">
                        <circle cx="3" cy="3" r="1" fill={color} />
                      </pattern>
                    );
                  }
                  return null;
                });
              })()}
            </defs>
            {showGrid && <rect x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h} fill="url(#grid)" />}

            {/* Render images first so they sit behind drafted geometry, acting
                as a base layer for tracing. Selected images still render their
                outline via renderShape; pointer events on the image element
                itself are off so vector shapes on top remain clickable. */}
            {shapes.filter(isShapeVisible).slice().sort((a, b) => {
              const aImg = a.type === 'image' ? 0 : 1;
              const bImg = b.type === 'image' ? 0 : 1;
              return aImg - bImg;
            }).map(s => {
              const isSelected = selectedSet.has(s.id);
              if (s.type === 'instance') {
                const sub = expandInstance(s, blocks);
                return <g key={s.id}>
                  {sub.map(es => renderShape({ ...es, stroke: isSelected ? '#6c63ff' : es.stroke }, false, { units, pxPerUnit }))}
                  {isSelected && <circle cx={s.x} cy={s.y} r="4" fill="#6c63ff" />}
                </g>;
              }
              return renderShape(s, isSelected, { units, pxPerUnit });
            })}
            {draft && renderShape(draft, false, { units, pxPerUnit })}
            {polyPending && polyPending.type === 'polyline' && (
              <>
                <polyline
                  points={polyPending.points.map(p => `${p.x},${p.y}`).join(' ')}
                  fill="none" stroke={polyPending.stroke} strokeWidth={polyPending.strokeWidth}
                  strokeLinecap="round" strokeLinejoin="round"
                />
                {previewPoint && polyPending.points.length > 0 && (() => {
                  const last = polyPending.points[polyPending.points.length - 1];
                  return <line
                    x1={last.x} y1={last.y} x2={previewPoint.x} y2={previewPoint.y}
                    stroke={polyPending.stroke} strokeWidth={polyPending.strokeWidth}
                    strokeDasharray="5,5" opacity="0.6"
                  />;
                })()}
                {polyPending.points.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r="3" fill="#6c63ff" />
                ))}
              </>
            )}
            {polyPending && polyPending.type === 'dimension' && previewPoint && (
              renderShape({ ...polyPending, x2: previewPoint.x, y2: previewPoint.y }, false, { units, pxPerUnit })
            )}
            {polyPending && polyPending.type === 'bezier' && previewPoint && (() => {
              if (polyPending.stage === 1) {
                // Show straight preview line to cursor
                return <line x1={polyPending.x1} y1={polyPending.y1} x2={previewPoint.x} y2={previewPoint.y}
                  stroke={polyPending.stroke} strokeWidth={polyPending.strokeWidth} strokeDasharray="5,5" opacity="0.6" />;
              }
              if (polyPending.stage === 2) {
                // Show curve with cursor as control point
                return (
                  <>
                    <path d={`M ${polyPending.x1} ${polyPending.y1} Q ${previewPoint.x} ${previewPoint.y} ${polyPending.x2} ${polyPending.y2}`}
                      fill="none" stroke={polyPending.stroke} strokeWidth={polyPending.strokeWidth} strokeLinecap="round" />
                    <circle cx={polyPending.x1} cy={polyPending.y1} r="3" fill="#6c63ff" />
                    <circle cx={polyPending.x2} cy={polyPending.y2} r="3" fill="#6c63ff" />
                    <circle cx={previewPoint.x} cy={previewPoint.y} r="3" fill="#22c55e" />
                  </>
                );
              }
              return null;
            })()}
            {freehandPoints && freehandPoints.length >= 2 && (
              <path
                d={'M ' + freehandPoints.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')}
                fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
              />
            )}
            {offsetMode && offsetAnchor && previewPoint && selectedId && (() => {
              const sel = shapeById.get(selectedId);
              if (!sel) return null;
              const dx = previewPoint.x - offsetAnchor.x;
              const dy = previewPoint.y - offsetAnchor.y;
              const ghost = translateShape(sel, dx, dy);
              return (
                <g opacity="0.5">
                  {renderShape({ ...ghost, id: ghost.id + '_ghost', stroke: '#22c55e' }, false, { units, pxPerUnit })}
                  <line
                    x1={offsetAnchor.x} y1={offsetAnchor.y} x2={previewPoint.x} y2={previewPoint.y}
                    stroke="#22c55e" strokeWidth="1" strokeDasharray="4,4"
                  />
                  <circle cx={offsetAnchor.x} cy={offsetAnchor.y} r="3" fill="#22c55e" />
                </g>
              );
            })()}
            {/* Mirror preview */}
            {mirrorMode && mirrorMode.stage === 'pickP2' && previewPoint && selectedId && (() => {
              const sel = shapeById.get(selectedId);
              if (!sel) return null;
              const reflected = mirrorShape(sel, { a: mirrorMode.p1, b: previewPoint });
              // Extend axis line for visual clarity
              const dx = previewPoint.x - mirrorMode.p1.x;
              const dy = previewPoint.y - mirrorMode.p1.y;
              const len = Math.hypot(dx, dy) || 1;
              const ext = 100; // extend the visible axis by 100px beyond each endpoint
              const ux = dx / len, uy = dy / len;
              const axLine = {
                x1: mirrorMode.p1.x - ux * ext, y1: mirrorMode.p1.y - uy * ext,
                x2: previewPoint.x + ux * ext, y2: previewPoint.y + uy * ext,
              };
              return (
                <g opacity="0.6">
                  <line x1={axLine.x1} y1={axLine.y1} x2={axLine.x2} y2={axLine.y2}
                    stroke="#22c55e" strokeWidth="1" strokeDasharray="6,4" />
                  <circle cx={mirrorMode.p1.x} cy={mirrorMode.p1.y} r="3" fill="#22c55e" />
                  <circle cx={previewPoint.x} cy={previewPoint.y} r="3" fill="#22c55e" />
                  {renderShape({ ...reflected, id: reflected.id + '_mirror_ghost', stroke: '#22c55e' }, false, { units, pxPerUnit })}
                </g>
              );
            })()}
            {/* Block insert preview */}
            {insertBlockId && previewPoint && (() => {
              const block = blocks.find(b => b.id === insertBlockId);
              if (!block) return null;
              const ghost = { id: '_insert_ghost', type: 'instance', blockId: insertBlockId, x: previewPoint.x, y: previewPoint.y, rotation: 0, scale: 1 };
              const sub = expandInstance(ghost, blocks);
              return <g opacity="0.5">
                {sub.map(es => renderShape({ ...es, stroke: '#22c55e' }, false, { units, pxPerUnit }))}
                <circle cx={previewPoint.x} cy={previewPoint.y} r="4" fill="#22c55e" />
              </g>;
            })()}
            {/* Mirror first-point marker */}
            {mirrorMode && mirrorMode.stage === 'pickP2' && (
              <circle cx={mirrorMode.p1.x} cy={mirrorMode.p1.y} r="4" fill="#22c55e" />
            )}
            {dragSelect && (() => {
              const { start, current } = dragSelect;
              const x = Math.min(start.x, current.x);
              const y = Math.min(start.y, current.y);
              const w = Math.abs(current.x - start.x);
              const h = Math.abs(current.y - start.y);
              const mode = (current.x >= start.x) ? 'window' : 'crossing';
              return <rect
                x={x} y={y} width={w} height={h}
                fill={mode === 'window' ? 'rgba(108, 99, 255, 0.08)' : 'rgba(34, 197, 94, 0.08)'}
                stroke={mode === 'window' ? '#6c63ff' : '#22c55e'}
                strokeWidth={worldSnapTolerance() * 0.15}
                strokeDasharray={mode === 'crossing' ? `${worldSnapTolerance()*0.5},${worldSnapTolerance()*0.5}` : 'none'}
                pointerEvents="none"
              />;
            })()}
            {snapHit && snapEnabled && (() => {
              // Marker size scales with zoom so it's always ~10 screen px
              const sz = worldSnapTolerance() * 0.8;
              if (snapHit.kind === 'endpoint' || snapHit.kind === 'vertex') {
                // Square
                return <rect
                  x={snapHit.x - sz/2} y={snapHit.y - sz/2}
                  width={sz} height={sz}
                  fill="none" stroke="#22c55e" strokeWidth={sz * 0.15}
                  pointerEvents="none"
                />;
              }
              if (snapHit.kind === 'midpoint') {
                // Triangle
                const h = sz;
                return <polygon
                  points={`${snapHit.x},${snapHit.y - h*0.6} ${snapHit.x - h*0.6},${snapHit.y + h*0.4} ${snapHit.x + h*0.6},${snapHit.y + h*0.4}`}
                  fill="none" stroke="#22c55e" strokeWidth={sz * 0.15}
                  pointerEvents="none"
                />;
              }
              if (snapHit.kind === 'center' || snapHit.kind === 'quadrant') {
                // Circle
                return <circle
                  cx={snapHit.x} cy={snapHit.y} r={sz * 0.5}
                  fill="none" stroke="#22c55e" strokeWidth={sz * 0.15}
                  pointerEvents="none"
                />;
              }
              return null;
            })()}
            {/* Handles for the selected shape(s). Click + drag a handle to
                resize/reshape. Sized in screen pixels regardless of zoom. */}
            {(() => {
              const screenPx = (n) => (n * viewBox.w) / (svgRef.current?.getBoundingClientRect().width || 1);
              const handleR = Math.max(4, screenPx(6));
              const strokeW = screenPx(1.5);
              const handles = [];
              for (const id of selectedIds) {
                const s = shapeById.get(id);
                if (!s) continue;
                if (s.type === 'line' || s.type === 'dimension') {
                  handles.push({ id: s.id, end: 'a', x: s.x1, y: s.y1 });
                  handles.push({ id: s.id, end: 'b', x: s.x2, y: s.y2 });
                } else if (s.type === 'rect' || s.type === 'image') {
                  // Four corners, in rotated screen positions
                  const rot = s.rotation || 0;
                  const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
                  const rad = (rot * Math.PI) / 180;
                  const cosR = Math.cos(rad), sinR = Math.sin(rad);
                  const rotPt = (px, py) => {
                    const dx = px - cx, dy = py - cy;
                    return { x: cx + dx * cosR + dy * sinR, y: cy - dx * sinR + dy * cosR };
                  };
                  const tl = rotPt(s.x, s.y);
                  const tr = rotPt(s.x + s.w, s.y);
                  const br = rotPt(s.x + s.w, s.y + s.h);
                  const bl = rotPt(s.x, s.y + s.h);
                  handles.push({ id: s.id, end: 'tl', x: tl.x, y: tl.y });
                  handles.push({ id: s.id, end: 'tr', x: tr.x, y: tr.y });
                  handles.push({ id: s.id, end: 'br', x: br.x, y: br.y });
                  handles.push({ id: s.id, end: 'bl', x: bl.x, y: bl.y });
                } else if (s.type === 'circle') {
                  // Radius handle at angle 0 (right side of circle)
                  handles.push({ id: s.id, end: 'r', x: s.cx + s.r, y: s.cy });
                } else if (s.type === 'polyline' || s.type === 'freehand') {
                  // One handle per vertex. For very dense freehand strokes
                  // (hundreds of points) we skip the freehand case to avoid
                  // rendering hundreds of handles — vertex-edit on a freehand
                  // sketch isn't a normal operation anyway. Polylines get all.
                  if (s.type === 'freehand' && (s.points?.length || 0) > 50) {
                    // Too dense — skip vertex handles for freehand
                  } else if (s.points) {
                    s.points.forEach((pt, i) => {
                      handles.push({ id: s.id, end: i, x: pt.x, y: pt.y });
                    });
                  }
                } else if (s.type === 'bezier') {
                  // Endpoints + control point. Color the control handle
                  // differently so the user knows it's the shape's curvature.
                  handles.push({ id: s.id, end: 'a', x: s.x1, y: s.y1 });
                  handles.push({ id: s.id, end: 'b', x: s.x2, y: s.y2 });
                  handles.push({ id: s.id, end: 'c', x: s.cx, y: s.cy, isControl: true });
                }
              }
              return handles.map((h, i) => (
                <circle
                  key={`hdl_${h.id}_${h.end}_${i}`}
                  cx={h.x} cy={h.y} r={handleR}
                  fill={h.isControl ? '#fde68a' : '#fff'}
                  stroke="#6c63ff"
                  strokeWidth={strokeW}
                  style={{ cursor: 'pointer' }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setEndpointDrag({
                      shapeId: h.id,
                      endpoint: h.end,
                      preDragSnap: deepSnap(),
                    });
                  }}
                />
              ));
            })()}
          </svg>
        </div>
      </div>

      {/* Mode banners */}
      {lockedLayerHint && (
        <div style={{
          position:'absolute', top:'140px', left:'50%', transform:'translateX(-50%)',
          background:'var(--bg-card)', border:'1px solid var(--yellow)', borderRadius:'8px',
          padding:'8px 14px', zIndex:65, fontSize:'13px', color:'var(--yellow)',
          boxShadow:'0 4px 16px rgba(0,0,0,0.4)', pointerEvents:'none',
        }}>
          🔒 {lockedLayerHint.text}
        </div>
      )}
      {(trimMode || extendMode) && (
        <div style={{
          position:'fixed', top:'80px', left:'50%', transform:'translateX(-50%)',
          background:'var(--bg-card)', border:'1px solid var(--accent)', borderRadius:'8px',
          padding:'10px 16px', zIndex:60, fontSize:'13px',
          boxShadow:'0 4px 16px rgba(0,0,0,0.4)'
        }}>
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            {trimMode && <span style={{color:'var(--accent)'}}>✂ Trim — click a line to remove the segment between intersections</span>}
            {extendMode && extendMode.stage === 'pickEnd' && <span style={{color:'var(--accent)'}}>↦ Extend — click near a line endpoint</span>}
            {extendMode && extendMode.stage === 'pickTarget' && <span style={{color:'var(--accent)'}}>↦ Extend — now click the target line to extend to</span>}
            <button className="btn btn-sm btn-ghost" onClick={() => { setTrimMode(false); setExtendMode(null); }}>Exit</button>
          </div>
        </div>
      )}

      {mirrorMode && (
        <div style={{
          position:'fixed', top:'80px', left:'50%', transform:'translateX(-50%)',
          background:'var(--bg-card)', border:'1px solid var(--accent)', borderRadius:'8px',
          padding:'10px 16px', zIndex:60, fontSize:'13px',
          boxShadow:'0 4px 16px rgba(0,0,0,0.4)'
        }}>
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            {mirrorMode.stage === 'pickP1' && <span style={{color:'var(--accent)'}}>⇋ Mirror — click first point of axis</span>}
            {mirrorMode.stage === 'pickP2' && <span style={{color:'var(--accent)'}}>⇋ Mirror — click second point of axis</span>}
            <button className="btn btn-sm btn-ghost" onClick={() => setMirrorMode(null)}>Cancel</button>
          </div>
        </div>
      )}

      {showArrayDialog && selectedId && (() => {
        const sel = shapeById.get(selectedId);
        if (!sel) return null;
        return <ArrayDialog
          shape={sel}
          units={units}
          pxPerUnit={pxPerUnit}
          onCancel={() => setShowArrayDialog(false)}
          onApply={(rows, cols, dx, dy) => {
            pushHistory();
            const copies = arrayShapes(sel, rows, cols, dx, dy);
            // Assign current activeLayerId and ensure unique ids
            const stamped = copies.map(c => ({ ...c, layer: activeLayerId }));
            setShapes(prev => [...prev, ...stamped]);
            setDirty(true);
            setShowArrayDialog(false);
          }}
        />;
      })()}

      {showRotateDialog && selectedId && (() => {
        const sel = shapeById.get(selectedId);
        if (!sel) return null;
        return <RotateDialog
          shape={sel}
          onCancel={() => setShowRotateDialog(false)}
          onApply={(angleDeg, keepOriginal) => {
            pushHistory();
            const center = shapeCenter(sel);
            const rotated = rotateShape(sel, center, angleDeg);
            if (keepOriginal) {
              const copy = { ...rotated, id: 'sh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) };
              setShapes(prev => [...prev, copy]);
              setSelectedId(copy.id);
            } else {
              setShapes(prev => prev.map(s => s.id === selectedId ? { ...rotated, id: s.id } : s));
            }
            setDirty(true);
            setShowRotateDialog(false);
          }}
        />;
      })()}

      {showScaleDialog && selectedId && (() => {
        const sel = shapeById.get(selectedId);
        if (!sel) return null;
        return <ScaleDialog
          shape={sel}
          units={units}
          pxPerUnit={pxPerUnit}
          onCancel={() => setShowScaleDialog(false)}
          onApply={(factor, keepOriginal) => {
            pushHistory();
            const center = shapeCenter(sel);
            const scaled = scaleShape(sel, factor, center);
            if (keepOriginal) {
              const copy = { ...scaled, id: 'sh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) };
              setShapes(prev => [...prev, copy]);
              setSelectedId(copy.id);
            } else {
              setShapes(prev => prev.map(s => s.id === selectedId ? { ...scaled, id: s.id } : s));
            }
            setDirty(true);
            setShowScaleDialog(false);
          }}
        />;
      })()}

      {showBlocksPanel && (
        <div style={{
          position:'absolute', top:'80px', left:'20px', width:'280px',
          background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'8px',
          padding:'12px', zIndex:50, maxHeight:'70vh', overflowY:'auto',
          boxShadow:'0 8px 24px rgba(0,0,0,0.4)'
        }}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px'}}>
            <h3 style={{margin:0,fontSize:'14px'}}>Blocks</h3>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowBlocksPanel(false)}>×</button>
          </div>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => setShowCreateBlockDialog(true)}
            disabled={!selectedId || !!blockEditMode}
            style={{width:'100%',marginBottom:'10px'}}
            title={blockEditMode ? "Nested blocks are not supported — finish editing first" : !selectedId ? "Select a shape first" : ""}
          >
            + Create block from selection
          </button>
          {blocks.length === 0 ? (
            <p style={{fontSize:'11px',color:'var(--text-3)',margin:0}}>No blocks yet. Select a shape and click "Create block from selection".</p>
          ) : (
            <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
              {blocks.map(b => {
                const count = shapes.filter(s => s.type === 'instance' && s.blockId === b.id).length;
                return (
                  <div key={b.id} style={{
                    padding:'6px 8px', borderRadius:'4px',
                    background: insertBlockId === b.id ? 'var(--bg-hover)' : 'transparent',
                    border: insertBlockId === b.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                  }}>
                    <div style={{display:'flex',alignItems:'center',gap:'4px'}}>
                      <InlineRenameInput
                        value={b.name}
                        onCommit={(newName) => renameBlock(b.id, newName)}
                        disabled={!!blockEditMode}
                        className="form-input"
                        style={{flex:1,padding:'2px 6px',fontSize:'12px',minWidth:0,opacity: blockEditMode ? 0.4 : 1}}
                      />
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => deleteBlock(b.id)}
                        disabled={!!blockEditMode}
                        style={{minWidth:'20px',padding:'2px 4px',color:'var(--red)',opacity: blockEditMode ? 0.4 : 1}}
                        title={blockEditMode ? "Finish editing first" : "Delete block"}
                      >×</button>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'4px',gap:'4px'}}>
                      <span style={{fontSize:'10px',color:'var(--text-3)'}}>{count} instance{count===1?'':'s'}</span>
                      <div style={{display:'flex',gap:'4px'}}>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => enterBlockEdit(b.id)}
                          disabled={!!blockEditMode}
                          style={{fontSize:'11px',padding:'2px 8px',opacity: blockEditMode ? 0.4 : 1}}
                          title={blockEditMode ? "Finish editing first" : "Edit block definition (all instances will update)"}
                        >Edit</button>
                        <button
                          className={`btn btn-sm ${insertBlockId === b.id ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={() => setInsertBlockId(insertBlockId === b.id ? null : b.id)}
                          disabled={!!blockEditMode}
                          style={{fontSize:'11px',padding:'2px 8px',opacity: blockEditMode ? 0.4 : 1}}
                          title={blockEditMode ? "Finish editing first" : ""}
                        >
                          {insertBlockId === b.id ? 'Click canvas…' : 'Insert'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showCreateBlockDialog && (
        <CreateBlockDialog
          defaultName={`Block ${blocks.length + 1}`}
          onCancel={() => setShowCreateBlockDialog(false)}
          onCreate={(name) => {
            createBlockFromSelection(name);
            setShowCreateBlockDialog(false);
          }}
        />
      )}

      {showPdfDialog && (
        <PdfExportDialog
          units={units}
          onCancel={() => setShowPdfDialog(false)}
          onExport={(paperSize, pdfScale) => {
            setShowPdfDialog(false);
            setTimeout(() => exportPdf(paperSize, pdfScale), 50);
          }}
        />
      )}

      {blockEditMode && (() => {
        const block = blocks.find(b => b.id === blockEditMode.blockId);
        const instCount = blockEditMode.savedShapes.filter(s => s.type === 'instance' && s.blockId === blockEditMode.blockId).length;
        return (
          <div style={{
            position:'fixed', top:'80px', left:'50%', transform:'translateX(-50%)',
            background:'var(--bg-card)', border:'2px solid var(--yellow)', borderRadius:'8px',
            padding:'10px 16px', zIndex:60, fontSize:'13px',
            boxShadow:'0 4px 16px rgba(0,0,0,0.4)'
          }}>
            <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
              <span style={{color:'var(--yellow)'}}>
                ◫ Editing block "{block?.name}" — changes will apply to {instCount} instance{instCount === 1 ? '' : 's'} on the canvas
              </span>
              <button className="btn btn-sm btn-primary" onClick={() => exitBlockEdit(true)}>Done</button>
              <button className="btn btn-sm btn-ghost" onClick={() => exitBlockEdit(false)}>Cancel</button>
            </div>
          </div>
        );
      })()}

      {calibrateMode && (
        <div style={{
          position:'fixed', top:'80px', left:'50%', transform:'translateX(-50%)',
          background:'var(--bg-card)', border:'2px solid var(--yellow)', borderRadius:'8px',
          padding:'10px 16px', zIndex:60, fontSize:'13px',
          boxShadow:'0 4px 16px rgba(0,0,0,0.4)'
        }}>
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <span style={{color:'var(--yellow)'}}>
              ⚖ Calibrate — {calibrateMode.stage === 'pickP1'
                ? 'click the first point on a known dimension (e.g. one end of a wall)'
                : 'click the second point (the other end of that dimension)'}
            </span>
            <button className="btn btn-sm btn-ghost" onClick={() => setCalibrateMode(null)}>Cancel</button>
          </div>
        </div>
      )}

      {insertBlockId && (() => {
        const block = blocks.find(b => b.id === insertBlockId);
        return (
          <div style={{
            position:'fixed', top:'80px', left:'50%', transform:'translateX(-50%)',
            background:'var(--bg-card)', border:'1px solid var(--accent)', borderRadius:'8px',
            padding:'10px 16px', zIndex:60, fontSize:'13px',
            boxShadow:'0 4px 16px rgba(0,0,0,0.4)'
          }}>
            <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
              <span style={{color:'var(--accent)'}}>◫ Insert "{block?.name}" — click on canvas to place</span>
              <button className="btn btn-sm btn-ghost" onClick={() => setInsertBlockId(null)}>Cancel</button>
            </div>
          </div>
        );
      })()}

      {paramInput && (
        <div style={{
          position:'fixed', bottom:'100px', left:'50%', transform:'translateX(-50%)',
          background:'var(--bg-card)', border:'1px solid var(--accent)', borderRadius:'8px',
          padding:'10px 14px', zIndex:70, fontSize:'13px',
          boxShadow:'0 4px 16px rgba(0,0,0,0.4)',
          display:'flex', alignItems:'center', gap:'10px',
        }}>
          <span style={{color:'var(--text-2)'}}>Length:</span>
          <input
            value={paramInput.value}
            autoFocus
            onChange={e => setParamInput(prev => prev ? { ...prev, value: e.target.value } : prev)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitParametric(); }
              if (e.key === 'Escape') { e.preventDefault(); setParamInput(null); }
            }}
            className="form-input"
            style={{width:'150px',fontSize:'14px',fontFamily:'monospace'}}
            placeholder="120 or 120<45 or 100,50"
          />
          <span style={{color:'var(--text-3)',fontSize:'11px'}}>{units}</span>
          <button className="btn btn-sm btn-primary" onClick={commitParametric}>OK</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setParamInput(null)}>Cancel</button>
        </div>
      )}

      {showLayersPanel && (
        <div style={{
          position:'absolute', top:'80px', right:'20px', width:'280px',
          background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:'8px',
          padding:'12px', zIndex:50, maxHeight:'70vh', overflowY:'auto',
          boxShadow:'0 8px 24px rgba(0,0,0,0.4)'
        }}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'10px'}}>
            <h3 style={{margin:0,fontSize:'14px'}}>Layers</h3>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowLayersPanel(false)}>×</button>
          </div>
          <button className="btn btn-sm btn-primary" onClick={addLayer} style={{width:'100%',marginBottom:'10px'}}>+ Add Layer</button>
          <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
            {layers.map(l => (
              <div key={l.id}
                onClick={() => setActiveLayerId(l.id)}
                style={{
                  display:'flex',alignItems:'center',gap:'6px',padding:'6px 8px',
                  borderRadius:'4px',cursor:'pointer',
                  background: activeLayerId === l.id ? 'var(--bg-hover)' : 'transparent',
                  border: activeLayerId === l.id ? '1px solid var(--accent)' : '1px solid transparent',
                }}>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={(e) => { e.stopPropagation(); toggleLayerVisible(l.id); }}
                  title={l.visible ? 'Hide' : 'Show'}
                  style={{minWidth:'24px',padding:'2px 4px',opacity: l.visible ? 1 : 0.4}}
                >{l.visible ? '👁' : '⊘'}</button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={(e) => { e.stopPropagation(); toggleLayerLocked(l.id); }}
                  title={l.locked ? 'Unlock' : 'Lock'}
                  style={{minWidth:'24px',padding:'2px 4px'}}
                >{l.locked ? '🔒' : '🔓'}</button>
                <InlineRenameInput
                  value={l.name}
                  onCommit={(newName) => renameLayer(l.id, newName)}
                  className="form-input"
                  style={{flex:1,padding:'2px 6px',fontSize:'12px',minWidth:0}}
                />
                <span style={{fontSize:'10px',color:'var(--text-3)'}}>
                  {shapes.filter(s => (s.layer || 'default') === l.id).length}
                </span>
                {layers.length > 1 && (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={(e) => { e.stopPropagation(); deleteLayer(l.id); }}
                    style={{minWidth:'20px',padding:'2px 4px',color:'var(--red)'}}
                    title="Delete layer"
                  >×</button>
                )}
              </div>
            ))}
          </div>
          {selectedId && (() => {
            const sel = shapeById.get(selectedId);
            if (!sel) return null;
            return (
              <div style={{marginTop:'12px',paddingTop:'10px',borderTop:'1px solid var(--border)'}}>
                <div style={{fontSize:'11px',color:'var(--text-2)',marginBottom:'4px'}}>Move selection to:</div>
                <select
                  value={sel.layer || 'default'}
                  onChange={e => {
                    pushHistory();
                    setShapes(prev => prev.map(s => s.id === selectedId ? { ...s, layer: e.target.value } : s));
                    setDirty(true);
                  }}
                  className="form-input"
                  style={{width:'100%',fontSize:'12px',padding:'4px 8px'}}
                >
                  {layers.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
                {sel.type === 'image' && (
                  <>
                    <div style={{fontSize:'11px',color:'var(--text-2)',marginTop:'10px',marginBottom:'4px'}}>
                      Opacity: {Math.round((sel.opacity != null ? sel.opacity : 0.7) * 100)}%
                    </div>
                    <input
                      type="range"
                      min="0.05"
                      max="1"
                      step="0.05"
                      value={sel.opacity != null ? sel.opacity : 0.7}
                      onChange={e => {
                        // Per-keystroke value writes are fine here — opacity
                        // changes are visually continuous and don't push history
                        // until commit (onMouseUp/onChange end). Use onChange on
                        // input[type=range] which fires per drag-tick; we don't
                        // pushHistory each tick (would flood). Capture pre-drag
                        // state on first interaction instead.
                        setShapes(prev => prev.map(s => s.id === selectedId ? { ...s, opacity: Number(e.target.value) } : s));
                        setDirty(true);
                      }}
                      onMouseDown={() => {
                        // Capture history once at the start of a drag
                        pushHistory();
                      }}
                      onTouchStart={() => pushHistory()}
                      style={{width:'100%'}}
                    />
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => setCalibrateMode({ imageId: selectedId, stage: 'pickP1' })}
                      style={{width:'100%',marginTop:'8px',fontSize:'12px'}}
                      title="Click two points on the image, then enter the real-world distance to scale the image correctly."
                    >
                      ⚖ Calibrate scale
                    </button>
                    <p style={{fontSize:'10px',color:'var(--text-3)',marginTop:'6px',marginBottom:0,lineHeight:1.4}}>
                      Native: {sel.nativeW || '?'} × {sel.nativeH || '?'} px
                      {sel.filename ? <><br/>{sel.filename}</> : null}
                    </p>
                  </>
                )}
                {(sel.type === 'rect' || sel.type === 'circle' || sel.type === 'polyline') && (
                  <>
                    <div style={{fontSize:'11px',color:'var(--text-2)',marginTop:'10px',marginBottom:'4px'}}>Fill style:</div>
                    <select
                      value={sel.fillStyle || 'none'}
                      onChange={e => {
                        pushHistory();
                        setShapes(prev => prev.map(s => s.id === selectedId ? { ...s, fillStyle: e.target.value, fillColor: s.fillColor || s.stroke } : s));
                        setDirty(true);
                      }}
                      className="form-input"
                      style={{width:'100%',fontSize:'12px',padding:'4px 8px'}}
                    >
                      <option value="none">None</option>
                      <option value="solid">Solid</option>
                      <option value="hatch">Hatch (diagonal lines)</option>
                      <option value="crosshatch">Crosshatch</option>
                      <option value="dots">Dots</option>
                    </select>
                    {sel.fillStyle && sel.fillStyle !== 'none' && (
                      <div style={{display:'flex',alignItems:'center',gap:'6px',marginTop:'6px',fontSize:'12px',color:'var(--text-2)'}}>
                        <span>Fill color:</span>
                        <input
                          type="color"
                          value={sel.fillColor || sel.stroke || '#e8eaf0'}
                          onChange={e => {
                            pushHistory();
                            setShapes(prev => prev.map(s => s.id === selectedId ? { ...s, fillColor: e.target.value } : s));
                            setDirty(true);
                          }}
                          style={{width:'28px',height:'24px',border:'none',background:'transparent',cursor:'pointer',padding:0}}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {offsetMode && (
        <div style={{
          position:'fixed', top:'80px', left:'50%', transform:'translateX(-50%)',
          background:'var(--bg-card)', border:'1px solid var(--accent)', borderRadius:'8px',
          padding:'10px 16px', zIndex:60, fontSize:'13px',
          boxShadow:'0 4px 16px rgba(0,0,0,0.4)'
        }}>
          <div style={{display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
            <span style={{color:'var(--accent)'}}>↗ Offset mode</span>
            <span style={{color:'var(--text-2)'}}>Click on the canvas to place the duplicate. Or enter:</span>
            <label style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'12px',color:'var(--text-2)'}}>
              dx
              <input
                type="text"
                placeholder={`e.g. 0 ${units}`}
                id="offset-dx"
                className="form-input"
                style={{width:'90px',padding:'4px 6px',fontSize:'12px'}}
              />
            </label>
            <label style={{display:'flex',alignItems:'center',gap:'4px',fontSize:'12px',color:'var(--text-2)'}}>
              dy
              <input
                type="text"
                placeholder={`e.g. 65 ${units} (south)`}
                id="offset-dy"
                className="form-input"
                style={{width:'130px',padding:'4px 6px',fontSize:'12px'}}
              />
            </label>
            <span style={{fontSize:'11px',color:'var(--text-3)'}}>
              Plain numbers = {units}. Or suffix: ft, ", m, cm, mm, yd. +dy = south.
            </span>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                const dxEl = document.getElementById('offset-dx');
                const dyEl = document.getElementById('offset-dy');
                const dxRaw = dxEl?.value || '';
                const dyRaw = dyEl?.value || '';
                const dxPx = parseLengthToPixels(dxRaw, units, pxPerUnit);
                const dyPx = parseLengthToPixels(dyRaw, units, pxPerUnit);
                // Report which box failed so the user doesn't have to guess.
                if (dxPx === null || dyPx === null) {
                  const badBoxes = [];
                  if (dxPx === null) badBoxes.push(`dx ("${dxRaw}")`);
                  if (dyPx === null) badBoxes.push(`dy ("${dyRaw}")`);
                  window.alert(
                    `Could not read ${badBoxes.join(' and ')}.\n\n` +
                    `Accepted formats:\n` +
                    `  • A plain number — interpreted as ${units} (your drawing's units)\n` +
                    `  • With a unit suffix: "8 in", "8\\"", "65 ft", "65'", "5 m", "100 cm"\n` +
                    `  • Architectural feet-inches: "6'-6\\"", "6'6\\"", "5'"\n` +
                    `  • Leave blank for 0\n\n` +
                    `Negative values flip direction. +dy = south (down).`
                  );
                  return;
                }
                if (dxPx === 0 && dyPx === 0) return;
                offsetByVector(dxPx, dyPx);
                setOffsetMode(false);
                setOffsetAnchor(null);
              }}
            >Apply</button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => { setOffsetMode(false); setOffsetAnchor(null); }}
            >Cancel</button>
          </div>
        </div>
      )}

      {editingTextId && (() => {
        const t = shapeById.get(editingTextId);
        if (!t) return null;
        return <TextEditDialog
          shape={t}
          onCancel={() => setEditingTextId(null)}
          onCommit={(newText) => {
            const originalText = t.text;
            if (newText === originalText) {
              // No-op: just close
              setEditingTextId(null);
              return;
            }
            pushHistory();
            if (!newText.trim()) {
              setShapes(prev => prev.filter(s => s.id !== editingTextId));
            } else {
              setShapes(prev => prev.map(s => s.id === editingTextId ? { ...s, text: newText } : s));
            }
            setDirty(true);
            setEditingTextId(null);
          }}
        />;
      })()}

      <p style={{fontSize:'12px',color:'var(--text-3)',marginTop:'10px'}}>
        Shortcuts: V select (drag empty space to box-select, Shift-click to add) · L line · R rect · C circle · P polyline · A curve · F freehand · D dimension · T text · O offset · ⇋ mirror · ⊟ array · ↻ rotate · ⤢ scale · ✂ trim · ↦ extend · ◈ object snap · ⊥ ortho · Z fit-to-view · Type a digit while drawing for parametric length · Drag the handles on a selected shape to reshape it (corners for rects, vertices for polylines, radius for circles, control point for curves) · Shift+drag a rect corner to lock aspect (Shift+drag an image FREES aspect) · Ctrl/Cmd+S save · Ctrl/Cmd+D duplicate · Del to remove · Ctrl+Z undo · Ctrl+Shift+Z (or Ctrl+Y) redo · Alt+drag or ✋ to pan · scroll to zoom
      </p>
    </div>
  );
}

// ─── Tier 2 helpers ────────────────────────────────────────────────

// Parse a user-entered length string into drawing pixels.
//
// Accepts:
//   "0"               → 0 pixels (empty/blank also = 0)
//   "65"              → 65 * pxPerUnit  (treated as drawing's current units)
//   "65 ft"           → converted from ft to current units, then to pixels
//   "65ft" "65'" "65 feet"  same
//   "6'6\""           → 6 ft 6 inches → 6.5 ft → converted to pixels
//   "6'-6\""          → same (architectural notation)
//   "6'-6"            → same (closing inch mark optional)
//   "20 in" "20\"" "20 inches"  → inches
//   "5 m" "5 meter" "5 meters"   → meters
//   "200 cm" "200 mm" "10 yd"    → other metric/imperial
//   "-3 ft"           → negative offsets (move other direction)
//
// Returns null if input cannot be parsed. Returns 0 for empty/whitespace.
//
// Conversion uses inches as the canonical unit, then converts to drawing px
// via pxPerUnit (which is px-per-`drawingUnits`).
function parseLengthToPixels(input, drawingUnits, pxPerUnit) {
  if (input == null) return 0;
  // Normalize: some keyboards/OSes auto-convert " to typographic ", and copy-
  // paste from documents commonly contains primes and smart quotes. Treat all
  // of them as their straight-quote equivalents so users don't get surprise
  // rejections for typing what looks like a perfectly normal inch mark.
  //   ' (U+2032 prime), ’ ‘ (U+2019/U+2018), ` (backtick): treat as foot mark
  //   ″ (U+2033 double prime), ” “ (U+201D/U+201C): treat as inch mark
  // Also accept a leading "+" sign (the regex only allows "-?" otherwise).
  let s = String(input).trim();
  if (s === '') return 0;
  s = s
    .replace(/[\u2018\u2019\u2032\u02B9\u0060]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/^\+/, '');

  const inPerUnit = {
    in: 1, ft: 12, yd: 36,
    m: 39.3701, cm: 0.393701, mm: 0.0393701,
  };
  const drawingInPerUnit = inPerUnit[drawingUnits] || 1;
  const pxPerInch = pxPerUnit / drawingInPerUnit;

  // Architectural feet-inches: 6'6"  6'-6"  6'-6  6'6  6'  -6'6"
  // Captures: optional sign, feet, optional inches.
  const archMatch = s.match(/^(-?)(\d+(?:\.\d+)?)\s*'\s*-?\s*(\d+(?:\.\d+)?)?\s*"?$/);
  if (archMatch) {
    const sign = archMatch[1] === '-' ? -1 : 1;
    const feet = parseFloat(archMatch[2]);
    const inches = archMatch[3] != null ? parseFloat(archMatch[3]) : 0;
    if (!Number.isFinite(feet) || !Number.isFinite(inches)) return null;
    const totalInches = sign * (feet * 12 + inches);
    return totalInches * pxPerInch;
  }

  // Plain inches with double-quote: 20"  -20"
  const inchMatch = s.match(/^(-?\d+(?:\.\d+)?)\s*"$/);
  if (inchMatch) {
    const inches = parseFloat(inchMatch[1]);
    if (!Number.isFinite(inches)) return null;
    return inches * pxPerInch;
  }

  // <number><unit>  or  <number> <unit>
  // Or just <number> with no unit (interpreted as drawing's current units)
  const numericMatch = s.match(
    /^(-?\d+(?:\.\d+)?)\s*(in|inch|inches|ft|feet|foot|yd|yard|yards|m|meter|meters|metre|metres|cm|centimeter|centimeters|centimetre|centimetres|mm|millimeter|millimeters|millimetre|millimetres|px|pixels?)?$/i
  );
  if (!numericMatch) return null;
  const value = parseFloat(numericMatch[1]);
  if (!Number.isFinite(value)) return null;
  const rawUnit = (numericMatch[2] || '').toLowerCase();
  // Normalize unit aliases
  const unitMap = {
    '': drawingUnits,  // no suffix → drawing's current units
    in: 'in', inch: 'in', inches: 'in',
    ft: 'ft', feet: 'ft', foot: 'ft',
    yd: 'yd', yard: 'yd', yards: 'yd',
    m: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm',
    cm: 'cm', centimeter: 'cm', centimeters: 'cm', centimetre: 'cm', centimetres: 'cm',
    mm: 'mm', millimeter: 'mm', millimeters: 'mm', millimetre: 'mm', millimetres: 'mm',
    px: 'px', pixel: 'px', pixels: 'px',
  };
  const unit = unitMap[rawUnit];
  if (unit === undefined) return null;
  if (unit === 'px') return value;  // Raw drawing pixels — passthrough
  const inches = value * (inPerUnit[unit] || 1);
  return inches * pxPerInch;
}

function parseParametric(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  if (!/^-?\d/.test(s)) return null;
  if (s.includes(',')) {
    const parts = s.split(',').map(p => p.trim());
    if (parts.length !== 2) return null;
    const dx = Number(parts[0]);
    const dy = Number(parts[1]);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    return { kind: 'delta', dx, dy };
  }
  if (s.includes('<')) {
    const parts = s.split('<').map(p => p.trim());
    if (parts.length !== 2) return null;
    const length = Number(parts[0]);
    const angleDeg = Number(parts[1]);
    if (!Number.isFinite(length) || !Number.isFinite(angleDeg)) return null;
    return { kind: 'lengthAngle', length, angleDeg };
  }
  const length = Number(s);
  if (!Number.isFinite(length)) return null;
  return { kind: 'length', length };
}

function applyParametric(parsed, anchor, cursor, pxPerUnit) {
  if (!parsed || !anchor) return null;
  if (parsed.kind === 'length') {
    if (!cursor) return null;
    const dx = cursor.x - anchor.x;
    const dy = cursor.y - anchor.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) {
      return { x: anchor.x + parsed.length * pxPerUnit, y: anchor.y };
    }
    const ux = dx / len, uy = dy / len;
    const L = parsed.length * pxPerUnit;
    return { x: anchor.x + ux * L, y: anchor.y + uy * L };
  }
  if (parsed.kind === 'lengthAngle') {
    const L = parsed.length * pxPerUnit;
    const rad = (parsed.angleDeg * Math.PI) / 180;
    return {
      x: anchor.x + Math.cos(rad) * L,
      y: anchor.y - Math.sin(rad) * L,
    };
  }
  if (parsed.kind === 'delta') {
    return {
      x: anchor.x + parsed.dx * pxPerUnit,
      y: anchor.y + parsed.dy * pxPerUnit,
    };
  }
  return null;
}

function reflectPoint(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx*dx + dy*dy;
  if (len2 === 0) return { x: p.x, y: p.y };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return { x: 2 * projX - p.x, y: 2 * projY - p.y };
}

function mirrorShape(s, axis) {
  const ref = (pt) => reflectPoint(pt, axis.a, axis.b);
  switch (s.type) {
    case 'line':
    case 'dimension': {
      const p1 = ref({ x: s.x1, y: s.y1 });
      const p2 = ref({ x: s.x2, y: s.y2 });
      return { ...s, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
    }
    case 'image':
      // Mirroring a reference image isn't well-defined — the raster content
      // would need its own flip (SVG scale(-1, 1)) to truly mirror, and most
      // users mirror to build symmetric geometry, not to flip a photo. Leave
      // the image untouched.
      return s;
    case 'rect': {
      // Reflect the center; new rotation = 2·(axis angle) − θ.
      // Axis angle in our CCW-y-down convention: atan2(-(b.y - a.y), b.x - a.x).
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      const newC = ref({ x: cx, y: cy });
      const dx = axis.b.x - axis.a.x, dy = axis.b.y - axis.a.y;
      const phi = Math.atan2(-dy, dx) * 180 / Math.PI;
      const theta = s.rotation || 0;
      const newRot = 2 * phi - theta;
      return {
        ...s,
        x: newC.x - s.w / 2,
        y: newC.y - s.h / 2,
        rotation: newRot,
      };
    }
    case 'circle': {
      const c = ref({ x: s.cx, y: s.cy });
      return { ...s, cx: c.x, cy: c.y };
    }
    case 'text': {
      const p = ref({ x: s.x, y: s.y });
      return { ...s, x: p.x, y: p.y };
    }
    case 'polyline':
    case 'freehand':
      return { ...s, points: s.points.map(ref) };
    case 'bezier': {
      const p1 = ref({ x: s.x1, y: s.y1 });
      const p2 = ref({ x: s.x2, y: s.y2 });
      const c = ref({ x: s.cx, y: s.cy });
      return { ...s, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, cx: c.x, cy: c.y };
    }
    default: return s;
  }
}

function rotatePoint(p, c, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = p.x - c.x, dy = p.y - c.y;
  return {
    x: c.x + dx * cos + dy * sin,
    y: c.y - dx * sin + dy * cos,
  };
}

function shapeCenter(s) {
  switch (s.type) {
    case 'instance': return { x: s.x, y: s.y };
    case 'rect':
    case 'image': return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
    case 'circle': return { x: s.cx, y: s.cy };
    case 'line':
    case 'dimension': return { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
    case 'bezier': return { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
    case 'text': return { x: s.x, y: s.y };
    case 'polyline':
    case 'freehand': {
      if (!s.points || s.points.length === 0) return { x: 0, y: 0 };
      const xs = s.points.map(p => p.x);
      const ys = s.points.map(p => p.y);
      return {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      };
    }
    default: return { x: 0, y: 0 };
  }
}

function rotateShape(s, center, angleDeg) {
  const rot = (pt) => rotatePoint(pt, center, angleDeg);
  switch (s.type) {
    case 'line':
    case 'dimension': {
      const p1 = rot({ x: s.x1, y: s.y1 });
      const p2 = rot({ x: s.x2, y: s.y2 });
      return { ...s, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
    }
    case 'rect':
    case 'image': {
      // Rotate the geometric center around the pivot, accumulate rotation.
      const cur = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
      const newC = rot(cur);
      return {
        ...s,
        x: newC.x - s.w / 2,
        y: newC.y - s.h / 2,
        rotation: (s.rotation || 0) + angleDeg,
      };
    }
    case 'circle': {
      const c = rot({ x: s.cx, y: s.cy });
      return { ...s, cx: c.x, cy: c.y };
    }
    case 'text': {
      const p = rot({ x: s.x, y: s.y });
      return { ...s, x: p.x, y: p.y };
    }
    case 'polyline':
    case 'freehand':
      return { ...s, points: s.points.map(rot) };
    case 'bezier': {
      const p1 = rot({ x: s.x1, y: s.y1 });
      const p2 = rot({ x: s.x2, y: s.y2 });
      const c = rot({ x: s.cx, y: s.cy });
      return { ...s, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, cx: c.x, cy: c.y };
    }
    default: return s;
  }
}

function arrayShapes(s, rows, cols, dx, dy) {
  if (rows < 1 || cols < 1) return [];
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 0) continue;
      const tx = c * dx, ty = r * dy;
      const moved = translateShape(s, tx, ty);
      const id = 'sh_' + Date.now() + '_' + r + '_' + c + '_' + Math.random().toString(36).slice(2, 5);
      out.push({ ...moved, id });
    }
  }
  return out;
}

function translateShape(s, dx, dy) {
  switch (s.type) {
    case 'instance':
      return { ...s, x: s.x + dx, y: s.y + dy };
    case 'line':
    case 'dimension':
      return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
    case 'rect':
    case 'image':
      return { ...s, x: s.x + dx, y: s.y + dy };
    case 'circle':
      return { ...s, cx: s.cx + dx, cy: s.cy + dy };
    case 'text':
      return { ...s, x: s.x + dx, y: s.y + dy };
    case 'polyline':
    case 'freehand':
      return { ...s, points: s.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
    case 'bezier':
      return {
        ...s,
        x1: s.x1 + dx, y1: s.y1 + dy,
        x2: s.x2 + dx, y2: s.y2 + dy,
        cx: s.cx + dx, cy: s.cy + dy,
      };
    default:
      return s;
  }
}

// ─── Tier 3 helpers ─────────────────────────────────────────────────

function scaleShape(s, factor, origin = { x: 0, y: 0 }) {
  const sp = (p) => ({ x: origin.x + (p.x - origin.x) * factor, y: origin.y + (p.y - origin.y) * factor });
  switch (s.type) {
    case 'line':
    case 'dimension': {
      const p1 = sp({ x: s.x1, y: s.y1 });
      const p2 = sp({ x: s.x2, y: s.y2 });
      return { ...s, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
    }
    case 'rect':
    case 'image': {
      const tl = sp({ x: s.x, y: s.y });
      return { ...s, x: tl.x, y: tl.y, w: s.w * factor, h: s.h * factor };
    }
    case 'circle': {
      const c = sp({ x: s.cx, y: s.cy });
      return { ...s, cx: c.x, cy: c.y, r: s.r * factor };
    }
    case 'text': {
      const p = sp({ x: s.x, y: s.y });
      return { ...s, x: p.x, y: p.y, fontSize: (s.fontSize || 18) * factor };
    }
    case 'polyline':
    case 'freehand':
      return { ...s, points: s.points.map(sp) };
    case 'bezier': {
      const p1 = sp({ x: s.x1, y: s.y1 });
      const p2 = sp({ x: s.x2, y: s.y2 });
      const c = sp({ x: s.cx, y: s.cy });
      return { ...s, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, cx: c.x, cy: c.y };
    }
    default: return s;
  }
}

function transformShapeForInstance(blockShape, instance) {
  let s = blockShape;
  const scale = instance.scale || 1;
  if (scale !== 1) s = scaleShape(s, scale, { x: 0, y: 0 });
  const rot = instance.rotation || 0;
  if (rot !== 0) s = rotateShape(s, { x: 0, y: 0 }, rot);
  s = translateShape(s, instance.x || 0, instance.y || 0);
  return s;
}

function expandInstance(instance, blocks) {
  const block = blocks.find(b => b.id === instance.blockId);
  if (!block) return [];
  return block.shapes.map(bs => {
    const transformed = transformShapeForInstance(bs, instance);
    return { ...transformed, id: `${instance.id}_${bs.id}` };
  });
}

function dxfWrite(shapes) {
  const lines = [];
  const out = (code, value) => { lines.push(String(code)); lines.push(String(value)); };
  out(0, 'SECTION'); out(2, 'HEADER');
  out(9, '$ACADVER'); out(1, 'AC1015');
  out(0, 'ENDSEC');
  out(0, 'SECTION'); out(2, 'TABLES');
  out(0, 'TABLE'); out(2, 'LAYER'); out(70, 1);
  out(0, 'LAYER'); out(2, '0'); out(70, 0); out(62, 7); out(6, 'CONTINUOUS');
  out(0, 'ENDTAB');
  out(0, 'ENDSEC');
  out(0, 'SECTION'); out(2, 'ENTITIES');
  for (const s of shapes) {
    if (s.type === 'image') {
      // DXF has no clean way to embed raster images. Skip them — they're
      // reference-only background, not part of the drafted geometry.
      continue;
    }
    if (s.type === 'line') {
      out(0, 'LINE'); out(8, '0');
      out(10, s.x1); out(20, -s.y1); out(30, 0);
      out(11, s.x2); out(21, -s.y2); out(31, 0);
    } else if (s.type === 'rect') {
      out(0, 'LWPOLYLINE'); out(8, '0');
      out(90, 4); out(70, 1);
      const rot = s.rotation || 0;
      if (rot === 0) {
        out(10, s.x);       out(20, -s.y);
        out(10, s.x + s.w); out(20, -s.y);
        out(10, s.x + s.w); out(20, -(s.y + s.h));
        out(10, s.x);       out(20, -(s.y + s.h));
      } else {
        const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
        const rad = (rot * Math.PI) / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const rp = (px, py) => {
          const dx = px - cx, dy = py - cy;
          return { x: cx + dx * cos + dy * sin, y: cy - dx * sin + dy * cos };
        };
        const c1 = rp(s.x, s.y), c2 = rp(s.x + s.w, s.y),
              c3 = rp(s.x + s.w, s.y + s.h), c4 = rp(s.x, s.y + s.h);
        out(10, c1.x); out(20, -c1.y);
        out(10, c2.x); out(20, -c2.y);
        out(10, c3.x); out(20, -c3.y);
        out(10, c4.x); out(20, -c4.y);
      }
    } else if (s.type === 'circle') {
      out(0, 'CIRCLE'); out(8, '0');
      out(10, s.cx); out(20, -s.cy); out(30, 0);
      out(40, s.r);
    } else if (s.type === 'polyline' || s.type === 'freehand') {
      if (!s.points || s.points.length < 2) continue;
      out(0, 'LWPOLYLINE'); out(8, '0');
      out(90, s.points.length); out(70, 0);
      for (const p of s.points) { out(10, p.x); out(20, -p.y); }
    } else if (s.type === 'text') {
      out(0, 'TEXT'); out(8, '0');
      out(10, s.x); out(20, -s.y); out(30, 0);
      out(40, s.fontSize || 18);
      out(1, s.text || '');
    } else if (s.type === 'dimension') {
      out(0, 'LINE'); out(8, '0');
      out(10, s.x1); out(20, -s.y1); out(30, 0);
      out(11, s.x2); out(21, -s.y2); out(31, 0);
    }
  }
  out(0, 'ENDSEC');
  out(0, 'EOF');
  return lines.join('\n');
}

function dxfParse(text) {
  const rawLines = text.replace(/\r\n/g, '\n').split('\n').map(l => l.trim());
  const pairs = [];
  for (let i = 0; i + 1 < rawLines.length; i += 2) {
    const code = parseInt(rawLines[i], 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: rawLines[i + 1] });
  }
  const shapes = [];
  let inEntities = false;
  let cur = null;
  const flushCur = () => {
    if (!cur) return;
    const baseId = 'imp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    if (cur._type === 'LINE') {
      shapes.push({
        id: baseId, type: 'line',
        x1: cur[10] || 0, y1: -(cur[20] || 0),
        x2: cur[11] || 0, y2: -(cur[21] || 0),
        stroke: '#e8eaf0', strokeWidth: 2,
      });
    } else if (cur._type === 'CIRCLE') {
      shapes.push({
        id: baseId, type: 'circle',
        cx: cur[10] || 0, cy: -(cur[20] || 0),
        r: cur[40] || 0,
        stroke: '#e8eaf0', strokeWidth: 2, fill: 'none',
      });
    } else if (cur._type === 'LWPOLYLINE') {
      const pts = (cur._vertices || []).map(v => ({ x: v.x, y: -v.y }));
      if (pts.length >= 2) {
        const closed = (cur[70] & 1) === 1;
        if (closed && pts.length === 4) {
          const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
          const uniqueXs = Array.from(new Set(xs.map(v => v.toFixed(3))));
          const uniqueYs = Array.from(new Set(ys.map(v => v.toFixed(3))));
          if (uniqueXs.length === 2 && uniqueYs.length === 2) {
            const x = Math.min(...xs), y = Math.min(...ys);
            shapes.push({
              id: baseId, type: 'rect',
              x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y,
              stroke: '#e8eaf0', strokeWidth: 2, fill: 'none',
            });
            cur = null;
            return;
          }
        }
        const ptsClosed = closed && (pts[0].x !== pts[pts.length-1].x || pts[0].y !== pts[pts.length-1].y)
          ? [...pts, pts[0]] : pts;
        shapes.push({
          id: baseId, type: 'polyline',
          points: ptsClosed,
          stroke: '#e8eaf0', strokeWidth: 2,
        });
      }
    } else if (cur._type === 'TEXT') {
      shapes.push({
        id: baseId, type: 'text',
        x: cur[10] || 0, y: -(cur[20] || 0),
        text: cur[1] || '',
        fontSize: cur[40] || 18,
        stroke: '#e8eaf0',
      });
    }
    cur = null;
  };
  for (let i = 0; i < pairs.length; i++) {
    const { code, value } = pairs[i];
    if (code === 0) {
      flushCur();
      if (value === 'SECTION') {
        if (i + 1 < pairs.length && pairs[i + 1].code === 2 && pairs[i + 1].value === 'ENTITIES') {
          inEntities = true;
        } else {
          inEntities = false;
        }
        continue;
      }
      if (value === 'ENDSEC') { inEntities = false; continue; }
      if (value === 'EOF') break;
      if (!inEntities) continue;
      if (value === 'LINE' || value === 'CIRCLE' || value === 'LWPOLYLINE' || value === 'TEXT' || value === 'POLYLINE') {
        cur = { _type: value === 'POLYLINE' ? 'LWPOLYLINE' : value };
      }
      continue;
    }
    if (!inEntities || !cur) continue;
    const num = parseFloat(value);
    if (cur._type === 'LWPOLYLINE' && code === 10) {
      cur._vertices = cur._vertices || [];
      cur._vertices.push({ x: num, y: 0 });
    } else if (cur._type === 'LWPOLYLINE' && code === 20) {
      const last = cur._vertices && cur._vertices[cur._vertices.length - 1];
      if (last) last.y = num;
    } else if (code === 1) {
      cur[1] = value;
    } else if (!Number.isNaN(num)) {
      cur[code] = num;
    }
  }
  flushCur();
  return shapes;
}

function unitToInches(unit) {
  if (unit === 'in') return 1;
  if (unit === 'ft') return 12;
  if (unit === 'm')  return 39.3701;
  if (unit === 'mm') return 0.0393701;
  return 1;
}

function computePdfTransform(units, pxPerUnit, pdfScale) {
  const { paperUnit, paperLen, drawingUnit, drawingLen } = pdfScale;
  const paperInPerDrawingIn = (unitToInches(paperUnit) * paperLen) /
                              (unitToInches(drawingUnit) * drawingLen);
  const paperPtPerDrawingIn = paperInPerDrawingIn * 72;
  const drawingInPerPx = unitToInches(units) / pxPerUnit;
  return paperPtPerDrawingIn * drawingInPerPx;
}

function cloneShapeWithNewId(s) {
  const id = 'sh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  return { ...s, id };
}

function ArrayDialog({ shape, units, pxPerUnit, onCancel, onApply }) {
  const [rows, setRows] = useState(1);
  const [cols, setCols] = useState(5);
  // Spacing default: shape's bbox width/height in current units
  const defaultDxUnits = (() => {
    if (shape.type === 'rect') return shape.w / pxPerUnit + 1;
    if (shape.type === 'circle') return (shape.r * 2) / pxPerUnit + 1;
    return 5;
  })();
  const [dxUnits, setDxUnits] = useState(defaultDxUnits);
  const [dyUnits, setDyUnits] = useState(defaultDxUnits);
  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.5)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:100,
    }} onClick={onCancel}>
      <div style={{background:'var(--bg-card)',padding:'20px',borderRadius:'8px',minWidth:'320px',border:'1px solid var(--border)'}} onClick={e => e.stopPropagation()}>
        <h3 style={{margin:'0 0 14px 0'}}>Array — rows × cols</h3>
        <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'8px 10px',alignItems:'center',fontSize:'13px'}}>
          <label>Rows</label>
          <input type="number" min="1" value={rows} onChange={e => setRows(Math.max(1, Number(e.target.value) || 1))} className="form-input" />
          <label>Columns</label>
          <input type="number" min="1" value={cols} onChange={e => setCols(Math.max(1, Number(e.target.value) || 1))} className="form-input" />
          <label>Column spacing ({units})</label>
          <input type="number" step="0.1" value={dxUnits} onChange={e => setDxUnits(Number(e.target.value))} className="form-input" />
          <label>Row spacing ({units})</label>
          <input type="number" step="0.1" value={dyUnits} onChange={e => setDyUnits(Number(e.target.value))} className="form-input" />
        </div>
        <p style={{fontSize:'11px',color:'var(--text-3)',marginTop:'10px'}}>Will create {rows * cols - 1} additional copies.</p>
        <div style={{display:'flex',gap:'8px',justifyContent:'flex-end',marginTop:'14px'}}>
          <button className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={() => onApply(rows, cols, dxUnits * pxPerUnit, dyUnits * pxPerUnit)}>Create</button>
        </div>
      </div>
    </div>
  );
}

function ScaleDialog({ shape, units, pxPerUnit, onCancel, onApply }) {
  const [mode, setMode] = useState('factor'); // 'factor' or 'target'
  const [factor, setFactor] = useState(2);
  const [target, setTarget] = useState(10); // in current units
  const [targetDim, setTargetDim] = useState('w'); // 'w' or 'h'
  const [keepOriginal, setKeepOriginal] = useState(false);

  // Compute current dimensions in real-world units for the "match dimension" UI
  const currentW = shape.w != null ? shape.w / pxPerUnit : null;
  const currentH = shape.h != null ? shape.h / pxPerUnit : null;
  const hasWH = currentW != null && currentH != null;

  function handleApply() {
    let f;
    if (mode === 'factor') {
      f = factor;
    } else if (hasWH) {
      const currentDim = targetDim === 'w' ? currentW : currentH;
      if (!currentDim || currentDim === 0) return;
      f = target / currentDim;
    } else {
      // shape has no w/h — fall back to factor anyway
      f = factor;
    }
    if (!Number.isFinite(f) || f <= 0) return;
    onApply(f, keepOriginal);
  }

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.5)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:100,
    }} onClick={onCancel}>
      <div style={{background:'var(--bg-card)',padding:'20px',borderRadius:'8px',minWidth:'340px',border:'1px solid var(--border)'}} onClick={e => e.stopPropagation()}>
        <h3 style={{margin:'0 0 14px 0'}}>Scale</h3>
        <div style={{display:'flex',gap:'8px',marginBottom:'12px'}}>
          <button
            className={`btn btn-sm ${mode === 'factor' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setMode('factor')}
            style={{flex:1}}
          >By factor</button>
          <button
            className={`btn btn-sm ${mode === 'target' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setMode('target')}
            disabled={!hasWH}
            style={{flex:1, opacity: hasWH ? 1 : 0.4}}
            title={hasWH ? '' : 'Only available for shapes with width/height (rect, image)'}
          >Match dimension</button>
        </div>
        {mode === 'factor' ? (
          <>
            <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'8px 10px',alignItems:'center',fontSize:'13px'}}>
              <label>Factor</label>
              <input type="number" value={factor} onChange={e => setFactor(Number(e.target.value))} step="0.1" min="0.01" className="form-input" autoFocus />
            </div>
            <div style={{display:'flex',gap:'6px',marginTop:'8px',flexWrap:'wrap'}}>
              {[0.25, 0.5, 0.75, 1.5, 2, 3, 4].map(f => (
                <button key={f} className="btn btn-sm btn-ghost" onClick={() => setFactor(f)}>×{f}</button>
              ))}
            </div>
            <p style={{fontSize:'11px',color:'var(--text-3)',marginTop:'8px',marginBottom:0}}>
              Scales the shape around its center. e.g. 2 doubles size, 0.5 halves.
            </p>
          </>
        ) : (
          <>
            <div style={{fontSize:'12px',color:'var(--text-2)',marginBottom:'8px'}}>
              Current: {currentW != null && `W ${currentW.toFixed(2)} ${units}`}{currentH != null && `, H ${currentH.toFixed(2)} ${units}`}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'auto 1fr auto',gap:'8px 10px',alignItems:'center',fontSize:'13px'}}>
              <label>Make</label>
              <select value={targetDim} onChange={e => setTargetDim(e.target.value)} className="form-input">
                <option value="w">Width</option>
                <option value="h">Height</option>
              </select>
              <span>=</span>
              <span></span>
              <input type="number" value={target} onChange={e => setTarget(Number(e.target.value))} step="0.1" min="0.01" className="form-input" autoFocus />
              <span>{units}</span>
            </div>
            <p style={{fontSize:'11px',color:'var(--text-3)',marginTop:'8px',marginBottom:0}}>
              Scales uniformly (preserves aspect ratio) so the chosen dimension hits the target.
            </p>
          </>
        )}
        <label style={{display:'flex',alignItems:'center',gap:'8px',marginTop:'12px',fontSize:'13px',color:'var(--text-2)'}}>
          <input type="checkbox" checked={keepOriginal} onChange={e => setKeepOriginal(e.target.checked)} />
          Keep original (copy + scale)
        </label>
        <div style={{display:'flex',gap:'8px',justifyContent:'flex-end',marginTop:'14px'}}>
          <button className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={handleApply}>Apply</button>
        </div>
      </div>
    </div>
  );
}

function RotateDialog({ shape, onCancel, onApply }) {
  const [angle, setAngle] = useState(90);
  const [keepOriginal, setKeepOriginal] = useState(false);
  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.5)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:100,
    }} onClick={onCancel}>
      <div style={{background:'var(--bg-card)',padding:'20px',borderRadius:'8px',minWidth:'300px',border:'1px solid var(--border)'}} onClick={e => e.stopPropagation()}>
        <h3 style={{margin:'0 0 14px 0'}}>Rotate</h3>
        <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'8px 10px',alignItems:'center',fontSize:'13px'}}>
          <label>Angle (°)</label>
          <input type="number" value={angle} onChange={e => setAngle(Number(e.target.value))} className="form-input" autoFocus />
        </div>
        <div style={{display:'flex',gap:'6px',marginTop:'8px'}}>
          {[-90, -45, 45, 90, 180].map(a => (
            <button key={a} className="btn btn-sm btn-ghost" onClick={() => setAngle(a)}>{a > 0 ? `+${a}` : a}°</button>
          ))}
        </div>
        <label style={{display:'flex',alignItems:'center',gap:'8px',marginTop:'12px',fontSize:'13px',color:'var(--text-2)'}}>
          <input type="checkbox" checked={keepOriginal} onChange={e => setKeepOriginal(e.target.checked)} />
          Keep original (copy + rotate)
        </label>
        <p style={{fontSize:'11px',color:'var(--text-3)',marginTop:'8px'}}>Rotates around shape's center. Positive angle = CCW.</p>
        <div style={{display:'flex',gap:'8px',justifyContent:'flex-end',marginTop:'14px'}}>
          <button className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={() => onApply(angle, keepOriginal)}>Apply</button>
        </div>
      </div>
    </div>
  );
}

// Input that owns its text locally and only commits on blur or Enter. Prevents
// per-keystroke pushHistory floods. Pass commit(newName) which the parent uses
// to pushHistory + update state once. Falls back to the original value if the
// user blurs with empty text (preserving the prior name).
function InlineRenameInput({ value, onCommit, disabled, className, style, title }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  // Re-sync when the underlying value changes (e.g. undo)
  useEffect(() => { if (!focused) setDraft(value); }, [value, focused]);
  function commit() {
    const trimmed = draft.trim();
    if (trimmed === '' || trimmed === value) {
      setDraft(value);
      return;
    }
    onCommit(trimmed);
  }
  return (
    <input
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.target.blur(); }
        if (e.key === 'Escape') { setDraft(value); e.target.blur(); }
      }}
      onClick={e => e.stopPropagation()}
      disabled={disabled}
      className={className}
      style={style}
      title={title}
    />
  );
}

function TextEditDialog({ shape, onCancel, onCommit }) {
  const [text, setText] = useState(shape.text || '');
  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.5)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:100
    }} onClick={onCancel}>
      <div style={{background:'var(--bg-card)',padding:'20px',borderRadius:'8px',minWidth:'300px',border:'1px solid var(--border)'}} onClick={e => e.stopPropagation()}>
        <h3 style={{margin:'0 0 12px 0'}}>Edit text</h3>
        <input
          className="form-input"
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onCommit(text); }}
          style={{width:'100%'}}
        />
        <div style={{display:'flex',gap:'8px',justifyContent:'flex-end',marginTop:'12px'}}>
          <button className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={() => onCommit(text)}>Done</button>
        </div>
      </div>
    </div>
  );
}

function CreateBlockDialog({ defaultName, onCancel, onCreate }) {
  const [name, setName] = useState(defaultName);
  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.5)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:100,
    }} onClick={onCancel}>
      <div style={{background:'var(--bg-card)',padding:'20px',borderRadius:'8px',minWidth:'300px',border:'1px solid var(--border)'}} onClick={e => e.stopPropagation()}>
        <h3 style={{margin:'0 0 14px 0'}}>Create block</h3>
        <p style={{fontSize:'12px',color:'var(--text-2)',margin:'0 0 10px 0'}}>The selected shape will be saved as a reusable block. The shape stays on canvas as an instance.</p>
        <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'8px 10px',alignItems:'center',fontSize:'13px'}}>
          <label>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} className="form-input" autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onCreate(name.trim()); }}
          />
        </div>
        <div style={{display:'flex',gap:'8px',justifyContent:'flex-end',marginTop:'14px'}}>
          <button className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={() => name.trim() && onCreate(name.trim())} disabled={!name.trim()}>Create</button>
        </div>
      </div>
    </div>
  );
}

const PAPER_SIZES = [
  { name: 'Letter (8.5×11)', w: 8.5, h: 11 },
  { name: 'Letter landscape (11×8.5)', w: 11, h: 8.5 },
  { name: 'Tabloid / 11×17', w: 11, h: 17 },
  { name: 'Tabloid landscape / 17×11', w: 17, h: 11 },
  { name: 'Arch C / 18×24', w: 18, h: 24 },
  { name: 'Arch D / 24×36', w: 24, h: 36 },
  { name: 'Arch E / 36×48', w: 36, h: 48 },
  { name: 'A4 (210×297mm)', w: 8.27, h: 11.69 },
  { name: 'A3 (297×420mm)', w: 11.69, h: 16.54 },
];

const COMMON_SCALES_FT = [
  { label: '1" = 1\'', paperLen: 1, paperUnit: 'in', drawingLen: 1, drawingUnit: 'ft' },
  { label: '1/2" = 1\'', paperLen: 0.5, paperUnit: 'in', drawingLen: 1, drawingUnit: 'ft' },
  { label: '1/4" = 1\' (most common)', paperLen: 0.25, paperUnit: 'in', drawingLen: 1, drawingUnit: 'ft' },
  { label: '1/8" = 1\'', paperLen: 0.125, paperUnit: 'in', drawingLen: 1, drawingUnit: 'ft' },
  { label: '1" = 10\'', paperLen: 1, paperUnit: 'in', drawingLen: 10, drawingUnit: 'ft' },
  { label: '1" = 20\'', paperLen: 1, paperUnit: 'in', drawingLen: 20, drawingUnit: 'ft' },
  { label: '1" = 30\'', paperLen: 1, paperUnit: 'in', drawingLen: 30, drawingUnit: 'ft' },
  { label: '1" = 40\'', paperLen: 1, paperUnit: 'in', drawingLen: 40, drawingUnit: 'ft' },
  { label: '1" = 50\'', paperLen: 1, paperUnit: 'in', drawingLen: 50, drawingUnit: 'ft' },
];

const COMMON_SCALES_METRIC = [
  { label: '1:50',  paperLen: 1, paperUnit: 'mm', drawingLen: 50,   drawingUnit: 'mm' },
  { label: '1:100', paperLen: 1, paperUnit: 'mm', drawingLen: 100,  drawingUnit: 'mm' },
  { label: '1:200', paperLen: 1, paperUnit: 'mm', drawingLen: 200,  drawingUnit: 'mm' },
  { label: '1:500', paperLen: 1, paperUnit: 'mm', drawingLen: 500,  drawingUnit: 'mm' },
  { label: '1:1000',paperLen: 1, paperUnit: 'mm', drawingLen: 1000, drawingUnit: 'mm' },
];

function PdfExportDialog({ units, onCancel, onExport }) {
  const isMetric = (units === 'm' || units === 'mm');
  const scaleOptions = isMetric ? COMMON_SCALES_METRIC : COMMON_SCALES_FT;
  const [paperIdx, setPaperIdx] = useState(isMetric ? 7 : 3);
  const [scaleIdx, setScaleIdx] = useState(isMetric ? 1 : 4);
  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.5)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:100,
    }} onClick={onCancel}>
      <div style={{background:'var(--bg-card)',padding:'20px',borderRadius:'8px',minWidth:'380px',border:'1px solid var(--border)'}} onClick={e => e.stopPropagation()}>
        <h3 style={{margin:'0 0 14px 0'}}>Export PDF (to scale)</h3>
        <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'10px',alignItems:'center',fontSize:'13px'}}>
          <label>Paper size</label>
          <select value={paperIdx} onChange={e => setPaperIdx(Number(e.target.value))} className="form-input">
            {PAPER_SIZES.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
          </select>
          <label>Drawing scale</label>
          <select value={scaleIdx} onChange={e => setScaleIdx(Number(e.target.value))} className="form-input">
            {scaleOptions.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
          </select>
        </div>
        <p style={{fontSize:'11px',color:'var(--text-3)',marginTop:'10px'}}>
          The PDF will be printed so measurements are physically correct at the selected scale.
          If the drawing doesn't fit at this scale, you'll be warned.
        </p>
        <div style={{display:'flex',gap:'8px',justifyContent:'flex-end',marginTop:'14px'}}>
          <button className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={() => {
            const { label, ...scale } = scaleOptions[scaleIdx];
            onExport(PAPER_SIZES[paperIdx], scale);
          }}>Export PDF</button>
        </div>
      </div>
    </div>
  );
}

function renderShape(s, selected, ctx) {
  const stroke = selected ? '#6c63ff' : s.stroke;
  const sw = selected ? (s.strokeWidth || 2) + 1.5 : s.strokeWidth;
  // Resolve fill from fillStyle: 'none', 'solid', or pattern ids 'hatch'/'crosshatch'/'dots'
  let fill = s.fill || 'none';
  if (s.fillStyle && s.fillStyle !== 'none') {
    if (s.fillStyle === 'solid') fill = s.fillColor || stroke;
    else fill = `url(#pattern-${s.fillStyle}-${(s.fillColor || stroke).replace('#', '')})`;
  }
  const common = { stroke, strokeWidth: sw, fill, strokeLinecap: 'round', strokeLinejoin: 'round' };
  if (s.type === 'line') {
    return <line key={s.id} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} {...common} fill="none" />;
  }
  if (s.type === 'image') {
    const rot = s.rotation || 0;
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    const opacity = s.opacity != null ? s.opacity : 0.7;
    const transform = rot === 0 ? undefined : `rotate(${-rot} ${cx} ${cy})`;
    return (
      <g key={s.id} transform={transform}>
        <image
          href={s.src}
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          opacity={opacity}
          preserveAspectRatio="none"
          pointerEvents="none"
        />
        <rect
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          fill="transparent"
          stroke={selected ? '#6c63ff' : 'none'}
          strokeWidth={selected ? 2 : 0}
          strokeDasharray={selected ? '6,4' : undefined}
        />
      </g>
    );
  }
  if (s.type === 'rect') {
    // Normalize negative w/h so the draft preview is visible when dragging
    // from bottom-right to top-left.
    const x = s.w >= 0 ? s.x : s.x + s.w;
    const y = s.h >= 0 ? s.y : s.y + s.h;
    const w = Math.abs(s.w);
    const h = Math.abs(s.h);
    const rot = s.rotation || 0;
    if (rot === 0) {
      return <rect key={s.id} x={x} y={y} width={w} height={h} {...common} />;
    }
    // SVG rotate() is CW in screen coords; our rotation convention is CCW. Negate.
    const cx = x + w / 2, cy = y + h / 2;
    return <rect key={s.id} x={x} y={y} width={w} height={h} transform={`rotate(${-rot} ${cx} ${cy})`} {...common} />;
  }
  if (s.type === 'circle') {
    return <circle key={s.id} cx={s.cx} cy={s.cy} r={s.r} {...common} />;
  }
  if (s.type === 'polyline') {
    if (!s.points || s.points.length < 2) return null;
    const pts = s.points.map(p => `${p.x},${p.y}`).join(' ');
    // Closed polyline (first==last) gets fill; otherwise no fill
    const isClosed = s.closed || (
      s.points.length > 2 &&
      Math.abs(s.points[0].x - s.points[s.points.length - 1].x) < 0.01 &&
      Math.abs(s.points[0].y - s.points[s.points.length - 1].y) < 0.01
    );
    if (isClosed) {
      return <polygon key={s.id} points={pts} {...common} />;
    }
    return <polyline key={s.id} points={pts} {...common} fill="none" />;
  }
  if (s.type === 'dimension') {
    const { x1, y1, x2, y2 } = s;
    const lenPx = Math.hypot(x2 - x1, y2 - y1);
    const label = ctx && ctx.units && ctx.pxPerUnit
      ? formatLength(lenPx, ctx.units, ctx.pxPerUnit)
      : `${Math.round(lenPx)} px`;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const tick = 8;
    const px = Math.cos(angle + Math.PI / 2) * tick;
    const py = Math.sin(angle + Math.PI / 2) * tick;
    const lx = mx + Math.cos(angle + Math.PI / 2) * 14;
    const ly = my + Math.sin(angle + Math.PI / 2) * 14;
    let deg = (angle * 180) / Math.PI;
    if (deg > 90 || deg < -90) deg += 180;
    return (
      <g key={s.id}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} />
        <line x1={x1 - px} y1={y1 - py} x2={x1 + px} y2={y1 + py} {...common} />
        <line x1={x2 - px} y1={y2 - py} x2={x2 + px} y2={y2 + py} {...common} />
        <text
          x={lx} y={ly}
          fill={stroke}
          fontSize="14"
          textAnchor="middle"
          dominantBaseline="middle"
          transform={`rotate(${deg} ${lx} ${ly})`}
          style={{userSelect:'none',pointerEvents:'none'}}
        >{label}</text>
      </g>
    );
  }
  if (s.type === 'text') {
    return (
      <text key={s.id}
        x={s.x} y={s.y}
        fill={stroke}
        fontSize={s.fontSize || 18}
        dominantBaseline="middle"
        style={{userSelect:'none'}}
      >{s.text}</text>
    );
  }
  if (s.type === 'bezier') {
    return <path key={s.id}
      d={`M ${s.x1} ${s.y1} Q ${s.cx} ${s.cy} ${s.x2} ${s.y2}`}
      {...common}
    />;
  }
  if (s.type === 'freehand') {
    if (!s.points || s.points.length < 2) return null;
    const d = 'M ' + s.points.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ');
    return <path key={s.id} d={d} {...common} />;
  }
  return null;
}

// ─────────────────────────────────────────
// CONTACTS VIEW
// ─────────────────────────────────────────
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
                <option value="client">Client</option>
                <option value="lead">Lead</option>
                <option value="agent">Agent</option>
                <option value="recruit">Recruit</option>
                <option value="partner">Partner</option>
                <option value="vendor">Vendor</option>
                <option value="family">Family / Personal</option>
                <option value="other">Other</option>
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

function ContactsView({ contacts, setContacts, userId }) {
  const [showModal, setShowModal] = useState(false);
  const [editContact, setEditContact] = useState(null);
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');

  const TYPES = [
    { id: 'all', label: 'All', icon: '👥' },
    { id: 'client', label: 'Clients', icon: '🤝' },
    { id: 'lead', label: 'Leads', icon: '🌱' },
    { id: 'agent', label: 'Agents', icon: '🧑‍💼' },
    { id: 'recruit', label: 'Recruits', icon: '🎣' },
    { id: 'partner', label: 'Partners', icon: '🤲' },
    { id: 'vendor', label: 'Vendors', icon: '🔧' },
    { id: 'family', label: 'Family', icon: '👨‍👩‍👧' },
  ];

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

  async function handleSave(data) {
    if (editContact) {
      const { data: updated } = await supabase.from('contacts').update(data).eq('id', editContact.id).select().single();
      if (updated) setContacts(prev => prev.map(c => c.id === updated.id ? updated : c));
    } else {
      const { data: created } = await supabase.from('contacts').insert({ ...data, user_id: userId }).select().single();
      if (created) setContacts(prev => [created, ...prev]);
    }
    setShowModal(false); setEditContact(null);
  }

  async function deleteContact(id) {
    if (!window.confirm('Delete this contact?')) return;
    await supabase.from('contacts').delete().eq('id', id);
    setContacts(prev => prev.filter(c => c.id !== id));
  }

  return (
    <div>
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
        <div><h2>Contacts</h2><p>{contacts.length} total · {filtered.length} shown</p></div>
        <button className="btn btn-primary" onClick={()=>{setEditContact(null);setShowModal(true);}}>+ New Contact</button>
      </div>

      <div className="panel">
        <div className="panel-header" style={{flexDirection:'column',alignItems:'stretch',gap:'10px'}}>
          <input className="form-input" placeholder="Search contacts…" value={search} onChange={e=>setSearch(e.target.value)} style={{margin:0}} />
          <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
            {TYPES.map(t => (
              <button key={t.id} className={`btn btn-sm ${typeFilter===t.id?'btn-primary':'btn-ghost'}`} onClick={()=>setTypeFilter(t.id)}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="panel-body">
          {filtered.length === 0
            ? <div className="empty-state"><div className="empty-icon">👥</div><p>No contacts here.</p></div>
            : <div className="task-list">
                {filtered.map(c => (
                  <div key={c.id} className="task-item" style={{cursor:'pointer'}} onClick={()=>{setEditContact(c);setShowModal(true);}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:600,color:'var(--text-1)',display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
                        {c.name}
                        <span className="task-priority" style={{background:'var(--bg-hover)',color:'var(--text-2)',textTransform:'capitalize'}}>{c.type}</span>
                      </div>
                      {(c.company || c.role) && <div style={{fontSize:'13px',color:'var(--text-2)',marginTop:'2px'}}>{[c.role,c.company].filter(Boolean).join(' · ')}</div>}
                      {(c.email || c.phone) && <div style={{fontSize:'12px',color:'var(--text-3)',marginTop:'2px'}}>{[c.email,c.phone].filter(Boolean).join(' · ')}</div>}
                    </div>
                    <div className="task-meta">
                      <span className={`task-priority priority-${c.priority==='urgent'?'high':c.priority==='normal'?'medium':c.priority}`}>{c.priority}</span>
                      <button className="task-delete" onClick={(e)=>{e.stopPropagation();deleteContact(c.id);}}>×</button>
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>
      </div>
      {showModal && <ContactModal onClose={()=>{setShowModal(false);setEditContact(null);}} onSave={handleSave} initial={editContact} />}
    </div>
  );
}

// ─────────────────────────────────────────
// PROPERTIES VIEW
// ─────────────────────────────────────────
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

function PropertiesView({ properties, setProperties, userId }) {
  const [showModal, setShowModal] = useState(false);
  const [editProp, setEditProp] = useState(null);
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

  async function deleteProp(id) {
    if (!window.confirm('Delete this property?')) return;
    await supabase.from('properties').delete().eq('id', id);
    setProperties(prev => prev.filter(p => p.id !== id));
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
                  <div key={p.id} className="task-item" style={{cursor:'pointer'}} onClick={()=>{setEditProp(p);setShowModal(true);}}>
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
                      <button className="task-delete" onClick={(e)=>{e.stopPropagation();deleteProp(p.id);}}>×</button>
                    </div>
                  </div>
                  );
                })}
              </div>
          }
        </div>
      </div>
      {showModal && <PropertyModal onClose={()=>{setShowModal(false);setEditProp(null);}} onSave={handleSave} initial={editProp} />}
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
// ─────────────────────────────────────────
function BrainEntryModal({ onClose, onSave, initial, defaultType }) {
  const [type, setType] = useState(initial?.type || defaultType || 'memory');
  const [title, setTitle] = useState(initial?.title || '');
  const [content, setContent] = useState(initial?.content || '');
  const [event_date, setEventDate] = useState(initial?.event_date || '');
  const [pinned, setPinned] = useState(initial?.pinned || false);

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({
      type, title: title.trim(), content: content.trim() || null,
      event_date: event_date || null, pinned,
    });
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>{initial ? 'Edit Entry' : 'New Brain Entry'}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group"><label className="form-label">Type</label>
              <select className="form-select" value={type} onChange={e=>setType(e.target.value)}>
                <option value="soul">🪞 Soul</option>
                <option value="memory">📖 Memory</option>
                <option value="playbook">📚 Playbook</option>
                <option value="decision">⚖️ Decision</option>
                <option value="lesson">💡 Lesson</option>
                <option value="north-star">🎯 North Star</option>
              </select>
            </div>
            <div className="form-group"><label className="form-label">Date (optional)</label><input className="form-input" type="date" value={event_date} onChange={e=>setEventDate(e.target.value)} /></div>
          </div>
          <div className="form-group"><label className="form-label">Title</label><input className="form-input" value={title} onChange={e=>setTitle(e.target.value)} autoFocus required /></div>
          <div className="form-group"><label className="form-label">Content</label><textarea className="form-textarea" value={content} onChange={e=>setContent(e.target.value)} style={{minHeight:'180px'}} /></div>
          <div className="form-group">
            <label className="form-label" style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}}>
              <input type="checkbox" checked={pinned} onChange={e=>setPinned(e.target.checked)} />
              Pin to top
            </label>
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

function BrainView({ brain, setBrain, userId }) {
  const [showModal, setShowModal] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [activeTab, setActiveTab] = useState('north-star');

  const TABS = [
    { id: 'north-star', label: 'North Star', icon: '🎯' },
    { id: 'soul', label: 'Soul', icon: '🪞' },
    { id: 'memory', label: 'Memory', icon: '📖' },
    { id: 'playbook', label: 'Playbooks', icon: '📚' },
    { id: 'decision', label: 'Decisions', icon: '⚖️' },
    { id: 'lesson', label: 'Lessons', icon: '💡' },
  ];

  const tabEntries = brain.filter(b => b.type === activeTab);
  // Pinned first, then by event_date desc (if present) then created_at desc
  const sorted = [...tabEntries].sort((a,b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const aD = a.event_date || a.created_at;
    const bD = b.event_date || b.created_at;
    return new Date(bD) - new Date(aD);
  });

  async function handleSave(data) {
    if (editEntry) {
      const { data: u } = await supabase.from('brain').update(data).eq('id', editEntry.id).select().single();
      if (u) setBrain(prev => prev.map(x => x.id === u.id ? u : x));
    } else {
      const { data: c } = await supabase.from('brain').insert({ ...data, user_id: userId }).select().single();
      if (c) setBrain(prev => [c, ...prev]);
    }
    setShowModal(false); setEditEntry(null);
  }

  async function deleteEntry(id) {
    if (!window.confirm('Delete this entry?')) return;
    await supabase.from('brain').delete().eq('id', id);
    setBrain(prev => prev.filter(x => x.id !== id));
  }

  async function togglePin(entry, e) {
    e.stopPropagation();
    const { data: u } = await supabase.from('brain').update({ pinned: !entry.pinned }).eq('id', entry.id).select().single();
    if (u) setBrain(prev => prev.map(x => x.id === u.id ? u : x));
  }

  const currentTab = TABS.find(t => t.id === activeTab);

  return (
    <div>
      <div className="page-header" style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:'10px'}}>
        <div><h2>🧠 Brain</h2><p>{brain.length} entries · {tabEntries.length} in {currentTab?.label}</p></div>
        <button className="btn btn-primary" onClick={()=>{setEditEntry(null);setShowModal(true);}}>+ New Entry</button>
      </div>

      <div className="panel">
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
        <div className="panel-body">
          {sorted.length === 0
            ? <div className="empty-state"><div className="empty-icon">{currentTab?.icon}</div><p>Nothing in {currentTab?.label} yet.</p></div>
            : <div className="task-list">
                {sorted.map(entry => (
                  <div key={entry.id} className="task-item" style={{cursor:'pointer',flexDirection:'column',alignItems:'stretch',gap:'6px'}} onClick={()=>{setEditEntry(entry);setShowModal(true);}}>
                    <div style={{display:'flex',alignItems:'center',gap:'8px',width:'100%'}}>
                      <div style={{flex:1,fontWeight:600,color:'var(--text-1)'}}>
                        {entry.pinned && <span title="Pinned" style={{marginRight:'6px'}}>📌</span>}
                        {entry.title}
                      </div>
                      <div className="task-meta">
                        {entry.event_date && <span className="task-due">{entry.event_date}</span>}
                        <button className="task-delete" style={{color:entry.pinned?'var(--accent)':undefined}} onClick={(e)=>togglePin(entry,e)} title="Pin">{entry.pinned ? '★' : '☆'}</button>
                        <button className="task-delete" onClick={(e)=>{e.stopPropagation();deleteEntry(entry.id);}}>×</button>
                      </div>
                    </div>
                    {entry.content && <div style={{fontSize:'13px',color:'var(--text-2)',whiteSpace:'pre-wrap',lineHeight:1.5,paddingLeft:'2px'}}>{entry.content.length > 200 ? entry.content.slice(0,200) + '…' : entry.content}</div>}
                  </div>
                ))}
              </div>
          }
        </div>
      </div>
      {showModal && <BrainEntryModal onClose={()=>{setShowModal(false);setEditEntry(null);}} onSave={handleSave} initial={editEntry} defaultType={activeTab} />}
    </div>
  );
}


// ─────────────────────────────────────────
// NOTES VIEW
// ─────────────────────────────────────────
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
    const { data: updated } = await supabase.from('notes')
      .update({ pinned: !note.pinned }).eq('id', note.id).select().single();
    if (updated) setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
  }

  async function deleteNote(note, e) {
    e.stopPropagation();
    if (!window.confirm(`Delete "${note.title}"?`)) return;
    await supabase.from('notes').delete().eq('id', note.id);
    setNotes(prev => prev.filter(n => n.id !== note.id));
    if (selected?.id === note.id) { setSelected(null); setEditTitle(''); setEditBody(''); }
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
    id: 'offer_strategy',
    label: 'Client asks about offer strategy on a hot listing',
    prompt: "A buyer client just texted: 'There are already 5 offers on the Hampton house. What should we do?' Draft a reply that gives them a real answer and one clear next step.",
  },
  {
    id: 'lost_listing',
    label: 'Agent who just lost a listing presentation',
    prompt: "An agent on the team just lost a listing they prepped hard for. They sent me: 'Lost it. Going to a discount broker.' Coach them. They need honesty, not a pep talk.",
  },
  {
    id: 'high_c_inspection',
    label: 'High-C buyer dissecting the inspection report',
    prompt: "A detail-oriented buyer (high-C) wants to negotiate every line of an inspection report — there are 14 minor items. Draft a message that respects their thoroughness and steers them to the 2-3 items that actually matter.",
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
  const [err, setErr] = useState('');

  async function startConnect() {
    setConnecting(true);
    setErr('');
    try {
      // Get a current access token to pass through (so the OAuth start function can
      // identify the user; verify_jwt is off because the function reads the bearer manually).
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in.');
      const { data, error } = await supabase.functions.invoke('gmail-oauth-start', {
        body: { return_to: window.location.origin + window.location.pathname },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error + (data.details ? ` — ${data.details}` : ''));
      if (!data?.url) throw new Error('No URL returned.');
      window.location.href = data.url;
    } catch (e) {
      setErr(e.message || String(e));
      setConnecting(false);
    }
  }

  async function disconnect(id) {
    if (!window.confirm('Disconnect this Gmail account? Synced messages will remain in the database.')) return;
    await supabase.from('email_accounts').update({ is_active: false }).eq('id', id);
    setEmailAccounts(prev => prev.map(a => a.id === id ? { ...a, is_active: false } : a));
  }

  return (
    <div className="panel" style={{marginBottom:'18px'}}>
      <div className="panel-header"><h3>📬 Email Accounts</h3></div>
      <div className="panel-body">
        <p style={{fontSize:'13px',color:'var(--text-2)',margin:'0 0 14px',lineHeight:1.5}}>
          Connect Gmail to read and send real email from Prism. Behavioral profiles are applied automatically to every draft.
        </p>
        {emailAccounts.length === 0
          ? <p style={{fontSize:'13px',color:'var(--text-3)',marginBottom:'14px'}}>No accounts connected yet.</p>
          : (
            <div style={{display:'flex',flexDirection:'column',gap:'8px',marginBottom:'14px'}}>
              {emailAccounts.map(a => (
                <div key={a.id} style={{padding:'10px 12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px',display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
                  <span style={{fontSize:'18px'}}>📧</span>
                  <div style={{flex:1,minWidth:'160px'}}>
                    <div style={{fontWeight:600,color:'var(--text-1)',fontSize:'14px'}}>{a.email_address}</div>
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
        <button className="btn btn-primary" onClick={startConnect} disabled={connecting}>
          {connecting ? 'Opening Google…' : '+ Connect Gmail'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// SETTINGS VIEW
// ─────────────────────────────────────────
function SettingsView({ user, priorityPref, onPriorityPrefChange, emailAccounts, setEmailAccounts }) {
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [displayName, setDisplayName] = useState(user?.user_metadata?.display_name || user?.user_metadata?.full_name?.split(/\s+/)[0] || '');
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState('');
  const [prefMsg, setPrefMsg] = useState('');
  const [savingPref, setSavingPref] = useState(false);

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
        <EmailAccountsPanel emailAccounts={emailAccounts || []} setEmailAccounts={setEmailAccounts} />
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
  const [emails, setEmails] = useState([]);
  const [robots, setRobots] = useState([]);
  const [drawings, setDrawings] = useState([]);
  const [notes, setNotes] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [properties, setProperties] = useState([]);
  const [investments, setInvestments] = useState([]);
  const [brain, setBrain] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [voiceCards, setVoiceCards] = useState([]);
  const [emailAccounts, setEmailAccounts] = useState([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [priorityPref, setPriorityPref] = useState('eisenhower');

  // Sync priority pref from user metadata when session changes
  useEffect(() => {
    const pref = session?.user?.user_metadata?.priority_system;
    if (pref === 'simple' || pref === 'eisenhower') setPriorityPref(pref);
    else setPriorityPref('eisenhower');
  }, [session]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  const loadData = useCallback(async () => {
    if (!session) return;
    const [tasksRes, emailsRes, robotsRes, drawingsRes, notesRes, contactsRes, propertiesRes, investmentsRes, brainRes, profilesRes, voiceCardsRes, emailAccountsRes] = await Promise.all([
      supabase.from('tasks').select('*').order('created_at', { ascending: false }),
      supabase.from('emails').select('*').order('created_at', { ascending: false }),
      supabase.from('robots').select('*').eq('active', true).order('created_at', { ascending: true }),
      supabase.from('drawings').select('*').order('updated_at', { ascending: false }),
      supabase.from('notes').select('*').order('updated_at', { ascending: false }),
      supabase.from('contacts').select('*').order('created_at', { ascending: false }),
      supabase.from('properties').select('*').order('created_at', { ascending: false }),
      supabase.from('investments').select('*').order('created_at', { ascending: false }),
      supabase.from('brain').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('*').order('created_at', { ascending: true }),
      supabase.from('voice_cards').select('*').order('created_at', { ascending: true }),
      supabase.from('email_accounts').select('*').order('created_at', { ascending: true }),
    ]);
    if (tasksRes.data) setTasks(tasksRes.data);
    if (emailsRes.data) setEmails(emailsRes.data);
    if (robotsRes.data) setRobots(robotsRes.data);
    if (drawingsRes.data) setDrawings(drawingsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (contactsRes.data) setContacts(contactsRes.data);
    if (propertiesRes.data) setProperties(propertiesRes.data);
    if (investmentsRes.data) setInvestments(investmentsRes.data);
    if (brainRes.data) setBrain(brainRes.data);
    if (profilesRes.data) setProfiles(profilesRes.data);
    if (voiceCardsRes.data) setVoiceCards(voiceCardsRes.data);
    if (emailAccountsRes.data) setEmailAccounts(emailAccountsRes.data);
    setDataLoaded(true);
  }, [session]);

  useEffect(() => { loadData(); }, [loadData]);

  // Handle the OAuth-callback redirect — show a brief banner, refresh data, and clean the URL.
  const [gmailConnectedFlash, setGmailConnectedFlash] = useState(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('gmail_connected');
    if (connected) {
      setGmailConnectedFlash(connected);
      // Strip the param from the URL
      params.delete('gmail_connected');
      const newSearch = params.toString();
      const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
      window.history.replaceState({}, '', newUrl);
      // Reload data so the new account appears
      if (session) loadData();
      // Hide the flash after 6s
      const t = setTimeout(() => setGmailConnectedFlash(null), 6000);
      return () => clearTimeout(t);
    }
  }, [session, loadData]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    setTasks([]); setEmails([]); setRobots([]); setDrawings([]); setNotes([]);
    setContacts([]); setProperties([]); setInvestments([]); setBrain([]);
    setProfiles([]); setVoiceCards([]); setEmailAccounts([]);
    setDataLoaded(false);
  }

  const navigate = (id) => { setView(id); setSidebarOpen(false); };

  if (loading) return <div className="loading-screen"><div className="spinner"/><p>Loading…</p></div>;
  if (!session) return <AuthScreen />;

  const user = session.user;
  const unreadCount = emails.filter(e=>!e.read&&(e.folder==='inbox'||!e.folder)).length;
  const openTaskCount = tasks.filter(t=>!t.completed).length;

  const NAV = [
    { id: 'dashboard',   icon: '⚡', label: 'Dashboard' },
    { id: 'tasks',       icon: '✅', label: 'Tasks',       badge: openTaskCount || null },
    { id: 'inbox',       icon: '📬', label: 'Inbox',       badge: unreadCount || null },
    { id: 'contacts',    icon: '👥', label: 'Contacts',    badge: contacts.length || null },
    { id: 'properties',  icon: '🏠', label: 'Properties',  badge: properties.length || null },
    { id: 'investments', icon: '💰', label: 'Investments', badge: investments.length || null },
    { id: 'brain',       icon: '🧠', label: 'Brain',       badge: brain.length || null },
    { id: 'notes',       icon: '📝', label: 'Notes',       badge: null },
    { id: 'draft',       icon: '✏️', label: 'Draft' },
    { id: 'chat',        icon: '✦',  label: 'Ari',         badge: null },
    { id: 'prism',       icon: '✦',  label: 'Prism',       badge: null },
    { id: 'settings',    icon: '⚙️',  label: 'Settings' },
  ];

  return (
    <div className="app-shell" style={{flexDirection:'column'}}>
      {/* Mobile header */}
      <div className="mobile-header">
        <div className="mobile-header-logo">My<span>Life</span></div>
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
            <h1>My<span>Life</span></h1>
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
              <span>✓ Connected <strong>{gmailConnectedFlash}</strong>. Open Inbox and tap Sync to pull messages.</span>
              <button className="btn btn-ghost btn-sm" onClick={()=>setGmailConnectedFlash(null)}>×</button>
            </div>
          )}
          {!dataLoaded
            ? <div className="loading-screen" style={{height:'60vh'}}><div className="spinner"/></div>
            : view==='dashboard'   ? <DashboardView tasks={tasks} emails={emails} user={user} setView={setView} robots={robots}/>
            : view==='tasks'       ? <TasksView tasks={tasks} setTasks={setTasks} userId={user.id} defaultSystem={priorityPref}/>
            : view==='inbox'       ? <InboxView emails={emails} setEmails={setEmails} emailAccounts={emailAccounts} setEmailAccounts={setEmailAccounts} profiles={profiles} contacts={contacts} userId={user.id}/>
            : view==='contacts'    ? <ContactsView contacts={contacts} setContacts={setContacts} userId={user.id}/>
            : view==='properties'  ? <PropertiesView properties={properties} setProperties={setProperties} userId={user.id}/>
            : view==='investments' ? <InvestmentsView investments={investments} setInvestments={setInvestments} properties={properties} userId={user.id}/>
            : view==='brain'       ? <BrainView brain={brain} setBrain={setBrain} userId={user.id}/>
            : view==='notes'       ? <NotesView notes={notes} setNotes={setNotes} userId={user.id}/>
            : view==='draft'       ? <DraftView drawings={drawings} setDrawings={setDrawings} userId={user.id}/>
            : view==='chat'        ? <ChatView robots={robots} userId={user.id}/>
            : view==='prism'       ? <PrismView profiles={profiles} setProfiles={setProfiles} voiceCards={voiceCards} setVoiceCards={setVoiceCards} contacts={contacts} userId={user.id}/>
            : view==='settings'    ? <SettingsView user={user} priorityPref={priorityPref} onPriorityPrefChange={setPriorityPref} emailAccounts={emailAccounts} setEmailAccounts={setEmailAccounts}/>
            : null
          }
        </main>
      </div>
    </div>
  );
}
