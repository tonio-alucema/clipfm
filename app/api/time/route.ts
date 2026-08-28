/**
 * The authoritative clock.
 *
 * This is the one place `Date.now()` is correct to call: it is the server's
 * own clock, which is the thing every client is trying to agree with. Client
 * sync code uses `serverNow()` and never reads its own clock.
 *
 * `force-dynamic` is load-bearing. Without it the App Router would happily
 * prerender this at build time and serve the build timestamp forever.
 */

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return new Response(JSON.stringify({ now: Date.now() }), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  });
}
