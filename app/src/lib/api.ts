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

// ---------------------------------------------------------------------
// Public profile
// ---------------------------------------------------------------------
export type PublicProfile = {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  banner_url: string | null
  bio: string | null
  location: string | null
  github_username: string | null
  clan: ClanKey | null
  mastery: MasteryKey | null
  xp: number
  available_to_collab: boolean
  is_verified: boolean
  created_at: string
}

export type ProfileBadge = { slug: string; name: string; description: string | null; tier: 'common' | 'rare' | 'legendary' }
export type ProfileProject = {
  id: string
  github_owner: string
  github_repo: string
  title: string
  summary: string | null
  language: string | null
  github_stars: number
  build_status: BuildStatus | null
}

export type ProfileData = {
  profile: PublicProfile
  xpPerLevel: number
  badges: ProfileBadge[]
  projects: ProfileProject[]
  /** Only known for your own profile (attempts are private). */
  questsSolved: number | null
}

/** Everything the profile page shows. Returns null when no member has this username. */
export async function loadProfile(username: string, viewerId: string): Promise<ProfileData | null> {
  const found = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, banner_url, bio, location, github_username, clan, mastery, xp, available_to_collab, is_verified, created_at')
    .eq('username', username)
    .maybeSingle()
  if (found.error) throw new Error(found.error.message)
  if (!found.data) return null
  const profile = found.data as PublicProfile
  const mine = profile.id === viewerId

  const [config, badges, projects, quests] = await Promise.all([
    supabase.from('game_config').select('value').eq('key', 'xp_per_level').maybeSingle(),
    supabase.from('user_badges').select('unlocked_at, badges(slug, name, description, tier)').eq('user_id', profile.id).not('unlocked_at', 'is', null),
    supabase.from('projects').select('id, github_owner, github_repo, title, summary, language, github_stars, build_status')
      .eq('owner_id', profile.id).eq('is_public', true).not('verified_at', 'is', null).order('github_stars', { ascending: false }),
    mine
      ? supabase.from('quest_attempts').select('id', { count: 'exact', head: true }).eq('user_id', profile.id).eq('status', 'solved')
      : Promise.resolve({ count: null, error: null }),
  ])
  for (const r of [config, badges, projects, quests]) if (r.error) throw new Error(r.error.message)

  const per = Number(config.data?.value ?? 10000) || 10000
  type BadgeRow = { badges: ProfileBadge | ProfileBadge[] | null }
  const badgeList = ((badges.data ?? []) as unknown as BadgeRow[])
    .map((r) => (Array.isArray(r.badges) ? r.badges[0] : r.badges))
    .filter((b): b is ProfileBadge => !!b)
  return {
    profile,
    xpPerLevel: per,
    badges: badgeList,
    projects: (projects.data ?? []) as ProfileProject[],
    questsSolved: mine ? (quests.count ?? 0) : null,
  }
}

// ---------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------
export type JobSort = 'recent' | 'pay'
export type JobFilters = { query: string; place: string; kind: '' | 'job' | 'freelance'; contract: string; remote: string; sort: JobSort }

export type JobOffer = {
  id: string
  title: string
  kind: 'job' | 'freelance'
  employment_type: string | null
  location: string | null
  remote: 'onsite' | 'hybrid' | 'remote'
  pay_min_fcfa: number | null
  pay_max_fcfa: number | null
  pay_unit: string | null
  pay_negotiable: boolean
  tags: string[]
  closes_on: string | null
  published_at: string
  employer_id: string
  employer_name: string
  employer_kind: string
  employer_logo_url: string | null
}

export const searchJobs = (f: JobFilters) =>
  rpc<JobOffer[]>('search_job_offers', {
    p_query: f.query.trim() || null,
    p_kind: f.kind || null,
    p_employment_type: f.contract || null,
    p_remote: f.remote || null,
    p_location: f.place.trim() || null,
    p_tag: null,
    p_min_pay: null,
    p_pay_unit: null,
    p_sort: f.sort,
    p_limit: 50,
    p_offset: 0,
  })

export type SavedOffer = {
  offer_id: string
  title: string
  kind: string
  location: string | null
  remote: string
  employer_name: string
  closes_on: string | null
  is_listed: boolean
  saved_at: string
}
export const listSavedOffers = () => rpc<SavedOffer[]>('list_saved_offers', { p_limit: 50, p_offset: 0 })
export const saveOffer = (id: string) => rpc<void>('save_offer', { p_offer: id })
export const unsaveOffer = (id: string) => rpc<void>('unsave_offer', { p_offer: id })

export type MyApplication = {
  id: string
  offer_id: string
  offer_title: string
  employer_name: string
  status: 'submitted' | 'seen' | 'shortlisted' | 'declined' | 'withdrawn'
  applied_at: string
  updated_at: string
  offer_open: boolean
  has_cv: boolean
}
export const listMyApplications = () => rpc<MyApplication[]>('list_my_applications')

// ---------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------
export type QuestSummary = {
  id: string
  slug: string
  title: string
  summary: string | null
  clan: ClanKey
  mastery: MasteryKey
  language: 'python' | 'javascript' | null
  topic: string | null
  est_minutes: number
  xp_reward: number
  kopek_reward: number
  daily_on: string | null
}

export type QuestFilters = { clan: ClanKey | ''; mastery: MasteryKey | ''; language: 'python' | 'javascript' | ''; query: string }

/** Published quests, newest first. The database only ever shows published ones. */
export async function listQuests(f: QuestFilters): Promise<QuestSummary[]> {
  let q = supabase
    .from('quests')
    .select('id, slug, title, summary, clan, mastery, language, topic, est_minutes, xp_reward, kopek_reward, daily_on')
    .order('created_at', { ascending: false })
    .limit(100)
  if (f.clan) q = q.eq('clan', f.clan)
  if (f.mastery) q = q.eq('mastery', f.mastery)
  if (f.language) q = q.eq('language', f.language)
  const text = f.query.trim().replace(/[%,()]/g, ' ')
  if (text) q = q.or(`title.ilike.%${text}%,topic.ilike.%${text}%`)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as QuestSummary[]
}

export type MyQuestProgress = { quest_id: string; status: 'in_progress' | 'solved'; tests_passed: number; tests_total: number }

/** The signed-in member's own attempts (the database only returns their own). */
export async function listMyQuestProgress(userId: string): Promise<MyQuestProgress[]> {
  const { data, error } = await supabase
    .from('quest_attempts')
    .select('quest_id, status, tests_passed, tests_total')
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
  return (data ?? []) as MyQuestProgress[]
}
