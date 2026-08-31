/**
 * Voting on a track.
 *
 * A vote is a fact, not an event — "this listener thinks this of this track" —
 * so it is one row per listener per track, changed rather than appended when
 * someone changes their mind. The visual burst is broadcast separately and
 * never written; see the room channel.
 *
 * No auth means listener_id is a value the browser invents, so a determined
 * person can vote as many times as they like under made-up identities. That
 * was harmless when the only signal was approval. It matters now that a
 * thumbs down is meant to inform whether a track gets pulled.
 */

import { getSupabase } from '../db/client';

/** 1 up, -1 down. A number because the useful question is what they sum to. */
export type VoteDirection = 1 | -1;

export type VoteOutcome = 'saved' | 'unchanged' | 'failed';

export type TrackVotes = {
  up: number;
  down: number;
};

const UNIQUE_VIOLATION = '23505';

export function outcomeForError(error: { code?: string | undefined } | null): VoteOutcome {
  if (error === null) return 'saved';
  return error.code === UNIQUE_VIOLATION ? 'unchanged' : 'failed';
}

export type CastVoteRequest = {
  roomId: string;
  trackUrl: string;
  listenerId: string;
  direction: VoteDirection;
};

/**
 * Never throws. A vote that fails to persist must not break the room or
 * retract the reaction the listener already saw.
 */
export async function castVote(request: CastVoteRequest): Promise<VoteOutcome> {
  const supabase = getSupabase();
  if (supabase === null) return 'failed';

  // Upsert: a listener changing their mind replaces their vote rather than
  // adding a second one, which is what the unique constraint means.
  const { error } = await supabase.from('votes').upsert(
    {
      room_id: request.roomId,
      track_url: request.trackUrl,
      listener_id: request.listenerId,
      direction: request.direction,
    },
    { onConflict: 'room_id,track_url,listener_id' },
  );

  return outcomeForError(error);
}

/** Tallies per track for the room, so a track can show what people think. */
export async function fetchVoteTallies(roomId: string): Promise<Map<string, TrackVotes>> {
  const supabase = getSupabase();
  const tallies = new Map<string, TrackVotes>();
  if (supabase === null) return tallies;

  const { data, error } = await supabase
    .from('votes')
    .select('track_url, direction')
    .eq('room_id', roomId);
  if (error !== null || data === null) return tallies;

  for (const row of data as Array<Record<string, unknown>>) {
    const url = row['track_url'];
    const direction = row['direction'];
    if (typeof url !== 'string' || typeof direction !== 'number') continue;
    const current = tallies.get(url) ?? { up: 0, down: 0 };
    if (direction > 0) current.up += 1;
    else current.down += 1;
    tallies.set(url, current);
  }
  return tallies;
}

/** What this listener has said about each track, so the buttons can show it. */
export async function fetchMyVotes(
  roomId: string,
  listenerId: string,
): Promise<Map<string, VoteDirection>> {
  const supabase = getSupabase();
  const mine = new Map<string, VoteDirection>();
  if (supabase === null) return mine;

  const { data, error } = await supabase
    .from('votes')
    .select('track_url, direction')
    .eq('room_id', roomId)
    .eq('listener_id', listenerId);
  if (error !== null || data === null) return mine;

  for (const row of data as Array<Record<string, unknown>>) {
    const url = row['track_url'];
    const direction = row['direction'];
    if (typeof url !== 'string' || typeof direction !== 'number') continue;
    mine.set(url, direction > 0 ? 1 : -1);
  }
  return mine;
}
