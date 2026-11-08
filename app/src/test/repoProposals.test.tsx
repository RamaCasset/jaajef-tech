import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ getProjectFull: vi.fn(), editorProposals: vi.fn(), editorMergeProposal: vi.fn(), editorCloseProposal: vi.fn() }))
vi.mock('../lib/api', async () => {
  const real = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...real, ...api }
})
const auth = vi.hoisted(() => ({ id: 'owner', username: 'awa_dev' }))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: auth.id, username: auth.username, display_name: 'Awa' } }, signOut: vi.fn() }),
}))
const { EditorError } = await vi.importActual<typeof import('../lib/api')>('../lib/api')
import { RepoProposals } from '../pages/RepoProposals'

const SHA = 'c'.repeat(40)
const project = { id: 'p1', title: 'Mon appli', github_owner: 'awa', github_repo: 'appli', owner_id: 'owner', repo_private: true }
const pulls = [
  { number: 3, title: 'Corrige le titre', branch: 'ndeye_k/fix', sha: SHA, author: 'ndeye_k', url: 'https://github.com/awa/appli/pull/3', created_at: '2026-11-07T10:00:00Z' },
  { number: 4, title: 'Mon essai', branch: 'awa_dev/idea', sha: 'd'.repeat(40), author: 'awa_dev', url: 'https://github.com/awa/appli/pull/4', created_at: '2026-11-08T10:00:00Z' },
]
const mount = () => render(<MemoryRouter initialEntries={['/projets/p1/propositions']}><Routes><Route path="/projets/:id/propositions" element={<RepoProposals />} /></Routes></MemoryRouter>)

beforeEach(() => {
  vi.resetAllMocks()
  auth.id = 'owner'
  auth.username = 'awa_dev'
  api.getProjectFull.mockResolvedValue(project)
  api.editorProposals.mockResolvedValue({ default_branch: 'main', pulls })
})

describe('Proposals page', () => {
  it('lists the proposals with who made them and a link to see the changes', async () => {
    mount()
    expect(await screen.findByText('Corrige le titre')).toBeInTheDocument()
    expect(screen.getByText(/par ndeye_k/)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Voir les changements' })[0]).toHaveAttribute('href', 'https://github.com/awa/appli/pull/3/files')
    expect(screen.getByRole('link', { name: /Retour au projet/ })).toHaveAttribute('href', '/projets/p1')
  })

  it('the owner merges after a confirmation, exactly the version shown', async () => {
    api.editorMergeProposal.mockResolvedValue({ merged: true, url: 'u' })
    mount()
    const row = (await screen.findByText('Corrige le titre')).closest('li') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: 'Fusionner' }))
    expect(api.editorMergeProposal).not.toHaveBeenCalled()
    await userEvent.click(within(row).getByRole('button', { name: 'Oui, fusionner' }))
    await waitFor(() => expect(api.editorMergeProposal).toHaveBeenCalledWith('p1', 3, SHA))
    expect(await screen.findByRole('status')).toHaveTextContent('Les changements sont maintenant dans main.')
    expect(screen.queryByText('Corrige le titre')).toBeNull()
    expect(screen.getByText('Mon essai')).toBeInTheDocument()
  })

  it('declining asks first, can be cancelled, and closes the proposal', async () => {
    api.editorCloseProposal.mockResolvedValue({ closed: true })
    mount()
    const row = (await screen.findByText('Corrige le titre')).closest('li') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: 'Refuser' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Annuler' }))
    expect(api.editorCloseProposal).not.toHaveBeenCalled()
    await userEvent.click(within(row).getByRole('button', { name: 'Refuser' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Oui, refuser' }))
    await waitFor(() => expect(api.editorCloseProposal).toHaveBeenCalledWith('p1', 3))
    expect(await screen.findByText('La proposition est fermée.')).toBeInTheDocument()
  })

  it('a collaborator cannot merge, and can only withdraw their own proposal', async () => {
    auth.id = 'collab'
    auth.username = 'ndeye_k'
    mount()
    await screen.findByText('Corrige le titre')
    expect(screen.queryByRole('button', { name: 'Fusionner' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Retirer' })).toHaveLength(1)
    const mine = screen.getByText('Corrige le titre').closest('li') as HTMLElement
    expect(within(mine).getByRole('button', { name: 'Retirer' })).toBeInTheDocument()
    expect(within(screen.getByText('Mon essai').closest('li') as HTMLElement).queryByRole('button')).toBeNull()
  })

  it('explains a conflict with a link to GitHub, and reloads when the branch moved', async () => {
    api.editorMergeProposal.mockRejectedValueOnce(new EditorError('not_mergeable')).mockRejectedValueOnce(new EditorError('branch_moved'))
    mount()
    const row = (await screen.findByText('Corrige le titre')).closest('li') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: 'Fusionner' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Oui, fusionner' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('entrent en conflit avec main')
    expect(screen.getByRole('link', { name: 'Ouvrir sur GitHub' })).toHaveAttribute('href', 'https://github.com/awa/appli/pull/3')
    await userEvent.click(within(row).getByRole('button', { name: 'Fusionner' }))
    await userEvent.click(within(row).getByRole('button', { name: 'Oui, fusionner' }))
    expect(await screen.findByText(/La branche a changé pendant que vous regardiez/)).toBeInTheDocument()
    await waitFor(() => expect(api.editorProposals).toHaveBeenCalledTimes(2))
  })

  it('explains a missing GitHub permission differently for the owner and for a collaborator', async () => {
    api.editorProposals.mockRejectedValue(new EditorError('pulls_permission_missing'))
    mount()
    expect(await screen.findByText(/Ouvrez ses réglages sur GitHub et acceptez la nouvelle autorisation/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /réglages/ })).toBeInTheDocument()
  })

  it('says so when there is nothing waiting', async () => {
    api.editorProposals.mockResolvedValue({ default_branch: 'main', pulls: [] })
    mount()
    expect(await screen.findByText('Aucune proposition en attente.')).toBeInTheDocument()
  })
})
