import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './dataService';
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
  const [dataLoaded, setDataLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  const loadData = useCallback(async () => {
    if (!session) return;
    const [tasksRes, emailsRes, robotsRes] = await Promise.all([
      supabase.from('tasks').select('*').order('created_at', { ascending: false }),
      supabase.from('emails').select('*').order('created_at', { ascending: false }),
      supabase.from('robots').select('*').eq('active', true).order('created_at', { ascending: true }),
    ]);
    if (tasksRes.data) setTasks(tasksRes.data);
    if (emailsRes.data) setEmails(emailsRes.data);
    if (robotsRes.data) setRobots(robotsRes.data);
    setDataLoaded(true);
  }, [session]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    setTasks([]); setEmails([]); setRobots([]); setDataLoaded(false);
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
            : view==='chat'      ? <ChatView robots={robots} userId={user.id}/>
            : view==='settings'  ? <SettingsView user={user}/>
            : null
          }
        </main>
      </div>
    </div>
  );
}
