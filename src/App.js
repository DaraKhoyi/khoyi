import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './dataService';
import './index.css';

// ─────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────
const PLATFORM_ADMIN_EMAIL = 'dara@brokerdara.com';

// ─────────────────────────────────────────
// AUTH SCREEN
// ─────────────────────────────────────────
function AuthScreen() {
  const [mode, setMode] = useState('login'); // login | signup | reset
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setLoading(false);
  }

  async function handleSignup(e) {
    e.preventDefault();
    setLoading(true); setError('');
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) setError(error.message);
    else setSuccess('Check your email to confirm your account.');
    setLoading(false);
  }

  async function handleReset(e) {
    e.preventDefault();
    setLoading(true); setError('');
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) setError(error.message);
    else setSuccess('Reset link sent — check your inbox.');
    setLoading(false);
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">
          <h1>Kho<span>yi</span></h1>
          <p>Your personal operating system</p>
        </div>

        {mode === 'login' && (
          <>
            <h2>Welcome back</h2>
            <p>Sign in to your workspace</p>
            {error && <div className="auth-error">{error}</div>}
            {success && <div className="auth-success">{success}</div>}
            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
              </div>
              <button className="btn btn-primary" style={{width:'100%'}} disabled={loading}>
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>
            <div className="auth-switch">
              <a onClick={() => { setMode('reset'); setError(''); setSuccess(''); }}>Forgot password?</a>
              {' · '}
              <a onClick={() => { setMode('signup'); setError(''); setSuccess(''); }}>Create account</a>
            </div>
          </>
        )}

        {mode === 'signup' && (
          <>
            <h2>Create account</h2>
            <p>Get started with Khoyi</p>
            {error && <div className="auth-error">{error}</div>}
            {success && <div className="auth-success">{success}</div>}
            <form onSubmit={handleSignup}>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
              </div>
              <div className="form-group">
                <label className="form-label">Password</label>
                <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
              </div>
              <button className="btn btn-primary" style={{width:'100%'}} disabled={loading}>
                {loading ? 'Creating…' : 'Create Account'}
              </button>
            </form>
            <div className="auth-switch">
              Already have an account? <a onClick={() => { setMode('login'); setError(''); setSuccess(''); }}>Sign in</a>
            </div>
          </>
        )}

        {mode === 'reset' && (
          <>
            <h2>Reset password</h2>
            <p>We'll send a reset link to your email</p>
            {error && <div className="auth-error">{error}</div>}
            {success && <div className="auth-success">{success}</div>}
            <form onSubmit={handleReset}>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
              </div>
              <button className="btn btn-primary" style={{width:'100%'}} disabled={loading}>
                {loading ? 'Sending…' : 'Send Reset Link'}
              </button>
            </form>
            <div className="auth-switch">
              <a onClick={() => { setMode('login'); setError(''); setSuccess(''); }}>Back to sign in</a>
            </div>
          </>
        )}
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
          <div className="form-group">
            <label className="form-label">Task</label>
            <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs to get done?" autoFocus required />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Priority</label>
              <select className="form-select" value={priority} onChange={e => setPriority(e.target.value)}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Due Date</label>
              <input className="form-input" type="date" value={due_date} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional details…" />
          </div>
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
  const [filter, setFilter] = useState('all'); // all | active | done

  const filtered = tasks.filter(t =>
    filter === 'all' ? true : filter === 'done' ? t.completed : !t.completed
  );

  const stats = {
    total: tasks.length,
    done: tasks.filter(t => t.completed).length,
    high: tasks.filter(t => t.priority === 'high' && !t.completed).length,
  };

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
    const { data: updated } = await supabase.from('tasks').update({ completed: !task.completed }).eq('id', task.id).select().single();
    if (updated) setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
  }

  async function deleteTask(id) {
    await supabase.from('tasks').delete().eq('id', id);
    setTasks(prev => prev.filter(t => t.id !== id));
  }

  return (
    <div>
      <div className="page-header" style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between'}}>
        <div>
          <h2>Tasks</h2>
          <p>{stats.done} of {stats.total} complete{stats.high > 0 ? ` · ${stats.high} high priority pending` : ''}</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditTask(null); setShowModal(true); }}>+ New Task</button>
      </div>

      <div className="cards-row">
        <div className="stat-card"><div className="stat-label">Total</div><div className="stat-value">{stats.total}</div></div>
        <div className="stat-card"><div className="stat-label">Completed</div><div className="stat-value" style={{color:'var(--green)'}}>{stats.done}</div></div>
        <div className="stat-card"><div className="stat-label">High Priority</div><div className="stat-value" style={{color:'var(--red)'}}>{stats.high}</div></div>
        <div className="stat-card"><div className="stat-label">Open</div><div className="stat-value">{stats.total - stats.done}</div></div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3>Task List</h3>
          <div style={{display:'flex', gap:'6px'}}>
            {['all','active','done'].map(f => (
              <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter(f)}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="panel-body">
          {filtered.length === 0
            ? <div className="empty-state"><div className="empty-icon">✅</div><p>No tasks here. Add one above.</p></div>
            : <div className="task-list">
                {filtered.map(task => (
                  <div key={task.id} className={`task-item ${task.completed ? 'done' : ''}`}>
                    <div className={`task-check ${task.completed ? 'checked' : ''}`} onClick={() => toggleTask(task)} />
                    <span className="task-text" style={{cursor:'pointer'}} onClick={() => { setEditTask(task); setShowModal(true); }}>{task.title}</span>
                    <div className="task-meta">
                      <span className={`task-priority priority-${task.priority}`}>{task.priority}</span>
                      {task.due_date && <span className="task-due">Due {task.due_date}</span>}
                      <button className="task-delete" onClick={() => deleteTask(task.id)}>×</button>
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>
      </div>

      {showModal && <TaskModal onClose={() => { setShowModal(false); setEditTask(null); }} onSave={handleSave} initial={editTask} />}
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

  const unread = emails.filter(e => !e.read).length;

  async function markRead(email) {
    if (email.read) { setSelected(email); return; }
    await supabase.from('emails').update({ read: true }).eq('id', email.id);
    setEmails(prev => prev.map(e => e.id === email.id ? { ...e, read: true } : e));
    setSelected({ ...email, read: true });
  }

  async function handleSend(ev) {
    ev.preventDefault();
    setSending(true);
    const { data: sent } = await supabase.from('emails').insert({
      user_id: userId,
      from_address: PLATFORM_ADMIN_EMAIL,
      to_address: composeTo,
      subject: composeSubject,
      body: composeBody,
      folder: 'sent',
      read: true,
    }).select().single();
    if (sent) setEmails(prev => [sent, ...prev]);
    setShowCompose(false); setComposeTo(''); setComposeSubject(''); setComposeBody('');
    setSending(false);
  }

  async function deleteEmail(id) {
    await supabase.from('emails').delete().eq('id', id);
    setEmails(prev => prev.filter(e => e.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  const inbox = emails.filter(e => e.folder === 'inbox' || !e.folder);
  const sent = emails.filter(e => e.folder === 'sent');
  const [tab, setTab] = useState('inbox');
  const visible = tab === 'inbox' ? inbox : sent;

  function initials(addr) {
    if (!addr) return '?';
    const name = addr.split('@')[0];
    return name.slice(0, 2).toUpperCase();
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diff = Math.floor((now - d) / 60000);
    if (diff < 1) return 'just now';
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff/60)}h ago`;
    return d.toLocaleDateString();
  }

  return (
    <div>
      <div className="page-header" style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between'}}>
        <div>
          <h2>Inbox</h2>
          <p>{unread} unread message{unread !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCompose(true)}>✏️ Compose</button>
      </div>

      <div style={{display:'grid', gridTemplateColumns: selected ? '1fr 1.4fr' : '1fr', gap:'20px'}}>
        <div>
          <div className="panel">
            <div className="panel-header">
              <div style={{display:'flex', gap:'6px'}}>
                {['inbox','sent'].map(t => (
                  <button key={t} className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setTab(t); setSelected(null); }}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                    {t === 'inbox' && unread > 0 && <span className="nav-badge" style={{marginLeft:'6px'}}>{unread}</span>}
                  </button>
                ))}
              </div>
            </div>
            <div className="panel-body">
              {visible.length === 0
                ? <div className="empty-state"><div className="empty-icon">📭</div><p>No messages here.</p></div>
                : <div className="email-list">
                    {visible.map(email => (
                      <div key={email.id} className={`email-item ${!email.read ? 'email-unread' : ''}`} onClick={() => markRead(email)}>
                        {!email.read && <div className="unread-dot" />}
                        <div className="email-avatar">{initials(tab === 'inbox' ? email.from_address : email.to_address)}</div>
                        <div className="email-content">
                          <div className="email-from">{tab === 'inbox' ? email.from_address : `To: ${email.to_address}`}</div>
                          <div className="email-subject">{email.subject || '(no subject)'}</div>
                          <div className="email-preview">{email.body?.slice(0,80) || ''}</div>
                        </div>
                        <div style={{display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'6px'}}>
                          <div className="email-time">{timeAgo(email.created_at)}</div>
                          <button className="btn btn-icon btn-danger btn-sm" onClick={ev => { ev.stopPropagation(); deleteEmail(email.id); }}>🗑</button>
                        </div>
                      </div>
                    ))}
                  </div>
              }
            </div>
          </div>
        </div>

        {selected && (
          <div className="panel">
            <div className="panel-header">
              <h3 style={{maxWidth:'80%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{selected.subject || '(no subject)'}</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>Close</button>
            </div>
            <div className="panel-body">
              <div style={{display:'flex', gap:'8px', marginBottom:'16px', flexWrap:'wrap'}}>
                <span className="pill pill-purple">From: {selected.from_address}</span>
                {selected.to_address && <span className="pill pill-green">To: {selected.to_address}</span>}
              </div>
              <div style={{fontSize:'13px', lineHeight:'1.7', color:'var(--text-1)', whiteSpace:'pre-wrap'}}>{selected.body}</div>
            </div>
          </div>
        )}
      </div>

      {showCompose && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowCompose(false)}>
          <div className="modal">
            <div className="modal-header">
              <h3>New Message</h3>
              <button className="modal-close" onClick={() => setShowCompose(false)}>×</button>
            </div>
            <form onSubmit={handleSend}>
              <div className="form-group">
                <label className="form-label">To</label>
                <input className="form-input" type="email" value={composeTo} onChange={e => setComposeTo(e.target.value)} placeholder="recipient@example.com" required />
              </div>
              <div className="form-group">
                <label className="form-label">Subject</label>
                <input className="form-input" value={composeSubject} onChange={e => setComposeSubject(e.target.value)} placeholder="Subject line" />
              </div>
              <div className="form-group">
                <label className="form-label">Message</label>
                <textarea className="form-textarea" value={composeBody} onChange={e => setComposeBody(e.target.value)} placeholder="Write your message…" style={{minHeight:'140px'}} required />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowCompose(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={sending}>{sending ? 'Sending…' : 'Send'}</button>
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
function DashboardView({ tasks, emails, user, setView }) {
  const pendingTasks = tasks.filter(t => !t.completed);
  const highPrio = pendingTasks.filter(t => t.priority === 'high');
  const unreadEmails = emails.filter(e => !e.read && (e.folder === 'inbox' || !e.folder));

  const today = new Date();
  const greeting = today.getHours() < 12 ? 'Good morning' : today.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const name = user?.email?.split('@')[0] || 'Dara';

  const overdue = pendingTasks.filter(t => t.due_date && new Date(t.due_date) < today);

  return (
    <div>
      <div className="page-header">
        <h2>{greeting}, {name} 👋</h2>
        <p>{today.toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric', year:'numeric'})}</p>
      </div>

      <div className="cards-row">
        <div className="stat-card" style={{cursor:'pointer'}} onClick={() => setView('tasks')}>
          <div className="stat-label">Open Tasks</div>
          <div className="stat-value">{pendingTasks.length}</div>
          <div className="stat-sub">{highPrio.length} high priority</div>
        </div>
        <div className="stat-card" style={{cursor:'pointer'}} onClick={() => setView('inbox')}>
          <div className="stat-label">Unread Email</div>
          <div className="stat-value">{unreadEmails.length}</div>
          <div className="stat-sub">in your inbox</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Completed Today</div>
          <div className="stat-value" style={{color:'var(--green)'}}>
            {tasks.filter(t => t.completed && t.updated_at && new Date(t.updated_at).toDateString() === today.toDateString()).length}
          </div>
          <div className="stat-sub">tasks done today</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Overdue</div>
          <div className="stat-value" style={{color: overdue.length > 0 ? 'var(--red)' : 'var(--text-1)'}}>{overdue.length}</div>
          <div className="stat-sub">need attention</div>
        </div>
      </div>

      <div className="dash-grid">
        <div className="panel">
          <div className="panel-header">
            <h3>🔥 High Priority Tasks</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => setView('tasks')}>View all</button>
          </div>
          <div className="panel-body">
            {highPrio.length === 0
              ? <div className="empty-state" style={{padding:'24px 0'}}><p>All clear — no high priority tasks.</p></div>
              : <div className="task-list">
                  {highPrio.slice(0,5).map(task => (
                    <div key={task.id} className="task-item">
                      <div className="task-check" />
                      <span className="task-text">{task.title}</span>
                      <div className="task-meta">
                        <span className="task-priority priority-high">high</span>
                        {task.due_date && <span className="task-due">Due {task.due_date}</span>}
                      </div>
                    </div>
                  ))}
                </div>
            }
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>📬 Recent Messages</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => setView('inbox')}>View all</button>
          </div>
          <div className="panel-body">
            {unreadEmails.length === 0
              ? <div className="empty-state" style={{padding:'24px 0'}}><p>Inbox is clear.</p></div>
              : <div className="email-list">
                  {unreadEmails.slice(0,4).map(email => (
                    <div key={email.id} className="email-item email-unread" style={{cursor:'default'}}>
                      <div className="unread-dot" />
                      <div className="email-avatar">{email.from_address?.slice(0,2).toUpperCase() || '?'}</div>
                      <div className="email-content">
                        <div className="email-from">{email.from_address}</div>
                        <div className="email-subject">{email.subject || '(no subject)'}</div>
                      </div>
                    </div>
                  ))}
                </div>
            }
          </div>
        </div>
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
    e.preventDefault();
    setSaving(true); setMsg('');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) setMsg('Error: ' + error.message);
    else { setMsg('Password updated.'); setNewPassword(''); }
    setSaving(false);
  }

  return (
    <div>
      <div className="page-header">
        <h2>Settings</h2>
        <p>Manage your account</p>
      </div>

      <div style={{maxWidth:'500px'}}>
        <div className="panel" style={{marginBottom:'20px'}}>
          <div className="panel-header"><h3>Account</h3></div>
          <div className="panel-body">
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" value={user?.email || ''} disabled style={{opacity:0.6}} />
            </div>
            <div className="form-group">
              <label className="form-label">User ID</label>
              <input className="form-input" value={user?.id || ''} disabled style={{opacity:0.6, fontSize:'11px'}} />
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><h3>Change Password</h3></div>
          <div className="panel-body">
            {msg && <div className={msg.startsWith('Error') ? 'auth-error' : 'auth-success'} style={{marginBottom:'14px'}}>{msg}</div>}
            <form onSubmit={handlePasswordChange}>
              <div className="form-group">
                <label className="form-label">New Password</label>
                <input className="form-input" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Min 6 characters" required minLength={6} />
              </div>
              <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Update Password'}</button>
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
  const [dataLoaded, setDataLoaded] = useState(false);

  // Auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load data
  const loadData = useCallback(async () => {
    if (!session) return;
    const [tasksRes, emailsRes] = await Promise.all([
      supabase.from('tasks').select('*').order('created_at', { ascending: false }),
      supabase.from('emails').select('*').order('created_at', { ascending: false }),
    ]);
    if (tasksRes.data) setTasks(tasksRes.data);
    if (emailsRes.data) setEmails(emailsRes.data);
    setDataLoaded(true);
  }, [session]);

  useEffect(() => { loadData(); }, [loadData]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    setTasks([]); setEmails([]); setDataLoaded(false);
  }

  if (loading) {
    return <div className="loading-screen"><div className="spinner" /><p>Loading Khoyi…</p></div>;
  }

  if (!session) return <AuthScreen />;

  const user = session.user;
  const unreadCount = emails.filter(e => !e.read && (e.folder === 'inbox' || !e.folder)).length;
  const openTaskCount = tasks.filter(t => !t.completed).length;

  const NAV = [
    { id: 'dashboard', icon: '⚡', label: 'Dashboard' },
    { id: 'tasks',     icon: '✅', label: 'Tasks',  badge: openTaskCount || null },
    { id: 'inbox',     icon: '📬', label: 'Inbox',  badge: unreadCount || null },
    { id: 'settings',  icon: '⚙️',  label: 'Settings' },
  ];

  return (
    <div className="app-shell">
      {/* SIDEBAR */}
      <nav className="sidebar">
        <div className="sidebar-logo">
          <h1>Kho<span>yi</span></h1>
          <p>Personal OS</p>
        </div>

        <div className="sidebar-nav">
          <div className="nav-section-label">Workspace</div>
          {NAV.map(item => (
            <div key={item.id} className={`nav-item ${view === item.id ? 'active' : ''}`} onClick={() => setView(item.id)}>
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

      {/* MAIN */}
      <main className="main-content">
        {!dataLoaded
          ? <div className="loading-screen" style={{height:'60vh'}}><div className="spinner" /></div>
          : view === 'dashboard' ? <DashboardView tasks={tasks} emails={emails} user={user} setView={setView} />
          : view === 'tasks'     ? <TasksView tasks={tasks} setTasks={setTasks} userId={user.id} />
          : view === 'inbox'     ? <InboxView emails={emails} setEmails={setEmails} userId={user.id} />
          : view === 'settings'  ? <SettingsView user={user} />
          : null
        }
      </main>
    </div>
  );
}
