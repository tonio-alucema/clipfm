/**
 * Browser Supabase client.
 *
 * Anon key only. The service role key never appears in app code — it belongs
 * to the local seed script and nowhere else.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Referenced statically, because Next inlines NEXT_PUBLIC_* at build time and
// cannot see through a dynamic lookup.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** False until the project is wired up, so callers can fall back to fixtures. */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  return client;
}
