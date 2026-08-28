import { describe, expect, it } from 'vitest';
import { outcomeForError } from './favorites';

describe('outcomeForError', () => {
  it('treats no error as saved', () => {
    expect(outcomeForError(null)).toBe('saved');
  });

  // A favourite is a fact, not an event. Stating it twice is not a failure,
  // and a listener must never be shown an error for tapping again.
  it('treats a duplicate as already favourited, not as a failure', () => {
    expect(outcomeForError({ code: '23505' })).toBe('already');
  });

  it('treats anything else as failed', () => {
    expect(outcomeForError({ code: '42501' })).toBe('failed');
    expect(outcomeForError({ code: undefined })).toBe('failed');
    expect(outcomeForError({})).toBe('failed');
  });
});
