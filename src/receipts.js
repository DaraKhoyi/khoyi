// receipts — a photographed receipt: stored under its books, read, and put
// with the entry it belongs to.
//
// Dara, 6 Oct 2026 (accounting build, part 5): "Receipts. Photograph a receipt;
// PrismOS reads it and attaches it to the matching bank line automatically."
//
// Where the file lives decides who can open it. In books that use statements
// it goes under the BOOK ({book_id}/receipts/ in the private `statements`
// bucket), so everyone with a seat on those books can see it. Otherwise it
// stays where receipts always went: the person's own private folder.
import { supabase } from './dataService';
import { notifyError } from './notify';

const underBook = (path) => /^[0-9a-f-]{36}\/receipts\//i.test(String(path || ''));
export const receiptBucket = (path) => (underBook(path) ? 'statements' : 'receipts');

export async function receiptLink(path) {
  if (!path) return null;
  const { data } = await supabase.storage.from(receiptBucket(path)).createSignedUrl(path, 3600);
  return (data && data.signedUrl) || null;
}
// The file is private: a link that works for an hour, opened beside the app.
export async function openReceipt(path) {
  const url = await receiptLink(path);
  if (!url) { notifyError('The receipt could not be opened.'); return; }
  window.open(url, '_blank', 'noopener');
}

// What the reader's answer means for the books, in a sentence.
export function attachSentence(a) {
  if (!a || !a.attached) return '';
  const day = a.date ? new Date(a.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  if (a.attached === 'line') return `That is ${a.payee || 'a line'}${day ? ' of ' + day : ''} on a statement you have not finished reviewing. The receipt is attached to it there.`;
  return `That is ${a.payee || 'an entry'}${day ? ' of ' + day : ''}, already in the books${a.bank ? ' from the bank' : ''}. The receipt is attached to it; nothing was added twice.`;
}

// Store the photo, have it read, and look for the entry it belongs to.
// Returns { path, url, extracted, attach } where attach is the database's
// answer: { attached: 'entry' | 'line' | null, choices: [...] }.
export async function snapReceipt({ file, book, userId }) {
  if (file.size > 10 * 1024 * 1024) throw new Error('That image is too large (10 MB at most).');
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const shared = !!(book && book.statements);
  const path = shared ? `${book.id}/receipts/${name}` : `${userId}/${name}`;
  const up = await supabase.storage.from(shared ? 'statements' : 'receipts').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
  if (up.error) throw new Error('The photo did not upload: ' + up.error.message);
  const url = await receiptLink(path);
  const { data, error } = await supabase.functions.invoke('parse-receipt', { body: shared ? { receipt_path: path, book_id: book.id } : { receipt_path: path } });
  if (error) throw new Error('The receipt could not be read: ' + error.message);
  if (data && data.error) throw new Error(data.error);
  let attach = null;
  if (book && data && Number(data.amount) && data.date) {
    const r = await supabase.rpc('receipt_attach', { p_book: book.id, p_path: path, p_amount: Math.abs(Number(data.amount)), p_date: data.date, p_transaction: null });
    if (!r.error) attach = r.data;
  }
  return { path, url, extracted: data, attach };
}
// The person said which of several entries the receipt belongs to.
export async function attachReceiptTo(book, path, transactionId) {
  const { data, error } = await supabase.rpc('receipt_attach', { p_book: book.id, p_path: path, p_amount: null, p_date: null, p_transaction: transactionId });
  if (error) { notifyError(error.message); return null; }
  return data;
}
