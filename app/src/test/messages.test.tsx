import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  listMyConversations: vi.fn(), startConversation: vi.fn(), listDirectMessages: vi.fn(), sendDirectMessage: vi.fn(),
  deleteDirectMessage: vi.fn(), markConversationRead: vi.fn(), blockUser: vi.fn(), unblockUser: vi.fn(), isBlockedByMe: vi.fn(),
  loadProfile: vi.fn(), listMyChatInbox: vi.fn(),
}))
vi.mock('../lib/api', () => api)
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ session: { user: { id: 'me' } }, member: { kopeks: 1, profile: { id: 'me', display_name: 'Moussa' } }, signOut: vi.fn() }),
}))

import { Messages } from '../pages/Messages'
import { Conversation } from '../pages/Conversation'
import { Profile } from '../pages/Profile'

const conv = (extra = {}) => ({
  conversation_id: 'c1', other_user_id: 'u2', other_username: 'awa', other_display_name: 'Awa Diallo', other_avatar_url: null,
  last_message_preview: 'À demain', last_message_at: '2026-11-05T10:00:00Z', unread_count: 2, ...extra,
})
const dm = (id: number, sender: string, body: string, extra = {}) => ({ id, sender_id: sender, body, file_name: null, created_at: '2026-11-05T10:00:00Z', deleted_at: null, ...extra })

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.listMyConversations.mockResolvedValue([conv()])
  api.listMyChatInbox.mockResolvedValue([
    { community_id: 'k1', slug: 'web-dev', name: 'Web Dev', avatar_url: null, project_id: null, last_message_preview: 'Bienvenue', last_author_name: 'Awa', last_message_at: '2026-11-05T10:00:00Z', unread_count: 3 },
    { community_id: 'k2', slug: 'salon-pdf', name: 'Salon PDF', avatar_url: null, project_id: 'p1', last_message_preview: null, last_author_name: null, last_message_at: null, unread_count: 0 },
  ])
  api.listDirectMessages.mockResolvedValue([dm(1, 'u2', 'Salut <i>toi</i>'), dm(2, 'me', 'Hello'), dm(3, 'u2', 'oups', { deleted_at: '2026-11-05T11:00:00Z' })])
  api.isBlockedByMe.mockResolvedValue(false)
  for (const f of [api.sendDirectMessage, api.deleteDirectMessage, api.markConversationRead, api.blockUser, api.unblockUser]) f.mockResolvedValue(undefined)
})

