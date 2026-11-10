import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const signOut = vi.hoisted(() => vi.fn())
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 2450, profile: { id: 'me', username: 'moussa_dev', display_name: 'Moussa Diop' } }, signOut }),
}))
vi.mock('../lib/api', () => ({
  getMyStaffAccess: vi.fn().mockResolvedValue({ role: null, shopManager: false, shopOwner: false, questWriter: false }),
  unreadNotificationCount: vi.fn().mockResolvedValue(3),
  listMyCommunities: vi.fn().mockResolvedValue([{ id: 'c1', slug: 'gamedev', name: 'GameDev Senegal', role: 'member' }]),
  listMyConversations: vi.fn().mockResolvedValue([{ unread_count: 2 }, { unread_count: 0 }]),
  listMyChatInbox: vi.fn().mockResolvedValue([{ unread_count: 3 }]),
}))
import { AppShell } from '../components/AppShell'

function mount() {
  return render(<MemoryRouter><AppShell><p>contenu</p></AppShell></MemoryRouter>)
}

describe('AppShell', () => {
  it('shows the total of unread private and room messages on the chat button', async () => {
    mount()
    const link = await screen.findByRole('link', { name: 'Messages, 5 non lus' })
    expect(link).toHaveAttribute('href', '/messages')
    expect(within(link).getByText('5')).toBeInTheDocument()
  })

  it('shows the main links in the top bar', async () => {
    mount()
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' })
    expect(within(nav).getByRole('link', { name: 'La Cité' })).toHaveAttribute('href', '/projets')
    expect(within(nav).getByRole('link', { name: 'Projets' })).toHaveAttribute('href', '/depots')
    expect(within(nav).getByRole('link', { name: 'Quêtes' })).toHaveAttribute('href', '/quetes')
    expect(within(nav).getByRole('link', { name: 'Le Souk' })).toHaveAttribute('href', '/souk')
    expect(await screen.findByRole('button', { name: 'Notifications (3)' })).toBeInTheDocument()
  })

  it('shows only the main spaces in the side rail', async () => {
    mount()
    const rail = screen.getByRole('navigation', { name: 'Espaces' })
    await within(rail).findByRole('link', { name: 'GameDev Senegal' })
    const hrefs = within(rail).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/communautes', '/communautes/gamedev', '/blog', '/questions', '/quetes', '/souk', '/jobs'])
  })

  it('opens and closes the side bar with the 3-bar button, and remembers the choice', async () => {
    localStorage.removeItem('jaajef.rail')
    mount()
    const rail = screen.getByRole('navigation', { name: 'Espaces' })
    const toggle = screen.getByRole('button', { name: 'Ouvrir le menu' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(rail).not.toHaveClass('rail-wide')
    await userEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Réduire le menu' })).toHaveAttribute('aria-expanded', 'true')
    expect(rail).toHaveClass('rail-wide')
    expect(localStorage.getItem('jaajef.rail')).toBe('open')
    localStorage.removeItem('jaajef.rail')
  })

  it('keeps the rail and the unread number between pages, so they do not blink at every page change', async () => {
    const first = mount()
    await screen.findByRole('link', { name: 'GameDev Senegal' })
    await screen.findByRole('link', { name: 'Messages, 5 non lus' })
    first.unmount()
    mount()
    // Right away, before anything is loaded again:
    expect(screen.getByRole('link', { name: 'GameDev Senegal' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Messages, 5 non lus' })).toBeInTheDocument()
  })

  it('keeps messages reachable outside the rail and has no arena entry', async () => {
    mount()
    expect(await screen.findByRole('link', { name: /^Messages/ })).toHaveAttribute('href', '/messages')
    await userEvent.click(screen.getByLabelText('Menu du compte'))
    expect(screen.queryByRole('link', { name: 'Arène' })).toBeNull()
  })

  it('shows the Kopeks balance and the search entry', () => {
    mount()
    expect(screen.getByLabelText('Kopeks')).toHaveTextContent('2450 Kopeks')
    expect(screen.getByRole('link', { name: 'Recherche' })).toHaveAttribute('href', '/recherche')
    expect(screen.getByText('contenu')).toBeInTheDocument()
  })

  it('puts profile, settings, guide and sign out in the account menu', async () => {
    mount()
    expect(screen.getByRole('link', { name: 'Mon profil' })).toHaveAttribute('href', '/cite')
    expect(screen.getByRole('link', { name: 'Paramètres' })).toHaveAttribute('href', '/parametres')
    expect(screen.getByRole('link', { name: 'Guide' })).toHaveAttribute('href', '/guide')
    await userEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }))
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
