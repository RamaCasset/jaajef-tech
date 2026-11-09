import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getProjectFull: vi.fn(), starProject: vi.fn(), unstarProject: vi.fn(), listProjectComments: vi.fn(), postProjectComment: vi.fn(),
  deleteProjectComment: vi.fn(), listCollaborators: vi.fn(), listCollabRequests: vi.fn(), requestCollaboration: vi.fn(),
  withdrawCollabRequest: vi.fn(), decideCollabRequest: vi.fn(), removeCollaborator: vi.fn(), loadRepoTree: vi.fn(), getLastCommits: vi.fn(),
  GithubError: class GithubError extends Error { code = 'failed' },
  projectCoverUrl: vi.fn(), saveProjectShowcase: vi.fn(), uploadProjectCover: vi.fn(), inviteCollaborator: vi.fn(), listProjectInvites: vi.fn(), cancelCollabInvite: vi.fn(), getProjectRoom: vi.fn(), searchEverything: vi.fn(), openProjectRoom: vi.fn(),
}))
vi.mock('../lib/api', () => api)
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: 'me', display_name: 'Moussa' } }, signOut: vi.fn() }),
}))

import { ProjectPage } from '../pages/ProjectPage'

const project = (extra = {}) => ({
  id: 'p1', title: 'Teranga', summary: 'Une appli', github_owner: 'awa', github_repo: 'teranga', language: 'Python', tags: ['web'],
  github_stars: 10, owner_id: 'u2', owner_username: 'awa', owner_display_name: 'Awa Diallo', star_count: 4, starred_by_me: false, demo_url: null, cover_path: null, is_public: true, repo_private: false, ...extra,
})
const mount = () => render(
  <MemoryRouter initialEntries={['/projets/p1']}>
    <Routes><Route path="/projets/:id" element={<ProjectPage />} /></Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  for (const f of Object.values(api)) if ('mockReset' in f) f.mockReset()
  api.getProjectFull.mockResolvedValue(project())
  api.listProjectComments.mockResolvedValue([
    { id: 1, author_id: 'me', body: 'Bravo <b>!</b>', created_at: '2026-11-01', author_username: 'moussa' },
    { id: 2, author_id: 'u3', body: 'Merci', created_at: '2026-11-01', author_username: 'bass' },
  ])
  api.listCollaborators.mockResolvedValue([{ user_id: 'u4', username: 'cheikh', display_name: 'Cheikh' }])
  api.listCollabRequests.mockResolvedValue([])
  api.listProjectInvites.mockResolvedValue([])
  api.searchEverything.mockResolvedValue([])
  api.getProjectRoom.mockResolvedValue(null)
  api.loadRepoTree.mockResolvedValue({ branch: 'main', truncated: false, entries: [{ path: 'src', type: 'tree', size: 0 }, { path: 'app.py', type: 'blob', size: 10 }] })
  api.getLastCommits.mockResolvedValue({})
  for (const f of [api.starProject, api.unstarProject, api.postProjectComment, api.deleteProjectComment, api.requestCollaboration, api.withdrawCollabRequest, api.decideCollabRequest, api.removeCollaborator, api.inviteCollaborator, api.cancelCollabInvite]) f.mockResolvedValue(undefined)
})

