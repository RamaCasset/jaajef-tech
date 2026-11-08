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
  github_username: string | null
}

export type MemberState = { profile: Profile; kopeks: number }

/** The signed-in member's profile and wallet. */
export async function loadMember(userId: string): Promise<MemberState> {
  const [profile, wallet] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url, location, clan, mastery, xp, onboarding_step, github_username')
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
  demo_url: string | null
  cover_path: string | null
  github_forks: number
  github_pushed_at: string | null
  owner_region: string | null
}

export const REGION_KEYS = [
  'dakar', 'thies', 'diourbel', 'fatick', 'kaolack', 'kaffrine', 'kedougou', 'kolda', 'louga', 'matam', 'saint_louis', 'sedhiou',
  'tambacounda', 'ziguinchor', 'afrique_ouest', 'afrique_autre', 'diaspora',
] as const
export type RegionKey = (typeof REGION_KEYS)[number]

export type SearchFilters = { query: string; language: string; clan: ClanKey | ''; sort: SortKey; region: RegionKey | '' }

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
    p_region: f.region || null,
  })

export type ProjectContributor = { project_id: string; user_id: string; username: string; display_name: string; avatar_url: string | null }
export const projectContributors = (ids: string[]) => (ids.length === 0 ? Promise.resolve([] as ProjectContributor[]) : rpc<ProjectContributor[]>('project_contributors', { p_projects: ids }))

export const projectCoverUrl = (path: string | null): string | null => (path ? supabase.storage.from('project-covers').getPublicUrl(path).data.publicUrl : null)

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
  headline?: string | null
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
  /** Stars on the member's projects plus likes on their posts. */
  appreciation: number
}

/** Everything the profile page shows. Returns null when no member has this username. */
export async function loadProfile(username: string, viewerId: string): Promise<ProfileData | null> {
  const found = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, banner_url, headline, bio, location, github_username, clan, mastery, xp, available_to_collab, is_verified, created_at')
    .eq('username', username)
    .maybeSingle()
  if (found.error) throw new Error(found.error.message)
  if (!found.data) return null
  const profile = found.data as PublicProfile
  const mine = profile.id === viewerId

  const [config, badges, projects, quests, appreciation] = await Promise.all([
    supabase.from('game_config').select('value').eq('key', 'xp_per_level').maybeSingle(),
    supabase.from('user_badges').select('unlocked_at, badges(slug, name, description, tier)').eq('user_id', profile.id).not('unlocked_at', 'is', null),
    supabase.from('projects').select('id, github_owner, github_repo, title, summary, language, github_stars, build_status')
      .eq('owner_id', profile.id).eq('is_public', true).not('verified_at', 'is', null).order('pinned_at', { ascending: false, nullsFirst: false }).order('github_stars', { ascending: false }),
    mine
      ? supabase.from('quest_attempts').select('id', { count: 'exact', head: true }).eq('user_id', profile.id).eq('status', 'solved')
      : Promise.resolve({ count: null, error: null }),
    supabase.rpc('received_appreciation', { p_user: profile.id }),
  ])
  for (const r of [config, badges, projects, quests, appreciation]) if (r.error) throw new Error(r.error.message)

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
    appreciation: Number(appreciation.data ?? 0),
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

// ---------------------------------------------------------------------
// One quest: reading it, starting it, hints, running code
// ---------------------------------------------------------------------
export type QuestDetail = QuestSummary & { statement_md: string | null; starter_code: string | null; min_seconds: number }

/** One published quest by its address name, or null when there is none. */
export async function getQuest(slug: string): Promise<QuestDetail | null> {
  const { data, error } = await supabase
    .from('quests')
    .select('id, slug, title, summary, clan, mastery, language, topic, est_minutes, xp_reward, kopek_reward, daily_on, statement_md, starter_code, min_seconds')
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as QuestDetail | null) ?? null
}

export type QuestAttempt = { status: 'in_progress' | 'solved'; code: string | null; tests_passed: number; tests_total: number; started_at: string }
/** Opens the member's attempt (creates it the first time, returns the saved one afterwards). */
export const startQuest = (questId: string) => rpc<QuestAttempt>('start_quest', { p_quest_id: questId })

export type Hint = { level: number; body: string }
export const getUnlockedHints = (questId: string) => rpc<Hint[]>('get_unlocked_hints', { p_quest_id: questId })

export type HintResult = { level?: number; body?: string; no_more_hints?: boolean; hints_used: number; hints_total: number }
export const revealHint = (questId: string) => rpc<HintResult>('use_hint', { p_quest_id: questId })

/** The explanation only opens after the quest is solved; before that the database returns nothing. */
export async function getExplanation(questId: string): Promise<string | null> {
  const { data, error } = await supabase.from('quest_explanations').select('explanation_md').eq('quest_id', questId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data?.explanation_md as string | undefined) ?? null
}

export const saveDraft = (questId: string, code: string, testsPassed: number) =>
  rpc<void>('save_attempt', { p_quest_id: questId, p_code: code, p_tests_passed: testsPassed })

export type TestOutcome = { name: string; passed: boolean; message?: string }
export type RunOutcome = {
  tests: TestOutcome[]
  tests_passed: number
  tests_total: number
  solved: boolean
  already_solved?: boolean
  reason?: 'tests_not_passed' | 'too_fast'
  min_seconds?: number
  xp?: number
  kopeks?: number
  streak_days?: number
  duration_ms?: number
  rewarded?: boolean
  daily_quest?: boolean
  bonus_xp?: number
  bonus_kopeks?: number
}

/** The grading service refused or failed. `code` is its short reason, such as 'runner_unavailable'. */
export class RunError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

/** Sends the code to be graded on the server. The expected answers never reach the browser. */
export async function runQuest(questId: string, code: string): Promise<RunOutcome> {
  const { data, error } = await supabase.functions.invoke('run-quest', { body: { quest_id: questId, code } })
  if (error) {
    let reason = 'unknown'
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      try { reason = String((await context.json())?.error ?? 'unknown') } catch { /* keep unknown */ }
    }
    throw new RunError(reason)
  }
  return data as RunOutcome
}

// ---------------------------------------------------------------------
// The Cité home page
// ---------------------------------------------------------------------
export type DailyQuest = {
  quest_id: string
  slug: string
  title: string
  summary: string | null
  clan: ClanKey
  mastery: MasteryKey
  topic: string | null
  language: 'python' | 'javascript' | null
  est_minutes: number
  xp_reward: number
  kopek_reward: number
  source: 'scheduled' | 'automatic'
  day: string
  seconds_left: number
  status: 'in_progress' | 'solved' | null
}

/** Today's quest, or null when no quest is published yet. */
export async function getDailyQuest(): Promise<DailyQuest | null> {
  const rows = await rpc<DailyQuest[] | null>('quest_of_the_day')
  return rows && rows.length > 0 ? rows[0] : null
}

export type StreakInfo = {
  current_streak: number
  longest_streak: number
  done_today: boolean
  at_risk: boolean
  chest_every: number
  chest_kopeks: number
  next_chest_in: number | null
  last_active_on: string | null
  freezes: number
  freeze_max: number
  protected_by_freeze: boolean
}

export async function getMyStreak(): Promise<StreakInfo | null> {
  const rows = await rpc<StreakInfo[] | null>('my_streak')
  return rows && rows.length > 0 ? rows[0] : null
}

/** XP needed per level (a game setting, 10 000 if it cannot be read). */
export async function getXpPerLevel(): Promise<number> {
  const { data, error } = await supabase.from('game_config').select('value').eq('key', 'xp_per_level').maybeSingle()
  if (error) throw new Error(error.message)
  return Number(data?.value ?? 10000) || 10000
}

