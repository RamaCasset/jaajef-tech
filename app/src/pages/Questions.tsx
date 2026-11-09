import { dateLocale } from '../i18n/lang'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useDebounced } from '../hooks'
import { fr } from '../i18n/fr'
import { listQuestions, type QuestionCard, type QuestionFilter, type QuestionSort } from '../lib/api'

const PAGE = 20

export function Questions() {
  const t = fr.qa
  const [tag, setTag] = useState('')
  const debounced = useDebounced(tag)
  const [filter, setFilter] = useState<QuestionFilter>('all')
  const [sort, setSort] = useState<QuestionSort>('recent')
  const [items, setItems] = useState<QuestionCard[] | null>(null)
  const [more, setMore] = useState(false)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    setFailed(false)
    setItems(null)
    listQuestions({ tag: debounced, filter, sort, limit: PAGE })
      .then((rows) => { if (alive) { setItems(rows); setMore(rows.length === PAGE) } })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [debounced, filter, sort, reload])

  async function loadMore() {
    if (!items) return
    try {
      const rows = await listQuestions({ tag: debounced, filter, sort, limit: PAGE, offset: items.length })
      setItems([...items, ...rows])
      setMore(rows.length === PAGE)
    } catch {
      setFailed(true)
    }
  }

  return (
    <AppShell>
      <main className="page souk">
        <header className="page-head">
          <h1 className="page-title">{t.title}</h1>
          <p className="muted">{t.subtitle}</p>
          <p><Link className="btn btn-cta" to="/questions/poser">{t.ask}</Link></p>
        </header>

        <div className="qa-filters">
          <div className="field">
            <label htmlFor="qa-filter">{t.filterLabel}</label>
            <select id="qa-filter" value={filter} onChange={(e) => setFilter(e.target.value as QuestionFilter)}>
              {(['all', 'open', 'solved'] as const).map((k) => <option key={k} value={k}>{t.filters[k]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="qa-sort">{t.sortLabel}</label>
            <select id="qa-sort" value={sort} onChange={(e) => setSort(e.target.value as QuestionSort)}>
              {(['recent', 'useful'] as const).map((k) => <option key={k} value={k}>{t.sorts[k]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="qa-tag">{t.tagFilter}</label>
            <input id="qa-tag" value={tag} onChange={(e) => setTag(e.target.value)} />
          </div>
        </div>

        {failed && (
          <div className="alert" role="alert">{t.loadFailed} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{t.retry}</button></div>
        )}
        {!failed && !items && <p className="muted">{fr.common.loading}</p>}
        {items && items.length === 0 && <p className="muted">{t.empty}</p>}

        <ul className="qa-list">
          {(items ?? []).map((q) => (
            <li key={q.id} className="panel panel-pad qa-item">
              <h2 className="qa-title"><Link to={`/questions/${q.id}`}>{q.title}</Link></h2>
              <p className="qa-meta tiny muted">
                {q.solved && <span className="tag qa-solved">{t.solved}</span>}
                <span>{t.answers(q.answer_count)}</span>
                <span>{t.useful(q.vote_count)}</span>
                <span>{t.by(`@${q.author_username}`)}</span>
                <span>{new Date(q.created_at).toLocaleDateString(dateLocale())}</span>
              </p>
              {q.tags.length > 0 && <p className="qa-tags">{q.tags.map((x) => <button key={x} type="button" className="tag qa-tag" onClick={() => setTag(x)}>{x}</button>)}</p>}
            </li>
          ))}
        </ul>
        {more && <p><button type="button" className="btn" onClick={() => void loadMore()}>{t.more}</button></p>}
      </main>
    </AppShell>
  )
}
