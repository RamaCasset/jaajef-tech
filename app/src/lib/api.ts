import { supabase } from './supabase'
import type { ClanKey, MasteryKey } from '../i18n/fr'

/** Calls one database action and returns its result, or throws with the database's message. */
export async function rpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data as T
}

export type Profile = {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  location: string | null
  clan: ClanKey | null
  mastery: MasteryKey | null
  xp: number
  onboarding_step: number
}

export type MemberState = { profile: Profile; kopeks: number }

/** The signed-in member's profile and wallet. */
export async function loadMember(userId: string): Promise<MemberState> {
  const [profile, wallet] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, location, clan, mastery, xp, onboarding_step')
      .eq('id', userId)
      .single(),
    supabase.from('wallets').select('kopeks').eq('user_id', userId).single(),
  ])
  if (profile.error) throw new Error(profile.error.message)
  return { profile: profile.data as Profile, kopeks: Number(wallet.data?.kopeks ?? 0) }
}

export const setCharacter = (clan: ClanKey, mastery: MasteryKey) =>
  rpc<void>('set_character', { p_clan: clan, p_mastery: mastery })

export const setOnboardingStep = (step: number) => rpc<void>('set_onboarding_step', { p_step: step })
