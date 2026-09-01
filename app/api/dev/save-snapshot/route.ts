/**
 * Writes a verified snapshot to seed.json.
 *
 * Purely ergonomic. The harvester produced the same JSON before; it just had
 * to be selected out of a textarea and pasted into a file by hand, which is
 * the kind of step that makes a chore not get done.
 *
 * Development only, and a 404 otherwise. This writes to the filesystem, which
 * a deployed app has no business doing, and the check is on NODE_ENV rather
 * than on anything a caller can influence.
 *
 * It holds no credentials and touches no database. The privileged half of
 * seeding is still `scripts/seed.mjs` with the service role key, on a local
 * machine — that has not moved and must not.
 *
 * The destination is fixed. Nothing about the path comes from the request,
 * because a route that writes where it is told is a route that will
 * eventually overwrite something it should not.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DESTINATION = 'seed.json';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * Enough of a shape check to catch a mistake, not a substitute for the real
 * gate. `scripts/seed.mjs` refuses a snapshot without `verifiedAt`, and that
 * refusal is what actually protects the room.
 */
function isSnapshot(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const { setUrl, verifiedAt, tracks } = value as Record<string, unknown>;
  if (typeof setUrl !== 'string' || setUrl.length === 0) return false;
  if (typeof verifiedAt !== 'string' || verifiedAt.length === 0) return false;
  return Array.isArray(tracks) && tracks.length > 0;
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV !== 'development') return json({ error: 'not found' }, 404);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'that was not JSON' }, 400);
  }

  if (!isSnapshot(body)) {
    return json({ error: 'that is not a verified snapshot' }, 400);
  }

  const destination = join(process.cwd(), DESTINATION);
  try {
    await writeFile(destination, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  } catch (cause) {
    return json({ error: cause instanceof Error ? cause.message : String(cause) }, 500);
  }

  const { tracks } = body as { tracks: unknown[] };
  return json({ saved: DESTINATION, tracks: tracks.length }, 200);
}
