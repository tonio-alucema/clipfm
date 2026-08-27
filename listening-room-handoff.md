# Listening room — Phase 0 handoff

Paste this at the start of a Claude Code session. Read it fully before writing any code, then propose a plan before touching files.

---

## What we're building

A turntable.fm-style listening room. A small group hears the same track at the same moment, sees each other as pill-shaped avatars, and can favorite the current song. Web only.

**Phase 0 scope is deliberately small.** Listen-only. Fixed curated playlist. No suggestions, no voting, no SoundCloud login, no search.

**Out of scope for Phase 0 — do not build these, do not scaffold for them beyond the seams noted below:**

- Track suggestions or a mutable queue
- SoundCloud OAuth or any authenticated SoundCloud API call
- Skip/vote-to-skip
- Chat
- Multiple rooms (build for one, but key the data by `room_id` so a second is cheap later)

---

## The one thing this phase exists to prove

Can 4–6 browsers stay within ~1 second of each other while playing audio through an iframe we don't control?

Everything else is decoration until that works. **Build the sync loop with a hardcoded two-track playlist and no UI before writing a single avatar, style, or animation.** If sync doesn't hold, the product doesn't exist and we'd rather learn that in an afternoon.

---

## Hard constraints

1. **No SoundCloud API key.** Registering an app now requires an Artist Pro subscription. We use only the free public surfaces: the embed widget and the oEmbed endpoint. If a task seems to need `client_id`, stop and flag it — don't work around it, and never scrape a `client_id` out of network traffic.
2. **Our server never touches audio bytes.** No proxying, no caching, no re-hosting, no downloading. Every listener's browser streams directly from SoundCloud through SoundCloud's own player.
3. **$0 infrastructure.** Supabase free tier, Vercel hobby. No cron jobs, no always-on process, no scheduled functions.
4. **No hardcoded motion values.** Durations and easings live in `lib/motion.ts`. Components import tokens. This is non-negotiable, including for throwaway prototypes.

---

## Stack

- Next.js (App Router) + TypeScript
- Supabase — Postgres + Realtime (presence and broadcast)
- Tailwind + shadcn/ui
- GSAP for avatar choreography; Framer Motion for enter/exit
- Vercel

---

## Core architecture

### Deterministic schedule

Nothing "advances" the track. There is no host, no owner, no server tick. What's playing is computed from arithmetic that every client runs independently and agrees on.

```
elapsed = (Date.now() - epoch) % totalDurationMs
```

Walk the track array accumulating durations until you pass `elapsed`. That gives you the current track index and the offset into it. A client that joins at 3am gets the right song at the right second because the math says so.

Consequence: a schedule is **immutable once written**. To change the playlist, insert a new schedule row with a new epoch and a frozen snapshot of order and durations. Never mutate a live schedule in place.

### Player abstraction

Wrap the SoundCloud widget behind a narrow interface so the source is swappable:

```ts
interface RoomPlayer {
  load(trackUrl: string): Promise<void>;
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  getPosition(): Promise<number>;
  onFinish(cb: () => void): void;
}
```

Sync logic must not import anything SoundCloud-specific. If terms change or a track won't embed, we drop in a YouTube implementation without touching the scheduler.

### Drift correction

- Compare local position to computed target every **5s**
- Re-seek only if the gap exceeds **1500ms** — smaller corrections are audible and worse than the drift
- Both numbers go in a config file, not inline

### Clock skew

`Date.now()` is the client's clock and it can be minutes off. On mount, fetch server time once, compute an offset, and use `serverNow()` everywhere in the scheduler. Never call `Date.now()` directly in sync code.

---

## SoundCloud specifics

**Widget embed** — no key required:

```html
<iframe
  id="sc-widget"
  allow="autoplay"
  src="https://w.soundcloud.com/player/?url=<TRACK_URL>&auto_play=false"
></iframe>
<script src="https://w.soundcloud.com/player/api.js"></script>
```

`SC.Widget(iframe)` returns an object with `play()`, `pause()`, `seekTo(ms)`, `load(url, opts)`, `getPosition(cb)`, `getDuration(cb)`, `getCurrentSound(cb)`, and `bind(SC.Widget.Events.X, cb)` for `READY`, `PLAY`, `PAUSE`, `FINISH`, `PLAY_PROGRESS`.

**Metadata** — `https://soundcloud.com/oembed?url=<TRACK_URL>&format=json` returns title, author, and artwork. No key. Does **not** return duration.

**Durations** must be harvested once per playlist with a seed script that loads each track in the widget and reads `getDuration()`. Store the result in the schedule snapshot. Do not fetch durations at runtime.

**Not every track allows off-platform embedding.** The seed script must detect and reject these, loudly, at seed time rather than at 2am in a live room.

**Autoplay is blocked** without a user gesture. The room needs an explicit "tune in" button. Treat this as a feature — joining mid-song is the point.

---

## Data model (first pass — propose changes if you see a problem)

```sql
rooms         (id, slug, name, active_schedule_id, created_at)
schedules     (id, room_id, epoch timestamptz, tracks jsonb, created_at)
favorites     (id, room_id, track_url, listener_id, created_at)
```

