import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Community as C } from '../lib/api'

const api = vi.hoisted(() => ({
  listMyCommunities: vi.fn(), listDiscoverCommunities: vi.fn(), communityMemberCount: vi.fn(), createCommunity: vi.fn(),
  joinCommunity: vi.fn(), requestToJoin: vi.fn(), leaveCommunity: vi.fn(), getCommunityBySlug: vi.fn(), listChannels: vi.fn(),
  listChannelMessages: vi.fn(), sendMessage: vi.fn(), deleteMessage: vi.fn(), listCommunityMembers: vi.fn(),
  listPendingJoinRequests: vi.fn(), decideJoinRequest: vi.fn(), removeCommunityMember: vi.fn(), setMemberRole: vi.fn(),
  transferCommunity: vi.fn(), deleteCommunity: vi.fn(),
}))
vi.mock('../lib/api', () => api)
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 1, profile: { id: 'me', display_name: 'Moussa' } }, signOut: vi.fn() }),
}))

import { Communities } from '../pages/Communities'
import { Community } from '../pages/Community'

const comm = (id: string, extra: Partial<C> = {}): C => ({ id, slug: `slug-${id}`, name: `Comm ${id}`, description: null, is_private: false, is_listed: true, owner_id: 'o', ...extra })

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.listMyCommunities.mockResolvedValue([{ ...comm('1'), role: 'owner' }])
  api.listDiscoverCommunities.mockResolvedValue([comm('1'), comm('2', { description: 'Pour apprendre' }), comm('3', { is_private: true })])
  api.communityMemberCount.mockResolvedValue(5)
  for (const f of [api.createCommunity, api.joinCommunity, api.requestToJoin, api.leaveCommunity, api.sendMessage, api.deleteMessage, api.decideJoinRequest, api.removeCommunityMember, api.setMemberRole, api.transferCommunity, api.deleteCommunity]) f.mockResolvedValue(undefined)
})

