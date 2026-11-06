import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** True when the two public settings are present. */
export const isConfigured = Boolean(url && key)

// Only the public (anon) key is ever used here. Row-level security in the database does the protecting.
export const supabase: SupabaseClient = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true },
})
