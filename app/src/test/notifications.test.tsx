import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationRow } from '../lib/api'

const listNotifications = vi.fn()
const listMutedKinds = vi.fn()
const markNotificationRead = vi.fn()
const markAllNotificationsRead = vi.fn()
const setNotificationMute = vi.fn()
const unreadNotificationCount = vi.fn()

vi.mock('../lib/api', () => ({
  listNotifications: (...a: unknown[]) => listNotifications(...a),
  listMutedKinds: (...a: unknown[]) => listMutedKinds(...a),
  markNotificationRead: (...a: unknown[]) => markNotificationRead(...a),
  markAllNotificationsRead: (...a: unknown[]) => markAllNotificationsRead(...a),
  setNotificationMute: (...a: unknown[]) => setNotificationMute(...a),
  unreadNotificationCount: (...a: unknown[]) => unreadNotificationCount(...a),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 100, profile: { display_name: 'Moussa Diop' } }, signOut: vi.fn() }),
}))

import { Notifications } from '../pages/Notifications'
import { AppShell } from '../components/AppShell'

const note = (id: number, kind: NotificationRow['kind'], data: Record<string, unknown>, read = false): NotificationRow => ({
  id, kind, data, created_at: '2026-11-05T10:00:00Z', read_at: read ? '2026-11-05T11:00:00Z' : null,
})
const mount = () => render(<MemoryRouter><Notifications /></MemoryRouter>)

beforeEach(() => {
  for (const m of [listNotifications, listMutedKinds, markNotificationRead, markAllNotificationsRead, setNotificationMute, unreadNotificationCount]) m.mockReset()
  listNotifications.mockResolvedValue([
    note(1, 'project_starred', { actor_username: 'awa', project_title: 'Teranga' }),
    note(2, 'badge_unlocked', { badge_name: 'Premier pas' }, true),
    note(3, 'suspension', { until: '2026-12-01T00:00:00Z' }),
  ])
  listMutedKinds.mockResolvedValue(['project_comment'])
  markNotificationRead.mockResolvedValue(undefined)
  markAllNotificationsRead.mockResolvedValue(2)
  setNotificationMute.mockResolvedValue(undefined)
  unreadNotificationCount.mockResolvedValue(0)
})

describe('Notifications page', () => {
  it('writes each notice as a French sentence, marks the unread ones, and links to the person', async () => {
    mount()
    expect(await screen.findByText(/awa a mis une étoile à « Teranga »/)).toBeInTheDocument()
    expect(screen.getByText(/Nouveau badge : Premier pas/)).toBeInTheDocument()
    expect(screen.getByText(/suspendu jusqu'au 1 décembre 2026/)).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('data-unread'))).toEqual(['true', 'false', 'true'])
    expect(screen.getByRole('link', { name: '@awa' })).toHaveAttribute('href', '/profil/awa')
  })

  it('tells the owner about a proposal and the author about its outcome, with a link to the proposals', async () => {
    listNotifications.mockResolvedValue([
      note(10, 'proposal_opened', { actor_username: 'ndeye_k', project_title: 'Teranga', title: 'Corrige le titre', project_id: 'p1' }),
      note(11, 'proposal_merged', { project_title: 'Teranga', title: 'Corrige le titre', project_id: 'p1' }),
      note(12, 'proposal_declined', { project_title: 'Teranga', title: 'Autre idée', project_id: 'p1' }),
    ])
    mount()
    expect(await screen.findByText('ndeye_k propose des changements pour « Teranga » : « Corrige le titre ».')).toBeInTheDocument()
    expect(screen.getByText('Votre proposition « Corrige le titre » a été fusionnée dans « Teranga ».')).toBeInTheDocument()
    expect(screen.getByText("Votre proposition « Autre idée » n'a pas été retenue pour « Teranga ».")).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: 'Voir les propositions' })
    expect(links).toHaveLength(3)
    expect(links[0]).toHaveAttribute('href', '/projets/p1/propositions')
    expect(screen.getByLabelText('Proposition de changements reçue')).toBeInTheDocument()
  })

  it('opening an unread notice marks it read once; an already read one does nothing', async () => {
    mount()
    await userEvent.click(await screen.findByText(/a mis une étoile/))
    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith(1))
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('data-unread', 'false')
    await userEvent.click(screen.getByText(/a mis une étoile/))
    await userEvent.click(screen.getByText(/Nouveau badge/))
    expect(markNotificationRead).toHaveBeenCalledTimes(1)
  })

  it('"mark all as read" clears every unread mark and the button goes away', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Tout marquer comme lu' }))
    expect(markAllNotificationsRead).toHaveBeenCalledTimes(1)
    screen.getAllByRole('listitem').forEach((r) => expect(r).toHaveAttribute('data-unread', 'false'))
    expect(screen.queryByRole('button', { name: 'Tout marquer comme lu' })).not.toBeInTheDocument()
  })

  it('shows the preferences: muted kinds unchecked, the three locked kinds checked and disabled', async () => {
    mount()
    await screen.findByText(/a mis une étoile/)
    expect(screen.getByLabelText('Commentaire sur un de mes projets')).not.toBeChecked()
    expect(screen.getByLabelText('Étoile sur un de mes projets')).toBeChecked()
    for (const l of [/^Avertissement/, /^Suspension/, /^Projet masqué/]) {
      const box = screen.getByLabelText(l)
      expect(box).toBeChecked()
      expect(box).toBeDisabled()
    }
  })

  it('switching a kind off or on calls the database; a failure puts the box back and says so', async () => {
    mount()
    await userEvent.click(await screen.findByLabelText('Étoile sur un de mes projets'))
    expect(setNotificationMute).toHaveBeenCalledWith('project_starred', true)
    expect(screen.getByLabelText('Étoile sur un de mes projets')).not.toBeChecked()
    await userEvent.click(screen.getByLabelText('Commentaire sur un de mes projets'))
    expect(setNotificationMute).toHaveBeenCalledWith('project_comment', false)
    setNotificationMute.mockRejectedValueOnce(new Error('boom'))
    await userEvent.click(screen.getByLabelText('Étoile sur un de mes projets'))
    expect(await screen.findByRole('alert')).toHaveTextContent("n'a pas été enregistré")
    expect(screen.getByLabelText('Étoile sur un de mes projets')).not.toBeChecked()
  })

  it('says when there is nothing, and offers a retry when loading fails', async () => {
    listNotifications.mockResolvedValueOnce([])
    const first = mount()
    expect(await screen.findByText("Rien de nouveau pour l'instant.")).toBeInTheDocument()
    first.unmount()
    listNotifications.mockRejectedValueOnce(new Error('down'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByText(/a mis une étoile/)).toBeInTheDocument()
  })
})

describe('Notification link in the top bar', () => {
  it('shows the unread number next to the link, and nothing when there are none', async () => {
    unreadNotificationCount.mockResolvedValue(3)
    const first = render(<MemoryRouter><AppShell><p>x</p></AppShell></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Notifications (3)' })).toHaveAttribute('href', '/notifications')
    first.unmount()
    unreadNotificationCount.mockResolvedValue(0)
    render(<MemoryRouter><AppShell><p>x</p></AppShell></MemoryRouter>)
    await waitFor(() => expect(unreadNotificationCount).toHaveBeenCalledTimes(2))
    const link = screen.getByRole('link', { name: 'Notifications' })
    expect(within(link).queryByText('0')).not.toBeInTheDocument()
  })
})
