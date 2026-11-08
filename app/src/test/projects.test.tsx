import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectRow } from '../lib/api'

const searchProjects = vi.fn()
const calledWith = (part: Record<string, unknown>) =>
  searchProjects.mock.calls.some((c) => Object.entries(part).every(([k, v]) => (c[0] as Record<string, unknown>)[k] === v))
const trendingCreators = vi.fn()
const projectLanguages = vi.fn()
const listGoodFirstIssues = vi.fn()
const buildStatuses = vi.fn()
const projectContributors = vi.fn()

vi.mock('../lib/api', () => ({
  searchProjects: (...a: unknown[]) => searchProjects(...a),
  trendingCreators: (...a: unknown[]) => trendingCreators(...a),
  projectLanguages: (...a: unknown[]) => projectLanguages(...a),
  listGoodFirstIssues: (...a: unknown[]) => listGoodFirstIssues(...a),
  buildStatuses: (...a: unknown[]) => buildStatuses(...a),
  projectContributors: (...a: unknown[]) => projectContributors(...a),
  projectCoverUrl: (p: string | null) => (p ? `https://img.test/${p}` : null),
  REGION_KEYS: ['dakar', 'thies', 'diaspora'],
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 100, profile: { display_name: 'Moussa Diop' } }, signOut: vi.fn() }),
}))

import { Projects } from '../pages/Projects'

const project = (n: number, extra: Partial<ProjectRow> = {}): ProjectRow => ({
  project_id: `p${n}`, title: `Projet ${n}`, summary: `Résumé ${n}`, github_owner: 'ndar', github_repo: `repo-${n}`,
  language: 'Python', tags: [], github_stars: 10, star_count: 2, comment_count: 0, collaborator_count: 0, is_featured: false,
  verified_at: '2026-01-01', owner_id: 'o1', owner_username: 'awa', owner_display_name: 'Awa Diallo', owner_avatar_url: null,
  owner_clan: 'forgeron', demo_url: null, cover_path: null, github_forks: 18, github_pushed_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), owner_region: 'dakar', ...extra,
})

function mount() {
  return render(<MemoryRouter><Projects /></MemoryRouter>)
}

beforeEach(() => {
  for (const m of [searchProjects, trendingCreators, projectLanguages, listGoodFirstIssues, buildStatuses, projectContributors]) m.mockReset()
  searchProjects.mockImplementation(async (_f, opts) => (opts?.featuredOnly ? [project(0, { github_repo: 'open-city', is_featured: true })] : [project(1), project(2)]))
  trendingCreators.mockResolvedValue([{ user_id: 'u1', username: 'awa', display_name: 'Awa Diallo', avatar_url: null, clan: 'forgeron', contributions: 248 }])
  projectLanguages.mockResolvedValue([{ language: 'Python', project_count: 2 }, { language: 'TypeScript', project_count: 1 }])
  listGoodFirstIssues.mockResolvedValue([])
  buildStatuses.mockResolvedValue({ p1: 'passing' })
  projectContributors.mockResolvedValue([
    { project_id: 'p1', user_id: 'o1', username: 'awa', display_name: 'Awa Diallo', avatar_url: null },
    { project_id: 'p1', user_id: 'o2', username: 'bara', display_name: 'Bara Ndiaye', avatar_url: null },
  ])
})

