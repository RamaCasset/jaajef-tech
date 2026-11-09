import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AddMenu } from './AddMenu'
import { Icon } from './Icon'
import { dateLocale } from '../i18n/lang'
import { fr } from '../i18n/fr'
import { EditorError, getLastCommits, GithubError, loadRepoTree, type LastCommit, type ProjectFull, type RepoEntry, type RepoTree } from '../lib/api'

const branchPart = (branch?: string | null) => (branch ? `&branche=${encodeURIComponent(branch)}` : '')
export const dirUrl = (id: string, dir: string, branch?: string | null) =>
  (dir || branch ? `/projets/${id}/code?dossier=${encodeURIComponent(dir)}${branchPart(branch)}` : `/projets/${id}`)
export const fileUrl = (id: string, path: string, branch?: string | null) => `/projets/${id}/code?fichier=${encodeURIComponent(path)}${branchPart(branch)}`
export const parentOf = (path: string) => path.split('/').slice(0, -1).join('/')
export const validName = (p: string) => p.length > 0 && p.length <= 200 && !p.startsWith('/') && !p.endsWith('/') && !p.includes('\\')
  && p.split('/').every((x) => x !== '' && x !== '.' && x !== '..' && x.toLowerCase() !== '.git')

/** The folders and files directly inside one folder: folders first, then files, each in alphabetical order. */
export function childrenOf(entries: RepoEntry[], dir: string): RepoEntry[] {
  const prefix = dir ? `${dir}/` : ''
  return entries
    .filter((e) => e.path.startsWith(prefix) && !e.path.slice(prefix.length).includes('/'))
    .sort((a, b) => (a.type === b.type ? a.path.localeCompare(b.path) : a.type === 'tree' ? -1 : 1))
}

/** `branch` is only given when it is not the main one: it is carried in every link and the commit columns are skipped. */
type Props = { project: ProjectFull; dir: string; canEdit: boolean; tree?: RepoTree | null; onTree?: (t: RepoTree) => void; branch?: string | null }

/** The list of files of a repository, like GitHub's: name, last commit message, last change. */
export function ProjectFiles({ project, dir, canEdit, tree: given, onTree, branch = null }: Props) {
  const t = fr.repoBrowser
  const navigate = useNavigate()
  const [own, setOwn] = useState<RepoTree | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [commits, setCommits] = useState<Record<string, LastCommit>>({})
  const picker = useRef<HTMLInputElement>(null)
  const tree = given ?? own

  useEffect(() => {
    if (given) return
    let alive = true
    loadRepoTree(project)
      .then((tr) => { if (alive) { setOwn(tr); onTree?.(tr) } })
      .catch((e) => { if (alive) setError(e instanceof GithubError ? fr.repoViewer.errors[e.code] : e instanceof EditorError ? (fr.editor.errors[e.code] ?? fr.editor.errors.unknown) : fr.repoViewer.errors.failed) })
    return () => { alive = false }
    // The tree is loaded once per project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, given])

  const rows = useMemo(() => childrenOf(tree?.entries ?? [], dir), [tree, dir])
  const wanted = rows.slice(0, 40).map((r) => r.path).join('\n')
  useEffect(() => {
    // The last-commit columns are read from GitHub's public side only.
    if (!wanted || project.repo_private || branch) return
    let alive = true
    // The last message and date are a convenience: when they cannot be loaded, the columns stay empty.
    getLastCommits(project.id, wanted.split('\n')).then((c) => { if (alive) setCommits(c) }).catch(() => undefined)
    return () => { alive = false }
  }, [project.id, project.repo_private, wanted, branch])

  const inDir = (n: string) => `${dir ? `${dir}/` : ''}${n}`

  // An upload is done in the editor, on the first file of this folder: the file travels with the navigation.
  function sendUpload(file: File | undefined) {
    if (!file) return
    const first = rows.find((r) => r.type === 'blob') ?? (tree?.entries ?? []).find((r) => r.type === 'blob')
    if (!first) return
    navigate(fileUrl(project.id, first.path, branch), { state: { upload: file } })
  }

  return (
    <>
    <div className="files-toolbar">
      <Link className="btn btn-small" to={`/projets/${project.id}/historique`}>{t.history}</Link>
      {canEdit && <Link className="btn btn-small" to={`/projets/${project.id}/propositions`}>{t.proposals}</Link>}
      {canEdit && (
        <>
          <AddMenu
            busy={false}
            folderName
            exists={(n) => (tree?.entries ?? []).some((x) => x.path === inDir(n))}
            onNewFile={(n) => navigate(`${fileUrl(project.id, inDir(n), branch)}&nouveau=1`)}
            onNewFolder={(n) => { if (n) navigate(`${fileUrl(project.id, inDir(`${n.replace(/\/+$/, '')}/.gitkeep`), branch)}&nouveau=1`) }}
            onUpload={() => picker.current?.click()}
          />
          <input ref={picker} type="file" hidden aria-label={fr.editor.upload} onChange={(e) => { sendUpload(e.target.files?.[0]); e.target.value = '' }} />
        </>
      )}
    </div>
    <section className="panel files-panel" aria-label={t.filesTitle}>
      <header className="files-head">
        <h2>{t.filesTitle}</h2>
      </header>
      {error && <p role="alert" className="alert files-pad">{error}</p>}
      {!tree && !error && <p className="muted files-pad">{fr.repoViewer.loading}</p>}
      {tree && tree.truncated && <p className="muted files-pad">{fr.repoViewer.truncated}</p>}
      {tree && (
        <table className="files-table">
          <thead>
            <tr><th scope="col">{t.colName}</th><th scope="col" className="files-msg">{t.colMessage}</th><th scope="col" className="files-date">{t.colDate}</th></tr>
          </thead>
          <tbody>
            {dir !== '' && (
              <tr>
                <td colSpan={3}><Link className="files-name" to={dirUrl(project.id, parentOf(dir), branch)} aria-label={t.parentDir}><Icon name="folder" size={18} /> ..</Link></td>
              </tr>
            )}
            {rows.map((r) => {
              const label = r.path.slice(dir ? dir.length + 1 : 0)
              const c = commits[r.path]
              return (
                <tr key={r.path}>
                  <td><Link className="files-name" to={r.type === 'tree' ? dirUrl(project.id, r.path, branch) : fileUrl(project.id, r.path, branch)}><Icon name={r.type === 'tree' ? 'folder' : 'file'} size={18} /> {label}</Link></td>
                  <td className="files-msg muted">{c?.message ?? ''}</td>
                  <td className="files-date muted">{c ? new Date(c.date).toLocaleDateString(dateLocale()) : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {tree && rows.length === 0 && <p className="muted files-pad">{tree.entries.length === 0 ? fr.repoViewer.empty : t.emptyDir}</p>}
    </section>
    </>
  )
}
