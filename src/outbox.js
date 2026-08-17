// ── outbox.js — nothing the user typed or said is ever lost ──────────────────
//
// FAILURE CONDITION this is written against:
//   it has failed if a user loses something they typed or said, or if anyone has
//   to REMEMBER to do something to protect their own work.
//
// That second clause is why this is not a "restore draft?" prompt. A prompt is a
// question asked of someone who has already lost faith. This saves continuously,
// restores silently, and retries by itself.
//
// TWO PROBLEMS, ONE MECHANISM. A note that fails to save in a parking garage and a
// twenty-second voice memo that fails to upload outside a listing are the same
// thing: unsent work sitting on a device. Building them twice would give us two
// half-reliable systems instead of one reliable one.
//
// WHY IndexedDB AND NOT localStorage:
//   • localStorage is ~5MB and stores strings. A single voice note is bigger than
//     the whole budget. IndexedDB stores Blobs and is measured in hundreds of MB.
//   • localStorage writes are SYNCHRONOUS and block the main thread — doing it on
//     every keystroke is how you make typing feel laggy on a mid-range Android.
//
// SCOPE, deliberately: this is an append-only outbox, NOT offline mode. It queues
// things that are CREATED. It does not cache the database for reading and it does
// not queue EDITS to existing records — an edit replayed an hour later can silently
// overwrite what someone else changed, and that is a worse bug than the one we are
// fixing.

const DB_NAME = 'prism-outbox';
const DB_VERSION = 1;
const DRAFTS = 'drafts';     // in-progress text, keyed by screen+field
const QUEUE = 'queue';       // completed work waiting to reach the server

let _db = null;
let _failed = false;

function open() {
  if (_failed) return Promise.resolve(null);
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(QUEUE)) {
          const s = db.createObjectStore(QUEUE, { keyPath: 'id' });
          s.createIndex('by_user', 'userId');
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      // Private browsing and locked-down profiles can refuse IndexedDB entirely.
      // Degrade to "no safety net" rather than breaking the app — the user is no
      // worse off than before this existed.
      req.onerror = () => { _failed = true; resolve(null); };
    } catch (_) { _failed = true; resolve(null); }
  });
}

const tx = async (store, mode, fn) => {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => resolve(r && r.result !== undefined ? r.result : true);
      t.onerror = () => resolve(null);
    } catch (_) { resolve(null); }
  });
};

// ── DRAFTS — in-progress text ───────────────────────────────────────────────
// Keyed by screen + field + record, so two notes open on two screens never
// overwrite each other.
export const draftKey = (screen, field, id) => `${screen}:${field}:${id || 'new'}`;

export async function saveDraft(key, value, meta = {}) {
  if (!key) return;
  const text = String(value ?? '');
  // An empty draft is a deletion, not a save — otherwise clearing a box leaves a
  // ghost that gets restored next time and confuses the user badly.
  if (!text.trim()) return clearDraft(key);
  await tx(DRAFTS, 'readwrite', (s) => s.put({ key, text, meta, at: Date.now() }));
}

export async function loadDraft(key) {
  const r = await tx(DRAFTS, 'readonly', (s) => s.get(key));
  return r && r.text ? r : null;
}

export async function clearDraft(key) {
  await tx(DRAFTS, 'readwrite', (s) => s.delete(key));
}

/** Drafts older than a fortnight are stale enough to be noise. */
export async function pruneDrafts(maxAgeMs = 14 * 24 * 3600 * 1000) {
  const db = await open();
  if (!db) return;
  const cutoff = Date.now() - maxAgeMs;
  await tx(DRAFTS, 'readwrite', (s) => {
    const req = s.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      if ((c.value.at || 0) < cutoff) c.delete();
      c.continue();
    };
    return req;
  });
}

// ── QUEUE — finished work waiting for the network ───────────────────────────
const listeners = new Set();
export const onOutboxChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = async () => {
  const items = await listQueue();
  for (const fn of Array.from(listeners)) { try { fn(items); } catch (_) {} }
};

/**
 * Queue a completed piece of work.
 *   kind    — 'voice_note' | 'note' | 'task' | 'journal'
 *   payload — plain JSON, or { blob } for audio
 * Returns the id so a caller can show "saved on this phone" immediately.
 */
export async function enqueue(userId, kind, payload, label) {
  const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
  const item = { id, userId, kind, payload, label: label || kind, attempts: 0, lastError: null, at: Date.now() };
  const ok = await tx(QUEUE, 'readwrite', (s) => s.put(item));
  await emit();
  return ok ? id : null;
}

export async function listQueue(userId) {
  const db = await open();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const t = db.transaction(QUEUE, 'readonly');
      const req = t.objectStore(QUEUE).getAll();
      req.onsuccess = () => resolve((req.result || []).filter((i) => !userId || i.userId === userId));
      req.onerror = () => resolve([]);
    } catch (_) { resolve([]); }
  });
}

export async function dequeue(id) {
  await tx(QUEUE, 'readwrite', (s) => s.delete(id));
  await emit();
}

async function markFailed(item, err) {
  item.attempts = (item.attempts || 0) + 1;
  item.lastError = String(err || 'failed').slice(0, 300);
  await tx(QUEUE, 'readwrite', (s) => s.put(item));
  await emit();
}

/**
 * Try to send everything queued. Safe to call often — it is a no-op when the
 * queue is empty or the browser reports itself offline.
 *
 * `senders` maps kind -> async (payload) => void. It throws to keep the item.
 * NOTHING IS DELETED UNTIL THE SEND SUCCEEDS. An item that fails stays exactly
 * where it was, with its attempt count, and is retried on the next reconnect.
 */
let _flushing = false;
export async function flushOutbox(senders, userId) {
  if (_flushing) return { sent: 0, kept: 0 };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { sent: 0, kept: 0 };
  _flushing = true;
  let sent = 0, kept = 0;
  try {
    for (const item of await listQueue(userId)) {
      const send = senders[item.kind];
      if (!send) { kept++; continue; }
      // Give up on the SERVER after enough tries, but never throw the work away —
      // it stays visible so the user can copy it out rather than discovering a
      // silent deletion.
      if ((item.attempts || 0) >= 8) { kept++; continue; }
      try { await send(item.payload); await dequeue(item.id); sent++; }
      catch (e) { await markFailed(item, e && e.message); kept++; }
    }
  } finally { _flushing = false; }
  return { sent, kept };
}

/** Flush on reconnect and when the app comes back to the foreground. */
export function startOutboxWatcher(senders, userId) {
  if (typeof window === 'undefined') return () => {};
  const run = () => { flushOutbox(senders, userId); };
  window.addEventListener('online', run);
  window.addEventListener('focus', run);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
  const timer = setInterval(run, 60000);
  run();
  return () => { window.removeEventListener('online', run); window.removeEventListener('focus', run); clearInterval(timer); };
}
