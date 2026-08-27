# CLAUDE.md

Persistent context for this repo. Loaded into every session — keep it short.

## What this is

A synchronized listening room. A small group hears the same track at the same moment, sees each other as pill-shaped avatars, and can favorite what's playing. Web only, Next.js App Router + TypeScript + Supabase + Tailwind + shadcn/ui, deployed on Vercel.

## Architecture invariants

**The schedule is the source of truth.** What's playing is computed from `(serverNow() - epoch) % totalDuration`, walked against an ordered array of track durations. No host, no owner, no server tick, no "next" event. Every client computes the same answer independently.

**Schedules are immutable.** To change a playlist, write a new row with a new epoch and a frozen snapshot of order and durations, then repoint `rooms.active_schedule_id`. Never mutate a schedule that has been played.

**Our server never touches audio bytes.** Every listener streams directly from the provider through the provider's own player. No proxy, no cache, no re-host, no download.

**The audio provider is swappable.** Everything provider-specific lives behind the `RoomPlayer` interface in `lib/player/`. Scheduler and room code must not import provider SDKs, globals, or types.

**Ephemeral state never hits the database.** Presence, avatar motion, and reaction bursts go over Realtime broadcast. Only schedules, favorites, and room config are written.

## Time

Client clocks are wrong. Sync code uses `serverNow()`, never `Date.now()`.

Drift correction thresholds live in config, not inline. Correcting a small drift is more audible than the drift itself — the current floor is 1500ms.

## Motion

Durations and easings live in `lib/motion.ts`. Components import tokens. No exceptions, including prototypes and one-offs.

GSAP handles timeline and sequenced choreography. Framer Motion handles component enter/exit and layout. Don't mix them on the same element.

Repeated elements need randomized per-instance offsets. Synchronized identical motion reads as broken, not alive.

## SoundCloud

Free public surfaces only: the embed widget (`w.soundcloud.com/player/api.js`) and the oEmbed endpoint. API app registration requires a paid Artist Pro subscription, which we don't have.

- oEmbed gives title, artist, artwork. It does not give duration.
- Durations are harvested by a seed script and frozen into the schedule snapshot. Never fetched at runtime.
- Not every track permits off-platform embedding. Seed-time validation catches this; runtime handles it as a state, not a crash.
- Autoplay requires a user gesture. The room has an explicit "tune in" entry point.

## Conventions

- Commits: `<type>: <description>`, small and single-concern
- One branch per unit of work, PR into `main`
- Migrations ship with a matching down migration, written at the same time. Never edit an applied migration.
- `NEXT_PUBLIC_*` is client-safe. The service role key is local-only, used by seed scripts, never in app code or Vercel client env.
- Sync changes get a multi-tab drift test on a Vercel preview before merge. Localhost across tabs hides real network conditions.

## Never

- Add a `client_id` or any authenticated SoundCloud API call
- Proxy, cache, download, or re-host audio
- Mutate an existing schedule row
- Call `Date.now()` in sync logic
- Write a row on every reaction or presence tick
- Hardcode a duration or easing in a component
- Import provider SDKs outside `lib/player/`
- Add a cron job, scheduled function, or always-on process

## When uncertain

Raise it rather than deciding silently. Anything touching the scheduler, the clock, or schedule immutability gets a proposal before implementation.
