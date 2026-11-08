import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import { myApplicationFile, saveApplicationFile, type ApplicationFile as FileData, type Availability } from '../lib/api'

const AVAILABILITIES = Object.keys(fr.applicationFile.availabilities) as Availability[]
const KINDS = ['job', 'freelance'] as const

export function ApplicationFile() {
  const [file, setFile] = useState<FileData | null>(null)
  const [failed, setFailed] = useState(false)
  const [headline, setHeadline] = useState('')
  const [summary, setSummary] = useState('')
  const [location, setLocation] = useState('')
  const [years, setYears] = useState('')
  const [availability, setAvailability] = useState<Availability | ''>('')
  const [kinds, setKinds] = useState<('job' | 'freelance')[]>([])
  const [skills, setSkills] = useState('')
  const [website, setWebsite] = useState('')
  const [linkedin, setLinkedin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const fill = (f: FileData) => {
    setFile(f)
    setHeadline(f.headline ?? '')
    setSummary(f.summary ?? '')
    setLocation(f.location ?? '')
    setYears(f.experience_years === null ? '' : String(f.experience_years))
    setAvailability(f.availability ?? '')
    setKinds(f.work_kinds)
    setSkills(f.skills.join(', '))
    setWebsite(f.website ?? '')
    setLinkedin(f.linkedin_url ?? '')
  }

  const load = useCallback(() => {
    setFailed(false)
    myApplicationFile().then(fill).catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    setBusy(true)
    try {
      await saveApplicationFile({
        headline, summary, location,
        experience_years: years.trim() === '' ? null : Number(years),
        availability: availability || null,
        work_kinds: kinds,
        skills: skills.split(',').map((s) => s.trim()).filter(Boolean),
        website, linkedin_url: linkedin,
      })
      setSaved(true)
      myApplicationFile().then(fill).catch(() => undefined)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleKind = (k: 'job' | 'freelance') => setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]))

  return (
    <AppShell>
      <main className="page jobs">
        <header className="page-head">
          <h1 className="page-title">{fr.applicationFile.title}</h1>
          <p className="muted">{fr.applicationFile.subtitle}</p>
          <p><Link to="/dossier/cv-portfolio">{fr.cvPortfolio.link}</Link></p>
        </header>

        {failed && (
          <div className="alert" role="alert">
            {fr.applicationFile.loadFailed} <button type="button" className="btn" onClick={load}>{fr.applicationFile.retry}</button>
          </div>
        )}
        {!failed && !file && <p className="muted">{fr.common.loading}</p>}

        {file && (
          <form className="panel panel-pad" onSubmit={onSubmit} noValidate>
            <p><strong>{fr.applicationFile.completion(file.completion)}</strong></p>
            {file.missing.length > 0 && (
              <>
                <p className="muted tiny">{fr.applicationFile.missingTitle}</p>
                <ul className="tiny">
                  {file.missing.map((m) => <li key={m}>{fr.applicationFile.missing[m as keyof typeof fr.applicationFile.missing] ?? m}</li>)}
                </ul>
              </>
            )}
            {error && <div className="alert" role="alert">{error}</div>}
            {saved && <div className="notice" role="status">{fr.applicationFile.saved}</div>}

            <div className="field">
              <label htmlFor="headline">{fr.applicationFile.headline}</label>
              <input id="headline" maxLength={100} value={headline} onChange={(e) => setHeadline(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="summary">{fr.applicationFile.summary}</label>
              <textarea id="summary" rows={5} maxLength={1000} value={summary} onChange={(e) => setSummary(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="location">{fr.applicationFile.location}</label>
              <input id="location" maxLength={100} value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="years">{fr.applicationFile.years}</label>
              <input id="years" type="number" min={0} max={60} value={years} onChange={(e) => setYears(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="availability">{fr.applicationFile.availability}</label>
              <select id="availability" value={availability} onChange={(e) => setAvailability(e.target.value as Availability | '')}>
                <option value="">—</option>
                {AVAILABILITIES.map((a) => <option key={a} value={a}>{fr.applicationFile.availabilities[a]}</option>)}
              </select>
            </div>
            <fieldset className="field">
              <legend>{fr.applicationFile.workKinds}</legend>
              {KINDS.map((k) => (
                <label key={k} style={{ marginRight: 16 }}>
                  <input type="checkbox" checked={kinds.includes(k)} onChange={() => toggleKind(k)} /> {fr.jobs.kinds[k]}
                </label>
              ))}
            </fieldset>
            <div className="field">
              <label htmlFor="skills">{fr.applicationFile.skills}</label>
              <input id="skills" value={skills} onChange={(e) => setSkills(e.target.value)} />
              <span className="hint">{fr.applicationFile.skillsHint}</span>
            </div>
            <div className="field">
              <label htmlFor="website">{fr.applicationFile.website}</label>
              <input id="website" type="url" maxLength={300} value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="linkedin">{fr.applicationFile.linkedin}</label>
              <input id="linkedin" type="url" maxLength={300} value={linkedin} onChange={(e) => setLinkedin(e.target.value)} />
            </div>
            <p className="muted tiny">{fr.applicationFile.cvLater}</p>
            <button className="btn btn-cta" type="submit" disabled={busy}>{fr.applicationFile.save}</button>
          </form>
        )}
      </main>
    </AppShell>
  )
}
