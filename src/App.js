import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from './dataService';
import { jsPDF } from 'jspdf';
import './index.css';

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
          <h1>Kho<span>yi</span></h1>
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
          <p>Get started with Khoyi</p>
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
// TASK MODAL
// ─────────────────────────────────────────
function TaskModal({ onClose, onSave, initial }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [priority, setPriority] = useState(initial?.priority || 'medium');
  const [due_date, setDueDate] = useState(initial?.due_date || '');
  const [notes, setNotes] = useState(initial?.notes || '');

  function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) return;
    onSave({ title: title.trim(), priority, due_date: due_date || null, notes: notes.trim() });
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
          <div className="form-row">
            <div className="form-group"><label className="form-label">Priority</label>
              <select className="form-select" value={priority} onChange={e=>setPriority(e.target.value)}>
                <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
            </div>
            <div className="form-group"><label className="form-label">Due Date</label><input className="form-input" type="date" value={due_date} onChange={e=>setDueDate(e.target.value)} /></div>
          </div>
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
function TasksView({ tasks, setTasks, userId }) {
  const [showModal, setShowModal] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [filter, setFilter] = useState('all');

  const filtered = tasks.filter(t => filter === 'all' ? true : filter === 'done' ? t.completed : !t.completed);
  const stats = { total: tasks.length, done: tasks.filter(t=>t.completed).length, high: tasks.filter(t=>t.priority==='high'&&!t.completed).length };

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
        <div><h2>Tasks</h2><p>{stats.done} of {stats.total} complete{stats.high > 0 ? ` · ${stats.high} high priority` : ''}</p></div>
        <button className="btn btn-primary" onClick={()=>{setEditTask(null);setShowModal(true);}}>+ New Task</button>
      </div>
      <div className="cards-row">
        <div className="stat-card"><div className="stat-label">Total</div><div className="stat-value">{stats.total}</div></div>
        <div className="stat-card"><div className="stat-label">Done</div><div className="stat-value" style={{color:'var(--green)'}}>{stats.done}</div></div>
        <div className="stat-card"><div className="stat-label">High Priority</div><div className="stat-value" style={{color:'var(--red)'}}>{stats.high}</div></div>
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
                      <span className={`task-priority priority-${task.priority}`}>{task.priority}</span>
                      {task.due_date && <span className="task-due">{task.due_date}</span>}
                      <button className="task-delete" onClick={()=>deleteTask(task.id)}>×</button>
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>
      </div>
      {showModal && <TaskModal onClose={()=>{setShowModal(false);setEditTask(null);}} onSave={handleSave} initial={editTask} />}
    </div>
  );
}

