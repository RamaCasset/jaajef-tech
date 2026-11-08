import { describe, expect, it } from 'vitest'
import {
  PendingError, addText, addUpload, changeAt, discard, editText, isTaken, listChanges, markedPaths, removeFile, renameFile, serverFileCount, toServerFiles,
  type Pending,
} from '../lib/pending'

const tree = new Set(['README.md', 'main.py', 'src/util.py', 'logo.png'])
const none: Pending = {}
const code = (fn: () => unknown) => { try { fn() } catch (e) { return e instanceof PendingError ? e.code : 'other' } return null }

describe('Pending changes: editing', () => {
  it('records an edit, and forgets it when the text goes back to the original', () => {
    let p = editText(none, 'main.py', 'print(2)', 'print(1)')
    expect(listChanges(p)).toEqual([{ key: 'main.py', kind: 'edit', from: 'main.py', path: 'main.py', original: 'print(1)', text: 'print(2)' }])
    p = editText(p, 'main.py', 'print(3)', 'print(1)')
    expect(p['main.py'].text).toBe('print(3)')
    p = editText(p, 'main.py', 'print(1)', 'print(1)')
    expect(p).toEqual({})
    expect(editText(none, 'main.py', 'same', 'same')).toBe(none)
  })

  it('does not change the old set', () => {
    const p = editText(none, 'main.py', 'b', 'a')
    expect(none).toEqual({})
    editText(p, 'main.py', 'c', 'a')
    expect(p['main.py'].text).toBe('b')
  })
})

describe('Pending changes: new, deleted, renamed files', () => {
  it('adds a text file and an upload, and refuses a name that is taken or not valid', () => {
    let p = addText(none, tree, 'docs/guide.md', '# Guide')
    p = addUpload(p, tree, 'img/a.png', 'QUJD', 3)
    expect(listChanges(p).map((c) => [c.path, c.kind])).toEqual([['docs/guide.md', 'add'], ['img/a.png', 'add']])
    expect(code(() => addText(p, tree, 'main.py'))).toBe('exists')
    expect(code(() => addText(p, tree, 'docs/guide.md'))).toBe('exists')
    for (const bad of ['', '/x', 'x/', 'a//b', '../x', 'a/.git/b', 'a\\b']) expect(code(() => addText(p, tree, bad)), bad).toBe('bad_path')
    expect(editText(p, 'docs/guide.md', 'changed', '')['docs/guide.md'].text).toBe('changed')
  })

  it('deleting a new file forgets it, deleting an existing file marks it, and a deleted path can be used again', () => {
    let p = addText(none, tree, 'new.txt', 'x')
    expect(removeFile(p, 'new.txt')).toEqual({})
    p = removeFile(none, 'main.py')
    expect(listChanges(p)).toEqual([{ key: 'main.py', kind: 'delete', from: 'main.py', path: 'main.py' }])
    expect(isTaken(p, tree, 'main.py')).toBe(false)
    const again = addText(p, tree, 'main.py', 'fresh')
    expect(listChanges(again).map((c) => c.kind).sort()).toEqual(['add', 'delete'])
    expect(toServerFiles(again).length).toBe(2)
  })

  it('renames an existing file, keeping its edit, and renaming back cancels the change', () => {
    let p = renameFile(none, tree, 'main.py', 'app.py')
    expect(p['main.py']).toMatchObject({ kind: 'edit', from: 'main.py', path: 'app.py' })
    expect(changeAt(p, 'app.py')?.key).toBe('main.py')
    expect(isTaken(p, tree, 'main.py')).toBe(false)
    expect(isTaken(p, tree, 'app.py')).toBe(true)
    p = editText(p, 'app.py', 'new text', 'old text')
    expect(p['main.py']).toMatchObject({ path: 'app.py', text: 'new text' })
    expect(renameFile(p, tree, 'app.py', 'main.py')['main.py']).toMatchObject({ path: 'main.py', text: 'new text' })
    expect(renameFile(renameFile(none, tree, 'main.py', 'app.py'), tree, 'app.py', 'main.py')).toEqual({})
  })

  it('renames a new file by changing its path, and refuses a taken or invalid target', () => {
    const p = renameFile(addText(none, tree, 'a.txt', 'x'), tree, 'a.txt', 'b/a.txt')
    expect(listChanges(p)).toMatchObject([{ key: 'b/a.txt', kind: 'add', path: 'b/a.txt', text: 'x' }])
    expect(code(() => renameFile(none, tree, 'main.py', 'README.md'))).toBe('exists')
    expect(code(() => renameFile(none, tree, 'main.py', '../x'))).toBe('bad_path')
    expect(renameFile(none, tree, 'main.py', 'main.py')).toBe(none)
  })

  it('deleting a renamed file deletes the original path', () => {
    const p = removeFile(renameFile(none, tree, 'main.py', 'app.py'), 'app.py')
    expect(toServerFiles(p)).toEqual([{ path: 'main.py', delete: true }])
  })

  it('discards one change', () => {
    const p = editText(editText(none, 'a', '2', '1'), 'b', '2', '1')
    expect(Object.keys(discard(p, 'a'))).toEqual(['b'])
  })
})

describe('Pending changes: what is sent and what is shown', () => {
  it('sends one entry per file: edit, new text, upload, delete, move, and a move with new text as delete plus new file', () => {
    let p = editText(none, 'README.md', 'new readme', 'old')
    p = addText(p, tree, 'docs/a.md', 'hello')
    p = addUpload(p, tree, 'img/a.png', 'QUJD', 3)
    p = removeFile(p, 'logo.png')
    p = renameFile(p, tree, 'src/util.py', 'src/helpers.py')
    p = renameFile(p, tree, 'main.py', 'app.py')
    p = editText(p, 'app.py', 'edited', 'orig')
    expect(toServerFiles(p)).toEqual([
      { path: 'main.py', delete: true }, { path: 'app.py', content: 'edited' },
      { path: 'docs/a.md', content: 'hello' }, { path: 'img/a.png', content_base64: 'QUJD' },
      { path: 'logo.png', delete: true },
      { path: 'README.md', content: 'new readme' },
      { path: 'src/helpers.py', move_from: 'src/util.py' },
    ])
    expect(serverFileCount(p)).toBe(7)
  })

  it('marks the files in the list: new, edited, deleted, renamed (the old name disappears)', () => {
    let p = editText(none, 'README.md', 'x', 'y')
    p = addText(p, tree, 'docs/a.md')
    p = removeFile(p, 'logo.png')
    p = renameFile(p, tree, 'main.py', 'app.py')
    const { paths, marks } = markedPaths([...tree], p)
    expect(paths).toEqual(['app.py', 'docs/a.md', 'logo.png', 'README.md', 'src/util.py'])
    expect(marks).toEqual({ 'README.md': 'edited', 'docs/a.md': 'new', 'logo.png': 'deleted', 'app.py': 'renamed' })
  })
})
