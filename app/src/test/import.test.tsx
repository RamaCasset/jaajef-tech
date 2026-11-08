import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GithubRepo, MyProject } from '../lib/api'

const linkGithubAccount = vi.fn()
const connectGithub = vi.fn()
const listPublicRepos = vi.fn()
const listMyProjects = vi.fn()
const publishProject = vi.fn()
const refreshMember = vi.fn()
const editorStatus = vi.fn()
const editorRepos = vi.fn()
const editorAdopt = vi.fn()
let startName: string | null = null
let nameAfterRefresh: string | null = 'bara-dev'

vi.mock('../lib/api', () => ({
  linkGithubAccount: (...a: unknown[]) => linkGithubAccount(...a),
  connectGithub: (...a: unknown[]) => connectGithub(...a),
  listPublicRepos: (...a: unknown[]) => listPublicRepos(...a),
  listMyProjects: (...a: unknown[]) => listMyProjects(...a),
  publishProject: (...a: unknown[]) => publishProject(...a),
  editorStatus: (...a: unknown[]) => editorStatus(...a),
  editorRepos: (...a: unknown[]) => editorRepos(...a),
  editorAdopt: (...a: unknown[]) => editorAdopt(...a),
  EditorError: class EditorError extends Error {
    code: string
    constructor(code: string) { super(code); this.code = code }
  },
  GithubError: class GithubError extends Error {
    code: string
    constructor(code: string) { super(code); this.code = code }
  },
}))
vi.mock('../auth/AuthContext', async () => {
  const React = await import('react')
  return {
    useAuth: () => {
      const [name, setName] = React.useState<string | null>(startName)
      return {
        member: { kopeks: 1, profile: { id: 'u1', display_name: 'Bara', github_username: name } },
        signOut: vi.fn(),
        refreshMember: async () => { refreshMember(); setName(nameAfterRefresh) },
      }
    },
  }
})

import { EditorError, GithubError } from '../lib/api'
import { ImportProject } from '../pages/ImportProject'

const repo = (name: string, extra: Partial<GithubRepo> = {}): GithubRepo => ({
  name, description: `Description de ${name}`, fork: false, archived: false, stargazers_count: 3, language: 'Python',
  html_url: `https://github.com/bara-dev/${name}`, ...extra,
})
const mine = (name: string, verified: string | null): MyProject => ({ id: `id-${name}`, github_owner: 'bara-dev', github_repo: name, verified_at: verified, repo_private: false })
const mount = () => render(<MemoryRouter><ImportProject /></MemoryRouter>)

beforeEach(() => {
  for (const m of [linkGithubAccount, connectGithub, listPublicRepos, listMyProjects, publishProject, refreshMember, editorStatus, editorRepos, editorAdopt]) m.mockReset()
  startName = 'bara-dev'
  nameAfterRefresh = 'bara-dev'
  listPublicRepos.mockResolvedValue([repo('mon-depot'), repo('vieux-projet', { fork: true, archived: true, language: null, description: null, stargazers_count: 1 })])
  listMyProjects.mockResolvedValue([])
  publishProject.mockResolvedValue('new-id')
  editorStatus.mockResolvedValue({ installed: true, install_url: 'https://github.com/apps/jaajef/installations/new', github_name: 'bara-dev' })
  editorRepos.mockResolvedValue({ repos: [{ name: 'secret-app', private: true, default_branch: 'main' }, { name: 'mon-depot', private: false, default_branch: 'main' }] })
  editorAdopt.mockResolvedValue({ project_id: 'p-1' })
})

