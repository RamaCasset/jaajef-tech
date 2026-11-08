import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MyRepo } from '../lib/api'

const api = vi.hoisted(() => ({
  listMyRepos: vi.fn(), setProjectPinned: vi.fn(), setProjectVisibility: vi.fn(), loadProfile: vi.fn(),
  countMyStars: vi.fn(), getNextBadge: vi.fn(), listMyStarred: vi.fn(),
}))
vi.mock('../lib/api', () => api)
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: 'me', username: 'moussa', display_name: 'Moussa Diop' } }, signOut: vi.fn() }),
}))

import { MyRepos } from '../pages/MyRepos'
import { MyStars } from '../pages/MyStars'

const repo = (n: number, extra: Partial<MyRepo> = {}): MyRepo => ({
  id: `r${n}`, github_owner: 'moussa', github_repo: `depot-${n}`, title: `Depot ${n}`, summary: `Résumé ${n}`, language: 'Python',
  github_stars: n, star_count: 0, github_forks: 2, github_pushed_at: new Date(Date.now() - n * 3600e3).toISOString(),
  updated_at: new Date().toISOString(), is_public: true, verified_at: '2026-01-01', build_status: null, pinned_at: null, ...extra,
})

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.listMyRepos.mockResolvedValue([
    repo(1, { pinned_at: '2026-02-01T00:00:00Z', build_status: 'passing' }), repo(2, { language: 'TypeScript' }), repo(3, { is_public: false }),
    repo(4), repo(5), repo(6), repo(7), repo(8, { verified_at: null }),
  ])
  api.setProjectPinned.mockResolvedValue(undefined)
  api.setProjectVisibility.mockResolvedValue(undefined)
  api.loadProfile.mockResolvedValue({
    profile: { id: 'me', username: 'moussa', display_name: 'Moussa Diop', headline: 'Dev à Dakar', avatar_url: null, banner_url: null, bio: 'Je code.', location: 'Dakar', github_username: 'moussa', clan: null, mastery: 'bagne', xp: 25000, is_verified: false, available_to_collab: true, created_at: '2024-03-01T00:00:00Z' },
    xpPerLevel: 10000, badges: [], projects: [], questsSolved: 3, appreciation: 0,
  })
  api.countMyStars.mockResolvedValue(32)
  api.getNextBadge.mockResolvedValue({ slug: 'l_architecte', name: "L'Architecte", description: null, progress: 14, threshold: 20 })
  api.listMyStarred.mockResolvedValue([])
})

