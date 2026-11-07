import { Link } from 'react-router-dom'
import type { JobOffer } from '../lib/api'
import { fr } from '../i18n/fr'

type Props = { job: JobOffer; saved: boolean; busy: boolean; onToggleSave: () => void }

export function JobCard({ job, saved, busy, onToggleSave }: Props) {
  const place = [job.location, fr.jobs.remotes[job.remote]].filter(Boolean).join(' · ')
  const contract = job.employment_type ? fr.jobs.contracts[job.employment_type as keyof typeof fr.jobs.contracts] : fr.jobs.kinds.freelance
  const hasPay = job.pay_min_fcfa !== null || job.pay_max_fcfa !== null
  return (
    <article className="panel job-card">
      <div className="job-logo" aria-hidden="true">{job.employer_name.slice(0, 2).toLowerCase()}</div>
      <div className="job-main">
        <h3><Link to={`/jobs/${job.id}`}>{job.title}</Link></h3>
        <p className="muted">{job.employer_name} · {place}</p>
        <div className="project-tags">
          <span className="tag">{contract}</span>
          {job.tags.map((t) => <span key={t} className="tag">{t}</span>)}
        </div>
        <p className="mono tiny">
          {hasPay ? fr.jobs.payRange(job.pay_min_fcfa, job.pay_max_fcfa, job.pay_unit) : job.pay_negotiable ? fr.jobs.negotiable : ''}
          {hasPay && job.pay_negotiable ? ` · ${fr.jobs.negotiable}` : ''}
          {job.closes_on ? `${hasPay || job.pay_negotiable ? ' · ' : ''}${fr.jobs.closes(new Date(job.closes_on).toLocaleDateString('fr-FR'))}` : ''}
        </p>
      </div>
      <button type="button" className="btn" disabled={busy} aria-pressed={saved} onClick={onToggleSave}
        aria-label={`${saved ? fr.jobs.unsave : fr.jobs.save} : ${job.title}`}>{saved ? '★' : '☆'}</button>
    </article>
  )
}
