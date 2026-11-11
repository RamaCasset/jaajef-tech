import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  getMyStaffAccess: vi.fn(), listReports: vi.fn().mockResolvedValue([]), listStaff: vi.fn(), listBackOfficeTeam: vi.fn(), setModerator: vi.fn(),
  setBackOfficeRole: vi.fn(), liftSuspension: vi.fn(), findMemberByUsername: vi.fn(),
}))
vi.mock('../lib/api', () => api)
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    member: { kopeks: 0, profile: { id: 'me', username: 'boss', display_name: 'Boss', clan: 'saltigue', mastery: 'bagne', xp: 0 } },
    signOut: vi.fn(),
  }),
}))

import { Staff } from '../pages/Staff'

const access = (extra = {}) => ({ role: 'admin', shopManager: false, questWriter: false, shopOwner: false, ...extra })
const mount = () => render(<MemoryRouter initialEntries={['/equipe?onglet=team']}><Staff /></MemoryRouter>)

beforeEach(() => {
  for (const m of Object.values(api)) m.mockReset()
  api.getMyStaffAccess.mockResolvedValue(access())
  api.listReports.mockResolvedValue([])
  api.listStaff.mockResolvedValue([
    { user_id: 'a1', username: 'chef', role: 'admin', granted_at: '2026-11-01T00:00:00Z' },
    { user_id: 'm1', username: 'modo', role: 'moderator', granted_at: '2026-11-02T00:00:00Z' },
  ])
  api.listBackOfficeTeam.mockResolvedValue([{ user_id: 's1', username: 'boutiquier', role: 'shop_manager', granted_at: '2026-11-03T00:00:00Z' }])
  api.findMemberByUsername.mockResolvedValue({ id: 'u9', username: 'awa' })
  for (const f of [api.setModerator, api.setBackOfficeRole, api.liftSuspension]) f.mockResolvedValue(undefined)
})

describe('Staff team', () => {
  it('is closed to a moderator', async () => {
    api.getMyStaffAccess.mockResolvedValue(access({ role: 'moderator' }))
    mount()
    expect(await screen.findByRole('tab', { name: 'Signalements' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Équipe' })).not.toBeInTheDocument()
    expect(api.listStaff).not.toHaveBeenCalled()
  })

  it('lists the team, with removal only for moderators', async () => {
    mount()
    expect(await screen.findByRole('link', { name: '@chef' })).toBeInTheDocument()
    expect(screen.getByLabelText('Retirer le rôle de modérateur : modo')).toBeInTheDocument()
    expect(screen.queryByLabelText('Retirer le rôle de modérateur : chef')).not.toBeInTheDocument()
  })

  it('removes a moderator and reloads', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByLabelText('Retirer le rôle de modérateur : modo'))
    await waitFor(() => expect(api.setModerator).toHaveBeenCalledWith('m1', false))
    await waitFor(() => expect(api.listStaff).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Modification enregistrée.')).toBeInTheDocument()
  })

  it('names a moderator by username, ignoring a leading @', async () => {
    const user = userEvent.setup()
    mount()
    await user.type(await screen.findByLabelText("Nom d'utilisateur", { selector: '#mod-name' }), '@awa')
    await user.click(screen.getByText('Nommer modérateur'))
    await waitFor(() => expect(api.findMemberByUsername).toHaveBeenCalledWith('@awa'))
    await waitFor(() => expect(api.setModerator).toHaveBeenCalledWith('u9', true))
  })

  it('says so when no member has that username, and changes nothing', async () => {
    api.findMemberByUsername.mockResolvedValue(null)
    const user = userEvent.setup()
    mount()
    await user.type(await screen.findByLabelText("Nom d'utilisateur", { selector: '#mod-name' }), 'personne')
    await user.click(screen.getByText('Nommer modérateur'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Aucun membre ne s\'appelle « personne »')
    expect(api.setModerator).not.toHaveBeenCalled()
  })

  it('gives the chosen back-office role', async () => {
    const user = userEvent.setup()
    mount()
    await user.selectOptions(await screen.findByLabelText('Rôle'), 'quest_writer')
    await user.type(screen.getByLabelText("Nom d'utilisateur", { selector: '#role-name' }), 'awa')
    await user.click(screen.getByText('Donner le rôle'))
    await waitFor(() => expect(api.setBackOfficeRole).toHaveBeenCalledWith('u9', 'quest_writer', true))
  })

  it('removes a back-office role', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByLabelText(/Retirer : boutiquier/))
    await waitFor(() => expect(api.setBackOfficeRole).toHaveBeenCalledWith('s1', 'shop_manager', false))
  })

  it('lifts a suspension for the named member', async () => {
    const user = userEvent.setup()
    mount()
    await user.type(await screen.findByLabelText("Nom d'utilisateur", { selector: '#lift-name' }), 'awa')
    await user.click(screen.getByText('Lever la suspension'))
    await waitFor(() => expect(api.liftSuspension).toHaveBeenCalledWith('u9'))
  })

  it('shows a friendly message when the database refuses', async () => {
    api.liftSuspension.mockRejectedValue(new Error('That member is not suspended'))
    const user = userEvent.setup()
    mount()
    await user.type(await screen.findByLabelText("Nom d'utilisateur", { selector: '#lift-name' }), 'awa')
    await user.click(screen.getByText('Lever la suspension'))
    expect(await screen.findByRole('alert')).toHaveTextContent("n'est pas suspendu")
  })
})