const mount = (ui = <MyRepos />) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('My repositories', () => {
  it('shows the counts, the pinned repositories apart, and the others in a list', async () => {
    mount()
    expect(await screen.findByRole('heading', { name: /Mes dépôts/ })).toBeInTheDocument()
    expect(await screen.findByText('7 publics')).toBeInTheDocument()
    expect(screen.getByText('1 privé')).toBeInTheDocument()
    expect(screen.getByText('1 épinglé')).toBeInTheDocument()
    const pinned = screen.getByRole('heading', { name: /Dépôts épinglés/ }).closest('section')!
    expect(within(pinned).getByRole('link', { name: 'depot-1' })).toHaveAttribute('href', '/projets/r1')
    expect(within(pinned).getByText('Build OK')).toBeInTheDocument()
    const others = screen.getByRole('heading', { name: /Autres dépôts/ }).closest('section')!
    expect(within(others).queryByRole('link', { name: 'depot-1' })).toBeNull()
    expect(within(others).getAllByRole('listitem')).toHaveLength(6)
    expect(within(others).getByText('1–6 sur 7 autres dépôts')).toBeInTheDocument()
  })

  it('marks private and unconfirmed repositories', async () => {
    mount()
    await screen.findByText('7 publics')
    await userEvent.click(screen.getByRole('button', { name: 'Page 2' }))
    expect(screen.getByText('En attente de confirmation')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Visibilité'), 'private')
    expect(screen.getByText('Privé', { selector: '.tag' })).toBeInTheDocument()
  })

  it('searches, filters by language, and says when nothing matches', async () => {
    mount()
    await screen.findByText('7 publics')
    await userEvent.selectOptions(screen.getByLabelText('Langage'), 'TypeScript')
    const others = screen.getByRole('heading', { name: /Autres dépôts/ }).closest('section')!
    expect(within(others).getAllByRole('listitem')).toHaveLength(1)
    await userEvent.type(screen.getByLabelText('Rechercher'), 'zzz')
    expect(screen.getByText('Aucun dépôt ne correspond à votre recherche.')).toBeInTheDocument()
  })

  it('goes to the next page', async () => {
    mount()
    await screen.findByText('7 publics')
    await userEvent.click(screen.getByRole('button', { name: 'Suivant' }))
    expect(screen.getByText('7–7 sur 7 autres dépôts')).toBeInTheDocument()
  })

  it('pins a repository, and unpins one, then reloads the list', async () => {
    mount()
    await screen.findByText('7 publics')
    await userEvent.click(screen.getAllByRole('button', { name: 'Actions pour depot-2' })[0])
    await userEvent.click(screen.getByRole('menuitem', { name: 'Épingler' }))
    await waitFor(() => expect(api.setProjectPinned).toHaveBeenCalledWith('r2', true))
    await waitFor(() => expect(api.listMyRepos).toHaveBeenCalledTimes(2))
    await userEvent.click(screen.getByRole('button', { name: 'Actions pour depot-1' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Désépingler' }))
    await waitFor(() => expect(api.setProjectPinned).toHaveBeenCalledWith('r1', false))
  })

  it('makes a repository private or public', async () => {
    mount()
    await screen.findByText('7 publics')
    await userEvent.click(screen.getByRole('button', { name: 'Actions pour depot-2' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rendre privé' }))
    await waitFor(() => expect(api.setProjectVisibility).toHaveBeenCalledWith('r2', false))
  })

  it('shows a refusal, for example when too many are pinned', async () => {
    api.setProjectPinned.mockRejectedValue(new Error('You can pin 3 projects at most'))
    mount()
    await screen.findByText('7 publics')
    await userEvent.click(screen.getByRole('button', { name: 'Actions pour depot-2' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Épingler' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('shows the profile card, the menu with counts, and the next badge', async () => {
    mount()
    expect(await screen.findByText('Moussa Diop')).toBeInTheDocument()
    expect(screen.getByText('NIV. 3')).toBeInTheDocument()
    const menu = screen.getByRole('navigation', { name: 'Menu de la page' })
    expect(within(menu).getByRole('link', { name: /Étoiles/ })).toHaveAttribute('href', '/depots/etoiles')
    expect(await within(menu).findByText('32')).toBeInTheDocument()
    expect(await screen.findByText('14 / 20. Encore 6 pour le débloquer.')).toBeInTheDocument()
  })

  it('has the switch to the community projects', async () => {
    mount()
    const toggle = await screen.findByRole('navigation', { name: 'Affichage des projets' })
    expect(within(toggle).getByRole('link', { name: 'Communauté' })).toHaveAttribute('href', '/projets')
    expect(within(toggle).getByRole('link', { name: 'Espace personnel' })).toHaveAttribute('aria-current', 'page')
  })

  it('offers a retry when loading fails, and an empty message when there is nothing', async () => {
    api.listMyRepos.mockRejectedValueOnce(new Error('down'))
    const a = mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('7 publics')).toBeInTheDocument()
    a.unmount()
    api.listMyRepos.mockResolvedValue([])
    mount()
    expect(await screen.findByText("Vous n'avez pas encore de dépôt ici.")).toBeInTheDocument()
  })
})

describe('My starred projects', () => {
  it('lists the projects I starred, or says there are none', async () => {
    api.listMyStarred.mockResolvedValue([{ id: 's1', github_owner: 'awa', github_repo: 'wolof-llm', title: 'Wolof', summary: 'Un modèle', language: 'Python', github_stars: 186, github_forks: 24, github_pushed_at: null, is_public: true, verified_at: '2026-01-01', owner_username: 'awa' }])
    const a = mount(<MyStars />)
    expect(await screen.findByRole('link', { name: 'wolof-llm' })).toHaveAttribute('href', '/projets/s1')
    expect(screen.getByText('par awa')).toBeInTheDocument()
    a.unmount()
    api.listMyStarred.mockResolvedValue([])
    mount(<MyStars />)
    expect(await screen.findByText("Vous n'avez encore étoilé aucun projet.")).toBeInTheDocument()
  })
})
