import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fr } from '../i18n/fr'
import { listQuestions, type QuestionCard } from '../lib/api'
import { Icon } from './Icon'
import { QuestionRows } from './QuestionRows'

/** The "Questions" room of a community: the questions asked in it, and a button to ask one here. */
export function CommunityQuestions({ communityId, communitySlug }: { communityId: string; communitySlug: string }) {
  const t = fr.qa
  const [items, setItems] = useState<QuestionCard[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    setItems(null)
    setFailed(false)
    listQuestions({ community: communityId, limit: 50 })
      .then((rows) => { if (alive) setItems(rows) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [communityId, reload])

  return (
    <>
      <header className="chat-head">
        <div className="chat-head-title">
          <strong><span className="chat-hash"><Icon name="question" size={16} /></span> {t.room}</strong>
          <span className="muted tiny">{t.roomHint}</span>
        </div>
        <Link className="btn btn-cta btn-icon" to={`/questions/poser?communaute=${encodeURIComponent(communitySlug)}`}><Icon name="plus" size={14} /> {t.ask}</Link>
      </header>
      <div className="chat-messages">
        {failed && <div className="alert" role="alert">{t.loadFailed} <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>{t.retry}</button></div>}
        {!failed && !items && <p className="muted">{fr.common.loading}</p>}
        {items && items.length === 0 && <p className="muted">{t.roomEmpty}</p>}
        {items && items.length > 0 && <QuestionRows items={items} showCommunity={false} />}
      </div>
    </>
  )
}
