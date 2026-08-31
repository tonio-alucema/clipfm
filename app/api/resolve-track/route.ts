/**
 * Turns a SoundCloud share link into the track it points at.
 *
 * `on.soundcloud.com/<token>` carries no track in it — only SoundCloud knows
 * what the token means, and finding out costs a redirect the browser is not
 * permitted to follow across origins. So the hop happens here.
 *
 * Deliberately narrow. This endpoint makes an outbound request on behalf of
 * whoever calls it, which is exactly the shape of a server-side request
 * forgery if it will fetch anything it is handed. It will not: the input must
 * already parse as a SoundCloud short link, only one redirect is read rather
 * than followed, and the destination must itself be a SoundCloud track URL
 * before it is returned.
 */

import { parseSoundCloudShortLink, parseSoundCloudTrackUrl } from '@/lib/suggestions/suggestions';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function GET(request: Request): Promise<Response> {
  const shortLink = parseSoundCloudShortLink(
    new URL(request.url).searchParams.get('url') ?? '',
  );
  if (shortLink === null) return json({ error: 'not a soundcloud share link' }, 400);

  let location: string | null;
  try {
    // manual, not follow: we want the one hop SoundCloud offers, not a chain
    // to wherever it might eventually lead.
    const response = await fetch(shortLink, { redirect: 'manual' });
    location = response.headers.get('location');
  } catch {
    return json({ error: 'could not reach soundcloud' }, 502);
  }

  if (location === null) return json({ error: 'that link does not point anywhere' }, 404);

  const trackUrl = parseSoundCloudTrackUrl(location);
  if (trackUrl === null) return json({ error: 'that link is not a track' }, 422);

  return json({ url: trackUrl }, 200);
}
