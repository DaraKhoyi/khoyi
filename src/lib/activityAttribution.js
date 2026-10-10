// How a contact timeline says who did something.
//
// The line is the same on a private contact and a shared one. On a private
// contact it is usually the agent themself. The name and the time come from
// the row the database stored. The app does not pick the actor. When the
// database has no name to give, the line says "author unknown".

export function initialsFromName(name) {
  const clean = String(name || '').trim();
  if (!clean) return '';
  return clean.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
}

export function hasServerAttribution(row) {
  if (!row || row._email) return false;
  return Object.prototype.hasOwnProperty.call(row, 'author_id')
    || Object.prototype.hasOwnProperty.call(row, 'author_name')
    || Object.prototype.hasOwnProperty.call(row, 'actor_id')
    || Object.prototype.hasOwnProperty.call(row, 'actor_name');
}

export function formatActivityWhen(iso, locale, timeZone) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const opts = { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' };
  if (timeZone) opts.timeZone = timeZone;
  return new Intl.DateTimeFormat(locale, opts).format(d).replace(/\u202f/g, ' ');
}

function who(name) {
  const clean = String(name || '').trim();
  return clean || 'author unknown';
}

export function byline(name, at, locale, timeZone) {
  const when = formatActivityWhen(at, locale, timeZone);
  return when ? `by ${who(name)}, ${when}` : `by ${who(name)}`;
}

export function editedByline(name, at, locale, timeZone) {
  const when = formatActivityWhen(at, locale, timeZone);
  return when ? `edited by ${who(name)}, ${when}` : `edited by ${who(name)}`;
}

export function completedByline(name, at, locale, timeZone) {
  const when = formatActivityWhen(at, locale, timeZone);
  return when ? `completed by ${who(name)}, ${when}` : `completed by ${who(name)}`;
}
