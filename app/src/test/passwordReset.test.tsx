import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestPasswordReset = vi.fn()
const updatePassword = vi.fn()
let session: unknown = null
let loading = false

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ requestPasswordReset, updatePassword, loading, session, member: null, signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(), refreshMember: vi.fn() }),
}))

import { ForgotPassword } from '../pages/ForgotPassword'
import { ResetPassword } from '../pages/ResetPassword'
import { Login } from '../pages/Login'
import { friendlyError } from '../lib/errors'

function at(path: string, ui: JSX.Element) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={ui} />
        <Route path="/mot-de-passe-oublie" element={<p>forgot page</p>} />
        <Route path="/la-cite" element={<p>arrived</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { requestPasswordReset.mockReset(); updatePassword.mockReset(); session = null; loading = false })

describe('Forgot password', () => {
  it('the link on the sign-in page leads here', async () => {
    at('/connexion', <Login />)
    await userEvent.click(screen.getByRole('link', { name: 'Mot de passe oublié ?' }))
    expect(screen.getByText('forgot page')).toBeInTheDocument()
  })

  it('sends the trimmed address and shows the same message, whatever the account', async () => {
    requestPasswordReset.mockResolvedValue(undefined)
    at('/mot-de-passe-oublie', <ForgotPassword />)
    expect(screen.getByRole('button', { name: /Envoyer le lien/ })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Adresse e-mail'), ' moussa@exemple.sn ')
    await userEvent.click(screen.getByRole('button', { name: /Envoyer le lien/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('Si un compte existe')
    expect(requestPasswordReset).toHaveBeenCalledWith('moussa@exemple.sn')
    expect(screen.queryByLabelText('Adresse e-mail')).not.toBeInTheDocument()
  })

  it('shows a French message when the service refuses (too many tries)', async () => {
    requestPasswordReset.mockRejectedValue(new Error('email rate limit exceeded'))
    at('/mot-de-passe-oublie', <ForgotPassword />)
    await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'a@b.sn')
    await userEvent.click(screen.getByRole('button', { name: /Envoyer le lien/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Trop de tentatives')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('Reset password', () => {
  it('without a valid link, offers to ask for a new one and shows no form', () => {
    at('/nouveau-mot-de-passe', <ResetPassword />)
    expect(screen.getByText('Ce lien ne fonctionne plus')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Demander un nouveau lien' })).toHaveAttribute('href', '/mot-de-passe-oublie')
    expect(screen.queryByLabelText('Nouveau mot de passe')).not.toBeInTheDocument()
  })

  it('waits while the link is being read', () => {
    loading = true
    at('/nouveau-mot-de-passe', <ResetPassword />)
    expect(screen.getByText('Chargement…')).toBeInTheDocument()
    expect(screen.queryByText('Ce lien ne fonctionne plus')).not.toBeInTheDocument()
  })

  it('refuses a short password and two different passwords before calling the server', async () => {
    session = { user: { id: 'u' } }
    at('/nouveau-mot-de-passe', <ResetPassword />)
    await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), 'short')
    await userEvent.type(screen.getByLabelText('Répétez le mot de passe'), 'short')
    await userEvent.click(screen.getByRole('button', { name: /Enregistrer/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('8 caractères')
    await userEvent.clear(screen.getByLabelText('Nouveau mot de passe'))
    await userEvent.clear(screen.getByLabelText('Répétez le mot de passe'))
    await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), 'long-enough-1')
    await userEvent.type(screen.getByLabelText('Répétez le mot de passe'), 'long-enough-2')
    await userEvent.click(screen.getByRole('button', { name: /Enregistrer/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('pas identiques')
    expect(updatePassword).not.toHaveBeenCalled()
  })

  it('saves the new password, confirms, then enters the city', async () => {
    session = { user: { id: 'u' } }
    updatePassword.mockResolvedValue(undefined)
    at('/nouveau-mot-de-passe', <ResetPassword />)
    await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), 'long-enough-1')
    await userEvent.type(screen.getByLabelText('Répétez le mot de passe'), 'long-enough-1')
    await userEvent.click(screen.getByRole('button', { name: /Enregistrer/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('a été changé')
    expect(updatePassword).toHaveBeenCalledWith('long-enough-1')
    await userEvent.click(screen.getByRole('button', { name: /Entrer dans la Cité/ }))
    await waitFor(() => expect(screen.getByText('arrived')).toBeInTheDocument())
  })

  it('explains it when the new password is the old one', async () => {
    session = { user: { id: 'u' } }
    updatePassword.mockRejectedValue(new Error('New password should be different from the old password.'))
    at('/nouveau-mot-de-passe', <ResetPassword />)
    await userEvent.type(screen.getByLabelText('Nouveau mot de passe'), 'long-enough-1')
    await userEvent.type(screen.getByLabelText('Répétez le mot de passe'), 'long-enough-1')
    await userEvent.click(screen.getByRole('button', { name: /Enregistrer/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('différent')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('friendlyError', () => {
  it('knows the two new cases', () => {
    expect(friendlyError(new Error('For security purposes, you can only request this after 52 seconds.'))).toContain('Trop de tentatives')
    expect(friendlyError(new Error('New password should be different from the old password.'))).toContain('différent')
  })
})
