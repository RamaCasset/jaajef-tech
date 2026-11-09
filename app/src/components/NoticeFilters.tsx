import { fr } from '../i18n/fr'
import type { NoticeFilter } from '../lib/notificationMeta'

/** The little round filter buttons: all, unread, mentions (and on the full page: projects, quests). */
export function NoticeFilters({ value, onChange, unread, full = false }: { value: NoticeFilter; onChange: (f: NoticeFilter) => void; unread: number; full?: boolean }) {
  const t = fr.notifications
  const all: { key: NoticeFilter; label: string }[] = [
    { key: 'all', label: t.filterAll },
    { key: 'unread', label: t.filterUnread(unread) },
    { key: 'mentions', label: t.filterMentions },
    ...(full ? [{ key: 'projects' as const, label: t.filterProjects }, { key: 'quests' as const, label: t.filterQuests }] : []),
  ]
  return (
    <div className="notice-filters" role="group" aria-label={t.title}>
      {all.map((f) => (
        <button key={f.key} type="button" className="chip" aria-pressed={value === f.key} onClick={() => onChange(f.key)}>{f.label}</button>
      ))}
    </div>
  )
}