describe('Communities list', () => {
  const mount = () => render(<MemoryRouter><Communities /></MemoryRouter>)

  it('shows mine with my role and link, and only others under "discover"', async () => {
    mount()
    expect(await screen.findByRole('link', { name: 'Comm 1' })).toHaveAttribute('href', '/communautes/slug-1')
    expect(screen.getByText(/Propriétaire/)).toBeInTheDocument()
    expect(screen.getByText('Comm 2')).toBeInTheDocument()
    expect(screen.getAllByText('Comm 1')).toHaveLength(1)
  })

  it('joins a public community directly, and asks to enter a private one with a message', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Rejoindre' }))
    expect(api.joinCommunity).toHaveBeenCalledWith('2')
    await userEvent.click(screen.getByRole('button', { name: 'Demander à rejoindre' }))
    await userEvent.type(screen.getByLabelText(/Un mot pour le propriétaire/), ' Salut ')
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer la demande' }))
    expect(api.requestToJoin).toHaveBeenCalledWith('3', ' Salut ')
    expect(await screen.findByRole('status')).toHaveTextContent('Demande envoyée')
  })

  it('creates a community with the chosen options and shows French errors', async () => {
    api.createCommunity.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "communities_slug_key"'))
    mount()
    await userEvent.type(await screen.findByLabelText('Nom'), 'Les Dev')
    await userEvent.type(screen.getByLabelText(/Adresse/), 'Les-Dev')
    await userEvent.click(screen.getByRole('button', { name: 'Créer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('déjà prise')
    await userEvent.click(screen.getByLabelText('Communauté privée'))
    await userEvent.click(screen.getByLabelText(/Visible dans la liste/))
    await userEvent.click(screen.getByRole('button', { name: 'Créer' }))
    await waitFor(() => expect(api.createCommunity).toHaveBeenLastCalledWith('les-dev', 'Les Dev', '', true, false))
  })

  it('offers a retry when loading fails', async () => {
    api.listMyCommunities.mockRejectedValueOnce(new Error('down'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('link', { name: 'Comm 1' })).toBeInTheDocument()
  })
})

describe('One community', () => {
  const members = (role: 'owner' | 'moderator' | 'member') => [
    { user_id: 'me', role, username: 'moussa', display_name: 'Moussa' },
    { user_id: 'u2', role: 'member' as const, username: 'awa', display_name: 'Awa' },
    { user_id: 'u3', role: 'moderator' as const, username: 'bass', display_name: 'Bass' },
  ]
  const channels = [{ id: 'ch1', slug: 'general', name: 'general', kind: 'chat' }, { id: 'ch2', slug: 'annonces', name: 'annonces', kind: 'announcement' }]
  const msgs = [
    { id: 1, author_id: 'u2', body: 'Bonjour <b>tous</b>', created_at: '2026-11-05T10:00:00Z', edited_at: null, deleted_at: null, author_username: 'awa', author_name: 'Awa' },
    { id: 2, author_id: 'me', body: 'Salut', created_at: '2026-11-05T10:01:00Z', edited_at: null, deleted_at: null, author_username: 'moussa', author_name: 'Moussa' },
    { id: 3, author_id: 'u2', body: 'secret', created_at: '2026-11-05T10:02:00Z', edited_at: null, deleted_at: '2026-11-05T11:00:00Z', author_username: 'awa', author_name: 'Awa' },
  ]
  function setup(role: 'owner' | 'moderator' | 'member' | null) {
    api.getCommunityBySlug.mockResolvedValue(comm('1'))
    api.listChannels.mockResolvedValue(role ? channels : [])
    api.listCommunityMembers.mockResolvedValue(role ? members(role) : [])
    api.listChannelMessages.mockResolvedValue(msgs)
    api.listPendingJoinRequests.mockResolvedValue([{ id: 'r1', user_id: 'u9', message: 'Je suis dev', username: 'newbie' }])
    return render(
      <MemoryRouter initialEntries={['/communautes/slug-1']}>
        <Routes>
          <Route path="/communautes/:slug" element={<Community />} />
          <Route path="/communautes" element={<p>list page</p>} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('shows messages as plain text, hides the text of deleted ones', async () => {
    setup('member')
    expect(await screen.findByText('Bonjour <b>tous</b>')).toBeInTheDocument()
    expect(document.querySelector('p b')).toBeNull()
    expect(screen.getByText('Message supprimé')).toBeInTheDocument()
    expect(screen.queryByText('secret')).not.toBeInTheDocument()
  })

  it('sends a message to the open channel, then clears the box and reloads', async () => {
    setup('member')
    await userEvent.type(await screen.findByLabelText('Votre message'), 'Yo')
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }))
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith('ch1', 'Yo'))
    await waitFor(() => expect(screen.getByLabelText('Votre message')).toHaveValue(''))
    expect(api.listChannelMessages.mock.calls.length).toBeGreaterThan(1)
  })

  it('an announcement channel is read-only for members, writable for moderators', async () => {
    const first = setup('member')
    await userEvent.click(await screen.findByRole('tab', { name: '# annonces' }))
    expect(screen.queryByLabelText('Votre message')).not.toBeInTheDocument()
    expect(screen.getByText(/Seuls le propriétaire et les modérateurs/)).toBeInTheDocument()
    first.unmount()
    setup('moderator')
    await userEvent.click(await screen.findByRole('tab', { name: '# annonces' }))
    expect(screen.getByLabelText('Votre message')).toBeInTheDocument()
  })

  it('members can delete only their own messages; moderators can delete any', async () => {
    const first = setup('member')
    await screen.findByText('Salut')
    expect(screen.getAllByRole('button', { name: 'Supprimer' })).toHaveLength(1)
    first.unmount()
    setup('moderator')
    await screen.findByText('Salut')
    expect(screen.getAllByRole('button', { name: 'Supprimer' })).toHaveLength(2)
  })

  it('a plain member sees no management tools, but can leave', async () => {
    setup('member')
    await screen.findByText('Salut')
    expect(screen.queryByText("Demandes d'entrée")).not.toBeInTheDocument()
    expect(screen.queryByText('Supprimer la communauté')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Donner la communauté/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Quitter la communauté' }))
    expect(api.leaveCommunity).toHaveBeenCalledWith('1')
    expect(await screen.findByText('list page')).toBeInTheDocument()
  })

  it('a non-member is told so and sees no chat', async () => {
    setup(null)
    expect(await screen.findByText(/n'êtes pas membre/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Votre message')).not.toBeInTheDocument()
  })

  it('an unknown community says so', async () => {
    api.getCommunityBySlug.mockResolvedValue(null)
    render(<MemoryRouter initialEntries={['/communautes/x']}><Routes><Route path="/communautes/:slug" element={<Community />} /></Routes></MemoryRouter>)
    expect(await screen.findByText(/n'existe pas/)).toBeInTheDocument()
  })

  it('the owner approves or declines requests', async () => {
    setup('owner')
    await userEvent.click(await screen.findByRole('button', { name: 'Accepter' }))
    expect(api.decideJoinRequest).toHaveBeenCalledWith('r1', true)
    await userEvent.click(screen.getByRole('button', { name: 'Refuser' }))
    expect(api.decideJoinRequest).toHaveBeenCalledWith('r1', false)
  })

  it('the owner gives the community only after confirming, and the owner cannot leave', async () => {
    setup('owner')
    await userEvent.click(await screen.findByRole('button', { name: 'Donner la communauté : awa' }))
    expect(api.transferCommunity).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Donner la communauté à Awa')
    await userEvent.click(screen.getByRole('button', { name: 'Oui, la donner' }))
    await waitFor(() => expect(api.transferCommunity).toHaveBeenCalledWith('1', 'u2'))
    expect(screen.queryByRole('button', { name: 'Quitter la communauté' })).not.toBeInTheDocument()
  })

  it('deleting needs the exact address typed', async () => {
    setup('owner')
    const del = await screen.findByRole('button', { name: 'Supprimer définitivement' })
    expect(del).toBeDisabled()
    await userEvent.type(screen.getByLabelText('slug-1'), 'slug-')
    expect(del).toBeDisabled()
    await userEvent.type(screen.getByLabelText('slug-1'), '1')
    await userEvent.click(del)
    await waitFor(() => expect(api.deleteCommunity).toHaveBeenCalledWith('1', 'slug-1'))
    expect(await screen.findByText('list page')).toBeInTheDocument()
  })

  it('the owner can promote a member and remove one; a moderator cannot remove another moderator', async () => {
    const first = setup('owner')
    await userEvent.click(await screen.findByRole('button', { name: 'Nommer modérateur : awa' }))
    expect(api.setMemberRole).toHaveBeenCalledWith('1', 'u2', 'moderator')
    await userEvent.click(screen.getByRole('button', { name: 'Retirer de la communauté : awa' }))
    expect(api.removeCommunityMember).toHaveBeenCalledWith('1', 'u2')
    first.unmount()
    setup('moderator')
    await screen.findByRole('button', { name: 'Retirer de la communauté : awa' })
    expect(screen.queryByRole('button', { name: 'Retirer de la communauté : bass' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Nommer modérateur/ })).not.toBeInTheDocument()
  })

  it('shows a refusal from the server in French', async () => {
    api.sendMessage.mockRejectedValue(new Error('Slow down: too many messages in the last minute'))
    setup('member')
    await userEvent.type(await screen.findByLabelText('Votre message'), 'Yo')
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('trop de messages')
  })

  it('offers "Signaler" only on other members\' messages that still exist', async () => {
    setup('member')
    const theirs = (await screen.findByText('Bonjour <b>tous</b>')).closest('li') as HTMLElement
    const mine = screen.getByText('Salut').closest('li') as HTMLElement
    expect(within(theirs).getByRole('button', { name: 'Signaler' })).toBeInTheDocument()
    expect(within(mine).queryByRole('button', { name: 'Signaler' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Signaler' })).toHaveLength(1)
  })
})
