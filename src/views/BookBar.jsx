// BookBar — whose books am I in, on screen the whole time I am in Money.
//
// Dara, 6 Oct 2026: a person who belongs to several sets of books "sees a
// clear book switcher, and the current book's name stays on screen at all
// times so nobody posts brokerage money into personal books."
//
// The bar sticks to the top of the Money room while the page scrolls. It is
// drawn for the people this is switched on for and for anyone who has been put
// on someone else's books; everyone else sees Money exactly as before.
// The thinking is in ../books.js; this file only draws it.
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../dataService';
import { useBackClose } from '../backClose';
import { ROLE_LABEL, bookKind, bookTitle, can, chooseBook, readRemembered, writeRemembered } from '../books';

// The books this person can open, and the one that is open.
// If the list cannot be read (offline, or a phone ahead of the database), the
// answer is "no books": Money then works on the person's own rows as it always has.
export function useBooks(userId, want, nonce) {
  const [state, setState] = useState({ ready: false, enabled: false, books: [], bookId: null });
  const honoured = useRef(null);       // the last one-time "open the brokerage's books" that was acted on
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_books');
    if (error || !data) { setState({ ready: true, enabled: false, books: [], bookId: null }); return; }
    // Statements: shared books always; a person's own once accounting is switched on for them.
    const books = (Array.isArray(data.books) ? data.books : []).map((b) => ({ ...b, statements: !b.is_mine || !!data.enabled }));
    const key = want ? `${want}:${nonce}` : null;
    const once = key && honoured.current !== key ? want : null;
    if (key) honoured.current = key;
    setState((s) => {
      const b = chooseBook(books, { remembered: s.bookId || readRemembered(userId), want: once });
      return { ready: true, enabled: !!data.enabled, books, bookId: b ? b.id : null };
    });
  }, [userId, want, nonce]);
  useEffect(() => { load(); }, [load]);
  const pick = useCallback((id) => { writeRemembered(userId, id); setState((s) => ({ ...s, bookId: id })); }, [userId]);
  const book = state.books.find((b) => b.id === state.bookId) || null;
  return { ...state, book, pick, reload: load };
}

function BookPicker({ books, current, onPick, onClose }) {
  useBackClose(onClose);
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal bk-sheet" role="dialog" aria-label="Choose a set of books">
        <h3>Whose books?</h3>
        <p className="bk-help">Everything you enter goes into the set of books you choose here.</p>
        <div className="bk-picks">
          {books.map((b) => (
            <button type="button" key={b.id} className={'bk-pick' + (current && b.id === current.id ? ' on' : '')} aria-pressed={!!current && b.id === current.id}
              onClick={() => { onPick(b.id); onClose(); }} data-testid="book-pick">
              <span className="who"><b>{bookTitle(b)}</b><i>{bookKind(b)} · {ROLE_LABEL[b.role] || b.role}</i></span>
              {current && b.id === current.id && <span className="here">Open now</span>}
            </button>
          ))}
        </div>
        <button type="button" className="bk-quiet" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

export function BookBar({ books, book, onPick, onPeople }) {
  const [choosing, setChoosing] = useState(false);
  if (!book) return null;
  return (
    <>
      <div className={'bk-bar' + (book.is_mine ? '' : ' shared')} data-testid="book-bar">
        <div className="bk-bar-who">
          <span className="bk-eye">{book.is_mine ? 'You are in' : 'Not your own books'}</span>
          <b className="bk-name" data-testid="book-name">{bookTitle(book)}</b>
          <span className="bk-role">{bookKind(book)} · {ROLE_LABEL[book.role] || book.role}{book.closed_through ? ' · closed through ' + book.closed_through : ''}</span>
        </div>
        <div className="bk-bar-go">
          {books.length > 1 && <button type="button" onClick={() => setChoosing(true)} data-testid="book-switch" aria-label="Switch books">Switch</button>}
          {can(book, 'people') && <button type="button" onClick={onPeople} data-testid="book-people">People</button>}
        </div>
      </div>
      {choosing && <BookPicker books={books} current={book} onPick={onPick} onClose={() => setChoosing(false)} />}
    </>
  );
}