/** The badges the member unlocked most recently. */
export async function getRecentBadges(userId: string, limit = 4): Promise<ProfileBadge[]> {
  const { data, error } = await supabase
    .from('user_badges')
    .select('unlocked_at, badges(slug, name, description, tier)')
    .eq('user_id', userId)
    .not('unlocked_at', 'is', null)
    .order('unlocked_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  type Row = { badges: ProfileBadge | ProfileBadge[] | null }
  return ((data ?? []) as unknown as Row[])
    .map((r) => (Array.isArray(r.badges) ? r.badges[0] : r.badges))
    .filter((b): b is ProfileBadge => !!b)
}

// Importing projects from GitHub
// ---------------------------------------------------------------------

/** Copies the GitHub name from the member's verified GitHub login onto their profile. */
export const linkGithubAccount = () => rpc<string>('link_github_account')

/** Sends the member to GitHub to connect their account, then back to the import page. */
export async function connectGithub(): Promise<void> {
  const { error } = await supabase.auth.linkIdentity({
    provider: 'github',
    options: { redirectTo: `${window.location.origin}/projets/ajouter` },
  })
  if (error) throw new Error(error.message)
}

export type GithubRepo = {
  name: string
  description: string | null
  fork: boolean
  archived: boolean
  stargazers_count: number
  language: string | null
  html_url: string
}

/** GitHub refused or failed. `code` is 'rate_limited', 'not_found' or 'failed'. */
export class GithubError extends Error {
  code: 'rate_limited' | 'not_found' | 'failed'
  constructor(code: 'rate_limited' | 'not_found' | 'failed') {
    super(code)
    this.code = code
  }
}

/** The member's PUBLIC repositories, straight from GitHub (no sign-in token needed, private ones are never visible). */
export async function listPublicRepos(githubName: string, fetchFn: typeof fetch = fetch): Promise<GithubRepo[]> {
  let response: Response
  try {
    response = await fetchFn(`https://api.github.com/users/${encodeURIComponent(githubName)}/repos?per_page=100&sort=updated`, {
      headers: { accept: 'application/vnd.github+json' },
    })
  } catch {
    throw new GithubError('failed')
  }
  if (response.status === 403 || response.status === 429) throw new GithubError('rate_limited')
  if (response.status === 404) throw new GithubError('not_found')
  if (!response.ok) throw new GithubError('failed')
  const list = (await response.json()) as GithubRepo[]
  return list.map((r) => ({
    name: r.name, description: r.description, fork: r.fork, archived: r.archived,
    stargazers_count: r.stargazers_count, language: r.language, html_url: r.html_url,
  }))
}

export type MyProject = { id: string; github_owner: string; github_repo: string; verified_at: string | null; repo_private: boolean }

/** The member's own listed projects, including the ones still waiting to be confirmed. */
export async function listMyProjects(userId: string): Promise<MyProject[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, github_owner, github_repo, verified_at, repo_private')
    .eq('owner_id', userId)
  if (error) throw new Error(error.message)
  return (data ?? []) as MyProject[]
}

export type MyRepo = {
  id: string
  github_owner: string
  github_repo: string
  title: string
  summary: string | null
  language: string | null
  github_stars: number
  star_count: number
  github_forks: number
  github_pushed_at: string | null
  updated_at: string
  is_public: boolean
  verified_at: string | null
  build_status: BuildStatus | null
  pinned_at: string | null
  repo_private: boolean
  repo_missing_at: string | null
  owner_id: string
  owner_username: string
}

const REPO_COLUMNS = 'id, github_owner, github_repo, title, summary, language, github_stars, github_forks, github_pushed_at, updated_at, is_public, verified_at, build_status, pinned_at, repo_private, repo_missing_at, owner_id, profiles:owner_id(username)'

/** The member's own projects (hidden and unconfirmed ones included) and the ones they collaborate on, with the stars given on the platform. */
export async function listMyRepos(userId: string): Promise<MyRepo[]> {
  const joined = await supabase.from('project_collaborators').select('project_id').eq('user_id', userId)
  if (joined.error) throw new Error(joined.error.message)
  const ids = (joined.data ?? []).map((r) => r.project_id as string)
  const base = supabase.from('projects').select(REPO_COLUMNS)
  const { data, error } = await (ids.length > 0 ? base.or(`owner_id.eq.${userId},id.in.(${ids.join(',')})`) : base.eq('owner_id', userId))
  if (error) throw new Error(error.message)
  type Row = Omit<MyRepo, 'star_count' | 'owner_username'> & { profiles: { username: string } | { username: string }[] | null }
  const rows = ((data ?? []) as unknown as Row[]).map(({ profiles, ...r }) => ({
    ...r, owner_username: (Array.isArray(profiles) ? profiles[0]?.username : profiles?.username) ?? '',
  }))
  if (rows.length === 0) return []
  const stats = await supabase.from('project_stats').select('project_id, star_count').in('project_id', rows.map((r) => r.id))
  if (stats.error) throw new Error(stats.error.message)
  const counts = new Map((stats.data ?? []).map((s) => [s.project_id as string, Number(s.star_count)]))
  return rows.map((r) => ({ ...r, star_count: counts.get(r.id) ?? 0 }))
}

/** Removes the project from the platform (never the GitHub repository), then deletes its cover file. */
export async function removeProject(projectId: string): Promise<void> {
  const cover = await rpc<string | null>('remove_project', { p_project: projectId })
  if (cover) await supabase.storage.from('project-covers').remove([cover])
}

export const setProjectPinned = (projectId: string, pinned: boolean) => rpc<void>('set_project_pinned', { p_project: projectId, p_pinned: pinned })
export const setProjectVisibility = (projectId: string, isPublic: boolean) => rpc<void>('update_project', { p_project: projectId, p_is_public: isPublic })

export type StarredRepo = Omit<MyRepo, 'pinned_at' | 'updated_at' | 'build_status' | 'star_count' | 'repo_private' | 'repo_missing_at' | 'owner_id'> & { owner_username: string }

/** The projects the member starred (only the ones anyone can see). */
export async function listMyStarred(userId: string): Promise<StarredRepo[]> {
  const { data, error } = await supabase
    .from('project_stars')
    .select('created_at, projects(id, github_owner, github_repo, title, summary, language, github_stars, github_forks, github_pushed_at, is_public, verified_at, profiles:owner_id(username))')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  type Row = { projects: (Omit<StarredRepo, 'owner_username'> & { profiles: { username: string } | { username: string }[] | null }) | null }
  return ((data ?? []) as unknown as Row[])
    .map((r) => r.projects)
    .filter((p): p is NonNullable<Row['projects']> => !!p && !!p.verified_at && p.is_public)
    .map(({ profiles, ...p }) => ({ ...p, owner_username: (Array.isArray(profiles) ? profiles[0]?.username : profiles?.username) ?? '' }))
}

export async function countMyStars(userId: string): Promise<number> {
  const { count, error } = await supabase.from('project_stars').select('project_id', { count: 'exact', head: true }).eq('user_id', userId)
  if (error) throw new Error(error.message)
  return count ?? 0
}

export type NextBadge = { slug: string; name: string; description: string | null; progress: number; threshold: number }

/** The automatic badge the member is closest to unlocking, or null when there is none in progress. */
export async function getNextBadge(userId: string): Promise<NextBadge | null> {
  const [mine, rules] = await Promise.all([
    supabase.from('user_badges').select('badge_slug, progress, badges(name, description)').eq('user_id', userId).is('unlocked_at', null),
    supabase.from('badge_rules').select('badge_slug, threshold').neq('metric', 'manual'),
  ])
  if (mine.error) throw new Error(mine.error.message)
  if (rules.error) throw new Error(rules.error.message)
  const goal = new Map((rules.data ?? []).map((r) => [r.badge_slug as string, Number(r.threshold)]))
  type Row = { badge_slug: string; progress: number; badges: { name: string; description: string | null } | { name: string; description: string | null }[] | null }
  let best: NextBadge | null = null
  for (const r of (mine.data ?? []) as unknown as Row[]) {
    const threshold = goal.get(r.badge_slug)
    const b = Array.isArray(r.badges) ? r.badges[0] : r.badges
    if (!threshold || !b) continue
    const candidate = { slug: r.badge_slug, name: b.name, description: b.description, progress: Number(r.progress), threshold }
    if (!best || candidate.progress / candidate.threshold > best.progress / best.threshold) best = candidate
  }
  return best
}

export const publishProject = (repoUrl: string, title: string, summary: string | null) =>
  rpc<string>('publish_project', { p_repo_url: repoUrl, p_title: title, p_summary: summary, p_tags: [] })

// ---- Blog ---------------------------------------------------------------------------------------------
export type BlogCard = {
  id: string
  slug: string
  title: string
  summary: string | null
  cover_url: string | null
  tags: string[]
  author_id: string
  author_username: string
  published_at: string
  like_count: number
  comment_count: number
  liked_by_me: boolean
}
export const listBlogPosts = (tag: string, limit = 20, offset = 0) =>
  rpc<BlogCard[]>('list_blog_posts', { p_tag: tag.trim() || null, p_author: null, p_limit: limit, p_offset: offset })
export const likeBlogPost = (id: string) => rpc<void>('like_blog_post', { p_post: id })
export const unlikeBlogPost = (id: string) => rpc<void>('unlike_blog_post', { p_post: id })

export type BlogPostFull = {
  id: string
  slug: string
  title: string
  summary: string | null
  body: string
  cover_url: string | null
  tags: string[]
  author_id: string
  author_username: string
  author_name: string
  published_at: string | null
  status: 'draft' | 'published'
  like_count: number
  comment_count: number
  liked_by_me: boolean
}
const POST_COLUMNS = 'id, slug, title, summary, body, cover_url, tags, author_id, published_at, status, profiles:author_id(username, display_name)'
type PostRow = Omit<BlogPostFull, 'author_username' | 'author_name' | 'like_count' | 'comment_count' | 'liked_by_me'> & { profiles: { username: string; display_name: string } | null }

async function fullPost(row: PostRow): Promise<BlogPostFull> {
  const [stats, liked] = await Promise.all([
    supabase.from('blog_stats').select('like_count, comment_count').eq('post_id', row.id).maybeSingle(),
    supabase.from('blog_likes').select('post_id').eq('post_id', row.id).limit(1),
  ])
  const { profiles, ...rest } = row
  return {
    ...rest,
    author_username: profiles?.username ?? '',
    author_name: profiles?.display_name ?? '',
    like_count: Number(stats.data?.like_count ?? 0),
    comment_count: Number(stats.data?.comment_count ?? 0),
    liked_by_me: (liked.data ?? []).length > 0,
  }
}
export async function getBlogPostBySlug(slug: string): Promise<BlogPostFull | null> {
  const { data, error } = await supabase.from('blog_posts').select(POST_COLUMNS).eq('slug', slug).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? fullPost(data as unknown as PostRow) : null
}
export async function getMyBlogPost(id: string): Promise<BlogPostFull | null> {
  const { data, error } = await supabase.from('blog_posts').select(POST_COLUMNS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? fullPost(data as unknown as PostRow) : null
}
export type MyBlogPost = { id: string; slug: string; title: string; status: 'draft' | 'published'; staff_hidden: boolean; updated_at: string }
export async function listMyBlogPosts(userId: string): Promise<MyBlogPost[]> {
  const { data, error } = await supabase
    .from('blog_posts')
    .select('id, slug, title, status, staff_hidden, updated_at')
    .eq('author_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as MyBlogPost[]
}

export type BlogComment = { id: number; author_id: string; body: string; created_at: string; author_username: string }
export async function listBlogComments(postId: string): Promise<BlogComment[]> {
  const { data, error } = await supabase
    .from('blog_comments')
    .select('id, author_id, body, created_at, profiles:author_id(username)')
    .eq('post_id', postId)
    .order('created_at')
    .limit(200)
  if (error) throw new Error(error.message)
  type Row = Omit<BlogComment, 'author_username'> & { profiles: { username: string } | null }
  return ((data ?? []) as unknown as Row[]).map(({ profiles, ...c }) => ({ ...c, author_username: profiles?.username ?? '' }))
}
export const postBlogComment = (postId: string, body: string) => rpc<number>('post_blog_comment', { p_post: postId, p_body: body })
export const deleteBlogComment = (id: number) => rpc<void>('delete_blog_comment', { p_comment: id })

export type BlogDraft = { title: string; summary: string; body: string; cover_url: string; tags: string[] }
export const createBlogPost = (d: BlogDraft, publish: boolean) =>
  rpc<string>('create_blog_post', { p_title: d.title, p_body: d.body, p_summary: d.summary.trim() || null, p_cover_url: d.cover_url.trim() || null, p_tags: d.tags, p_publish: publish })
export const updateBlogPost = (id: string, d: BlogDraft) =>
  rpc<void>('update_blog_post', { p_post: id, p_title: d.title, p_body: d.body, p_summary: d.summary.trim() || null, p_cover_url: d.cover_url.trim() || null, p_tags: d.tags })
export const publishBlogPost = (id: string) => rpc<void>('publish_blog_post', { p_post: id })
export const unpublishBlogPost = (id: string) => rpc<void>('unpublish_blog_post', { p_post: id })
export const deleteBlogPost = (id: string) => rpc<void>('delete_blog_post', { p_post: id })
// ---- Private messages ----------------------------------------------------------------------------------
export type Conversation = {
  conversation_id: string
  other_user_id: string
  other_username: string
  other_display_name: string
  other_avatar_url: string | null
  last_message_preview: string | null
  last_message_at: string | null
  unread_count: number
}
export const listMyConversations = () => rpc<Conversation[]>('list_my_conversations')
export const startConversation = (userId: string) => rpc<string>('start_conversation', { p_user: userId })

export type DirectMessage = {
  id: number
  sender_id: string
  body: string
  file_name: string | null
  created_at: string
  deleted_at: string | null
}
export async function listDirectMessages(conversationId: string, limit = 100): Promise<DirectMessage[]> {
  const { data, error } = await supabase
    .from('direct_messages')
    .select('id, sender_id, body, file_name, created_at, deleted_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return ((data ?? []) as DirectMessage[]).reverse()
}
export const sendDirectMessage = (conversationId: string, body: string) => rpc<number>('send_direct_message', { p_conversation: conversationId, p_body: body })
export const deleteDirectMessage = (id: number) => rpc<void>('delete_direct_message', { p_message: id })
export const markConversationRead = (conversationId: string) => rpc<void>('mark_conversation_read', { p_conversation: conversationId })
export const blockUser = (userId: string) => rpc<void>('block_user', { p_user: userId })
export const unblockUser = (userId: string) => rpc<void>('unblock_user', { p_user: userId })
export async function isBlockedByMe(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('blocks').select('blocked_id').eq('blocked_id', userId).limit(1)
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}
// ---- Communities and chat ------------------------------------------------------------------------------
export type Community = {
  id: string
  slug: string
  name: string
  description: string | null
  is_private: boolean
  is_listed: boolean
  owner_id: string
}
export type CommunityRole = 'owner' | 'moderator' | 'member'

const COMMUNITY_COLUMNS = 'id, slug, name, description, is_private, is_listed, owner_id'

/** Communities the member belongs to, with their role. */
export async function listMyCommunities(userId: string): Promise<(Community & { role: CommunityRole })[]> {
  const { data, error } = await supabase
    .from('community_members')
    .select(`role, communities(${COMMUNITY_COLUMNS})`)
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
  type Row = { role: CommunityRole; communities: Community | null }
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.communities)
    .map((r) => ({ ...(r.communities as Community), role: r.role }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Communities anyone can see: public ones, and private ones that chose to be listed. */
export async function listDiscoverCommunities(): Promise<Community[]> {
  const { data, error } = await supabase
    .from('communities')
    .select(COMMUNITY_COLUMNS)
    .or('is_private.eq.false,is_listed.eq.true')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return (data ?? []) as Community[]
}

export const communityMemberCount = (id: string) => rpc<number | null>('community_member_count', { p_community: id })
export const createCommunity = (slug: string, name: string, description: string, isPrivate: boolean, isListed: boolean) =>
  rpc<string>('create_community', { p_slug: slug, p_name: name, p_description: description.trim() || null, p_is_private: isPrivate, p_is_listed: isListed })
/** The chat room of a project: its slug when the signed-in member is in the team (the owner or a collaborator), otherwise null. */
export async function getProjectRoom(projectId: string): Promise<string | null> {
  const { data, error } = await supabase.from('communities').select('slug').eq('project_id', projectId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as { slug: string } | null)?.slug ?? null
}
export const openProjectRoom = (projectId: string) => rpc<string>('open_project_room', { p_project: projectId })
export const joinCommunity = (id: string) => rpc<void>('join_community', { p_community: id })
export const requestToJoin = (id: string, message: string) => rpc<string>('request_to_join', { p_community: id, p_message: message.trim() || null })
export const leaveCommunity = (id: string) => rpc<void>('leave_community', { p_community: id })

export async function getCommunityBySlug(slug: string): Promise<Community | null> {
  const { data, error } = await supabase.from('communities').select(COMMUNITY_COLUMNS).eq('slug', slug).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Community | null) ?? null
}

export type Channel = { id: string; slug: string; name: string; kind: 'chat' | 'announcement' | 'forum' }
export async function listChannels(communityId: string): Promise<Channel[]> {
  const { data, error } = await supabase.from('channels').select('id, slug, name, kind').eq('community_id', communityId).order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as Channel[]
}

export type ChatMessage = {
  id: number
  author_id: string
  body: string
  created_at: string
  edited_at: string | null
  deleted_at: string | null
  author_username: string
  author_name: string
}
export async function listChannelMessages(channelId: string, limit = 100): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, author_id, body, created_at, edited_at, deleted_at, profiles:author_id(username, display_name)')
    .eq('channel_id', channelId)
    .is('parent_id', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  type Row = Omit<ChatMessage, 'author_username' | 'author_name'> & { profiles: { username: string; display_name: string } | null }
  return ((data ?? []) as unknown as Row[])
    .map(({ profiles, ...m }) => ({ ...m, author_username: profiles?.username ?? '', author_name: profiles?.display_name ?? '' }))
    .reverse()
}
export const sendMessage = (channelId: string, body: string) => rpc<number>('send_message', { p_channel: channelId, p_body: body })
export const deleteMessage = (id: number) => rpc<void>('delete_message', { p_message: id })

export type CommunityMember = { user_id: string; role: CommunityRole; username: string; display_name: string }
export async function listCommunityMembers(communityId: string): Promise<CommunityMember[]> {
  const { data, error } = await supabase
    .from('community_members')
    .select('user_id, role, profiles:user_id(username, display_name)')
    .eq('community_id', communityId)
    .order('joined_at')
    .limit(200)
  if (error) throw new Error(error.message)
  type Row = { user_id: string; role: CommunityRole; profiles: { username: string; display_name: string } | null }
  return ((data ?? []) as unknown as Row[]).map((r) => ({ user_id: r.user_id, role: r.role, username: r.profiles?.username ?? '', display_name: r.profiles?.display_name ?? '' }))
}

export type JoinRequest = { id: string; user_id: string; message: string | null; username: string }
export async function listPendingJoinRequests(communityId: string): Promise<JoinRequest[]> {
  const { data, error } = await supabase
    .from('join_requests')
    .select('id, user_id, message, profiles:user_id(username)')
    .eq('community_id', communityId)
    .eq('status', 'pending')
    .order('created_at')
  if (error) throw new Error(error.message)
  type Row = { id: string; user_id: string; message: string | null; profiles: { username: string } | null }
  return ((data ?? []) as unknown as Row[]).map((r) => ({ id: r.id, user_id: r.user_id, message: r.message, username: r.profiles?.username ?? '' }))
}
export const decideJoinRequest = (id: string, approve: boolean) => rpc<void>('decide_join_request', { p_request: id, p_approve: approve })
export const removeCommunityMember = (communityId: string, userId: string) => rpc<void>('remove_member', { p_community: communityId, p_user: userId })
export const setMemberRole = (communityId: string, userId: string, role: 'moderator' | 'member') =>
  rpc<void>('set_member_role', { p_community: communityId, p_user: userId, p_role: role })
export const transferCommunity = (communityId: string, userId: string) => rpc<void>('transfer_community', { p_community: communityId, p_user: userId })
export const deleteCommunity = (communityId: string, confirmSlug: string) => rpc<void>('delete_community', { p_community: communityId, p_confirm_slug: confirmSlug })
// ---- One job offer, applying, and my application file -----------------------------------------------------
export type JobOfferDetail = JobOffer & { description: string }

export async function getJobOffer(id: string): Promise<JobOfferDetail | null> {
  const { data, error } = await supabase
    .from('job_offers')
    .select('id, title, kind, description, employment_type, location, remote, pay_min_fcfa, pay_max_fcfa, pay_unit, pay_negotiable, tags, closes_on, published_at, employer_id, employers(name, kind, logo_url)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const e = (data as unknown as { employers: { name: string; kind: string; logo_url: string | null } | null }).employers
  const { employers: _drop, ...rest } = data as Record<string, unknown>
  void _drop
  return { ...(rest as Omit<JobOfferDetail, 'employer_name' | 'employer_kind' | 'employer_logo_url'>), employer_name: e?.name ?? '', employer_kind: e?.kind ?? '', employer_logo_url: e?.logo_url ?? null }
}

export const applyToOffer = (offerId: string, message: string, includeCv: boolean) =>
  rpc<string>('apply_to_offer', { p_offer: offerId, p_message: message.trim() || null, p_include_cv: includeCv })
export const withdrawApplication = (id: string) => rpc<void>('withdraw_application', { p_application: id })

export type Availability = 'immediate' | 'within_month' | 'within_3_months' | 'not_looking'
export type ApplicationFile = {
  headline: string | null
  summary: string | null
  location: string | null
  experience_years: number | null
  availability: Availability | null
  work_kinds: ('job' | 'freelance')[]
  skills: string[]
  website: string | null
  linkedin_url: string | null
  cv_name: string | null
  portfolio_count: number
  completion: number
  missing: string[]
}
export async function myApplicationFile(): Promise<ApplicationFile> {
  const rows = await rpc<ApplicationFile[]>('my_application_file')
  return rows[0]
}
export const saveApplicationFile = (f: {
  headline: string; summary: string; location: string; experience_years: number | null; availability: Availability | null
  work_kinds: ('job' | 'freelance')[]; skills: string[]; website: string; linkedin_url: string
}) =>
  rpc<void>('save_application_file', {
    p_headline: f.headline, p_summary: f.summary, p_location: f.location, p_experience_years: f.experience_years,
    p_availability: f.availability, p_work_kinds: f.work_kinds, p_skills: f.skills, p_website: f.website, p_linkedin_url: f.linkedin_url,
  })
// ---- Notifications ---------------------------------------------------------------------------------------
export type NotificationKind =
  | 'project_starred' | 'project_comment' | 'project_confirmed' | 'project_hidden'
  | 'collab_request' | 'collab_accepted' | 'collab_declined'
  | 'collab_invite' | 'collab_invite_accepted' | 'collab_invite_declined'
  | 'proposal_opened' | 'proposal_merged' | 'proposal_declined'
  | 'join_request' | 'join_approved' | 'join_declined'
  | 'badge_unlocked' | 'warning' | 'suspension'

export type NotificationRow = {
  id: number
  kind: NotificationKind
  data: Record<string, unknown>
  created_at: string
  read_at: string | null
}

export async function listNotifications(limit = 50): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, kind, data, created_at, read_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as NotificationRow[]
}

export const unreadNotificationCount = () => rpc<number>('unread_notification_count')
export const markNotificationRead = (id: number) => rpc<void>('mark_notification_read', { p_id: id })
export const markAllNotificationsRead = () => rpc<number>('mark_all_notifications_read')
export const setNotificationMute = (kind: NotificationKind, muted: boolean) =>
  rpc<void>('set_notification_mute', { p_kind: kind, p_muted: muted })

export async function listMutedKinds(): Promise<NotificationKind[]> {
  const { data, error } = await supabase.from('notification_mutes').select('kind')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => r.kind as NotificationKind)
}
// ---- Account: delete and download my data ----------------------------------------------------------------
export type DeletionBlocker = { code: 'staff' | 'suspended' | 'community_owner' | 'employer_active'; count: number }
export type AccountDeletion = { requested_at: string | null; delete_on: string | null; blockers: DeletionBlocker[] }

export async function myAccountDeletion(): Promise<AccountDeletion> {
  const rows = await rpc<AccountDeletion[]>('my_account_deletion')
  return rows[0] ?? { requested_at: null, delete_on: null, blockers: [] }
}
export const requestAccountDeletion = () => rpc<string>('request_account_deletion')
export const cancelAccountDeletion = () => rpc<void>('cancel_account_deletion')
export const exportMyData = () => rpc<Record<string, unknown>>('export_my_data')

// ---- Search everything ---------------------------------------------------------------------------------
export type SearchKind = 'project' | 'member' | 'community' | 'quest'
export type SearchHit = { kind: SearchKind; pos: number; id: string; slug: string; title: string; subtitle: string | null; image_url: string | null }
export const searchEverything = (query: string) => rpc<SearchHit[]>('search_everything', { p_query: query.trim(), p_limit_each: 8 })
// ---- Edit my profile ---------------------------------------------------------------------------------
export type ProfileEdit = { display_name: string; headline: string; bio: string; location: string; region: RegionKey | ''; available_to_collab: boolean }
export type MyProfileFields = ProfileEdit & { avatar_url: string | null; banner_url: string | null }
export async function updateMyProfile(userId: string, e: ProfileEdit): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({
      display_name: e.display_name.trim(),
      headline: e.headline.trim() || null,
      bio: e.bio.trim() || null,
      location: e.location.trim() || null,
      region: e.region || null,
      available_to_collab: e.available_to_collab,
    })
    .eq('id', userId)
  if (error) throw new Error(error.message)
}
export async function loadMyProfileFields(userId: string): Promise<MyProfileFields> {
  const { data, error } = await supabase.from('profiles').select('display_name, headline, bio, location, region, available_to_collab, avatar_url, banner_url').eq('id', userId).single()
  if (error) throw new Error(error.message)
  return { display_name: data.display_name, headline: data.headline ?? '', bio: data.bio ?? '', location: data.location ?? '', region: (data.region ?? '') as RegionKey | '', available_to_collab: data.available_to_collab, avatar_url: data.avatar_url, banner_url: data.banner_url }
}

// ---- Profile pictures ------------------------------------------------------------------------------------
export type ProfileImageKind = 'avatar' | 'cover'
export const PROFILE_IMAGE_MAX_BYTES = 2 * 1024 * 1024
const PROFILE_IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const PROFILE_BUCKET = 'profile-images'

/** The file name inside the bucket, when this address points at one of our pictures. */
function profileImagePath(url: string | null): string | null {
  const marker = `/${PROFILE_BUCKET}/`
  const i = url ? url.indexOf(marker) : -1
  return url && i >= 0 ? decodeURIComponent(url.slice(i + marker.length)) : null
}

/** Uploads a picture, makes it the member's avatar or cover, and deletes the previous file. Returns the new address. */
export async function uploadProfileImage(userId: string, kind: ProfileImageKind, file: File, oldUrl: string | null): Promise<string> {
  const ext = PROFILE_IMAGE_TYPES[file.type]
  if (!ext) throw new Error('image-type')
  if (file.size > PROFILE_IMAGE_MAX_BYTES) throw new Error('image-size')
  const path = `${userId}/${kind}-${crypto.randomUUID()}.${ext}`
  const up = await supabase.storage.from(PROFILE_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (up.error) throw new Error(up.error.message)
  const url = supabase.storage.from(PROFILE_BUCKET).getPublicUrl(path).data.publicUrl
  const { error } = await supabase.from('profiles').update({ [kind === 'avatar' ? 'avatar_url' : 'banner_url']: url }).eq('id', userId)
  if (error) {
    await supabase.storage.from(PROFILE_BUCKET).remove([path])
    throw new Error(error.message)
  }
  const old = profileImagePath(oldUrl)
  if (old) await supabase.storage.from(PROFILE_BUCKET).remove([old])
  return url
}

export async function removeProfileImage(userId: string, kind: ProfileImageKind, oldUrl: string | null): Promise<void> {
  const { error } = await supabase.from('profiles').update({ [kind === 'avatar' ? 'avatar_url' : 'banner_url']: null }).eq('id', userId)
  if (error) throw new Error(error.message)
  const old = profileImagePath(oldUrl)
  if (old) await supabase.storage.from(PROFILE_BUCKET).remove([old])
}
// ---- Project demo link and cover ---------------------------------------------------------------------------
const COVER_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/** Saves the demo link and the cover of a project. Pass the current cover path to keep it, null to remove it. */
export async function saveProjectShowcase(projectId: string, demoUrl: string, coverPath: string | null): Promise<void> {
  const old = await rpc<string | null>('set_project_showcase', { p_project: projectId, p_demo_url: demoUrl.trim() || null, p_cover_path: coverPath })
  if (old) await supabase.storage.from('project-covers').remove([old])
}

/** Uploads a new cover, then makes it the project's cover (the previous file is deleted). Returns the new path. */
export async function uploadProjectCover(userId: string, projectId: string, file: File, demoUrl: string): Promise<string> {
  const ext = COVER_TYPES[file.type]
  if (!ext) throw new Error('image-type')
  if (file.size > PROFILE_IMAGE_MAX_BYTES) throw new Error('image-size')
  const path = `${userId}/${crypto.randomUUID()}.${ext}`
  const up = await supabase.storage.from('project-covers').upload(path, file, { contentType: file.type, upsert: false })
  if (up.error) throw new Error(up.error.message)
  try {
    await saveProjectShowcase(projectId, demoUrl, path)
  } catch (err) {
    await supabase.storage.from('project-covers').remove([path])
    throw err
  }
  return path
}

// ---- Selling in the Souk -----------------------------------------------------------------------------
export type SoukSubmission = {
  id: string
  kind: SoukKind
  name: string
  description: string | null
  data: Record<string, unknown>
  proposed_price: number
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  review_note: string | null
  created_at: string
}
export const listMySoukSubmissions = () => rpc<SoukSubmission[]>('list_my_souk_submissions')
export const submitSoukItem = (kind: SoukKind, name: string, description: string, data: Record<string, unknown>, price: number) =>
  rpc<string>('submit_souk_item', { p_kind: kind, p_name: name.trim(), p_description: description.trim() || null, p_data: data, p_price: price })
export const withdrawSoukSubmission = (id: string) => rpc<void>('withdraw_souk_submission', { p_submission: id })

export type CreatorSummary = { items_on_sale: number; sales_count: number; kopeks_earned: number; share_percent: number }
export async function myCreatorSummary(): Promise<CreatorSummary> {
  const rows = await rpc<CreatorSummary[]>('my_creator_summary')
  const r = rows[0]
  return { items_on_sale: Number(r.items_on_sale), sales_count: Number(r.sales_count), kopeks_earned: Number(r.kopeks_earned), share_percent: Number(r.share_percent) }
}
export type MySale = { id: number; item_name: string; price: number; share_percent: number; amount: number; sold_at: string }
export const listMySales = () => rpc<MySale[]>('list_my_sales', { p_limit: 20, p_offset: 0 })
// ---- One project: stars, comments, collaboration -------------------------------------------------------
export type ProjectFull = {
  id: string
  title: string
  summary: string | null
  github_owner: string
  github_repo: string
  language: string | null
  tags: string[]
  github_stars: number
  owner_id: string
  owner_username: string
  owner_display_name: string
  star_count: number
  starred_by_me: boolean
  demo_url: string | null
  cover_path: string | null
  is_public: boolean
  repo_private: boolean
}
export async function getProjectFull(id: string): Promise<ProjectFull | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, title, summary, github_owner, github_repo, language, tags, github_stars, demo_url, cover_path, is_public, repo_private, owner_id, profiles:owner_id(username, display_name)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const [stats, mine] = await Promise.all([
    supabase.from('project_stats').select('star_count').eq('project_id', id).maybeSingle(),
    supabase.from('project_stars').select('project_id').eq('project_id', id).limit(1),
  ])
  const { profiles, ...rest } = data as unknown as Omit<ProjectFull, 'owner_username' | 'owner_display_name' | 'star_count' | 'starred_by_me'> & { profiles: { username: string; display_name: string } | null }
  return {
    ...rest,
    owner_username: profiles?.username ?? '',
    owner_display_name: profiles?.display_name ?? '',
    star_count: Number(stats.data?.star_count ?? 0),
    starred_by_me: (mine.data ?? []).length > 0,
  }
}
export const starProject = (id: string) => rpc<void>('star_project', { p_project: id })
export const unstarProject = (id: string) => rpc<void>('unstar_project', { p_project: id })

export type ProjectComment = { id: number; author_id: string; body: string; created_at: string; author_username: string }
export async function listProjectComments(projectId: string): Promise<ProjectComment[]> {
  const { data, error } = await supabase
    .from('project_comments')
    .select('id, author_id, body, created_at, profiles:author_id(username)')
    .eq('project_id', projectId)
    .order('created_at')
    .limit(200)
  if (error) throw new Error(error.message)
  type Row = Omit<ProjectComment, 'author_username'> & { profiles: { username: string } | null }
  return ((data ?? []) as unknown as Row[]).map(({ profiles, ...c }) => ({ ...c, author_username: profiles?.username ?? '' }))
}
export const postProjectComment = (projectId: string, body: string) => rpc<number>('post_project_comment', { p_project: projectId, p_body: body })
export const deleteProjectComment = (id: number) => rpc<void>('delete_project_comment', { p_comment: id })

export type Collaborator = { user_id: string; username: string; display_name: string }
export async function listCollaborators(projectId: string): Promise<Collaborator[]> {
  const { data, error } = await supabase
    .from('project_collaborators')
    .select('user_id, profiles:user_id(username, display_name)')
    .eq('project_id', projectId)
  if (error) throw new Error(error.message)
  type Row = { user_id: string; profiles: { username: string; display_name: string } | null }
  return ((data ?? []) as unknown as Row[]).map((r) => ({ user_id: r.user_id, username: r.profiles?.username ?? '', display_name: r.profiles?.display_name ?? '' }))
}
export type CollabRequest = { id: string; requester_id: string; message: string; status: 'pending' | 'accepted' | 'declined' | 'withdrawn'; requester_username: string }
/** Requests I can see on this project: all of them for the owner, only mine for anyone else. */
export async function listCollabRequests(projectId: string): Promise<CollabRequest[]> {
  const { data, error } = await supabase
    .from('collab_requests')
    .select('id, requester_id, message, status, profiles:requester_id(username)')
    .eq('project_id', projectId)
    .in('status', ['pending'])
    .order('created_at')
  if (error) throw new Error(error.message)
  type Row = Omit<CollabRequest, 'requester_username'> & { profiles: { username: string } | null }
  return ((data ?? []) as unknown as Row[]).map(({ profiles, ...r }) => ({ ...r, requester_username: profiles?.username ?? '' }))
}
export const requestCollaboration = (projectId: string, message: string) => rpc<string>('request_collaboration', { p_project: projectId, p_message: message.trim() })
export const withdrawCollabRequest = (id: string) => rpc<void>('withdraw_collab_request', { p_request: id })
export const decideCollabRequest = (id: string, accept: boolean) => rpc<void>('decide_collab_request', { p_request: id, p_accept: accept })
/** The owner invites a member by username. The member sees nothing until they accept. */
export const inviteCollaborator = (projectId: string, username: string) => rpc<string | null>('invite_collaborator', { p_project: projectId, p_username: username.trim().replace(/^@/, '') })
export const cancelCollabInvite = (inviteId: string) => rpc<void>('cancel_collab_invite', { p_invite: inviteId })
export const answerCollabInvite = (inviteId: string, accept: boolean) => rpc<void>('answer_collab_invite', { p_invite: inviteId, p_accept: accept })

export type ProjectInvite = { id: string; invitee_username: string; expires_at: string }
/** The invitations still waiting on a project (the owner sees them; expired ones are not listed). */
export async function listProjectInvites(projectId: string): Promise<ProjectInvite[]> {
  const rows = await rpc<{ invite_id: string; invitee_username: string; expires_at: string }[]>('project_invites', { p_project: projectId })
  return (rows ?? []).map((r) => ({ id: r.invite_id, invitee_username: r.invitee_username, expires_at: r.expires_at }))
}

export type MyInvite = { invite_id: string; project_title: string; owner_username: string; created_at: string; expires_at: string }
/** The invitations to collaborate that wait for the member's answer. */
export const listMyInvites = () => rpc<MyInvite[]>('my_collab_invites')
export const removeCollaborator = (projectId: string, userId: string) => rpc<void>('remove_collaborator', { p_project: projectId, p_user: userId })
// ---- Staff area ---------------------------------------------------------------------------------------
export type StaffAccess = { role: 'admin' | 'moderator' | null; shopManager: boolean; questWriter: boolean; shopOwner: boolean }
export async function getMyStaffAccess(userId: string): Promise<StaffAccess> {
  const [roleRes, access] = await Promise.all([
    supabase.from('staff_roles').select('role').eq('user_id', userId).maybeSingle(),
    rpc<{ quest_writer: boolean; shop_manager: boolean; shop_owner: boolean }[]>('my_back_office_access'),
  ])
  if (roleRes.error) throw new Error(roleRes.error.message)
  const a = access[0]
  return {
    role: (roleRes.data?.role as 'admin' | 'moderator' | undefined) ?? null,
    shopManager: !!a?.shop_manager,
    questWriter: !!a?.quest_writer,
    shopOwner: !!a?.shop_owner,
  }
}

export type ReportRow = {
  report_id: string
  target_type: 'message' | 'direct_message' | 'project' | 'member'
  target_id: string
  target_author_id: string
  target_author_username: string
  reporter_username: string
  reason: 'spam' | 'harassment' | 'inappropriate' | 'scam' | 'other'
  note: string | null
  snapshot: Record<string, unknown>
  status: 'open' | 'dismissed' | 'actioned'
  created_at: string
  open_reports_on_same_target: number
}
export const listReports = (status: 'open' | 'dismissed' | 'actioned', limit = 50) =>
  rpc<ReportRow[]>('list_reports', { p_status: status, p_limit: limit })
export type ReportAction = 'dismiss' | 'remove_content' | 'warn_member' | 'suspend_member'
export const resolveReport = (id: string, action: ReportAction, note: string, days: number | null) =>
  rpc<void>('resolve_report', { p_report: id, p_action: action, p_note: note.trim() || null, p_days: action === 'suspend_member' ? days : null })

export type ReviewItem = { kind: 'employer' | 'offer'; id: string; title: string; owner_username: string; employer_kind: string; created_at: string }
export const listReviewQueue = () => rpc<ReviewItem[]>('list_review_queue')
export const reviewEmployer = (id: string, approve: boolean, note: string) => rpc<void>('review_employer', { p_employer: id, p_approve: approve, p_note: note.trim() || null })
export const reviewJobOffer = (id: string, approve: boolean, note: string) => rpc<void>('review_job_offer', { p_offer: id, p_approve: approve, p_note: note.trim() || null })
export type StaffMember = { user_id: string; username: string; role: string; granted_at: string }
export type BackOfficeRole = 'quest_writer' | 'shop_manager' | 'shop_owner'
export const listStaff = () => rpc<StaffMember[]>('list_staff')
export const listBackOfficeTeam = () => rpc<StaffMember[]>('list_back_office_team')
export const setModerator = (userId: string, on: boolean) => rpc<void>('set_moderator', { p_user: userId, p_on: on })
export const setBackOfficeRole = (userId: string, role: BackOfficeRole, on: boolean) =>
  rpc<void>('set_back_office_role', { p_user: userId, p_role: role, p_on: on })
export const liftSuspension = (userId: string) => rpc<void>('lift_suspension', { p_user: userId })
/** Finds a member by exact username (a leading @ is ignored). Returns null when nobody has it. */
export async function findMemberByUsername(username: string): Promise<{ id: string; username: string } | null> {
  const name = username.trim().replace(/^@/, '')
  if (!name) return null
  const { data, error } = await supabase.from('profiles').select('id, username').eq('username', name).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? { id: data.id as string, username: data.username as string } : null
}
export type SoukSubmissionStaff = {
  id: string
  creator_id: string
  creator_username: string
  kind: SoukKind
  name: string
  description: string | null
  data: Record<string, unknown>
  proposed_price: number
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  review_note: string | null
  created_at: string
}
export const listSoukSubmissions = (status: 'pending' | 'approved' | 'rejected', limit = 50) =>
  rpc<SoukSubmissionStaff[]>('list_souk_submissions', { p_status: status, p_limit: limit })
export const reviewSoukSubmission = (id: string, approve: boolean, note: string, price: number | null) =>
  rpc<string | null>('review_souk_submission', { p_submission: id, p_approve: approve, p_note: note.trim() || null, p_price: approve ? price : null })

// ---- Reporting content ------------------------------------------------------------------------------
export type ReportTarget = 'message' | 'direct_message' | 'project' | 'member'
export type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'scam' | 'other'
export const reportContent = (type: ReportTarget, id: string, reason: ReportReason, note: string) =>
  rpc<string>('report_content', { p_target_type: type, p_target_id: id, p_reason: reason, p_note: note.trim() || null })

// ---- Portfolio and CV --------------------------------------------------------------------------------
export type PortfolioItem = { id: string; title: string; description: string | null; url: string | null; project_id: string | null }
export async function listMyPortfolio(userId: string): Promise<PortfolioItem[]> {
  const { data, error } = await supabase
    .from('portfolio_items')
    .select('id, title, description, url, project_id')
    .eq('user_id', userId)
    .order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as PortfolioItem[]
}
export const addPortfolioItem = (title: string, description: string, url: string) =>
  rpc<string>('add_portfolio_item', { p_title: title, p_description: description || null, p_url: url || null, p_project: null })
export const updatePortfolioItem = (id: string, title: string, description: string, url: string) =>
  rpc<void>('update_portfolio_item', { p_item: id, p_title: title, p_description: description || null, p_url: url || null, p_project: null })
export const deletePortfolioItem = (id: string) => rpc<void>('delete_portfolio_item', { p_item: id })

export type MyCv = { cv_path: string | null; cv_name: string | null; cv_size: number | null }
export async function getMyCv(userId: string): Promise<MyCv> {
  const { data, error } = await supabase.from('application_files').select('cv_path, cv_name, cv_size').eq('user_id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  return { cv_path: data?.cv_path ?? null, cv_name: data?.cv_name ?? null, cv_size: data?.cv_size ?? null }
}
/** Uploads the PDF into the member's own folder, records it, and deletes the file it replaces. */
export async function uploadCv(userId: string, file: File): Promise<void> {
  const path = `${userId}/${crypto.randomUUID()}.pdf`
  const up = await supabase.storage.from('cv-files').upload(path, file, { contentType: 'application/pdf', upsert: false })
  if (up.error) throw new Error(up.error.message)
  let old: string | null
  try {
    old = await rpc<string | null>('set_cv', { p_path: path, p_name: file.name, p_size: file.size })
  } catch (err) {
    await supabase.storage.from('cv-files').remove([path])
    throw err
  }
  if (old) await supabase.storage.from('cv-files').remove([old])
}
export async function removeMyCv(): Promise<void> {
  const old = await rpc<string | null>('remove_cv')
  if (old) await supabase.storage.from('cv-files').remove([old])
}
export async function cvLink(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('cv-files').createSignedUrl(path, 60)
  if (error || !data) throw new Error(error?.message ?? 'No link')
  return data.signedUrl
}

// ---- Talent directory --------------------------------------------------------------------------------
export type TalentFilters = { query: string; place: string; kind: '' | 'job' | 'freelance'; availability: string }
export type TalentCard = {
  user_id: string; username: string; display_name: string; avatar_url: string | null; headline: string; summary: string | null
  location: string | null; experience_years: number | null; availability: string | null; work_kinds: string[]; skills: string[]
  portfolio_count: number; listed_at: string
}
export type TalentDetail = Omit<TalentCard, 'portfolio_count' | 'listed_at'> & {
  website: string | null; linkedin_url: string | null
  portfolio: { title: string; description: string | null; url: string | null }[]
}
export type MyTalentListing = { listed: boolean; visible: boolean; hidden_by_staff: boolean }
export const searchTalent = (f: TalentFilters) =>
  rpc<TalentCard[]>('search_talent', {
    p_query: f.query.trim() || null,
    p_skill: null,
    p_location: f.place.trim() || null,
    p_work_kind: f.kind || null,
    p_availability: f.availability || null,
    p_min_years: null,
    p_limit: 30,
    p_offset: 0,
  })
export async function getTalent(userId: string): Promise<TalentDetail> {
  const rows = await rpc<TalentDetail[]>('get_talent', { p_user: userId })
  if (!rows || rows.length === 0) throw new Error('Profile not found')
  return rows[0]
}
export async function myTalentListing(): Promise<MyTalentListing> {
  const rows = await rpc<MyTalentListing[]>('my_talent_listing')
  return rows[0] ?? { listed: false, visible: false, hidden_by_staff: false }
}
export const joinTalentDirectory = () => rpc<void>('join_talent_directory')
export const leaveTalentDirectory = () => rpc<void>('leave_talent_directory')

// ---- Employer side of jobs ---------------------------------------------------------------------------
export type EmployerKind = 'company' | 'individual'
export type MyEmployer = {
  id: string; kind: EmployerKind; name: string; description: string | null; website: string | null
  logo_url: string | null; location: string | null; status: 'pending' | 'approved' | 'rejected'; review_note: string | null
}
export type EmployerInput = { kind: EmployerKind; name: string; description: string; website: string; location: string }
export async function getMyEmployer(userId: string): Promise<MyEmployer | null> {
  const { data, error } = await supabase
    .from('employers')
    .select('id, kind, name, description, website, logo_url, location, status, review_note')
    .eq('owner_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as MyEmployer | null) ?? null
}
export const createEmployer = (i: EmployerInput) =>
  rpc<string>('create_employer', {
    p_kind: i.kind, p_name: i.name, p_description: i.description || null, p_website: i.website || null, p_logo_url: null, p_location: i.location || null,
  })
export const updateEmployer = (i: EmployerInput, logo: string | null) =>
  rpc<string>('update_employer', {
    p_name: i.name, p_description: i.description || null, p_website: i.website || null, p_logo_url: logo, p_location: i.location || null,
  })

export type OfferStatus = 'draft' | 'pending_review' | 'published' | 'closed' | 'rejected'
export type MyOffer = {
  id: string; title: string; kind: 'job' | 'freelance'; description: string; employment_type: string | null; location: string | null
  remote: string; pay_min_fcfa: number | null; pay_max_fcfa: number | null; pay_unit: string | null; pay_negotiable: boolean
  tags: string[]; status: OfferStatus; review_note: string | null; staff_hidden: boolean; closes_on: string | null
}
const OFFER_COLUMNS = 'id, title, kind, description, employment_type, location, remote, pay_min_fcfa, pay_max_fcfa, pay_unit, pay_negotiable, tags, status, review_note, staff_hidden, closes_on'
export async function listMyOffers(userId: string): Promise<MyOffer[]> {
  const { data, error } = await supabase.from('job_offers').select(OFFER_COLUMNS).eq('posted_by', userId).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as MyOffer[]
}
export async function getMyOffer(userId: string, id: string): Promise<MyOffer | null> {
  const { data, error } = await supabase.from('job_offers').select(OFFER_COLUMNS).eq('posted_by', userId).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as MyOffer | null) ?? null
}
export type OfferInput = {
  title: string; kind: 'job' | 'freelance'; description: string; employment_type: string; location: string; remote: string
  pay_min: string; pay_max: string; pay_unit: string; pay_negotiable: boolean; tags: string; closes_on: string
}
function offerArgs(i: OfferInput) {
  const tags = i.tags.split(',').map((t) => t.trim()).filter(Boolean)
  return {
    p_title: i.title, p_kind: i.kind, p_description: i.description,
    p_employment_type: i.kind === 'job' ? i.employment_type || null : null,
    p_location: i.location || null, p_remote: i.remote,
    p_pay_min: i.pay_min.trim() ? Number(i.pay_min) : null, p_pay_max: i.pay_max.trim() ? Number(i.pay_max) : null,
    p_pay_unit: i.pay_unit || null, p_pay_negotiable: i.pay_negotiable, p_tags: tags, p_closes_on: i.closes_on || null,
  }
}
export const createJobOffer = (i: OfferInput, publish: boolean) => rpc<string>('create_job_offer', { ...offerArgs(i), p_publish: publish })
export const updateJobOffer = (id: string, i: OfferInput) => rpc<void>('update_job_offer', { p_offer: id, ...offerArgs(i) })
export const publishJobOffer = (id: string) => rpc<'published' | 'pending_review'>('publish_job_offer', { p_offer: id })
export const closeJobOffer = (id: string) => rpc<void>('close_job_offer', { p_offer: id })
export const unpublishJobOffer = (id: string) => rpc<void>('unpublish_job_offer', { p_offer: id })
export const deleteJobOffer = (id: string) => rpc<void>('delete_job_offer', { p_offer: id })

export type ApplicantStatus = 'submitted' | 'seen' | 'shortlisted' | 'declined'
export type Applicant = {
  id: string; applicant_id: string; username: string; display_name: string; avatar_url: string | null; headline: string | null
  skills: string[]; status: ApplicantStatus; applied_at: string; has_cv: boolean
}
export const listOfferApplicants = (offer: string, status: ApplicantStatus | '') =>
  rpc<Applicant[]>('list_offer_applicants', { p_offer: offer, p_status: status || null, p_limit: 50, p_offset: 0 })
export const setApplicationStatus = (id: string, status: 'seen' | 'shortlisted' | 'declined') =>
  rpc<void>('set_application_status', { p_application: id, p_status: status })
export type ApplicantDetail = { message: string | null; cv_path: string | null; cv_name: string | null; summary: string | null }
export async function getApplicationDetail(id: string): Promise<ApplicantDetail> {
  const { data, error } = await supabase.from('job_applications').select('message, cv_path, cv_name, profile_snapshot').eq('id', id).maybeSingle()
  if (error || !data) throw new Error(error?.message ?? 'Application not found')
  const snap = (data.profile_snapshot ?? {}) as { summary?: string | null }
  return { message: data.message ?? null, cv_path: data.cv_path ?? null, cv_name: data.cv_name ?? null, summary: snap.summary ?? null }
}
export async function applicantCvLink(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('cv-files').createSignedUrl(path, 60)
  if (error || !data) throw new Error(error?.message ?? 'No link')
  return data.signedUrl
}

// ---- Settings: blocked members, job email, sign-in methods -------------------------------------------
export type BlockedMember = { id: string; username: string; display_name: string }
export async function listBlockedMembers(userId: string): Promise<BlockedMember[]> {
  const { data, error } = await supabase.from('blocks').select('blocked_id').eq('blocker_id', userId).order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  const ids = (data ?? []).map((r) => r.blocked_id as string)
  if (ids.length === 0) return []
  const people = await supabase.from('profiles').select('id, username, display_name').in('id', ids)
  if (people.error) throw new Error(people.error.message)
  return ids.map((id) => (people.data ?? []).find((p) => p.id === id)).filter(Boolean) as BlockedMember[]
}
export async function getJobEmailSetting(): Promise<boolean> {
  const rows = await rpc<{ email_digest: boolean }[]>('my_job_alert_settings')
  return rows[0]?.email_digest ?? true
}
export const setJobEmailSetting = (on: boolean) => rpc<void>('set_job_alert_email', { p_on: on })
export async function getSignInMethods(): Promise<{ email: string | null; github: boolean }> {
  const { data, error } = await supabase.auth.getUserIdentities()
  if (error) throw new Error(error.message)
  const list = data?.identities ?? []
  const email = list.find((i) => i.provider === 'email')
  return { email: (email?.identity_data?.email as string | undefined) ?? null, github: list.some((i) => i.provider === 'github') }
}

// ---- Quest arena ---------------------------------------------------------------------------------------
export type PastDailyQuest = {
  day: string; quest_id: string; slug: string; title: string; clan: ClanKey; mastery: MasteryKey
  language: 'python' | 'javascript' | null; est_minutes: number; status: 'in_progress' | 'solved' | null
}
export const listPastDailyQuests = (days = 30) => rpc<PastDailyQuest[]>('list_past_daily_quests', { p_days: days })

// ---- Read-only code viewer (public GitHub repositories) --------------------------------------------------
export type RepoEntry = { path: string; type: 'blob' | 'tree'; size: number }
export type RepoTree = { branch: string; default_branch?: string; entries: RepoEntry[]; truncated: boolean }
const NAME = /^[A-Za-z0-9._-]{1,100}$/
async function githubJson<T>(url: string, fetchFn: typeof fetch): Promise<T> {
  let response: Response
  try {
    response = await fetchFn(url, { headers: { accept: 'application/vnd.github+json' } })
  } catch {
    throw new GithubError('failed')
  }
  if (response.status === 403 || response.status === 429) throw new GithubError('rate_limited')
  if (response.status === 404) throw new GithubError('not_found')
  if (!response.ok) throw new GithubError('failed')
  return (await response.json()) as T
}
/** The files of a public repository, from its default branch (two GitHub calls). */
export async function getRepoTree(owner: string, repo: string, wanted?: string | null, fetchFn: typeof fetch = fetch): Promise<RepoTree> {
  if (!NAME.test(owner) || !NAME.test(repo)) throw new GithubError('not_found')
  const info = await githubJson<{ default_branch: string }>(`https://api.github.com/repos/${owner}/${repo}`, fetchFn)
  const branch = wanted || info.default_branch
  const tree = await githubJson<{ tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, fetchFn)
  const entries = tree.tree
    .filter((e) => e.type === 'blob' || e.type === 'tree')
    .map((e) => ({ path: e.path, type: e.type as 'blob' | 'tree', size: e.size ?? 0 }))
  return { branch, default_branch: info.default_branch, entries, truncated: tree.truncated }
}
export const MAX_VIEW_BYTES = 200 * 1024
/** One file's text. Throws GithubError; the caller checks the size and the kind of file first. */
export async function getRepoFile(owner: string, repo: string, branch: string, path: string, fetchFn: typeof fetch = fetch): Promise<string> {
  if (!NAME.test(owner) || !NAME.test(repo) || path.includes('..')) throw new GithubError('not_found')
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`
  let response: Response
  try {
    response = await fetchFn(url)
  } catch {
    throw new GithubError('failed')
  }
  if (response.status === 404) throw new GithubError('not_found')
  if (response.status === 403 || response.status === 429) throw new GithubError('rate_limited')
  if (!response.ok) throw new GithubError('failed')
  return await response.text()
}
const BINARY = /\.(png|jpe?g|gif|webp|ico|svg|pdf|zip|gz|tar|woff2?|ttf|otf|mp[34]|mov|wasm|exe|bin|so|dll|class|jar|lock)$/i
export const isViewable = (e: RepoEntry) => e.type === 'blob' && !BINARY.test(e.path) && e.size <= MAX_VIEW_BYTES

export type LastCommit = { message: string; date: string }
/** The last commit message and date of some files or folders of a project's repository (through the repo-info function). */
export async function getLastCommits(projectId: string, paths: string[]): Promise<Record<string, LastCommit>> {
  const { data, error } = await supabase.functions.invoke('repo-info', { body: { project_id: projectId, paths } })
  if (error) throw new Error('repo-info failed')
  return ((data as { commits?: Record<string, LastCommit> } | null)?.commits) ?? {}
}

// ---- Code editor (saves to GitHub through the repo-editor function) ------------------------------------
export class EditorError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}
async function callEditor<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('repo-editor', { body })
  if (error) {
    let reason = 'unknown'
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      try { reason = String((await context.json())?.error ?? 'unknown') } catch { /* keep unknown */ }
    }
    throw new EditorError(reason)
  }
  return data as T
}
export type EditorStatus = { installed: boolean; install_url: string; github_name: string }
export type EditorTree = { branch: string; default_branch?: string; head: string | null; entries: RepoEntry[]; truncated: boolean }
export type FileChange = { path: string; content?: string; content_base64?: string; delete?: boolean; move_from?: string }
export const editorStatus = () => callEditor<EditorStatus>({ action: 'status' })
export type EditorRepo = { name: string; private: boolean; default_branch: string }
export const editorRepos = () => callEditor<{ repos: EditorRepo[] }>({ action: 'repos' })
/** Lists a PRIVATE repository on the platform; it stays private. */
export const editorAdopt = (repo: string, title: string, summary: string | null) =>
  callEditor<{ project_id: string }>({ action: 'adopt', repo, title, summary })
/** Asks GitHub which private repositories the app can still see, and flags the ones that are gone. */
export const editorPresence = () => callEditor<{ checked: boolean }>({ action: 'presence' })
export const editorTree = (repo: string) => callEditor<EditorTree>({ action: 'tree', repo })
/** Reading the code of a project through the GitHub app: allowed for the owner and the collaborators. */
export const editorTreeOf = (projectId: string, branch?: string | null) =>
  callEditor<EditorTree>({ action: 'tree', project: projectId, ...(branch ? { branch } : {}) })
export type BranchList = { default_branch: string; branches: string[] }
export const editorBranches = (projectId: string) => callEditor<BranchList>({ action: 'branches', project: projectId })
/** Saves changes as one commit. The owner may pick any branch; a collaborator only a branch named after them (the server checks). */
export const editorCommitTo = (projectId: string, o: { branch: string; createFrom?: string; baseSha: string; message: string; files: FileChange[] }) =>
  callEditor<{ commit_sha: string; html_url: string }>({
    action: 'commit', project: projectId, branch: o.branch, base_sha: o.baseSha, message: o.message, files: o.files, ...(o.createFrom ? { create_from: o.createFrom } : {}),
  })
export const editorFileOf = (projectId: string, path: string, ref: string) =>
  callEditor<{ path: string; content: string }>({ action: 'file', project: projectId, path, ref })
export const editorFile = (repo: string, path: string, ref: string) =>
  callEditor<{ path: string; content: string }>({ action: 'file', repo, path, ref })
export const editorCommit = (repo: string, branch: string, baseSha: string, message: string, files: FileChange[]) =>
  callEditor<{ commit_sha: string; html_url: string }>({ action: 'commit', repo, branch, base_sha: baseSha, message, files })

export type SearchMatch = { path: string; line: number; text: string }
export type SearchResult = { matches: SearchMatch[]; scanned: number; skipped: number; more: boolean }
/** Text inside the files of a branch (members only). */
export const editorSearch = (projectId: string, q: string, branch: string | null) =>
  callEditor<SearchResult>({ action: 'search', project: projectId, q, ...(branch ? { branch } : {}) })
/** One file as base64 (used to show an image of a private repository). */
export const editorBlob = (projectId: string, path: string, ref: string) =>
  callEditor<{ path: string; size: number; content_base64: string }>({ action: 'blob', project: projectId, path, ref })
const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon' }
export const imageMime = (path: string) => IMAGE_TYPES[path.split('.').pop()?.toLowerCase() ?? ''] ?? null
export const rawFileUrl = (owner: string, repo: string, branch: string, path: string) =>
  `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`

export type Proposal = { number: number; title: string; branch: string; sha: string; author: string; url: string; created_at: string }
export const editorProposals = (projectId: string) => callEditor<{ default_branch: string; pulls: Proposal[] }>({ action: 'prs', project: projectId })
/** Proposes a branch to the main code. `existed` is true when a proposal for that branch was already open. */
export const editorPropose = (projectId: string, o: { branch: string; title: string; body?: string }) =>
  callEditor<{ number: number; url: string; existed: boolean }>({ action: 'pr_open', project: projectId, branch: o.branch, title: o.title, ...(o.body ? { body: o.body } : {}) })
/** Merges exactly the version the owner was shown (`sha`): if the branch got a newer commit, nothing is merged. */
export const editorMergeProposal = (projectId: string, number: number, sha: string) =>
  callEditor<{ merged: boolean; url: string }>({ action: 'pr_merge', project: projectId, number, sha })
export const editorCloseProposal = (projectId: string, number: number) => callEditor<{ closed: boolean }>({ action: 'pr_close', project: projectId, number })

// ---- Reading a project's code and history (public repositories directly, private ones through the GitHub app) -----
type RepoRef = { id: string; github_owner: string; github_repo: string; repo_private: boolean }

export async function loadRepoTree(project: RepoRef, branch?: string | null): Promise<RepoTree> {
  if (!project.repo_private) return getRepoTree(project.github_owner, project.github_repo, branch)
  const t = await editorTreeOf(project.id, branch)
  return { branch: t.branch, default_branch: t.default_branch, entries: t.entries, truncated: t.truncated }
}

/** The branches of the project's repository, the main one first. */
export async function loadBranches(project: RepoRef, fetchFn: typeof fetch = fetch): Promise<BranchList> {
  if (project.repo_private) return editorBranches(project.id)
  if (!NAME.test(project.github_owner) || !NAME.test(project.github_repo)) throw new GithubError('not_found')
  const base = `https://api.github.com/repos/${project.github_owner}/${project.github_repo}`
  const info = await githubJson<{ default_branch: string }>(base, fetchFn)
  const list = await githubJson<{ name: string }[]>(`${base}/branches?per_page=100`, fetchFn)
  return { default_branch: info.default_branch, branches: list.map((b) => b.name) }
}

/** Where GitHub's "open a pull request" page for a branch is (the owner or a collaborator finishes the merge there). */
export const pullRequestUrl = (owner: string, repo: string, base: string, branch: string) =>
  `https://github.com/${owner}/${repo}/compare/${base.split('/').map(encodeURIComponent).join('/')}...${branch.split('/').map(encodeURIComponent).join('/')}?expand=1`

export async function loadRepoFile(project: RepoRef, branch: string, path: string): Promise<string> {
  if (!project.repo_private) return getRepoFile(project.github_owner, project.github_repo, branch, path)
  return (await editorFileOf(project.id, path, branch)).content
}

export type CommitRow = { sha: string; message: string; author: string; date: string; html_url: string }
export type History = { commits: CommitRow[]; more: boolean }

/** The latest commits of the project (30 per page), or only those that changed one file. */
export async function loadHistory(project: RepoRef, opts: { path?: string; page?: number } = {}, fetchFn: typeof fetch = fetch): Promise<History> {
  const page = opts.page ?? 1
  if (project.repo_private) {
    const h = await callEditor<History>({ action: 'history', project: project.id, ...(opts.path ? { path: opts.path } : {}), page })
    return h
  }
  if (!NAME.test(project.github_owner) || !NAME.test(project.github_repo)) throw new GithubError('not_found')
  const query = new URLSearchParams({ per_page: '30', page: String(page) })
  if (opts.path) query.set('path', opts.path)
  type Raw = { sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } | null }; author: { login: string } | null }[]
  const raw = await githubJson<Raw>(`https://api.github.com/repos/${project.github_owner}/${project.github_repo}/commits?${query.toString()}`, fetchFn)
  const commits = raw.map((c) => ({
    sha: c.sha, message: c.commit.message.split('\n')[0].slice(0, 300), author: c.commit.author?.name ?? c.author?.login ?? '',
    date: c.commit.author?.date ?? '', html_url: c.html_url,
  }))
  return { commits, more: commits.length === 30 }
}

// ---- Questions and answers
export type QuestionCard = { id: string; title: string; tags: string[]; author_id: string; author_username: string; answer_count: number; vote_count: number; solved: boolean; created_at: string }
export type QuestionFull = {
  id: string; title: string; body: string; tags: string[]; author_id: string; author_username: string; author_display_name: string | null
  accepted_answer_id: number | null; answer_count: number; vote_count: number; voted_by_me: boolean; created_at: string; edited_at: string | null
}
export type AnswerRow = {
  id: number; body: string; author_id: string; author_username: string; author_display_name: string | null
  vote_count: number; voted_by_me: boolean; accepted: boolean; created_at: string; edited_at: string | null
}
export type QuestionFilter = 'all' | 'open' | 'solved'
export type QuestionSort = 'recent' | 'useful'
export const listQuestions = (o: { tag?: string; filter?: QuestionFilter; sort?: QuestionSort; limit?: number; offset?: number } = {}) =>
  rpc<QuestionCard[]>('list_questions', { p_tag: o.tag?.trim() || null, p_filter: o.filter ?? 'all', p_sort: o.sort ?? 'recent', p_limit: o.limit ?? 20, p_offset: o.offset ?? 0 })
export async function getQuestion(id: string): Promise<QuestionFull | null> {
  const rows = await rpc<QuestionFull[]>('get_question', { p_question: id })
  return rows[0] ?? null
}
export const listAnswers = (questionId: string) => rpc<AnswerRow[]>('list_answers', { p_question: questionId })
export const askQuestion = (title: string, body: string, tags: string[]) => rpc<string>('ask_question', { p_title: title, p_body: body, p_tags: tags })
export const deleteQuestion = (id: string) => rpc<void>('delete_question', { p_question: id })
export const postAnswer = (questionId: string, body: string) => rpc<number>('post_answer', { p_question: questionId, p_body: body })
export const deleteAnswer = (id: number) => rpc<void>('delete_answer', { p_answer: id })
export const acceptAnswer = (id: number) => rpc<void>('accept_answer', { p_answer: id })
export const unacceptAnswer = (questionId: string) => rpc<void>('unaccept_answer', { p_question: questionId })
export const voteQuestion = (id: string, on: boolean) => rpc<void>(on ? 'vote_question' : 'unvote_question', { p_question: id })
export const voteAnswer = (id: number, on: boolean) => rpc<void>(on ? 'vote_answer' : 'unvote_answer', { p_answer: id })