describe('Inbox', () => {
  it('lists conversations with the other person, preview and unread count, linking to the thread', async () => {
    render(<MemoryRouter><Messages /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Awa Diallo' })).toHaveAttribute('href', '/messages/c1')
    expect(screen.getByText('À demain')).toBeInTheDocument()
    expect(screen.getByText('2 non lus')).toBeInTheDocument()
  })
  it('explains how to start when empty, and offers a retry on failure', async () => {
    api.listMyConversations.mockResolvedValueOnce([])
    const first = render(<MemoryRouter><Messages /></MemoryRouter>)
    expect(await screen.findByText(/Ouvrez le profil d'un membre/)).toBeInTheDocument()
    first.unmount()
    api.listMyConversations.mockRejectedValueOnce(new Error('down'))
    render(<MemoryRouter><Messages /></MemoryRouter>)
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('link', { name: 'Awa Diallo' })).toBeInTheDocument()
  })
})

describe('Inbox tabs', () => {
  it('splits communities from project rooms, with last message and unread counts', async () => {
    render(<MemoryRouter><Messages /></MemoryRouter>)
    await screen.findByRole('link', { name: 'Awa Diallo' })
    await userEvent.click(screen.getByRole('tab', { name: /Communautés/ }))
    expect(await screen.findByRole('link', { name: 'Web Dev' })).toHaveAttribute('href', '/communautes/web-dev')
    expect(screen.getByText('Awa : Bienvenue')).toBeInTheDocument()
    expect(screen.getAllByText('3')).toHaveLength(2)
    expect(screen.queryByRole('link', { name: 'Salon PDF' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Projets/ }))
    expect(await screen.findByRole('link', { name: 'Salon PDF' })).toHaveAttribute('href', '/communautes/salon-pdf')
    expect(screen.getByText('Aucun message pour l\'instant')).toBeInTheDocument()
  })
  it('explains an empty communities tab and still shows private messages when rooms fail', async () => {
    api.listMyChatInbox.mockRejectedValue(new Error('down'))
    render(<MemoryRouter><Messages /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Awa Diallo' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Communautés/ }))
    expect(await screen.findByText(/Vous ne faites partie d'aucune communauté/)).toBeInTheDocument()
  })
})

describe('Conversation', () => {
  const mount = () => render(
    <MemoryRouter initialEntries={['/messages/c1']}>
      <Routes><Route path="/messages/:id" element={<Conversation />} /></Routes>
    </MemoryRouter>,
  )

  it('shows messages as plain text, mine marked, deleted ones without their text, and marks the thread read', async () => {
    mount()
    expect(await screen.findByText('Salut <i>toi</i>')).toBeInTheDocument()
    expect(document.querySelector('p i')).toBeNull()
    expect(screen.getByText('Message supprimé')).toBeInTheDocument()
    expect(screen.queryByText('oups')).not.toBeInTheDocument()
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('data-mine'))).toEqual(['false', 'true', 'false'])
    await waitFor(() => expect(api.markConversationRead).toHaveBeenCalledWith('c1'))
  })

  it('only my own messages can be deleted', async () => {
    mount()
    await screen.findByText('Hello')
    const buttons = screen.getAllByRole('button', { name: 'Supprimer' })
    expect(buttons).toHaveLength(1)
    await userEvent.click(buttons[0])
    expect(api.deleteDirectMessage).toHaveBeenCalledWith(2)
  })

  it('offers "Signaler" only on the other person\'s messages that still exist', async () => {
    mount()
    await screen.findByText('Hello')
    const rows = screen.getAllByRole('listitem')
    const theirs = rows.find((r) => r.getAttribute('data-mine') === 'false') as HTMLElement
    const mine = rows.find((r) => r.getAttribute('data-mine') === 'true') as HTMLElement
    expect(within(theirs).getByRole('button', { name: 'Signaler' })).toBeInTheDocument()
    expect(within(mine).queryByRole('button', { name: 'Signaler' })).not.toBeInTheDocument()
  })

  it('sends a message, clears the box, reloads', async () => {
    mount()
    await userEvent.type(await screen.findByLabelText('Votre message'), 'Coucou')
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }))
    await waitFor(() => expect(api.sendDirectMessage).toHaveBeenCalledWith('c1', 'Coucou'))
    await waitFor(() => expect(screen.getByLabelText('Votre message')).toHaveValue(''))
  })

  it('the send button stays off for an empty or blank message', async () => {
    mount()
    const send = await screen.findByRole('button', { name: 'Envoyer' })
    expect(send).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Votre message'), '   ')
    expect(send).toBeDisabled()
  })

  it('says in French when the person cannot be written to', async () => {
    api.sendDirectMessage.mockRejectedValue(new Error('You cannot message this person'))
    mount()
    await userEvent.type(await screen.findByLabelText('Votre message'), 'Coucou')
    await userEvent.click(screen.getByRole('button', { name: 'Envoyer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Vous ne pouvez pas écrire')
  })

  it('blocks and unblocks, and says when the person is blocked', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Bloquer ce membre' }))
    expect(api.blockUser).toHaveBeenCalledWith('u2')
    expect(await screen.findByRole('status')).toHaveTextContent('Vous avez bloqué')
    await userEvent.click(screen.getByRole('button', { name: 'Débloquer ce membre' }))
    expect(api.unblockUser).toHaveBeenCalledWith('u2')
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })

  it('shows "blocked" from the start when it already is', async () => {
    api.isBlockedByMe.mockResolvedValue(true)
    mount()
    expect(await screen.findByRole('status')).toHaveTextContent('Vous avez bloqué')
    expect(screen.getByRole('button', { name: 'Débloquer ce membre' })).toBeInTheDocument()
  })

  it('an unknown conversation says so', async () => {
    api.listMyConversations.mockResolvedValue([])
    mount()
    expect(await screen.findByText(/n'existe pas/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Votre message')).not.toBeInTheDocument()
  })
})

describe('Writing from a profile', () => {
  const profile = (id: string) => ({
    profile: { id, username: 'awa', display_name: 'Awa Diallo', avatar_url: null, banner_url: null, bio: null, location: null, github_username: null, clan: null, mastery: null, xp: 0, available_to_collab: false, is_verified: false, created_at: '2026-01-01T00:00:00Z' },
    xpPerLevel: 100, badges: [], projects: [], questsSolved: null, appreciation: 0,
  })
  const mount = () => render(
    <MemoryRouter initialEntries={['/profil/awa']}>
      <Routes>
        <Route path="/profil/:username" element={<Profile />} />
        <Route path="/messages/:id" element={<p>thread opened</p>} />
      </Routes>
    </MemoryRouter>,
  )

  it('opens the conversation with that member', async () => {
    api.loadProfile.mockResolvedValue(profile('u2'))
    api.startConversation.mockResolvedValue('c9')
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Envoyer un message' }))
    expect(api.startConversation).toHaveBeenCalledWith('u2')
    expect(await screen.findByText('thread opened')).toBeInTheDocument()
  })

  it('shows the refusal in French and stays on the profile', async () => {
    api.loadProfile.mockResolvedValue(profile('u2'))
    api.startConversation.mockRejectedValue(new Error('You cannot message this person'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Envoyer un message' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Vous ne pouvez pas écrire')
    expect(screen.queryByText('thread opened')).not.toBeInTheDocument()
  })

  it('no button on my own profile', async () => {
    api.loadProfile.mockResolvedValue(profile('me'))
    mount()
    await screen.findByText('Awa Diallo')
    expect(screen.queryByRole('button', { name: 'Envoyer un message' })).not.toBeInTheDocument()
  })
})
