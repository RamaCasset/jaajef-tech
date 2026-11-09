import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const signIn = vi.fn()
const signUp = vi.fn()

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ signIn, signUp, loading: false, session: null, member: null, signOut: vi.fn(), refreshMember: vi.fn() }),
}))

import { Login } from '../pages/Login'
import { Signup } from '../pages/Signup'
import { friendlyError } from '../lib/errors'

function at(path: string, ui: JSX.Element, target: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={ui} />
        <Route path={target} element={<p>arrived</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { signIn.mockReset(); signUp.mockReset() })

describe('Login', () => {
  it('signs in and goes to the city', async () => {
    signIn.mockResolvedValue(undefined)
    at('/connexion', <Login />, '/projets')
    await userEvent.type(screen.getByLabelText('Adresse e-mail'), ' moussa@exemple.sn ')
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'secret-pass')
    await userEvent.click(screen.getByRole('button', { name: /Se connecter/ }))
    await waitFor(() => expect(screen.getByText('arrived')).toBeInTheDocument())
    expect(signIn).toHaveBeenCalledWith('moussa@exemple.sn', 'secret-pass')
  })

  it('shows a French message when the password is wrong, and stays', async () => {
    signIn.mockRejectedValue(new Error('Invalid login credentials'))
    at('/connexion', <Login />, '/projets')
    await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'a@b.sn')
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /Se connecter/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Adresse e-mail ou mot de passe incorrect.')
    expect(screen.queryByText('arrived')).not.toBeInTheDocument()
  })

  it('keeps the button off until both fields are filled', async () => {
    at('/connexion', <Login />, '/projets')
    expect(screen.getByRole('button', { name: /Se connecter/ })).toBeDisabled()
  })
})

describe('Signup', () => {
  it('refuses a short password before calling the server', async () => {
    at('/inscription', <Signup />, '/inscription/clan')
    await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'a@b.sn')
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'short')
    await userEvent.click(screen.getByRole('button', { name: /Continuer/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('8 caractères')
    expect(signUp).not.toHaveBeenCalled()
  })

  it('goes to the clan step when signed in right away', async () => {
    signUp.mockResolvedValue('signed_in')
    at('/inscription', <Signup />, '/inscription/clan')
    await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'a@b.sn')
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'long-enough-1')
    await userEvent.click(screen.getByRole('button', { name: /Continuer/ }))
    await waitFor(() => expect(screen.getByText('arrived')).toBeInTheDocument())
  })

  it('asks to confirm the email when no session comes back', async () => {
    signUp.mockResolvedValue('confirm_email')
    at('/inscription', <Signup />, '/inscription/clan')
    await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'a@b.sn')
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'long-enough-1')
    await userEvent.click(screen.getByRole('button', { name: /Continuer/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('Vérifiez votre boîte mail')
  })
})

describe('friendlyError', () => {
  it('maps known messages and hides unknown ones', () => {
    expect(friendlyError(new Error('User already registered'))).toMatch(/déjà utilisée/)
    expect(friendlyError(new Error('Your character is already chosen and cannot be changed'))).toMatch(/déjà choisi/)
    expect(friendlyError(new Error('duplicate key value violates unique constraint "x"'))).toBe('Une erreur est survenue. Réessayez dans un instant.')
  })
})