`tracks` jsonb is an ordered array of `{ url, title, artist, artwork, durationMs }`.

Presence is **not** a table. Use Supabase Realtime presence.

**Ephemeral vs durable — enforce this split:**

| Ephemeral (broadcast only, never written) | Durable (Postgres) |
|---|---|
| Who's in the room | Schedules |
| Avatar bob state | Favorites |
| Heart bursts | Room config |

Writing a row on every heart tap will exhaust the free tier and add latency to the one interaction that must feel instant.

Listener identity in Phase 0 is a nickname plus a UUID in localStorage. No auth. Don't add Supabase Auth yet.

---

## Build sequence

Each step ends at a checkpoint. **Stop at each checkpoint and wait for review before continuing.**

**1. Scheduler, pure functions, no UI, no network**
`lib/schedule.ts` — given a tracks array, epoch, and a timestamp, return `{ trackIndex, offsetMs }`. Unit tests covering: t=0, mid-track, exact boundary, wraparound past the end of the playlist, and empty playlist.
→ *Checkpoint: tests pass.*

**2. Player wrapper**
`lib/player/soundcloud.ts` implementing `RoomPlayer`. A bare page that loads one hardcoded track and seeks to 30s on a button click.
→ *Checkpoint: audio plays from the right position in one tab.*

**3. Sync loop**
Wire the scheduler to the player with a hardcoded 2-track playlist and hardcoded epoch. Add an on-screen debug readout showing target position, actual position, and drift in ms.
→ *Checkpoint: open three tabs, confirm drift stays under 1.5s across a track boundary. This is the phase's real deliverable.*

**4. Supabase**
Schema, RLS, seed script for durations, room page reading a real schedule.
→ *Checkpoint: sync works from live data, not constants.*

**5. Presence and avatars**
Realtime presence, pill avatars, join/leave transitions.
→ *Checkpoint: avatars appear and disappear correctly with three tabs.*

**6. Favorites and hearts**
Durable write for the favorite, broadcast for the visual burst.
→ *Checkpoint: heart is instant locally and visible to others.*

**7. Motion pass**
GSAP idle bob with randomized per-avatar offset. Twelve pills bobbing in unison reads as broken, not alive. All values from `lib/motion.ts`.
→ *Checkpoint: looks alive.*

---

## Working agreements

**Branching**
- `main` deploys to production
- One branch per numbered step: `feat/01-scheduler`, `feat/02-player-wrapper`, etc.
- PR into `main` at each checkpoint. Vercel preview URL is how sync gets tested across real devices — localhost testing across tabs hides real network conditions.

**Commits**
- Format: `<type>: <description>`
- Small and single-concern. A commit that touches the scheduler and the avatar styles is two commits.

**Env vars**
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — client-safe
- Service role key is used **only** by the local seed script, from `.env.local`, never in app code and never in Vercel's client-side env
- Confirm `.env.local` is gitignored before the first commit

**Rollback**
- Steps 1–3 are pure additions; revert the merge commit
- Step 4 adds schema. Every migration needs a matching down migration written at the same time. Never edit a migration that's been applied to the hosted database — write a new one.
- Schedules are append-only, so a bad playlist is fixed by pointing `active_schedule_id` at the previous row. No data loss path here by design.

**Testing checkpoints**
- Steps 1 and 4: unit tests, including the boundary and wraparound cases
- Step 3: manual multi-tab drift test on a Vercel preview, plus one test on a phone over cellular — that's where clock skew and latency actually show up
- Every step after 3: re-run the multi-tab drift test before merging. Sync is the thing most likely to be quietly broken by unrelated changes.

**Review mode**
Approval mode 1 (approve each edit) through steps 1–4. Mode 2 is fine for step 7's repetitive motion tuning.

**Models**
Sonnet by default. Switch to Opus for step 3 (the sync loop and clock skew handling) and step 7 if the choreography gets involved.

---

## Never do

- Add a `client_id` or any authenticated SoundCloud API call
- Proxy, cache, download, or re-host audio
- Mutate an existing schedule row
- Call `Date.now()` inside sync logic — use `serverNow()`
- Write a database row on every heart or presence tick
- Hardcode a duration or easing in a component
- Add a cron job, scheduled function, or any always-on process
- Import SoundCloud types or the `SC` global outside `lib/player/`
- Build ahead into Phase 1 (queue, suggestions, auth) without asking first

---

## Open questions to raise, not silently decide

- Does drift hold on mobile Safari, where background tabs throttle timers? If not, we need a visibility-change re-sync and possibly a "you fell behind, catch up" state.
- What happens when a track in the schedule becomes unavailable or geo-blocked mid-session? Skip forward and accept desync, or show a "this track isn't available in your region" state and keep the clock running? Second is probably right — the clock is the source of truth — but flag it before implementing.
- Presence with no auth means one person in two tabs looks like two listeners. Acceptable for Phase 0, worth naming.

---

## First response expected from you

Don't write code yet. Read the repo if one exists, then reply with:

1. Your restatement of the deterministic schedule model in your own words, so I can confirm you have it
2. The file structure you propose for steps 1–3
3. Anything in this doc you think is wrong or will cause a problem
