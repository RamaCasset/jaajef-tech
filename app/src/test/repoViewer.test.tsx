import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
const api = vi.hoisted(() => ({ getProjectFull: vi.fn(), getRepoTree: vi.fn(), getRepoFile: vi.fn() }))
vi.mock('../lib/api', async () => {
  const real = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...real, getProjectFull: api.getProjectFull, getRepoTree: api.getRepoTree, getRepoFile: api.getRepoFile }
})
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: 'me', display_name: 'Moussa' } }, signOut: vi.fn() }),
}))

import { RepoViewer } from '../pages/RepoViewer'

const { GithubError } = actual
const project = { id: 'p1', title: 'Mon appli', github_owner: 'awa', github_repo: 'appli' }
const tree = (extra = {}) => ({
  branch: 'main', truncated: false,
  entries: [
    { path: 'src', type: 'tree', size: 0 },
    { path: 'src/main.py', type: 'blob', size: 40 },
    { path: 'README.md', type: 'blob', size: 20 },
    { path: 'logo.png', type: 'blob', size: 900 },
    { path: 'gros.txt', type: 'blob', size: 900000 },
  ],
  ...extra,
})
const mount = () => render(
  <MemoryRouter initialEntries={['/projets/p1/code']}>
    <Routes><Route path="/projets/:id/code" element={<RepoViewer />} /></Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  vi.resetAllMocks()
  api.getProjectFull.mockResolvedValue(project)
  api.getRepoTree.mockResolvedValue(tree())
  api.getRepoFile.mockResolvedValue('print("<b>bonjour</b>")\nfin')
})

describe('Repo viewer', () => {
  it('lists the files only (not folders) and the branch', async () => {
    mount()
    expect(await screen.findByRole('button', { name: 'src/main.py' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'README.md' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'src' })).toBeNull()
    expect(screen.getByText('Branche : main')).toBeInTheDocument()
    expect(api.getRepoTree).toHaveBeenCalledWith('awa', 'appli')
  })

  it('shows a file as plain text with its line count', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'src/main.py' }))
    expect(await screen.findByText(/print\("<b>bonjour<\/b>"\)/)).toBeInTheDocument()
    expect(screen.getByText('2 lignes')).toBeInTheDocument()
    expect(document.querySelector('pre b')).toBeNull()
    expect(api.getRepoFile).toHaveBeenCalledWith('awa', 'appli', 'main', 'src/main.py')
  })

  it('does not fetch images or files that are too big', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'logo.png' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ne peut pas être affiché')
    await userEvent.click(screen.getByRole('button', { name: 'gros.txt' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ne peut pas être affiché')
    expect(api.getRepoFile).not.toHaveBeenCalled()
  })

  it('says so when GitHub limits requests, and retries', async () => {
    api.getRepoTree.mockRejectedValueOnce(new GithubError('rate_limited'))
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('limite temporairement')
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('button', { name: 'README.md' })).toBeInTheDocument()
  })

  it('says a private or missing repository is not found', async () => {
    api.getRepoTree.mockRejectedValue(new GithubError('not_found'))
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('introuvable ou privé')
  })

  it('shows an error under the file when it cannot be loaded', async () => {
    api.getRepoFile.mockRejectedValue(new GithubError('failed'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'README.md' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de joindre GitHub')
  })

  it('warns when the repository is too big to list fully, and when it is empty', async () => {
    api.getRepoTree.mockResolvedValue(tree({ truncated: true }))
    const { unmount } = mount()
    expect(await screen.findByText(/seule une partie des fichiers/)).toBeInTheDocument()
    unmount()
    api.getRepoTree.mockResolvedValue({ branch: 'main', truncated: false, entries: [] })
    mount()
    expect(await screen.findByText('Ce dépôt est vide.')).toBeInTheDocument()
  })
})

describe('Repo viewer: GitHub calls', () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => String(body) }) as unknown as Response
  const bad = (status: number) => ({ ok: false, status }) as unknown as Response

  it('reads the default branch, then the tree', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(ok({ default_branch: 'dev' }))
      .mockResolvedValueOnce(ok({ truncated: false, tree: [{ path: 'a.py', type: 'blob', size: 3 }, { path: 'x', type: 'commit' }] }))
    const t = await actual.getRepoTree('awa', 'appli', f)
    expect(t).toEqual({ branch: 'dev', truncated: false, entries: [{ path: 'a.py', type: 'blob', size: 3 }] })
    expect(f.mock.calls[0][0]).toBe('https://api.github.com/repos/awa/appli')
    expect(f.mock.calls[1][0]).toBe('https://api.github.com/repos/awa/appli/git/trees/dev?recursive=1')
  })

  it('refuses odd names without calling GitHub', async () => {
    const f = vi.fn()
    await expect(actual.getRepoTree('awa/../x', 'appli', f)).rejects.toMatchObject({ code: 'not_found' })
    await expect(actual.getRepoFile('awa', 'appli', 'main', '../secret', f)).rejects.toMatchObject({ code: 'not_found' })
    expect(f).not.toHaveBeenCalled()
  })

  it('maps GitHub answers to clear errors', async () => {
    await expect(actual.getRepoTree('awa', 'appli', vi.fn().mockResolvedValue(bad(403)))).rejects.toMatchObject({ code: 'rate_limited' })
    await expect(actual.getRepoTree('awa', 'appli', vi.fn().mockResolvedValue(bad(404)))).rejects.toMatchObject({ code: 'not_found' })
    await expect(actual.getRepoTree('awa', 'appli', vi.fn().mockResolvedValue(bad(500)))).rejects.toMatchObject({ code: 'failed' })
    await expect(actual.getRepoTree('awa', 'appli', vi.fn().mockRejectedValue(new Error('net')))).rejects.toMatchObject({ code: 'failed' })
  })

  it('reads a file from the raw address with each part of the path encoded', async () => {
    const f = vi.fn().mockResolvedValue(ok('contenu'))
    const text = await actual.getRepoFile('awa', 'appli', 'main', 'src/mon fichier.py', f)
    expect(text).toBe('contenu')
    expect(f.mock.calls[0][0]).toBe('https://raw.githubusercontent.com/awa/appli/main/src/mon%20fichier.py')
  })

  it('decides which files can be shown', () => {
    expect(actual.isViewable({ path: 'a.py', type: 'blob', size: 10 })).toBe(true)
    expect(actual.isViewable({ path: 'a.png', type: 'blob', size: 10 })).toBe(false)
    expect(actual.isViewable({ path: 'a.py', type: 'blob', size: 300000 })).toBe(false)
    expect(actual.isViewable({ path: 'src', type: 'tree', size: 0 })).toBe(false)
  })
})
