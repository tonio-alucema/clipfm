import { redirect } from 'next/navigation';
import { DEFAULT_ROOM_SLUG } from '@/lib/rooms';

/**
 * The front door.
 *
 * There is one room, so arriving at the site should put you in it. A landing
 * page explaining that a room exists, in front of the only room, would be a
 * page asking you to click "enter".
 */
export default function Home() {
  redirect(`/room/${DEFAULT_ROOM_SLUG}`);
}
