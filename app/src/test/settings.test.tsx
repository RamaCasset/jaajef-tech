import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const myAccountDeletion = vi.fn()
const requestAccountDeletion = vi.fn()
const cancelAccountDeletion = vi.fn()
const exportMyData = vi.fn()

vi.mock('../lib/api', () => ({
  myAccountDeletion: (...a: unknown[]) => myAccountDeletion(...a),
  requestAccountDeletion: (...a: unknown[]) => requestAccountDeletion(...a),
  cancelAccountDeletion: (...a: unknown[]) => cancelAccountDeletion(...a),
  exportMyData: (...a: unknown[]) => exportMyData(...a),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ member: { kopeks: 100, profile: { display_name: 'Moussa Diop' } }, signOut: vi.fn() }),
}))

import { Settings } from '../pages/Settings'

const free = { requested_at: null, delete_on: null, blockers: [] }
const mount = () => render(<MemoryRouter><Settings /></MemoryRouter>)

beforeEach(() => {
  for (const m of [myAccountDeletion, requestAccountDeletion, cancelAccountDeletion, exportMyData]) m.mockReset()
  myAccountDeletion.mockResolvedValue(free)
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
