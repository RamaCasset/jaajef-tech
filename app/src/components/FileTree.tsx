import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { fileUrl } from './ProjectFiles'

type Node = { name: string; path: string; folders: Node[]; files: Node[] }

function build(paths: string[]): Node {
  const root: Node = { name: '', path: '', folders: [], files: [] }
  for (const p of paths) {
    const parts = p.split('/')
    let at = root
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join('/')
      if (i === parts.length - 1) { at.files.push({ name, path, folders: [], files: [] }); return }
      let next = at.folders.find((f) => f.name === name)
      if (!next) { next = { name, path, folders: [], files: [] }; at.folders.push(next) }
      at = next
    })
  }
  const sort = (n: Node) => { n.folders.sort((a, b) => a.name.localeCompare(b.name)); n.files.sort((a, b) => a.name.localeCompare(b.name)); n.folders.forEach(sort) }
  sort(root)
  return root
}

const ancestors = (path: string) => path.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))

/** Folder tree of the repository: folders open and close, the open file is highlighted. */
export function FileTree({ projectId, paths, current, onNavigate }: { projectId: string; paths: string[]; current: string; onNavigate?: (ev: MouseEvent) => void }) {
  const root = useMemo(() => build(paths), [paths])
  const [open, setOpen] = useState<Set<string>>(() => new Set(ancestors(current)))
  useEffect(() => { setOpen((o) => new Set([...o, ...ancestors(current)])) }, [current])
  const toggle = (p: string) => setOpen((o) => { const n = new Set(o); if (n.has(p)) n.delete(p); else n.add(p); return n })

  const render = (n: Node, depth: number) => (
    <ul className="file-tree" role={depth === 0 ? undefined : 'group'}>
      {n.folders.map((f) => (
        <li key={f.path}>
          <button type="button" className="file-row file-folder" style={{ paddingLeft: 10 + depth * 14 }} aria-expanded={open.has(f.path)} onClick={() => toggle(f.path)}>
            <Icon name={open.has(f.path) ? 'chevron-down' : 'chevron-right'} size={14} />
            <span>{f.name}</span>
          </button>
          {open.has(f.path) && render(f, depth + 1)}
        </li>
      ))}
      {n.files.map((f) => (
        <li key={f.path}>
          <Link className={`file-row ${f.path === current ? 'file-row-on' : ''}`} style={{ paddingLeft: 10 + depth * 14 + 20 }} to={fileUrl(projectId, f.path)} onClick={onNavigate} aria-current={f.path === current ? 'page' : undefined} title={f.path}>{f.name}</Link>
        </li>
      ))}
    </ul>
  )
  return render(root, 0)
}