describe('Projects page', () => {
  it('shows the featured project, the list, the count, trending creators and build badges', async () => {
    mount()
    expect(await screen.findByRole('heading', { name: 'ndar / open-city' })).toBeInTheDocument()
    expect(await screen.findByText('repo-1')).toBeInTheDocument()
    expect(screen.getByText('repo-2')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'repo-1' })).toHaveAttribute('href', '/projets/p1')
    expect(screen.getByText(/2 projets/)).toBeInTheDocument()
    expect(await screen.findByText('Build OK')).toBeInTheDocument()
    const trending = screen.getByRole('heading', { name: 'Créateurs en tendance' }).closest('section')!
    expect(within(trending).getByText('Awa Diallo')).toBeInTheDocument()
    expect(within(trending).getByText('248')).toBeInTheDocument()
  })

  it('has a button that leads to the page for adding a project', async () => {
    mount()
    expect(screen.getByRole('link', { name: 'Ajouter un dépôt' })).toHaveAttribute('href', '/projets/ajouter')
  })

  it('searches after typing stops, passing the text to the database', async () => {
    mount()
    await screen.findByText('repo-1')
    const slow = userEvent.setup({ delay: 60 })
    await slow.type(screen.getByRole('searchbox'), 'wolof')
    await waitFor(() => expect(calledWith({ query: 'wolof' })).toBe(true), { timeout: 2000 })
    const withText = searchProjects.mock.calls.filter((c) => c[0].query === 'wolof')
    expect(withText.length).toBe(1)
    const partial = searchProjects.mock.calls.filter((c) => c[0].query && c[0].query !== 'wolof')
    expect(partial).toEqual([]) // not one call per letter
  })

  it('filters by language, by clan and by sort', async () => {
    mount()
    await screen.findByText('repo-1')
    await screen.findByRole('option', { name: /TypeScript/ })
    await userEvent.selectOptions(screen.getByLabelText('Langage'), 'TypeScript')
    await waitFor(() => expect(calledWith({ language: 'TypeScript' })).toBe(true))
    await userEvent.selectOptions(screen.getByLabelText('Clan'), 'forgeron')
    await waitFor(() => expect(calledWith({ clan: 'forgeron', language: 'TypeScript' })).toBe(true))
    await userEvent.selectOptions(screen.getByLabelText('Trier'), 'stars')
    await waitFor(() => expect(calledWith({ sort: 'stars' })).toBe(true))
  })

  it('shows a friendly message when nothing matches', async () => {
    searchProjects.mockImplementation(async (_f, opts) => (opts?.featuredOnly ? [] : []))
    mount()
    expect(await screen.findByText('Aucun projet ne correspond à ta recherche.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /open-city/ })).not.toBeInTheDocument()
  })

  it('shows an error with a retry button, and retry loads the list', async () => {
    let fail = true
    searchProjects.mockImplementation(async (_f, opts) => {
      if (opts?.featuredOnly) return []
      if (fail) throw new Error('boom')
      return [project(1)]
    })
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de charger les projets')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('repo-1')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not let a slow old answer replace a newer one', async () => {
    let releaseOld: (rows: ProjectRow[]) => void = () => undefined
    const old = new Promise<ProjectRow[]>((resolve) => { releaseOld = resolve })
    let call = 0
    searchProjects.mockImplementation(async (f, opts) => {
      if (opts?.featuredOnly) return []
      call++
      if (call === 1) return old // the first list request stays pending
      return [project(9, { github_repo: f.language ? 'new-answer' : 'other' })]
    })
    mount()
    await screen.findByRole('option', { name: /Python/ })
    await userEvent.selectOptions(screen.getByLabelText('Langage'), 'Python')
    expect(await screen.findByText('new-answer')).toBeInTheDocument()
    releaseOld([project(1, { github_repo: 'stale-answer' })])
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('stale-answer')).not.toBeInTheDocument()
    expect(screen.getByText('new-answer')).toBeInTheDocument()
  })

  it('keeps the page working when a side block fails to load', async () => {
    trendingCreators.mockRejectedValue(new Error('x'))
    listGoodFirstIssues.mockRejectedValue(new Error('x'))
    projectLanguages.mockRejectedValue(new Error('x'))
    mount()
    expect(await screen.findByText('repo-1')).toBeInTheDocument()
    expect(await screen.findByText("Pas encore d'activité cette semaine.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Good first issues' })).toBeDisabled()
  })

  it('opens the good first issues with links to GitHub', async () => {
    listGoodFirstIssues.mockResolvedValue([
      { issue_id: 1, project_id: 'p1', github_owner: 'ndar', github_repo: 'repo-1', project_title: 'Projet 1', language: 'Python', issue_number: 12, title: 'Corriger la faute', url: 'https://github.com/ndar/repo-1/issues/12', comments: 2, created_on: '2026-01-01', owner_username: 'awa', owner_clan: 'forgeron' },
      { issue_id: 2, project_id: 'p1', github_owner: 'ndar', github_repo: 'repo-1', project_title: 'Projet 1', language: 'Python', issue_number: 13, title: 'Ajouter un test', url: 'https://github.com/ndar/repo-1/issues/13', comments: 0, created_on: '2026-01-01', owner_username: 'awa', owner_clan: 'forgeron' },
    ])
    mount()
    await screen.findByText('repo-1')
    expect(await screen.findByText('1 projet cherche un premier contributeur.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Good first issues' }))
    const panel = screen.getByRole('region', { name: 'Bonnes premières issues' })
    const link = within(panel).getByRole('link', { name: 'Corriger la faute' })
    expect(link).toHaveAttribute('href', 'https://github.com/ndar/repo-1/issues/12')
    expect(within(panel).getByText(/2 commentaires/)).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Fermer' }))
    expect(screen.queryByRole('region', { name: 'Bonnes premières issues' })).not.toBeInTheDocument()
  })

  it('shows forks, last update and the people on a project', async () => {
    mount()
    expect((await screen.findAllByLabelText('18 forks')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText(/Mis à jour il y a 2 heures/)).length).toBeGreaterThan(0)
    expect(await screen.findByRole('img', { name: 'Sur ce projet : Awa Diallo, Bara Ndiaye' })).toBeInTheDocument()
  })

  it('filters by region', async () => {
    mount()
    await screen.findByText('repo-1')
    await userEvent.selectOptions(screen.getByLabelText('Région'), 'thies')
    await waitFor(() => expect(calledWith({ region: 'thies' })).toBe(true))
  })

  it('offers the live demo of the featured project, in a new tab, only when there is a link', async () => {
    searchProjects.mockImplementation(async (_f, opts) => (opts?.featuredOnly ? [project(0, { github_repo: 'open-city', is_featured: true, demo_url: 'https://demo.exemple.sn/jeu' })] : [project(1)]))
    mount()
    const link = await screen.findByRole('link', { name: /Tester la démo en live/ })
    expect(link).toHaveAttribute('href', 'https://demo.exemple.sn/jeu')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('shows no demo button without a link', async () => {
    mount()
    await screen.findByRole('heading', { name: 'ndar / open-city' })
    expect(screen.queryByRole('link', { name: /Tester la démo en live/ })).toBeNull()
  })

  it('has the switch to my personal space', async () => {
    mount()
    const toggle = await screen.findByRole('navigation', { name: 'Affichage des projets' })
    expect(within(toggle).getByRole('link', { name: 'Espace personnel' })).toHaveAttribute('href', '/depots')
    expect(within(toggle).getByRole('link', { name: 'Communauté' })).toHaveAttribute('aria-current', 'page')
  })
})
