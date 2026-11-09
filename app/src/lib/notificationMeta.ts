import { dateLocale } from '../i18n/lang'
import { fr } from '../i18n/fr'
import type { NotificationKind, NotificationRow } from './api'

export type NoticeFilter = 'all' | 'unread' | 'mentions' | 'projects' | 'quests'
type Category = 'mentions' | 'projects' | 'quests' | 'other'

const CATEGORY: Record<NotificationKind, Category> = {
  mention: 'mentions', project_comment: 'mentions', blog_comment: 'mentions', blog_like: 'mentions',
  quest_completed: 'quests',
  new_application: 'other', application_seen: 'other', application_shortlisted: 'other', application_declined: 'other', job_alert: 'other', job_offer_hidden: 'other',
  blog_hidden: 'other', souk_submission_approved: 'other', souk_submission_rejected: 'other', souk_sale: 'other', souk_item_removed: 'other',
  project_starred: 'projects', project_confirmed: 'projects', project_hidden: 'projects',
  collab_request: 'projects', collab_accepted: 'projects', collab_declined: 'projects',
  collab_invite: 'projects', collab_invite_accepted: 'projects', collab_invite_declined: 'projects',
  proposal_opened: 'projects', proposal_merged: 'projects', proposal_declined: 'projects',
  join_request: 'projects', join_approved: 'projects', join_declined: 'projects',
  badge_unlocked: 'quests',
  warning: 'other', suspension: 'other',
}

/** The three switches of "À votre rythme": each one turns a group of kinds on or off. */
export const RHYTHM_GROUPS: { key: 'mentions' | 'projects' | 'quests'; kinds: NotificationKind[] }[] = [
  { key: 'mentions', kinds: ['mention', 'project_comment', 'blog_comment', 'blog_like'] },
  { key: 'projects', kinds: ['project_starred', 'project_confirmed', 'collab_request', 'collab_accepted', 'collab_declined', 'collab_invite', 'collab_invite_accepted', 'collab_invite_declined', 'proposal_opened', 'proposal_merged', 'proposal_declined', 'join_request', 'join_approved', 'join_declined'] },
  { key: 'quests', kinds: ['badge_unlocked', 'quest_completed'] },
]

export function matchesFilter(n: NotificationRow, f: NoticeFilter): boolean {
  if (f === 'all') return true
  if (f === 'unread') return !n.read_at
  return CATEGORY[n.kind] === f
}

export type ToneIcon = { text?: string; icon?: string; tone: 'blue' | 'gold' | 'red' }
export function tileOf(kind: NotificationKind): ToneIcon {
  switch (kind) {
    case 'mention': return { text: '@', tone: 'blue' }
    case 'project_comment': case 'blog_comment': return { icon: 'messages', tone: 'blue' }
    case 'blog_like': return { icon: 'star', tone: 'blue' }
    case 'new_application': case 'application_seen': case 'application_shortlisted': case 'application_declined': case 'job_alert': return { icon: 'jobs', tone: 'blue' }
    case 'souk_submission_approved': case 'souk_submission_rejected': case 'souk_sale': return { icon: 'souk', tone: 'blue' }
    case 'proposal_opened': case 'proposal_merged': case 'proposal_declined': return { icon: 'fork', tone: 'blue' }
    case 'collab_request': case 'collab_accepted': case 'collab_declined': case 'collab_invite': case 'collab_invite_accepted': case 'collab_invite_declined': return { icon: 'user', tone: 'blue' }
    case 'project_starred': return { icon: 'star', tone: 'blue' }
    case 'project_confirmed': return { icon: 'repo', tone: 'blue' }
    case 'join_request': case 'join_approved': case 'join_declined': return { icon: 'communities', tone: 'blue' }
    case 'badge_unlocked': case 'quest_completed': return { text: '+', tone: 'gold' }
    default: return { icon: 'shield', tone: 'red' }
  }
}

export type Bucket = 'today' | 'yesterday' | 'week' | 'older'
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

export function bucketOf(iso: string, now: Date = new Date()): Bucket {
  const days = Math.round((dayStart(now) - dayStart(new Date(iso))) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return 'week'
  return 'older'
}

/** Short relative time: "il y a 5 min", "il y a 2 h". */
function shortAgo(iso: string, now: number): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000)
  const rtf = new Intl.RelativeTimeFormat(dateLocale(), { numeric: 'auto', style: 'short' })
  const abs = Math.abs(seconds)
  if (abs < 60) return rtf.format(0, 'second')
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
  return rtf.format(Math.round(seconds / 3600), 'hour')
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/** "Il y a 5 min" today, "Hier · 18:42" yesterday, "Lundi · 10:32" this week, the date after that. */
export function whenLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
  switch (bucketOf(iso, now)) {
    case 'today': return cap(shortAgo(iso, now.getTime()))
    case 'yesterday': return `${fr.notifications.yesterday} · ${time}`
    case 'week': return `${cap(d.toLocaleDateString(dateLocale(), { weekday: 'long' }))} · ${time}`
    default: return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
  }
}

export function groupByDay(items: NotificationRow[], now: Date = new Date()): { bucket: Bucket; items: NotificationRow[] }[] {
  const order: Bucket[] = ['today', 'yesterday', 'week', 'older']
  return order
    .map((bucket) => ({ bucket, items: items.filter((n) => bucketOf(n.created_at, now) === bucket) }))
    .filter((g) => g.items.length > 0)
}

export function noticeText(n: NotificationRow): string {
  const make = fr.notifications.text[n.kind]
  return make ? make(n.data as Record<string, string>) : n.kind
}
export const noticeTitle = (n: NotificationRow): string => fr.notifications.kinds[n.kind] ?? n.kind

/** Where a notice leads, when it leads somewhere (the invite and proposal notices have their own buttons and links). */
export function noticeLink(n: NotificationRow): string | null {
  const d = n.data as Record<string, unknown>
  const str = (k: string) => (typeof d[k] === 'string' && d[k] ? (d[k] as string) : null)
  switch (n.kind) {
    case 'mention': return d.place === 'blog' ? (str('post_slug') ? `/blog/${str('post_slug')}` : null) : (str('project_id') ? `/projets/${str('project_id')}` : null)
    case 'project_comment': case 'project_starred': case 'project_confirmed': case 'collab_request': case 'collab_accepted': case 'collab_declined':
      return str('project_id') ? `/projets/${str('project_id')}` : null
    case 'blog_comment': case 'blog_like': return str('post_slug') ? `/blog/${str('post_slug')}` : null
    case 'quest_completed': return str('quest_slug') ? `/quetes/${str('quest_slug')}` : '/quetes'
    case 'new_application': case 'job_alert': return str('offer_id') ? `/jobs/${str('offer_id')}` : null
    case 'souk_submission_approved': case 'souk_submission_rejected': case 'souk_sale': case 'souk_item_removed': return '/souk'
    default: return null
  }
}
