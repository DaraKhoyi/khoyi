// ── Toast + confirm-dialog registry — extracted from App.js (strangle) ────────
// The single shared registry lives here. notify()/confirmDialog() push to it;
// the ToastHost/ConfirmHost components (still in App.js) subscribe via the
// exported subscribe helpers, so everything connects through one Set. Views and
// non-React code import notify/notifyError/confirmDialog from here.

const __toastListeners = new Set();
const __confirmListeners = new Set();

export function subscribeToasts(fn) { __toastListeners.add(fn); return () => __toastListeners.delete(fn); }
export function subscribeConfirms(fn) { __confirmListeners.add(fn); return () => __confirmListeners.delete(fn); }

export function notify(message, kind = 'info', action = null) {
  // action: { label, onClick } — renders an inline button on the toast.
  __toastListeners.forEach(fn => { try { fn({ id: Date.now() + Math.random(), message, kind, action }); } catch (_) {} });
}

export function notifyError(message) { notify(message, 'error'); }

// Promise-based branded confirm; replaces native window.confirm.
export function confirmDialog(message, opts = {}) {
  return new Promise(resolve => {
    const payload = {
      id: Date.now() + Math.random(),
      message,
      confirmLabel: opts.confirmLabel || 'Confirm',
      cancelLabel: opts.cancelLabel || 'Cancel',
      danger: opts.danger !== false,
      resolve,
    };
    if (__confirmListeners.size === 0) {
      // Fail safe: never silently skip a confirmation if no host is mounted.
      resolve(typeof window !== 'undefined' ? window.confirm(message) : true);
      return;
    }
    __confirmListeners.forEach(fn => { try { fn(payload); } catch (_) {} });
  });
}

// Expose to window so non-React code paths (cron retry hooks, etc.) can call too.
if (typeof window !== 'undefined') {
  window.__notify = notify;
  window.__confirmDialog = confirmDialog;
}

export default { notify, notifyError, confirmDialog, subscribeToasts, subscribeConfirms };
