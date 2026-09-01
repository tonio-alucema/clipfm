import { describe, expect, it } from 'vitest';
import { outcomeForError } from './favorites';

describe('outcomeForError', () => {
  it('treats no error as saved', () => {
    expect(outcomeForError(null)).toBe('saved');
  });

  // Load-bearing: with no UPDATE privilege the insert is plain, so a repeat
  // tap always collides. If this read as a failure the room would roll back a
  // favorite the listener already has.
  it('treats a unique violation as already-yours, not a failure', () => {
    expect(outcomeForError({ code: '23505' })).toBe('unchanged');
  });

  it('treats anything else as failed', () => {
    expect(outcomeForError({ code: '42501' })).toBe('failed');
    expect(outcomeForError({})).toBe('failed');
  });
});
