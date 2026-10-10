// Tasks shown on a contact: the ones whose row points at the contact (that is how
// a task another agent added on a SHARED contact arrives) plus the ones linked
// through task_contacts. Open first, then by due date. Moved out of
// ContactDetailModal.jsx (file size budget), behaviour unchanged.
export async function loadContactTasks(supabase, contactId) {
  const byId = new Map();
  const { data: direct } = await supabase.from('tasks').select('*').eq('contact_id', contactId);
  (direct || []).forEach(t => byId.set(t.id, t));
  const { data: linkRows } = await supabase.from('task_contacts').select('task_id').eq('contact_id', contactId);
  const missing = (linkRows || []).map(r => r.task_id).filter(id => id && !byId.has(id));
  if (missing.length) {
    const { data: tasks } = await supabase.from('tasks').select('*').in('id', missing);
    (tasks || []).forEach(t => byId.set(t.id, t));
  }
  return [...byId.values()].sort((a, b) => {
    if (!!a.completed !== !!b.completed) return a.completed ? 1 : -1;
    return String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'));
  });
}
