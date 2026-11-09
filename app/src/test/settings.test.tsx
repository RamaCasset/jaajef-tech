import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const myAccountDeletion = vi.fn()
const requestAccountDeletion = vi.fn()
const cancelAccountDeletion = vi.fn()
const exportMyData = vi.fn()
const listBlockedMembers = vi.fn()
const unblockUser = vi.fn()
const getJobEmailSetting = vi.fn()
const setJobEmailSetting = vi.fn()
const getSignInMethods = vi.fn()
const updatePassword = vi.fn()
const listMutedKinds = vi.fn()
const setNotificationMute = vi.fn()

vi.mock('../lib/api', () => ({
  myAccountDeletion: (...a: unknown[]) => myAccountDeletion(...a),
  requestAccountDeletion: (...a: unknown[]) => requestAccountDeletion(...a),
  cancelAccountDeletion: (...a: unknown[]) => cancelAccountDeletion(...a),
  exportMyData: (...a: unknown[]) => exportMyData(...a),
  listBlockedMembers: (...a: unknown[]) => listBlockedMembers(...a),
  unblockUser: (...a: unknown[]) => unblockUser(...a),
  getJobEmailSetting: (...a: unknown[]) => getJobEmailSetting(...a),
  setJobEmailSetting: (...a: unknown[]) => setJobEmailSetting(...a),
  getSignInMethods: (...a: unknown[]) => getSignInMethods(...a),
  listMutedKinds: (...a: unknown[]) => listMutedKinds(...a),
  setNotificationMute: (...a: unknown[]) => setNotificationMute(...a),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 100, profile: { id: 'me', display_name: 'Moussa Diop' } }, signOut: vi.fn(), updatePassword: (...a: unknown[]) => updatePassword(...a) }),
}))

import { Settings } from '../pages/Settings'

const free = { requested_at: null, delete_on: null, blockers: [] }
const mount = () => render(<MemoryRouter><Settings /></MemoryRouter>)

beforeEach(() => {
  for (const m of [myAccountDeletion, requestAccountDeletion, cancelAccountDeletion, exportMyData, listBlockedMembers, unblockUser, getJobEmailSetting, setJobEmailSetting, getSignInMethods, updatePassword, listMutedKinds, setNotificationMute]) m.mockReset()
  myAccountDeletion.mockResolvedValue(free)
  listBlockedMembers.mockResolvedValue([])
  getJobEmailSetting.mockResolvedValue(true)
  getSignInMethods.mockResolvedValue({ email: 'moussa@exemple.sn', github: false })
  unblockUser.mockResolvedValue(undefined)
  setJobEmailSetting.mockResolvedValue(undefined)
  updatePassword.mockResolvedValue(undefined)
  listMutedKinds.mockResolvedValue(['project_comment'])
  setNotificationMute.mockResolvedValue(undefined)
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})

