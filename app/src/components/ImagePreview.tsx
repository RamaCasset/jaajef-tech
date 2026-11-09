import { useEffect, useState } from 'react'
import { editorBlob, imageMime, rawFileUrl } from '../lib/api'
import { fr } from '../i18n/fr'

/** Shows an image of the repository. A public repository is read straight from GitHub; a private one goes through the editor function. */
export function ImagePreview({ projectId, owner, repo, isPrivate, branch, path, base64 }: {
  projectId: string; owner: string; repo: string; isPrivate: boolean; branch: string; path: string; base64?: string
}) {
  const mime = imageMime(path)
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
    if (!mime) { setFailed(true); return }
    if (base64 !== undefined) { setSrc(`data:${mime};base64,${base64}`); return }
    if (!isPrivate) { setSrc(rawFileUrl(owner, repo, branch, path)); return }
    let alive = true
    setSrc(null)
    editorBlob(projectId, path, branch).then((r) => { if (alive) setSrc(`data:${mime};base64,${r.content_base64}`) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [projectId, owner, repo, isPrivate, branch, path, base64, mime])
  if (failed) return <p role="alert" className="alert editor-pad">{fr.editor.imageFailed}</p>
  if (!src) return <p className="muted editor-pad">{fr.repoViewer.loading}</p>
  return <div className="image-preview"><img src={src} alt={fr.editor.imageAlt(path)} onError={() => setFailed(true)} /></div>
}
