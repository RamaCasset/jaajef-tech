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

export type MyProject = { id: string; github_owner: string; github_repo: string; verified_at: string | null }

/** The member's own listed projects, including the ones still waiting to be confirmed. */
export async function listMyProjects(userId: string): Promise<MyProject[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, github_owner, github_repo, verified_at')
    .eq('owner_id', userId)
  if (error) throw new Error(error.message)
  return (data ?? []) as MyProject[]
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
export type ProfileEdit = { display_name: string; bio: string; location: string; available_to_collab: boolean }
export async function updateMyProfile(userId: string, e: ProfileEdit): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({
      display_name: e.display_name.trim(),
      bio: e.bio.trim() || null,
      location: e.location.trim() || null,
      available_to_collab: e.available_to_collab,
    })
    .eq('id', userId)
  if (error) throw new Error(error.message)
}
export async function loadMyProfileFields(userId: string): Promise<ProfileEdit> {
  const { data, error } = await supabase.from('profiles').select('display_name, bio, location, available_to_collab').eq('id', userId).single()
  if (error) throw new Error(error.message)
  return { display_name: data.display_name, bio: data.bio ?? '', location: data.location ?? '', available_to_collab: data.available_to_collab }
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
}
export async function getProjectFull(id: string): Promise<ProjectFull | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, title, summary, github_owner, github_repo, language, tags, github_stars, owner_id, profiles:owner_id(username, display_name)')
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
