import Link from 'next/link';

export default function Home() {
  return (
    <main>
      <h1>clip.fm</h1>
      <p>Phase 0. Nothing to listen to yet.</p>
      <Link href="/debug/player">Player harness (step 2)</Link>
    </main>
  );
}