describe('Project page', () => {
  it('lists the files of the repository, and has no separate code or edit links', async () => {
    mount()
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('link', { name: 'src' })).toHaveAttribute('href', '/projets/p1/code?dossier=src')
    expect(within(table).getByRole('link', { name: 'app.py' })).toHaveAttribute('href', '/projets/p1/code?fichier=app.py')
    expect(screen.queryByRole('link', { name: 'Voir le code' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Modifier le code' })).toBeNull()
  })

  it('shows the project, its owner, the GitHub link and the star count', async () => {
    mount()
    expect(await screen.findByRole('heading', { name: 'Teranga' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Voir sur GitHub' })).toHaveAttribute('href', 'https://github.com/awa/teranga')
    expect(screen.getByRole('link', { name: 'par Awa Diallo' })).toHaveAttribute('href', '/profil/awa')
    expect(screen.getByText('4 étoiles de la Cité')).toBeInTheDocument()
  })

  it('stars and unstars with the count following', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: /Mettre une étoile/ }))
    expect(api.starProject).toHaveBeenCalledWith('p1')
    expect(await screen.findByText('5 étoiles de la Cité')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Retirer l'étoile/ }))
    expect(api.unstarProject).toHaveBeenCalledWith('p1')
    expect(await screen.findByText('4 étoiles de la Cité')).toBeInTheDocument()
  })

  it('no star button on my own project', async () => {
    api.getProjectFull.mockResolvedValue(project({ owner_id: 'me' }))
    mount()
    expect(await screen.findByRole('heading', { name: 'Teranga' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /étoile/ })).not.toBeInTheDocument()
  })

  it('comments are plain text; delete only mine, or any on my own project', async () => {
    const first = mount()
    await screen.findByText('Bravo <b>!</b>')
    expect(document.querySelector('li b')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Supprimer' })).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Supprimer' }))
    expect(api.deleteProjectComment).toHaveBeenCalledWith(1)
    first.unmount()
    api.getProjectFull.mockResolvedValue(project({ owner_id: 'me' }))
    mount()
    await screen.findAllByText('Merci')
    expect(screen.getAllByRole('button', { name: 'Supprimer' })).toHaveLength(2)
  })

  it('posting a comment sends it and clears the box; blank is not allowed', async () => {
    mount()
    const send = await screen.findByRole('button', { name: 'Commenter' })
    await userEvent.type(screen.getByLabelText('Votre commentaire'), '   ')
    expect(send).toBeDisabled()
    await userEvent.clear(screen.getByLabelText('Votre commentaire'))
    await userEvent.type(screen.getByLabelText('Votre commentaire'), 'Top')
    await userEvent.click(send)
    await waitFor(() => expect(api.postProjectComment).toHaveBeenCalledWith('p1', 'Top'))
    await waitFor(() => expect(screen.getByLabelText('Votre commentaire')).toHaveValue(''))
  })

  it('asks to collaborate with a message, and confirms', async () => {
    mount()
    await userEvent.type(await screen.findByLabelText('Dites pourquoi vous voulez collaborer'), 'Je connais Django')
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer la demande' }))
    await waitFor(() => expect(api.requestCollaboration).toHaveBeenCalledWith('p1', 'Je connais Django'))
    expect(await screen.findByRole('status')).toHaveTextContent('Demande envoyée')
  })

  it('with a request already waiting, offers to withdraw it instead of a new form', async () => {
    api.listCollabRequests.mockResolvedValue([{ id: 'r1', requester_id: 'me', message: 'x', status: 'pending', requester_username: 'moussa' }])
    mount()
    expect(await screen.findByText('Votre demande est en attente.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Dites pourquoi vous voulez collaborer')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retirer ma demande' }))
    expect(api.withdrawCollabRequest).toHaveBeenCalledWith('r1')
  })

  it('a collaborator sees no request form', async () => {
    api.listCollaborators.mockResolvedValue([{ user_id: 'me', username: 'moussa', display_name: 'Moussa' }])
    mount()
    await screen.findByRole('heading', { name: 'Teranga' })
    await screen.findByText('Moussa')
    expect(screen.queryByLabelText('Dites pourquoi vous voulez collaborer')).not.toBeInTheDocument()
  })

  it('the owner answers requests and can remove a collaborator; others cannot', async () => {
    api.getProjectFull.mockResolvedValue(project({ owner_id: 'me' }))
    api.listCollabRequests.mockResolvedValue([{ id: 'r9', requester_id: 'u7', message: 'Je veux aider', status: 'pending', requester_username: 'newbie' }])
    const first = mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Accepter' }))
    expect(api.decideCollabRequest).toHaveBeenCalledWith('r9', true)
    await userEvent.click(screen.getByRole('button', { name: 'Refuser' }))
    expect(api.decideCollabRequest).toHaveBeenCalledWith('r9', false)
    await userEvent.click(screen.getByRole('button', { name: 'Retirer : cheikh' }))
    expect(api.removeCollaborator).toHaveBeenCalledWith('p1', 'u4')
    expect(screen.queryByLabelText('Dites pourquoi vous voulez collaborer')).not.toBeInTheDocument()
    first.unmount()
    api.getProjectFull.mockResolvedValue(project())
    api.listCollabRequests.mockResolvedValue([])
    mount()
    await screen.findByText('Cheikh')
    expect(screen.queryByRole('button', { name: 'Retirer : cheikh' })).not.toBeInTheDocument()
    expect(screen.queryByText('Demandes de collaboration')).not.toBeInTheDocument()
  })

  it('shows refusals in French', async () => {
    api.requestCollaboration.mockRejectedValue(new Error('The owner is not looking for collaborators right now'))
    mount()
    await userEvent.type(await screen.findByLabelText('Dites pourquoi vous voulez collaborer'), 'Salut')
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer la demande' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ne cherche pas de collaborateurs')
  })

  it('unknown project, and retry when loading fails', async () => {
    api.getProjectFull.mockResolvedValueOnce(null)
    const first = mount()
    expect(await screen.findByText(/n'existe pas ou n'est pas encore visible/)).toBeInTheDocument()
    first.unmount()
    api.getProjectFull.mockRejectedValueOnce(new Error('x'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('heading', { name: 'Teranga' })).toBeInTheDocument()
  })

  it('offers "Signaler" on someone else\'s project but not on my own', async () => {
    const view = mount()
    expect(await screen.findByRole('button', { name: 'Signaler' })).toBeInTheDocument()
    view.unmount()
    api.getProjectFull.mockResolvedValue(project({ owner_id: 'me' }))
    mount()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('button', { name: 'Signaler' })).not.toBeInTheDocument()
  })

  it('the owner invites a collaborator by username, sees waiting invitations and can cancel one; nobody else sees the form', async () => {
    api.getProjectFull.mockResolvedValue(project({ owner_id: 'me' }))
    const first = mount()
    await userEvent.type(await screen.findByLabelText("Inviter un collaborateur (nom d'utilisateur)"), 'ibou_dev')
    await userEvent.click(screen.getByRole('button', { name: 'Inviter' }))
    await waitFor(() => expect(api.inviteCollaborator).toHaveBeenCalledWith('p1', 'ibou_dev'))
    expect(await screen.findByText(/Invitation envoyée/)).toBeInTheDocument()
    expect(screen.getByLabelText("Inviter un collaborateur (nom d'utilisateur)")).toHaveValue('')
    api.listProjectInvites.mockResolvedValue([{ id: 'i1', invitee_username: 'ibou_dev', expires_at: '2026-11-15T10:00:00Z' }])
    first.unmount()
    const second = mount()
    expect(await screen.findByText(/Expire le 15 novembre/)).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Annuler : ibou_dev' }))
    expect(api.cancelCollabInvite).toHaveBeenCalledWith('i1')
    second.unmount()
    api.getProjectFull.mockResolvedValue(project())
    api.listProjectInvites.mockResolvedValue([])
    mount()
    await screen.findByText('Cheikh')
    expect(screen.queryByLabelText("Inviter un collaborateur (nom d'utilisateur)")).toBeNull()
  })

  it('explains in French when the username does not exist', async () => {
    api.getProjectFull.mockResolvedValue(project({ owner_id: 'me' }))
    api.inviteCollaborator.mockRejectedValue(new Error('No member with this username'))
    mount()
    await userEvent.type(await screen.findByLabelText("Inviter un collaborateur (nom d'utilisateur)"), 'personne')
    await userEvent.click(screen.getByRole('button', { name: 'Inviter' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Aucun membre n'a ce nom d'utilisateur.")
  })

  it('a private project has no stars, comments or join requests, says who can see it, and shows its files to members', async () => {
    api.getProjectFull.mockResolvedValue(project({ is_public: false, repo_private: true }))
    api.listCollaborators.mockResolvedValue([{ user_id: 'me', username: 'moussa', display_name: 'Moussa' }])
    mount()
    expect(await screen.findByText('Privé', { selector: '.tag' })).toBeInTheDocument()
    expect(screen.getByText(/seuls le propriétaire et les collaborateurs le voient/)).toBeInTheDocument()
    expect(screen.queryByText(/étoiles? de la Cité/)).toBeNull()
    expect(screen.queryByRole('button', { name: /étoile/i })).toBeNull()
    expect(screen.queryByText('Commentaires')).toBeNull()
    expect(screen.queryByLabelText('Dites pourquoi vous voulez collaborer')).toBeNull()
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(api.loadRepoTree).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', repo_private: true }))
    expect(screen.getByRole('link', { name: 'Historique' })).toHaveAttribute('href', '/projets/p1/historique')
    expect(await screen.findByText('Moussa')).toBeInTheDocument()
  })

  it('a collaborator on a public project sees "you collaborate" instead of the star button', async () => {
    api.listCollaborators.mockResolvedValue([{ user_id: 'me', username: 'moussa', display_name: 'Moussa' }])
    mount()
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mettre une étoile/ })).toBeNull()
    expect(screen.queryByText('Vous collaborez à ce projet')).toBeNull()
  })

  it('the owner can create the project room, then open it', async () => {
    api.getProjectFull.mockResolvedValue(project({ owner_id: 'me' }))
    api.openProjectRoom.mockImplementation(async () => { api.getProjectRoom.mockResolvedValue('projet-abc'); return 'room1' })
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Créer le salon du projet' }))
    expect(api.openProjectRoom).toHaveBeenCalledWith('p1')
    expect(await screen.findByRole('link', { name: 'Ouvrir le salon' })).toHaveAttribute('href', '/communautes/projet-abc')
  })

  it('a collaborator sees the link when the room exists; a visitor sees nothing', async () => {
    api.getProjectRoom.mockResolvedValue('projet-abc')
    mount()
    expect(await screen.findByRole('link', { name: 'Ouvrir le salon' })).toBeInTheDocument()
  })

  it('a visitor does not see the room section', async () => {
    mount()
    await screen.findByText('Teranga')
    expect(screen.queryByText('Salon du projet')).toBeNull()
  })

  it('the owner can create the project room, then open it', async () => {
    api.getProjectFull.mockResolvedValue(project({ owner_id: 'me' }))
    api.openProjectRoom.mockImplementation(async () => { api.getProjectRoom.mockResolvedValue('projet-abc'); return 'room1' })
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Créer le salon du projet' }))
    expect(api.openProjectRoom).toHaveBeenCalledWith('p1')
    expect(await screen.findByRole('link', { name: 'Ouvrir le salon' })).toHaveAttribute('href', '/communautes/projet-abc')
  })

  it('a collaborator sees the link when the room exists; a visitor sees nothing', async () => {
    api.getProjectRoom.mockResolvedValue('projet-abc')
    mount()
    expect(await screen.findByRole('link', { name: 'Ouvrir le salon' })).toBeInTheDocument()
  })

  it('a visitor does not see the room section', async () => {
    mount()
    await screen.findByText('Teranga')
    expect(screen.queryByText('Salon du projet')).toBeNull()
  })
})
