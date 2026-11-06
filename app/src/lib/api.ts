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

// ---------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------
export type SortKey = 'recent' | 'stars' | 'trending' | 'name'

export type ProjectRow = {
  project_id: string
  title: string
  summary: string | null
  github_owner: string
  github_repo: string
  language: string | null
  tags: string[]
  github_stars: number
  star_count: number
  comment_count: number
  collaborator_count: number
  is_featured: boolean
  verified_at: string
  owner_id: string
  owner_username: string
  owner_display_name: string
  owner_avatar_url: string | null
  owner_clan: ClanKey | null
}

export type SearchFilters = { query: string; language: string; clan: ClanKey | ''; sort: SortKey }

export const searchProjects = (f: SearchFilters, opts: { featuredOnly?: boolean; limit?: number; offset?: number } = {}) =>
  rpc<ProjectRow[]>('search_projects', {
    p_query: f.query.trim() || null,
    p_language: f.language || null,
    p_tag: null,
    p_clan: f.clan || null,
    p_sort: f.sort,
    p_featured_only: opts.featuredOnly ?? false,
    p_limit: opts.limit ?? 20,
    p_offset: opts.offset ?? 0,
  })

export type TrendingCreator = {
  user_id: string
  username: string
  display_name: string
  avatar_url: string | null
  clan: ClanKey | null
  contributions: number
}
export const trendingCreators = (days = 7, limit = 5) => rpc<TrendingCreator[]>('trending_creators', { p_days: days, p_limit: limit })

export type LanguageCount = { language: string; project_count: number }
export const projectLanguages = () => rpc<LanguageCount[]>('project_languages')

export type GoodFirstIssue = {
  issue_id: number
  project_id: string
  github_owner: string
  github_repo: string
  project_title: string
  language: string | null
  issue_number: number
  title: string
  url: string
  comments: number
  created_on: string
  owner_username: string
  owner_clan: ClanKey | null
}
export const listGoodFirstIssues = (limit = 20) =>
  rpc<GoodFirstIssue[]>('list_good_first_issues', { p_language: null, p_clan: null, p_limit: limit, p_offset: 0 })

export type BuildStatus = 'passing' | 'failing' | 'running' | 'none'

/** Build status of several projects at once (the search result does not carry it). */
export async function buildStatuses(ids: string[]): Promise<Record<string, BuildStatus | null>> {
  if (ids.length === 0) return {}
  const { data, error } = await supabase.from('projects').select('id, build_status').in('id', ids)
  if (error) throw new Error(error.message)
  const out: Record<string, BuildStatus | null> = {}
  for (const row of data ?? []) out[row.id as string] = (row.build_status as BuildStatus | null) ?? null
  return out
}

// ---------------------------------------------------------------------
// Souk
// ---------------------------------------------------------------------
export type SoukKind = 'theme' | 'avatar_frame' | 'status_badge'
export type SoukSort = 'new' | 'rating' | 'price_asc' | 'price_desc'

export type SoukItem = {
  id: string
  slug: string
  kind: SoukKind
  name: string
  description: string | null
  price_kopeks: number
  data: Record<string, unknown>
  avg_rating: number | null
  rating_count: number
  owned: boolean
  my_rating: number | null
  created_at: string
}

export const soukShop = (kind: SoukKind | null, sort: SoukSort) =>
  rpc<SoukItem[]>('souk_shop', { p_kind: kind, p_sort: sort, p_limit: 50, p_offset: 0 })

export const buyItem = (id: string) => rpc<void>('buy_item', { p_item: id })
export const equipItem = (id: string) => rpc<void>('equip_item', { p_item: id })
export const unequipItem = (kind: SoukKind) => rpc<void>('unequip_item', { p_kind: kind })

/** Ids of the items the member currently wears. */
export async function myEquippedIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from('equipped_items').select('item_id').eq('user_id', userId)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => r.item_id as string)
}
