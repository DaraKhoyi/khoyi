import { describe, it, expect } from 'vitest';
import {
  initialsFromName,
  hasServerAttribution,
  byline,
  editedByline,
  completedByline,
} from './activityAttribution';

const WHEN = '2026-10-09T18:30:00.000Z';
const opts = ['en-US', 'UTC'];

describe('shared contact attribution lines', () => {
  it('names the agent and the time', () => {
    expect(byline('Ada Lovelace', WHEN, ...opts)).toBe('by Ada Lovelace, Oct 9, 2026, 6:30 PM');
  });

  it('keeps the original author and adds who edited', () => {
    expect(editedByline('Grace Hopper', '2026-10-09T19:05:00.000Z', ...opts))
      .toBe('edited by Grace Hopper, Oct 9, 2026, 7:05 PM');
  });

  it('says who completed a task', () => {
    expect(completedByline('Ada Lovelace', WHEN, ...opts))
      .toBe('completed by Ada Lovelace, Oct 9, 2026, 6:30 PM');
  });

  it('says author unknown when the database has no name', () => {
    expect(byline(null, WHEN, ...opts)).toBe('by author unknown, Oct 9, 2026, 6:30 PM');
    expect(byline('   ', null)).toBe('by author unknown');
    expect(completedByline('', WHEN, ...opts)).toBe('completed by author unknown, Oct 9, 2026, 6:30 PM');
  });

  it('uses initials when a name exists and nothing when it does not', () => {
    expect(initialsFromName('Ada Lovelace')).toBe('AL');
    expect(initialsFromName('Ada')).toBe('A');
    expect(initialsFromName('')).toBe('');
    expect(initialsFromName(null)).toBe('');
  });

  it('shows a byline only after the server columns are present', () => {
    expect(hasServerAttribution({ author_id: null, author_name: null })).toBe(true);
    expect(hasServerAttribution({ body: 'a note from before the columns existed' })).toBe(false);
    expect(hasServerAttribution({ _email: true, author_name: 'Ada' })).toBe(false);
  });
});