describe('Import a project', () => {
  it('lists the public repositories of the connected GitHub account', async () => {
    mount()
    expect(await screen.findByText('mon-depot')).toBeInTheDocument()
    expect(listPublicRepos).toHaveBeenCalledWith('bara-dev')
    expect(screen.getByText('Compte GitHub : bara-dev')).toBeInTheDocument()
    expect(screen.getByText('Description de mon-depot')).toBeInTheDocument()
    expect(screen.getByText('Fork')).toBeInTheDocument()
    expect(screen.getByText('Archivé')).toBeInTheDocument()
    expect(screen.getByText('1 étoile')).toBeInTheDocument()
    expect(screen.getByText(/Un dépôt public devient visible de tous/)).toBeInTheDocument()
    expect(linkGithubAccount).not.toHaveBeenCalled()
  })

  it('adds a repository with its name, GitHub address and description, then shows it as waiting', async () => {
    listMyProjects.mockResolvedValueOnce([]).mockResolvedValueOnce([mine('mon-depot', null)])
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Ajouter : mon-depot' }))
    await waitFor(() => expect(publishProject).toHaveBeenCalledWith('https://github.com/bara-dev/mon-depot', 'mon-depot', 'Description de mon-depot'))
    expect(await screen.findByText('En attente de confirmation')).toBeInTheDocument()
    expect(screen.getByText(/GitHub va confirmer le dépôt/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ajouter : mon-depot' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Ajouter : vieux-projet' })).toBeInTheDocument()
  })

  it('cuts a very long description to the 300 characters the database accepts', async () => {
    listPublicRepos.mockResolvedValue([repo('long', { description: 'x'.repeat(500) })])
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Ajouter : long' }))
    await waitFor(() => expect(publishProject).toHaveBeenCalled())
    expect((publishProject.mock.calls[0][2] as string).length).toBe(300)
  })

  it('sends no description when the repository has none', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Ajouter : vieux-projet' }))
    await waitFor(() => expect(publishProject).toHaveBeenCalledWith('https://github.com/bara-dev/vieux-projet', 'vieux-projet', null))
  })

  it('marks repositories that are already added, whatever the letter case, and offers no button for them', async () => {
    listPublicRepos.mockResolvedValue([repo('Mon-Depot'), repo('autre')])
    listMyProjects.mockResolvedValue([mine('mon-depot', '2026-11-01'), mine('autre', null)])
    mount()
    expect(await screen.findByText('Confirmé')).toBeInTheDocument()
    expect(screen.getByText('En attente de confirmation')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ajouter : (Mon-Depot|autre)/ })).toBeNull()
  })

  it('explains the database refusal in plain French', async () => {
    publishProject.mockRejectedValue(new Error('You have reached the limit of projects you can list'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Ajouter : mon-depot' }))
    expect(await screen.findByText('Vous avez atteint le nombre maximum de projets.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ajouter : mon-depot' })).toBeEnabled()
  })

  it('says so when the account has no public repository', async () => {
    listPublicRepos.mockResolvedValue([])
    mount()
    expect(await screen.findByText(/aucun dépôt public/)).toBeInTheDocument()
  })

  it('tells the member when GitHub limits the requests, and retries on request', async () => {
    listPublicRepos.mockRejectedValueOnce(new GithubError('rate_limited'))
    mount()
    expect(await screen.findByText(/GitHub limite temporairement les demandes/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText('mon-depot')).toBeInTheDocument()
  })

  it('asks to connect GitHub when no GitHub login is attached, and starts the connection', async () => {
    startName = null
    linkGithubAccount.mockRejectedValue(new Error('No GitHub account is connected to your login'))
    mount()
    const button = await screen.findByRole('button', { name: 'Connecter GitHub' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(linkGithubAccount).toHaveBeenCalledTimes(1)
    expect(listPublicRepos).not.toHaveBeenCalled()
    connectGithub.mockResolvedValue(undefined)
    await userEvent.click(button)
    expect(connectGithub).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Redirection vers GitHub…' })).toBeDisabled()
  })

  it('on coming back from GitHub, copies the name once, refreshes the member and lists the repositories', async () => {
    startName = null
    linkGithubAccount.mockResolvedValue('bara-dev')
    mount()
    expect(await screen.findByText('mon-depot')).toBeInTheDocument()
    expect(linkGithubAccount).toHaveBeenCalledTimes(1)
    expect(refreshMember).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Connecter GitHub' })).toBeNull()
  })

  it('shows the connection error when GitHub cannot be reached', async () => {
    startName = null
    linkGithubAccount.mockRejectedValue(new Error('No GitHub account is connected to your login'))
    connectGithub.mockRejectedValue(new Error('boom'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Connecter GitHub' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connecter GitHub' })).toBeEnabled()
  })

  it('lists the private repositories the app can see, marked as private, and adds one as private', async () => {
    listMyProjects.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...mine('secret-app', '2026-11-01'), repo_private: true }])
    mount()
    expect(await screen.findByText('secret-app')).toBeInTheDocument()
    expect(screen.getByText('Privé')).toBeInTheDocument()
    // a public repository the app can also see is not repeated in the private list
    expect(screen.getAllByText('mon-depot')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter : secret-app' }))
    await waitFor(() => expect(editorAdopt).toHaveBeenCalledWith('secret-app', 'secret-app', null))
    expect(publishProject).not.toHaveBeenCalled()
    expect(await screen.findByText(/Ce dépôt est privé/)).toBeInTheDocument()
    expect(await screen.findByText('Déjà ajouté')).toBeInTheDocument()
  })

  it('offers to install the GitHub app when it is not installed, and refreshes on request', async () => {
    editorStatus.mockResolvedValueOnce({ installed: false, install_url: 'https://github.com/apps/jaajef/installations/new', github_name: 'bara-dev' })
    mount()
    const link = await screen.findByRole('link', { name: "Installer l'application GitHub" })
    expect(link).toHaveAttribute('href', 'https://github.com/apps/jaajef/installations/new')
    expect(screen.getByText('mon-depot')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Actualiser' }))
    expect(await screen.findByText('secret-app')).toBeInTheDocument()
  })

  it('keeps the public list working when the private repositories cannot be read', async () => {
    editorStatus.mockRejectedValue(new EditorError('not_configured'))
    mount()
    expect(await screen.findByText('mon-depot')).toBeInTheDocument()
    expect(await screen.findByText(/Impossible de lire vos dépôts privés/)).toBeInTheDocument()
  })

  it('explains why a private repository could not be added', async () => {
    editorAdopt.mockRejectedValue(new EditorError('already_listed'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Ajouter : secret-app' }))
    expect(await screen.findByText('Ce dépôt est déjà ajouté.')).toBeInTheDocument()
  })

  it('creates a project: the name is checked, the GitHub page opens prefilled, then the member comes back to import', async () => {
    mount()
    await screen.findByText('mon-depot')
    await userEvent.click(screen.getByRole('tab', { name: 'Créer un nouveau dépôt' }))
    expect(screen.getByRole('button', { name: 'Créer sur GitHub' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Nom du dépôt'), 'mon nom')
    expect(screen.getByText(/Lettres, chiffres, tirets/)).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Nom du dépôt'))
    await userEvent.type(screen.getByLabelText('Nom du dépôt'), 'nouveau-projet')
    await userEvent.type(screen.getByLabelText('Description (facultatif)'), 'Mon idée')
    await userEvent.click(screen.getByRole('radio', { name: 'Privé' }))
    const go = screen.getByRole('link', { name: 'Créer sur GitHub' })
    const href = go.getAttribute('href') ?? ''
    expect(href.startsWith('https://github.com/new?')).toBe(true)
    const q = new URL(href).searchParams
    expect([q.get('name'), q.get('description'), q.get('visibility')]).toEqual(['nouveau-projet', 'Mon idée', 'private'])
    expect(go).toHaveAttribute('target', '_blank')
    await userEvent.click(go)
    expect(screen.getByText(/installez l'application sur ce dépôt/)).toBeInTheDocument()
    listPublicRepos.mockClear()
    await userEvent.click(screen.getByRole('button', { name: "J'ai créé le dépôt" }))
    await waitFor(() => expect(listPublicRepos).toHaveBeenCalled())
    expect(await screen.findByText('mon-depot')).toBeInTheDocument()
  })
})
