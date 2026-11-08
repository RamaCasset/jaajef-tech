import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ getProjectFull: vi.fn(), loadHistory: vi.fn() }))
vi.mock('../lib/api', async () => {
  const real = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...real, ...api }
})
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: 'me', display_name: 'Moussa' } }, signOut: vi.fn() }),
}))
const { EditorError } = await vi.importActual<typeof import('../lib/api')>('../lib/api')

import { RepoHistory } from '../pages/RepoHistory'

const project = { id: 'p1', title: 'Mon appli', github_owner: 'awa', github_repo: 'appli', owner_id: 'u2', repo_private: true }
const commit = (n: number) => ({ sha: `${n}`.padStart(40, 'a'), message: `Modification ${n}`, author: 'Awa', date: '2026-11-0' + (n % 9 + 1) + 'T10:00:00Z', html_url: `https://github.com/awa/appli/commit/${n}` })
const mount = (url = '/projets/p1/historique') => render(
  <MemoryRouter initialEntries={[url]}><Routes><Route path="/projets/:id/historique" element={<RepoHistory />} /></Routes></MemoryRouter>,
)

beforeEach(() => {
  vi.resetAllMocks()
  api.getProjectFull.mockResolvedValue(project)
  api.loadHistory.mockResolvedValue({ commits: [commit(1), commit(2)], more: false })
})

describe('Change history', () => {
  it('lists the commits with author, date and a GitHub link, and goes back to the repository', async () => {
    mount()
    expect(await screen.findByText('Modification 1')).toBeInTheDocument()
    expect(api.loadHistory).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', repo_private: true }), { path: undefined, page: 1 })
    expect(screen.getAllByText(/par Awa/)).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: 'Voir sur GitHub' })[0]).toHaveAttribute('href', 'https://github.com/awa/appli/commit/1')
    expect(screen.getByRole('link', { name: '← Retour au dépôt' })).toHaveAttribute('href', '/projets/p1')
    expect(screen.queryByRole('button', { name: 'Voir plus' })).toBeNull()
  })

  it('shows the history of one file, with a way back to that file', async () => {
    mount('/projets/p1/historique?fichier=src%2Futil.py')
    expect(await screen.findByRole('heading', { name: 'Historique de src/util.py' })).toBeInTheDocument()
    expect(api.loadHistory).toHaveBeenCalledWith(expect.anything(), { path: 'src/util.py', page: 1 })
    expect(screen.getByRole('link', { name: '← Retour au dépôt' })).toHaveAttribute('href', '/projets/p1/code?fichier=src%2Futil.py')
  })

  it('loads more commits on request', async () => {
    api.loadHistory.mockResolvedValueOnce({ commits: [commit(1)], more: true }).mockResolvedValueOnce({ commits: [commit(2)], more: false })
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Voir plus' }))
    expect(await screen.findByText('Modification 2')).toBeInTheDocument()
    expect(screen.getByText('Modification 1')).toBeInTheDocument()
    expect(api.loadHistory).toHaveBeenLastCalledWith(expect.anything(), { path: undefined, page: 2 })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Voir plus' })).toBeNull())
  })

  it('says so when there is no change yet', async () => {
    api.loadHistory.mockResolvedValue({ commits: [], more: false })
    mount()
    expect(await screen.findByText('Aucune modification pour le moment.')).toBeInTheDocument()
  })

  it('explains a refusal from the GitHub app, and retries on request', async () => {
    api.loadHistory.mockRejectedValueOnce(new EditorError('repo_not_allowed'))
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent("L'application n'a pas accès à ce dépôt.")
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('Modification 1')).toBeInTheDocument()
  })

  it('says when the project cannot be seen', async () => {
    api.getProjectFull.mockResolvedValue(null)
    mount()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