describe('Settings', () => {
  it('asks twice before deleting, and "no" changes nothing', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Demander la suppression' }))
    expect(requestAccountDeletion).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Non, je garde mon compte' }))
    expect(requestAccountDeletion).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Demander la suppression' })).toBeInTheDocument()
  })

  it('requests the deletion after confirmation, then shows the date and a way to cancel', async () => {
    requestAccountDeletion.mockResolvedValue('2026-11-20T10:00:00Z')
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Demander la suppression' }))
    myAccountDeletion.mockResolvedValue({ requested_at: '2026-11-06T10:00:00Z', delete_on: '2026-11-20T10:00:00Z', blockers: [] })
    await userEvent.click(screen.getByRole('button', { name: 'Oui, supprimer mon compte' }))
    expect(await screen.findByRole('status')).toHaveTextContent('20 novembre 2026')
    expect(requestAccountDeletion).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Annuler la suppression' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Demander la suppression' })).not.toBeInTheDocument()
  })

  it('cancelling goes back to the normal state and says so', async () => {
    myAccountDeletion.mockResolvedValue({ requested_at: '2026-11-06T10:00:00Z', delete_on: '2026-11-20T10:00:00Z', blockers: [] })
    cancelAccountDeletion.mockResolvedValue(undefined)
    mount()
    const cancel = await screen.findByRole('button', { name: 'Annuler la suppression' })
    myAccountDeletion.mockResolvedValue(free)
    await userEvent.click(cancel)
    await waitFor(() => expect(cancelAccountDeletion).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('button', { name: 'Demander la suppression' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('annulée')
  })

  it('a blocked member sees why, and cannot ask', async () => {
    myAccountDeletion.mockResolvedValue({ requested_at: null, delete_on: null, blockers: [{ code: 'community_owner', count: 1 }, { code: 'employer_active', count: 2 }] })
    mount()
    expect(await screen.findByText(/propriétaire d'une communauté/)).toBeInTheDocument()
    expect(screen.getByText(/offres publiées/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Demander la suppression' })).not.toBeInTheDocument()
  })

  it('a refusal from the server is shown in French and the page refreshes', async () => {
    requestAccountDeletion.mockRejectedValue(new Error('Your account cannot be deleted yet: staff'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Demander la suppression' }))
    await userEvent.click(screen.getByRole('button', { name: 'Oui, supprimer mon compte' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('ne peut pas être supprimé')
    expect(myAccountDeletion).toHaveBeenCalledTimes(2)
  })

  it('downloads the data as a file, and tells the member if it fails', async () => {
    exportMyData.mockResolvedValue({ profile: { username: 'moussa' } })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Télécharger mes données' }))
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    exportMyData.mockRejectedValue(new Error('boom'))
    await userEvent.click(screen.getByRole('button', { name: 'Télécharger mes données' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("n'a pas pu")
    click.mockRestore()
  })

  it('offers a retry when the page cannot load', async () => {
    myAccountDeletion.mockRejectedValueOnce(new Error('down'))
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Réessayer' }))
    expect(await screen.findByRole('button', { name: 'Demander la suppression' })).toBeInTheDocument()
  })
})

describe('Settings: more sections', () => {
  it('shows how the member signs in', async () => {
    getSignInMethods.mockResolvedValue({ email: 'moussa@exemple.sn', github: true })
    mount()
    expect(await screen.findByText('Email : moussa@exemple.sn')).toBeInTheDocument()
    expect(screen.getByText('GitHub : connecté')).toBeInTheDocument()
  })

  it('says GitHub is not connected', async () => {
    mount()
    expect(await screen.findByText('GitHub : non connecté')).toBeInTheDocument()
  })

  it('changes the password when both fields match', async () => {
    mount()
    await userEvent.type(await screen.findByLabelText('Nouveau mot de passe'), 'motdepasse1')
    await userEvent.type(screen.getByLabelText('Confirmer le nouveau mot de passe'), 'motdepasse1')
    await userEvent.click(screen.getByRole('button', { name: 'Changer mon mot de passe' }))
    await waitFor(() => expect(updatePassword).toHaveBeenCalledWith('motdepasse1'))
    expect(await screen.findByText('Mot de passe changé.')).toBeInTheDocument()
  })

  it('refuses a password that is too short or does not match', async () => {
    mount()
    await userEvent.type(await screen.findByLabelText('Nouveau mot de passe'), 'court')
    await userEvent.type(screen.getByLabelText('Confirmer le nouveau mot de passe'), 'court')
    await userEvent.click(screen.getByRole('button', { name: 'Changer mon mot de passe' }))
    expect(await screen.findByText(/trop court/)).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Nouveau mot de passe'))
    await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), 'motdepasse1')
    await userEvent.click(screen.getByRole('button', { name: 'Changer mon mot de passe' }))
    expect(await screen.findByText('Les deux mots de passe ne sont pas identiques.')).toBeInTheDocument()
    expect(updatePassword).not.toHaveBeenCalled()
  })

  it('lists blocked members and unblocks the right one', async () => {
    listBlockedMembers.mockResolvedValue([
      { id: 'b1', username: 'awa', display_name: 'Awa' },
      { id: 'b2', username: 'omar', display_name: 'Omar' },
    ])
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Débloquer : Omar' }))
    await waitFor(() => expect(unblockUser).toHaveBeenCalledWith('b2'))
    expect(await screen.findByText('Membre débloqué.')).toBeInTheDocument()
  })

  it('says when nobody is blocked', async () => {
    mount()
    expect(await screen.findByText("Vous n'avez bloqué personne.")).toBeInTheDocument()
  })

  it('switches the job email off', async () => {
    mount()
    await userEvent.click(await screen.findByRole('checkbox', { name: /résumé quotidien/ }))
    await waitFor(() => expect(setJobEmailSetting).toHaveBeenCalledWith(false))
  })

  it('puts the email switch back if saving fails', async () => {
    setJobEmailSetting.mockRejectedValue(new Error('boom'))
    mount()
    const box = await screen.findByRole('checkbox', { name: /résumé quotidien/ })
    await userEvent.click(box)
    await waitFor(() => expect(box).toBeChecked())
    expect(await screen.findAllByRole('alert')).not.toHaveLength(0)
  })
})

describe('Settings: choosing what I receive', () => {
  it('shows the preferences: muted kinds unchecked, the three locked kinds checked and disabled', async () => {
    mount()
    expect(await screen.findByRole('heading', { name: 'Choisir ce que je reçois' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Commentaire sur un de mes projets')).not.toBeChecked())
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
})
