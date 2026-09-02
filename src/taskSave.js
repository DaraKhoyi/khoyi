import { supabase } from './dataService';

// Saving a task, once.
//
// TaskModal emits two fields that are NOT columns on `tasks`:
//   _contact_ids  the people linked to the task, written through the
//                 set_task_contacts RPC
//   _email        a delegation payload, handled by the caller
//
// Every caller has to strip them. CalendarView always did. The contact record
// did not, and PostgREST answered "Could not find the '_contact_ids' column",
// which reads to the user as "That didn't save" with the edit still on screen.
// A rule every call site must remember is a rule that will eventually be
// forgotten, so it lives here instead.

export async function saveTaskFromModal(taskId, data) {
  const { _contact_ids, _email, ...taskData } = data || {};
  delete taskData.id;

  const { data: updated, error } = await supabase
    .from('tasks').update(taskData).eq('id', taskId).select().single();
  if (error) {
    return { ok: false, error: error.message || error.code || 'unknown error' };
  }

  // Contact links are a separate write and can fail on their own. Report that
  // rather than implying the whole save failed — the task itself is stored.
  let linkError = null;
  if (Array.isArray(_contact_ids)) {
    const { error: cErr } = await supabase.rpc('set_task_contacts', {
      p_task_id: taskId, p_contact_ids: _contact_ids,
    });
    if (cErr) linkError = cErr.message || cErr.code;
  }

  // Today, the call list and the briefing all read tasks; tell them.
  try { window.dispatchEvent(new Event('prism:tasks-changed')); } catch (_) {}

  return { ok: true, row: updated || taskData, linkError, email: _email || null };
}

export async function deleteTask(taskId) {
  const { error } = await supabase.from('tasks').delete().eq('id', taskId);
  if (error) return { ok: false, error: error.message || error.code || 'unknown error' };
  try { window.dispatchEvent(new Event('prism:tasks-changed')); } catch (_) {}
  return { ok: true };
}