// ─────────────────────────────────────────
// INBOX VIEW
// ─────────────────────────────────────────
function InboxView({ emails, setEmails, userId }) {
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
        <div><h2>Inbox</h2><p>{unread} unread</p></div>
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
                ? <div className="empty-state"><div className="empty-icon">📭</div><p>No messages here.</p></div>
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

// ─────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────
function DashboardView({ tasks, emails, user, setView, robots }) {
  const pending = tasks.filter(t=>!t.completed);
  const highPrio = pending.filter(t=>t.priority==='high');
  const unread = emails.filter(e=>!e.read&&(e.folder==='inbox'||!e.folder));
  const today = new Date();
  const gr = today.getHours()<12?'Good morning':today.getHours()<17?'Good afternoon':'Good evening';
  const name = user?.email?.split('@')[0]||'Dara';
  const overdue = pending.filter(t=>t.due_date&&new Date(t.due_date)<today);
  const robot = robots[0];

  return (
    <div>
      <div className="page-header">
        <h2>{gr}, {name} 👋</h2>
        <p>{today.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</p>
      </div>
      <div className="cards-row">
        <div className="stat-card" style={{cursor:'pointer'}} onClick={()=>setView('tasks')}><div className="stat-label">Open Tasks</div><div className="stat-value">{pending.length}</div><div className="stat-sub">{highPrio.length} high priority</div></div>
        <div className="stat-card" style={{cursor:'pointer'}} onClick={()=>setView('inbox')}><div className="stat-label">Unread Email</div><div className="stat-value">{unread.length}</div><div className="stat-sub">in inbox</div></div>
        <div className="stat-card"><div className="stat-label">Done Today</div><div className="stat-value" style={{color:'var(--green)'}}>{tasks.filter(t=>t.completed&&t.updated_at&&new Date(t.updated_at).toDateString()===today.toDateString()).length}</div></div>
        <div className="stat-card"><div className="stat-label">Overdue</div><div className="stat-value" style={{color:overdue.length>0?'var(--red)':'var(--text-1)'}}>{overdue.length}</div></div>
      </div>
      <div className="dash-grid">
        <div className="panel">
          <div className="panel-header"><h3>🔥 High Priority</h3><button className="btn btn-ghost btn-sm" onClick={()=>setView('tasks')}>All tasks</button></div>
          <div className="panel-body">
            {highPrio.length===0
              ? <div className="empty-state" style={{padding:'20px 0'}}><p>All clear — no high priority tasks.</p></div>
              : <div className="task-list">{highPrio.slice(0,5).map(t=>(
                  <div key={t.id} className="task-item"><div className="task-check"/><span className="task-text">{t.title}</span><div className="task-meta"><span className="task-priority priority-high">high</span>{t.due_date&&<span className="task-due">{t.due_date}</span>}</div></div>
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
      return { minX: s.x, minY: s.y, maxX: s.x + s.w, maxY: s.y + s.h };
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
    } else if (s.type === 'rect') {
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
  const [freehandPoints, setFreehandPoints] = useState(null); // array of points during freehand stroke
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
  // Tier 3 state
  const [blocks, setBlocks] = useState([]);
  const [showBlocksPanel, setShowBlocksPanel] = useState(false);
  const [showCreateBlockDialog, setShowCreateBlockDialog] = useState(false);
  const [insertBlockId, setInsertBlockId] = useState(null);
  const [showPdfDialog, setShowPdfDialog] = useState(false);
  const fileInputRef = useRef(null);
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
        const original = shapes.find(s => s.id === selectedId);
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
      const original = shapes.find(s => s.id === selectedId);
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
      const hit = [...shapes].reverse().find(s => isShapeInteractable(s) && hitTest(s, p));
      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      if (hit) {
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
          const s = shapes.find(sh => sh.id === id);
          if (s) originalById[id] = s;
        }
        setMoving({ startX: p.x, startY: p.y, originalById, preDragSnap: deepSnap() });
      } else {
        if (!additive) setSelectedIds([]);
        setDragSelect({ start: p, current: p, additive });
      }
      return;
    }

    const id = 'sh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    if (tool === 'line') setDraft({ id, type: 'line', x1: p.x, y1: p.y, x2: p.x, y2: p.y, stroke: color, strokeWidth, layer: activeLayerId });
    if (tool === 'rect') setDraft({ id, type: 'rect', x: p.x, y: p.y, w: 0, h: 0, stroke: color, strokeWidth, fill: 'none', layer: activeLayerId });
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
    if (dragSelect) {
      const p = svgPoint(e);
      setDragSelect(prev => prev ? { ...prev, current: p } : prev);
      return;
    }
    if (panStart.current && svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      const dx = ((e.clientX - panStart.current.mx) / rect.width) * viewBox.w;
      const dy = ((e.clientY - panStart.current.my) / rect.height) * viewBox.h;
      setViewBox(v => ({ ...v, x: panStart.current.vx - dx, y: panStart.current.vy - dy }));
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
        const current = shapes.find(s => s.id === id);
        if (!current) continue;
        if (current.type === 'rect' && (current.x !== original.x || current.y !== original.y)) actuallyMoved = true;
        else if (current.type === 'circle' && (current.cx !== original.cx || current.cy !== original.cy)) actuallyMoved = true;
        else if ((current.type === 'line' || current.type === 'dimension') && (current.x1 !== original.x1 || current.y1 !== original.y1)) actuallyMoved = true;
        else if (current.type === 'text' && (current.x !== original.x || current.y !== original.y)) actuallyMoved = true;
        else if (current.type === 'bezier' && (current.x1 !== original.x1 || current.y1 !== original.y1)) actuallyMoved = true;
        else if (current.type === 'instance' && (current.x !== original.x || current.y !== original.y)) actuallyMoved = true;
        else if ((current.type === 'polyline' || current.type === 'freehand') && current.points[0] && original.points[0] && (current.points[0].x !== original.points[0].x)) actuallyMoved = true;
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

  function hitTest(s, p) {
    // Tolerance scales with zoom — 8 screen pixels in world units.
    // Without this, zoomed-out shapes are nearly impossible to click and zoomed-in
    // shapes accept clicks from absurdly far away.
    const tol = Math.max(2, (8 * viewBox.w) / (svgRef.current?.getBoundingClientRect().width || 1));
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
    if (s.type === 'rect') {
      const on = (a, b) => Math.abs(a - b) <= tol;
      const inX = p.x >= s.x - tol && p.x <= s.x + s.w + tol;
      const inY = p.y >= s.y - tol && p.y <= s.y + s.h + tol;
      if (!inX || !inY) return false;
      return on(p.x, s.x) || on(p.x, s.x + s.w) || on(p.y, s.y) || on(p.y, s.y + s.h);
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
      const src = shapes.find(s => s.id === extendMode.shapeId);
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
    const sel = shapes.find(s => s.id === selectedId);
    if (!sel) return;
    // Anchor = a natural reference point on the shape
    let anchor;
    switch (sel.type) {
      case 'instance': anchor = { x: sel.x, y: sel.y }; break;
      case 'rect': anchor = { x: sel.x, y: sel.y }; break;
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
    const original = shapes.find(s => s.id === selectedId);
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
      const original = shapes.find(s => s.id === id);
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
  }
  function toggleLayerLocked(id) {
    pushHistory();
    setLayers(prev => prev.map(l => l.id === id ? { ...l, locked: !l.locked } : l));
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
      if (!paramInput && !showArrayDialog && !showRotateDialog && !editingTextId
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
      if ((e.ctrlKey || e.metaKey) && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) { e.preventDefault(); redo(); }
      if (e.key === 'v') setTool('select');
      if (e.key === 'l') setTool('line');
      if (e.key === 'r') setTool('rect');
      if (e.key === 'c') setTool('circle');
      if (e.key === 'p') setTool('polyline');
      if (e.key === 'd') setTool('dimension');
      if (e.key === 't') setTool('text');
      if (e.key === 'a') setTool('bezier');
      if (e.key === 'f') setTool('freehand');
      if (e.key === 'z' && !e.ctrlKey && !e.metaKey) fitToView();
      if (e.key === 'o' && selectedId) startOffset();
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && selectedId) { e.preventDefault(); duplicateSelected(); }
      if (e.key === 'Enter') { e.preventDefault(); finalizePoly(); }
      if (e.key === 'Escape') {
        setSelectedId(null); setDraft(null); cancelPoly(); setEditingTextId(null);
        if (offsetMode) { setOffsetMode(false); setOffsetAnchor(null); }
        if (trimMode) setTrimMode(false);
        if (extendMode) setExtendMode(null);
        if (mirrorMode) setMirrorMode(null);
        if (paramInput) setParamInput(null);
        if (insertBlockId) setInsertBlockId(null);
        if (moving) {
          // Revert in-progress drag to original positions
          setShapes(prev => prev.map(s => moving.originalById[s.id] || s));
          setMoving(null);
        }
        if (freehandPoints) setFreehandPoints(null);
        if (dragSelect) setDragSelect(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line

  function handleWheel(e) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    const rect = svgRef.current.getBoundingClientRect();
    const mx = viewBox.x + ((e.clientX - rect.left) / rect.width) * viewBox.w;
    const my = viewBox.y + ((e.clientY - rect.top) / rect.height) * viewBox.h;
    setViewBox({
      x: mx - (mx - viewBox.x) * factor,
      y: my - (my - viewBox.y) * factor,
      w: viewBox.w * factor,
      h: viewBox.h * factor,
    });
  }

  async function newDrawing() {
    const { data } = await supabase.from('drawings').insert({
      user_id: userId, title: 'Untitled Drawing', shapes: []
    }).select().single();
    if (data) {
      setDrawings(prev => [data, ...prev]);
      setActiveId(data.id);
    }
  }

  async function saveDrawing() {
    if (!active) return;
    setSaving(true);
    const payload = { shapes, layers };
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
    await supabase.from('drawings').delete().eq('id', id);
    setDrawings(prev => prev.filter(d => d.id !== id));
    if (activeId === id) setActiveId(null);
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

  function createBlockFromSelection(name) {
    if (!selectedId) return;
    const sel = shapes.find(s => s.id === selectedId);
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

  function exportPdf(paperSize, pdfScale) {
    const expanded = getExportShapes();
    if (expanded.length === 0) {
      window.alert('Nothing to export.');
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of expanded) {
      if (s.type === 'line' || s.type === 'dimension') { minX = Math.min(minX, s.x1, s.x2); minY = Math.min(minY, s.y1, s.y2); maxX = Math.max(maxX, s.x1, s.x2); maxY = Math.max(maxY, s.y1, s.y2); }
      else if (s.type === 'rect') { minX = Math.min(minX, s.x); minY = Math.min(minY, s.y); maxX = Math.max(maxX, s.x + s.w); maxY = Math.max(maxY, s.y + s.h); }
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
      if (s.type === 'line' || s.type === 'dimension') {
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
        const tl = px2pt(s.x, s.y);
        pdf.rect(tl.x, tl.y, s.w * k, s.h * k);
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
    <div>
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
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
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

            {shapes.filter(isShapeVisible).map(s => {
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
              const sel = shapes.find(s => s.id === selectedId);
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
              const sel = shapes.find(s => s.id === selectedId);
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
          </svg>
        </div>
      </div>

      {/* Mode banners */}
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
        const sel = shapes.find(s => s.id === selectedId);
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
        const sel = shapes.find(s => s.id === selectedId);
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

      {showBlocksPanel && (
        <div style={{
          position:'fixed', top:'80px', left:'20px', width:'280px',
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
            disabled={!selectedId}
            style={{width:'100%',marginBottom:'10px'}}
            title={!selectedId ? "Select a shape first" : ""}
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
                      <input
                        value={b.name}
                        onChange={e => renameBlock(b.id, e.target.value)}
                        className="form-input"
                        style={{flex:1,padding:'2px 6px',fontSize:'12px',minWidth:0}}
                      />
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => deleteBlock(b.id)}
                        style={{minWidth:'20px',padding:'2px 4px',color:'var(--red)'}}
                        title="Delete block"
                      >×</button>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:'4px'}}>
                      <span style={{fontSize:'10px',color:'var(--text-3)'}}>{count} instance{count===1?'':'s'}</span>
                      <button
                        className={`btn btn-sm ${insertBlockId === b.id ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setInsertBlockId(insertBlockId === b.id ? null : b.id)}
                        style={{fontSize:'11px',padding:'2px 8px'}}
                      >
                        {insertBlockId === b.id ? 'Click canvas…' : 'Insert'}
                      </button>
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
          position:'fixed', top:'80px', right:'20px', width:'280px',
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
                <input
                  value={l.name}
                  onChange={e => renameLayer(l.id, e.target.value)}
                  onClick={e => e.stopPropagation()}
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
            const sel = shapes.find(s => s.id === selectedId);
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
          <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
            <span style={{color:'var(--accent)'}}>↗ Offset mode</span>
            <span style={{color:'var(--text-2)'}}>Click on the canvas to place the duplicate. Or:</span>
            <input
              type="number" placeholder="dx"
              id="offset-dx"
              className="form-input"
              style={{width:'60px',padding:'4px 6px',fontSize:'12px'}}
            />
            <input
              type="number" placeholder="dy"
              id="offset-dy"
              className="form-input"
              style={{width:'60px',padding:'4px 6px',fontSize:'12px'}}
            />
            <button
              className="btn btn-sm btn-primary"
              onClick={() => {
                const dxEl = document.getElementById('offset-dx');
                const dyEl = document.getElementById('offset-dy');
                const dx = Number(dxEl?.value) || 0;
                const dy = Number(dyEl?.value) || 0;
                if (dx === 0 && dy === 0) return;
                offsetByVector(dx, dy);
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
        const t = shapes.find(s => s.id === editingTextId);
        if (!t) return null;
        return (
          <div style={{
            position:'fixed', inset:0, background:'rgba(0,0,0,0.5)',
            display:'flex', alignItems:'center', justifyContent:'center', zIndex:100
          }} onClick={() => setEditingTextId(null)}>
            <div style={{background:'var(--bg-card)',padding:'20px',borderRadius:'8px',minWidth:'300px',border:'1px solid var(--border)'}} onClick={e => e.stopPropagation()}>
              <h3 style={{margin:'0 0 12px 0'}}>Edit text</h3>
              <input
                className="form-input"
                autoFocus
                value={t.text}
                onChange={e => {
                  setShapes(prev => prev.map(s => s.id === editingTextId ? { ...s, text: e.target.value } : s));
                  setDirty(true);
                }}
                onKeyDown={e => { if (e.key === 'Enter') setEditingTextId(null); }}
                style={{width:'100%'}}
              />
              <div style={{display:'flex',gap:'8px',justifyContent:'flex-end',marginTop:'12px'}}>
                <button className="btn btn-sm btn-ghost" onClick={() => {
                  // delete if empty
                  if (!t.text.trim()) {
                    setShapes(prev => prev.filter(s => s.id !== editingTextId));
                  }
                  setEditingTextId(null);
                }}>Done</button>
              </div>
            </div>
          </div>
        );
      })()}

      <p style={{fontSize:'12px',color:'var(--text-3)',marginTop:'10px'}}>
        Shortcuts: V select (drag empty space to box-select, Shift-click to add) · L line · R rect · C circle · P polyline · A curve · F freehand · D dimension · T text · O offset · ⇋ mirror · ⊟ array · ↻ rotate · ✂ trim · ↦ extend · ◈ object snap · ⊥ ortho · Z fit-to-view · Type a digit while drawing for parametric length · Ctrl/Cmd+D duplicate · Del to remove · Ctrl+Z undo · Ctrl+Shift+Z (or Ctrl+Y) redo · Alt+drag or ✋ to pan · scroll to zoom
      </p>
    </div>
  );
}

// ─── Tier 2 helpers ────────────────────────────────────────────────

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
    case 'rect': {
      const c1 = ref({ x: s.x, y: s.y });
      const c2 = ref({ x: s.x + s.w, y: s.y });
      const c3 = ref({ x: s.x + s.w, y: s.y + s.h });
      const c4 = ref({ x: s.x, y: s.y + s.h });
      const xs = [c1.x, c2.x, c3.x, c4.x];
      const ys = [c1.y, c2.y, c3.y, c4.y];
      const nx = Math.min(...xs), ny = Math.min(...ys);
      return { ...s, x: nx, y: ny, w: Math.max(...xs) - nx, h: Math.max(...ys) - ny };
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
    case 'rect': return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
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
    case 'rect': {
      const c1 = rot({ x: s.x, y: s.y });
      const c2 = rot({ x: s.x + s.w, y: s.y });
      const c3 = rot({ x: s.x + s.w, y: s.y + s.h });
      const c4 = rot({ x: s.x, y: s.y + s.h });
      const xs = [c1.x, c2.x, c3.x, c4.x];
      const ys = [c1.y, c2.y, c3.y, c4.y];
      const nx = Math.min(...xs), ny = Math.min(...ys);
      return { ...s, x: nx, y: ny, w: Math.max(...xs) - nx, h: Math.max(...ys) - ny };
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
    case 'rect': {
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
    if (s.type === 'line') {
      out(0, 'LINE'); out(8, '0');
      out(10, s.x1); out(20, -s.y1); out(30, 0);
      out(11, s.x2); out(21, -s.y2); out(31, 0);
    } else if (s.type === 'rect') {
      out(0, 'LWPOLYLINE'); out(8, '0');
      out(90, 4); out(70, 1);
      out(10, s.x);       out(20, -s.y);
      out(10, s.x + s.w); out(20, -s.y);
      out(10, s.x + s.w); out(20, -(s.y + s.h));
      out(10, s.x);       out(20, -(s.y + s.h));
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
  if (s.type === 'rect') {
    // Normalize negative w/h so the draft preview is visible when dragging
    // from bottom-right to top-left.
    const x = s.w >= 0 ? s.x : s.x + s.w;
    const y = s.h >= 0 ? s.y : s.y + s.h;
    const w = Math.abs(s.w);
    const h = Math.abs(s.h);
    return <rect key={s.id} x={x} y={y} width={w} height={h} {...common} />;
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
// SETTINGS VIEW
// ─────────────────────────────────────────
function SettingsView({ user }) {
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

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
  const [dataLoaded, setDataLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  const loadData = useCallback(async () => {
    if (!session) return;
    const [tasksRes, emailsRes, robotsRes, drawingsRes] = await Promise.all([
      supabase.from('tasks').select('*').order('created_at', { ascending: false }),
      supabase.from('emails').select('*').order('created_at', { ascending: false }),
      supabase.from('robots').select('*').eq('active', true).order('created_at', { ascending: true }),
      supabase.from('drawings').select('*').order('updated_at', { ascending: false }),
    ]);
    if (tasksRes.data) setTasks(tasksRes.data);
    if (emailsRes.data) setEmails(emailsRes.data);
    if (robotsRes.data) setRobots(robotsRes.data);
    if (drawingsRes.data) setDrawings(drawingsRes.data);
    setDataLoaded(true);
  }, [session]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    setTasks([]); setEmails([]); setRobots([]); setDrawings([]); setDataLoaded(false);
  }

  const navigate = (id) => { setView(id); setSidebarOpen(false); };

  if (loading) return <div className="loading-screen"><div className="spinner"/><p>Loading…</p></div>;
  if (!session) return <AuthScreen />;

  const user = session.user;
  const unreadCount = emails.filter(e=>!e.read&&(e.folder==='inbox'||!e.folder)).length;
  const openTaskCount = tasks.filter(t=>!t.completed).length;

  const NAV = [
    { id: 'dashboard', icon: '⚡', label: 'Dashboard' },
    { id: 'tasks',     icon: '✅', label: 'Tasks',     badge: openTaskCount || null },
    { id: 'inbox',     icon: '📬', label: 'Inbox',     badge: unreadCount || null },
    { id: 'draft',     icon: '✏️', label: 'Draft' },
    { id: 'chat',      icon: '✦',  label: 'Ari',       badge: null },
    { id: 'settings',  icon: '⚙️',  label: 'Settings' },
  ];

  return (
    <div className="app-shell" style={{flexDirection:'column'}}>
      {/* Mobile header */}
      <div className="mobile-header">
        <div className="mobile-header-logo">Kho<span>yi</span></div>
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
            <h1>Kho<span>yi</span></h1>
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
              <div className="sidebar-avatar">{user.email?.slice(0,2).toUpperCase()}</div>
              <div className="sidebar-user-info">
                <div className="sidebar-user-name">{user.email?.split('@')[0]}</div>
                <div className="sidebar-user-email">{user.email}</div>
              </div>
              <button className="logout-btn" onClick={handleSignOut} title="Sign out">⏻</button>
            </div>
          </div>
        </nav>

        {/* Main */}
        <main className="main-content">
          {!dataLoaded
            ? <div className="loading-screen" style={{height:'60vh'}}><div className="spinner"/></div>
            : view==='dashboard' ? <DashboardView tasks={tasks} emails={emails} user={user} setView={setView} robots={robots}/>
            : view==='tasks'     ? <TasksView tasks={tasks} setTasks={setTasks} userId={user.id}/>
            : view==='inbox'     ? <InboxView emails={emails} setEmails={setEmails} userId={user.id}/>
            : view==='draft'     ? <DraftView drawings={drawings} setDrawings={setDrawings} userId={user.id}/>
            : view==='chat'      ? <ChatView robots={robots} userId={user.id}/>
            : view==='settings'  ? <SettingsView user={user}/>
            : null
          }
        </main>
      </div>
    </div>
  );
}
