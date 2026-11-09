import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { Icon } from '../components/Icon'
import { QuestionRows } from '../components/QuestionRows'
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
      <main className="page notices-page">
        <header className="page-head-row">
          <div>
            <p className="eyebrow">{t.eyebrow}</p>
            <h1 className="page-title">{t.title}</h1>
            <p className="muted">{t.subtitle}</p>
          </div>
          <Link className="btn btn-cta btn-icon" to="/questions/poser"><Icon name="plus" size={16} /> {t.ask}</Link>
        </header>

        <div className="notice-search-row">
          <label className="notice-search">
            <Icon name="search" size={16} />
            <input id="qa-tag" type="search" placeholder={t.searchPlaceholder} aria-label={t.tagFilter} value={tag} onChange={(e) => setTag(e.target.value)} />
          </label>
          <select aria-label={t.sortLabel} value={sort} onChange={(e) => setSort(e.target.value as QuestionSort)}>
            {(['recent', 'useful'] as const).map((k) => <option key={k} value={k}>{t.sorts[k]}</option>)}
          </select>
        </div>
        <div className="notice-filters" role="group" aria-label={t.filterLabel}>
          {(['all', 'open', 'solved'] as const).map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{t.filters[k]}</button>
          ))}
        </div>

        <div className="notices-layout">
          <div>
            {failed && (
              <div className="alert" role="alert">{t.loadFailed} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{t.retry}</button></div>
            )}
            {!failed && !items && <p className="muted">{fr.common.loading}</p>}
            {items && items.length === 0 && <section className="panel panel-pad"><p className="muted">{t.empty}</p></section>}

            {items && items.length > 0 && <QuestionRows items={items} onTag={setTag} />}
            {more && <p><button type="button" className="btn" onClick={() => void loadMore()}>{t.more}</button></p>}
          </div>

          <aside className="notices-side">
            <section className="panel side-card" aria-label={t.howTitle}>
              <h2 className="side-title">{t.howTitle}</h2>
              <ol className="qa-steps">
                <li>{t.how1}</li>
                <li>{t.how2}</li>
                <li>{t.how3}</li>
              </ol>
              <Link className="btn btn-cta" to="/questions/poser">{t.ask}</Link>
            </section>
          </aside>
        </div>
      </main>
    </AppShell>
  )
}
