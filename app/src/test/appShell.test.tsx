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
}))
import { AppShell } from '../components/AppShell'

function mount() {
  return render(<MemoryRouter><AppShell><p>contenu</p></AppShell></MemoryRouter>)
}

describe('AppShell', () => {
  it('shows the four main links in the top bar', async () => {
    mount()
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' })
    expect(within(nav).getByRole('link', { name: 'La Cité' })).toHaveAttribute('href', '/cite')
    expect(within(nav).getByRole('link', { name: 'Projets' })).toHaveAttribute('href', '/projets')
    expect(within(nav).getByRole('link', { name: 'Quêtes' })).toHaveAttribute('href', '/quetes')
    expect(within(nav).getByRole('link', { name: 'Le Souk' })).toHaveAttribute('href', '/souk')
    expect(await screen.findByRole('link', { name: 'Notifications (3)' })).toHaveAttribute('href', '/notifications')
  })

  it('shows my communities, then the other spaces, in the side rail', async () => {
    mount()
    const rail = screen.getByRole('navigation', { name: 'Espaces' })
    expect(await within(rail).findByRole('link', { name: 'GameDev Senegal' })).toHaveAttribute('href', '/communautes/gamedev')
    const hrefs = within(rail).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/communautes/gamedev', '/communautes', '/blog', '/quetes', '/souk', '/jobs'])
  })

  it('keeps messages and the arena reachable outside the rail', async () => {
    mount()
    expect(screen.getByRole('link', { name: 'Messages' })).toHaveAttribute('href', '/messages')
    await userEvent.click(screen.getByLabelText('Menu du compte'))
    expect(screen.getByRole('link', { name: 'Arène' })).toHaveAttribute('href', '/arene')
  })

  it('shows the Kopeks balance and the search entry', () => {
    mount()
    expect(screen.getByLabelText('Kopeks')).toHaveTextContent('2450 Kopeks')
    expect(screen.getByRole('link', { name: 'Recherche' })).toHaveAttribute('href', '/recherche')
    expect(screen.getByText('contenu')).toBeInTheDocument()
  })

  it('puts profile, settings, guide and sign out in the account menu', async () => {
    mount()
    expect(screen.getByRole('link', { name: 'Mon profil' })).toHaveAttribute('href', '/profil/moussa_dev')
    expect(screen.getByRole('link', { name: 'Paramètres' })).toHaveAttribute('href', '/parametres')
    expect(screen.getByRole('link', { name: 'Guide' })).toHaveAttribute('href', '/guide')
    await userEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }))
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
