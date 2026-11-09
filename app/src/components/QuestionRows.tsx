import { Link } from 'react-router-dom'
import { dateLocale } from '../i18n/lang'
import { fr } from '../i18n/fr'
import type { QuestionCard } from '../lib/api'

/** The list of questions: an answer-count tile, the title, tags, and who asked. Used on the big list and in a community's room. */
export function QuestionRows({ items, onTag, showCommunity = true }: { items: QuestionCard[]; onTag?: (tag: string) => void; showCommunity?: boolean }) {
  const t = fr.qa
  return (
    <ul className="panel qa-list">
      {items.map((q) => (
        <li key={q.id} className="qa-item">
          <div className={`qa-count ${q.solved ? 'qa-count-solved' : ''}`} aria-label={t.answers(q.answer_count)}>
            <strong>{q.answer_count}</strong>
            <span>{t.answerWord(q.answer_count)}</span>
          </div>
          <div className="qa-main">
            <h2 className="qa-title"><Link to={`/questions/${q.id}`}>{q.title}</Link></h2>
            {q.tags.length > 0 && (
              <p className="qa-tags">
                {q.tags.map((x) => onTag
                  ? <button key={x} type="button" className="chip qa-tag" onClick={() => onTag(x)}>{x}</button>
                  : <span key={x} className="chip qa-tag">{x}</span>)}
              </p>
            )}
            <p className="qa-meta tiny muted">
              {q.solved && <span className="tag qa-solved">{t.solved}</span>}
              {showCommunity && q.community_slug && <Link className="qa-community" to={`/communautes/${q.community_slug}`}>{q.community_name}</Link>}
              <span>{t.useful(q.vote_count)}</span>
              <span>{t.by(`@${q.author_username}`)}</span>
              <span>{new Date(q.created_at).toLocaleDateString(dateLocale())}</span>
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}
