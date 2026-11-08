import { useState } from 'react'
import { fr } from '../i18n/fr'
import { friendlyError } from '../lib/errors'
import { projectCoverUrl, saveProjectShowcase, uploadProjectCover } from '../lib/api'

/** For the project owner: the demo link and the cover image shown on the community page. */
export function ProjectShowcase({ projectId, userId, demoUrl, coverPath, onSaved }: {
  projectId: string; userId: string; demoUrl: string | null; coverPath: string | null; onSaved: () => void
}) {
  const t = fr.showcase
  const [demo, setDemo] = useState(demoUrl ?? '')
  const [cover, setCover] = useState<string | null>(coverPath)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function run(work: () => Promise<void>) {
    setMessage(null)
    setBusy(true)
    try {
      await work()
      setMessage({ ok: true, text: t.saved })
      onSaved()
    } catch (err) {
      const m = err instanceof Error ? err.message : ''
      setMessage({ ok: false, text: m === 'image-type' ? fr.editProfile.imageType : m === 'image-size' ? fr.editProfile.imageSize : friendlyError(err) })
    } finally {
      setBusy(false)
    }
  }

  const demoOk = demo.trim() === '' || /^https:\/\/\S+$/.test(demo.trim())

  return (
    <section className="panel panel-pad stack-gap" aria-label={t.title}>
      <h2>{t.title}</h2>
      <div className="picture-edit picture-edit-cover">
        <div className="picture-cover" style={cover ? { backgroundImage: `url(${projectCoverUrl(cover)})` } : undefined} aria-hidden="true" />
        <div>
          <p className="picture-label">{t.cover}</p>
          <div className="picture-actions">
            <label className="btn">
              {t.change}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label={t.cover} disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) void run(async () => { setCover(await uploadProjectCover(userId, projectId, file, demo)) })
                }} />
            </label>
            {cover && <button type="button" className="btn" disabled={busy} onClick={() => void run(async () => { await saveProjectShowcase(projectId, demo, null); setCover(null) })}>{t.remove}</button>}
          </div>
          <span className="hint">{t.coverHint}</span>
        </div>
      </div>
      <div className="field">
        <label htmlFor="sc-demo">{t.demoLabel}</label>
        <input id="sc-demo" type="url" inputMode="url" maxLength={300} placeholder="https://" value={demo} onChange={(e) => setDemo(e.target.value)} />
        <span className="hint">{demoOk ? t.demoHint : t.demoInvalid}</span>
      </div>
      {message && <div className={message.ok ? 'notice' : 'alert'} role={message.ok ? 'status' : 'alert'}>{message.text}</div>}
      <p><button type="button" className="btn btn-cta" disabled={busy || !demoOk} onClick={() => void run(() => saveProjectShowcase(projectId, demo, cover))}>{t.save}</button></p>
    </section>
  )
}
