import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const signIn = vi.fn()
const signUp = vi.fn()
const signInWithGithub = vi.fn()
const signInWithGoogle = vi.fn()
const isUsernameAvailable = vi.fn()

vi.mock('../lib/api', () => ({ isUsernameAvailable: (u: string) => isUsernameAvailable(u) }))

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ signIn, signUp, signInWithGithub, signInWithGoogle, loading: false, session: null, member: null, signOut: vi.fn(), refreshMember: vi.fn() }),
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

beforeEach(() => { signIn.mockReset(); signUp.mockReset(); signInWithGithub.mockReset(); signInWithGoogle.mockReset(); isUsernameAvailable.mockReset(); isUsernameAvailable.mockResolvedValue(true) })

describe('Login', () => {
  it('signs in and goes to the city', async () => {
    signIn.mockResolvedValue(undefined)
    at('/connexion', <Login />, '/la-cite')
    await userEvent.type(screen.getByLabelText('Adresse e-mail'), ' moussa@exemple.sn ')
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'secret-pass')
    await userEvent.click(screen.getByRole('button', { name: /^Se connecter →/ }))
    await waitFor(() => expect(screen.getByText('arrived')).toBeInTheDocument())
    expect(signIn).toHaveBeenCalledWith('moussa@exemple.sn', 'secret-pass')
  })

  it('shows a French message when the password is wrong, and stays', async () => {
    signIn.mockRejectedValue(new Error('Invalid login credentials'))
    at('/connexion', <Login />, '/la-cite')
    await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'a@b.sn')
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /^Se connecter →/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Adresse e-mail ou mot de passe incorrect.')
    expect(screen.queryByText('arrived')).not.toBeInTheDocument()
  })

  it('keeps the button off until both fields are filled', async () => {
    at('/connexion', <Login />, '/la-cite')
    expect(screen.getByRole('button', { name: /^Se connecter →/ })).toBeDisabled()
  })
})

describe('GitHub button', () => {
  it('is on the sign in page and starts the GitHub sign in', async () => {
    signInWithGithub.mockResolvedValue(undefined)
    at('/connexion', <Login />, '/la-cite')
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter avec GitHub' }))
    expect(signInWithGithub).toHaveBeenCalledTimes(1)
  })

  it('is on the sign up page too, and shows a message if it fails', async () => {
    signInWithGithub.mockRejectedValue(new Error('boom'))
    at('/inscription', <Signup />, '/inscription/clan')
    await userEvent.click(screen.getByRole('button', { name: "S'inscrire avec GitHub" }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})

describe('Google button', () => {
  it('is on the sign in page and starts the Google sign in', async () => {
    signInWithGoogle.mockResolvedValue(undefined)
    at('/connexion', <Login />, '/la-cite')
    await userEvent.click(screen.getByRole('button', { name: 'Se connecter avec Google' }))
    expect(signInWithGoogle).toHaveBeenCalledTimes(1)
  })

  it('is on the sign up page too, and shows a message if it fails', async () => {
    signInWithGoogle.mockRejectedValue(new Error('boom'))
    at('/inscription', <Signup />, '/inscription/clan')
    await userEvent.click(screen.getByRole('button', { name: "S'inscrire avec Google" }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})

describe('Signup', () => {
  it('refuses a short password before calling the server', async () => {
    at('/inscription', <Signup />, '/inscription/clan')
    await userEvent.type(screen.getByLabelText('Nom complet'), 'Awa Diallo')
    await userEvent.type(screen.getByLabelText('Nom d’utilisateur'), 'Awa_Dev')
    await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'a@b.sn')
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'short')
    await userEvent.click(screen.getByRole('button', { name: /Continuer/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('8 caractères')
    expect(signUp).not.toHaveBeenCalled()
  })

  it('sends the full name and the lowercase username with the sign-up', async () => {
    signUp.mockResolvedValue('signed_in')
    at('/inscription', <Signup />, '/inscription/clan')
    await userEvent.type(screen.getByLabelText('Nom complet'), 'Awa Diallo')
    await userEvent.type(screen.getByLabelText('Nom d’utilisateur'), 'Awa_Dev')
    await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'a@b.sn')
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'long-enough-1')
    await userEvent.click(screen.getByRole('button', { name: /Continuer/ }))
    await waitFor(() => expect(signUp).toHaveBeenCalledWith('a@b.sn', 'long-enough-1', { fullName: 'Awa Diallo', username: 'awa_dev' }))
    expect(isUsernameAvailable).toHaveBeenCalledWith('awa_dev')
  })

  it('refuses a username that is already taken, without creating the account', async () => {
    isUsernameAvailable.mockResolvedValue(false)
    at('/inscription', <Signup />, '/inscription/clan')
    await userEvent.type(screen.getByLabelText('Nom complet'), 'Awa Diallo')
    await userEvent.type(screen.getByLabelText('Nom d’utilisateur'), 'Awa_Dev')
    await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'a@b.sn')
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'long-enough-1')
    await userEvent.click(screen.getByRole('button', { name: /Continuer/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('déjà pris')
    expect(signUp).not.toHaveBeenCalled()
  })

  it('refuses a badly formed username before asking the server', async () => {
    at('/inscription', <Signup />, '/inscription/clan')
    await userEvent.type(screen.getByLabelText('Nom complet'), 'Awa Diallo')
    await userEvent.type(screen.getByLabelText('Nom d’utilisateur'), 'a b')
    await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'a@b.sn')
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'long-enough-1')
    await userEvent.click(screen.getByRole('button', { name: /Continuer/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('3 à 24 caractères')
    expect(isUsernameAvailable).not.toHaveBeenCalled()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('goes to the clan step when signed in right away', async () => {
    signUp.mockResolvedValue('signed_in')
    at('/inscription', <Signup />, '/inscription/clan')
    await userEvent.type(screen.getByLabelText('Nom complet'), 'Awa Diallo')
    await userEvent.type(screen.getByLabelText('Nom d’utilisateur'), 'Awa_Dev')
    await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'a@b.sn')
    await userEvent.type(screen.getByLabelText('Mot de passe'), 'long-enough-1')
    await userEvent.click(screen.getByRole('button', { name: /Continuer/ }))
    await waitFor(() => expect(screen.getByText('arrived')).toBeInTheDocument())
  })

  it('asks to confirm the email when no session comes back', async () => {
    signUp.mockResolvedValue('confirm_email')
    at('/inscription', <Signup />, '/inscription/clan')
    await userEvent.type(screen.getByLabelText('Nom complet'), 'Awa Diallo')
    await userEvent.type(screen.getByLabelText('Nom d’utilisateur'), 'Awa_Dev')
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
