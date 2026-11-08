// The changes a member has made in the code editor and not saved yet: edited, new, deleted, renamed or moved files.
// Plain functions, no screen: each one returns a new set of changes and never touches the old one.
// A change is stored under its key: the original path for a file that exists on GitHub, the new path for a new file.

export type Change = {
  key: string
  kind: 'edit' | 'add' | 'delete'
  /** The path on GitHub now (null for a new file). */
  from: string | null
  /** The path after saving (the same as `from` unless the file is renamed or moved). */
  path: string
  /** The text on GitHub, for the "my changes" view (known once the file was opened). */
  original?: string
  /** The new text. Missing means the content is not changed (a rename, or an upload). */
  text?: string
  /** An uploaded file, as base64. */
  base64?: string
  size?: number
}
export type Pending = Record<string, Change>
export type ServerFile = { path: string; content?: string; content_base64?: string; delete?: boolean; move_from?: string }

export class PendingError extends Error {
  code: 'exists' | 'bad_path' | 'too_many'
  constructor(code: PendingError['code']) {
    super(code)
    this.code = code
  }
}

export const MAX_SERVER_FILES = 20
export const MAX_UPLOAD_BYTES = 1_000_000

export const badPath = (p: string) => !(p.length > 0 && p.length <= 200 && !p.startsWith('/') && !p.endsWith('/') && !p.includes('\\') && !p.includes('\0')
  && p.split('/').every((x) => x !== '' && x !== '.' && x !== '..' && x.toLowerCase() !== '.git'))

/** The change that gives this file its current path (so a renamed file is found under its new name). */
export function changeAt(p: Pending, path: string): Change | undefined {
  return Object.values(p).find((c) => c.path === path && c.kind !== 'delete')
}

/** True when something already lives at that path, on GitHub or in the changes. */
export function isTaken(p: Pending, treePaths: Set<string>, path: string): boolean {
  if (Object.values(p).some((c) => c.kind !== 'delete' && c.path === path)) return true
  if (!treePaths.has(path)) return false
  // On GitHub, but maybe deleted or moved away by a change.
  return !Object.values(p).some((c) => c.from === path && (c.kind === 'delete' || c.path !== path))
}

function without(p: Pending, key: string): Pending {
  const next = { ...p }
  delete next[key]
  return next
}

/** The text of a file was edited. `original` is its text on GitHub. */
export function editText(p: Pending, path: string, text: string, original: string): Pending {
  const c = changeAt(p, path)
  if (c) {
    if (c.kind === 'add') return { ...p, [c.key]: { ...c, text } }
    if (text === original && c.path === c.from) return without(p, c.key)
    return { ...p, [c.key]: { ...c, text: text === original ? undefined : text, original } }
  }
  if (text === original) return p
  return { ...p, [path]: { key: path, kind: 'edit', from: path, path, original, text } }
}

function addAny(p: Pending, treePaths: Set<string>, path: string, rest: Partial<Change>): Pending {
  if (badPath(path)) throw new PendingError('bad_path')
  if (isTaken(p, treePaths, path)) throw new PendingError('exists')
  // A file deleted earlier at that same path comes back as an edit would be confusing: it is simply a new file.
  const key = p[path] ? `new:${path}` : path
  return { ...p, [key]: { key, kind: 'add', from: null, path, ...rest } }
}
export const addText = (p: Pending, treePaths: Set<string>, path: string, text = '') => addAny(p, treePaths, path, { text })
export const addUpload = (p: Pending, treePaths: Set<string>, path: string, base64: string, size: number) => addAny(p, treePaths, path, { base64, size })

/** Delete the file that has this path now. A new file is simply forgotten. */
export function removeFile(p: Pending, path: string): Pending {
  const c = changeAt(p, path)
  if (!c) return { ...p, [path]: { key: path, kind: 'delete', from: path, path } }
  if (c.kind === 'add') return without(p, c.key)
  return { ...p, [c.key]: { key: c.key, kind: 'delete', from: c.from, path: c.from ?? path, original: c.original } }
}

/** Rename or move the file that has this path now. */
export function renameFile(p: Pending, treePaths: Set<string>, from: string, to: string): Pending {
  if (from === to) return p
  if (badPath(to)) throw new PendingError('bad_path')
  if (isTaken(p, treePaths, to)) throw new PendingError('exists')
  const c = changeAt(p, from)
  if (!c) return { ...p, [from]: { key: from, kind: 'edit', from, path: to } }
  if (c.kind === 'add') {
    const next = without(p, c.key)
    return { ...next, [to]: { ...c, key: to, path: to } }
  }
  const moved = { ...c, path: to }
  // Back to where it started with nothing else changed: nothing to save.
  if (moved.path === moved.from && moved.text === undefined) return without(p, c.key)
  return { ...p, [c.key]: moved }
}

/** Forget one change (the file goes back to what GitHub has). */
export const discard = (p: Pending, key: string): Pending => without(p, key)

/** The changes in the order they are shown: by path. */
export const listChanges = (p: Pending): Change[] => Object.values(p).sort((a, b) => a.path.localeCompare(b.path))

/** What to send to the server: one entry per file, except a rename with new text which is a delete plus a new file. */
export function toServerFiles(p: Pending): ServerFile[] {
  const out: ServerFile[] = []
  for (const c of listChanges(p)) {
    if (c.kind === 'delete') out.push({ path: c.from ?? c.path, delete: true })
    else if (c.kind === 'add') out.push(c.base64 !== undefined ? { path: c.path, content_base64: c.base64 } : { path: c.path, content: c.text ?? '' })
    else if (c.path === c.from) out.push({ path: c.path, content: c.text ?? '' })
    else if (c.text === undefined) out.push({ path: c.path, move_from: c.from ?? '' })
    else out.push({ path: c.from ?? '', delete: true }, { path: c.path, content: c.text })
  }
  return out
}

export const serverFileCount = (p: Pending) => toServerFiles(p).length

/** How each path should look in the file list: new, edited, deleted or renamed. */
export type Mark = 'new' | 'edited' | 'deleted' | 'renamed'
export function markedPaths(treePaths: string[], p: Pending): { paths: string[]; marks: Record<string, Mark> } {
  const marks: Record<string, Mark> = {}
  const shown = new Set(treePaths)
  for (const c of Object.values(p)) {
    if (c.kind === 'delete') { marks[c.from ?? c.path] = 'deleted'; continue }
    if (c.kind === 'add') { shown.add(c.path); marks[c.path] = 'new'; continue }
    if (c.path !== c.from) { shown.delete(c.from ?? ''); shown.add(c.path); marks[c.path] = 'renamed'; continue }
    marks[c.path] = 'edited'
  }
  return { paths: [...shown].sort((a, b) => a.localeCompare(b)), marks }
}
