import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const myEquippedTheme = vi.fn()
vi.mock('../lib/api', () => ({ myEquippedTheme: (...a: unknown[]) => myEquippedTheme(...a) }))
let auth: { loading: boolean; session: { user: { id: string } } | null } = { loading: true, session: null }
vi.mock('../auth/AuthContext', () => ({ useAuth: () => auth }))

import { ThemeApplier } from '../components/ThemeApplier'
import { applyTheme } from '../lib/theme'

const accent = () => document.documentElement.style.getPropertyValue('--accent')

beforeEach(() => {
  myEquippedTheme.mockReset()
  document.documentElement.removeAttribute('style')
  localStorage.clear()
})

describe('ThemeApplier', () => {
  it('keeps the remembered theme while the sign-in is still being read', () => {
    applyTheme({ accent: '#f0b24a' })
    auth = { loading: true, session: null }
    render(<ThemeApplier />)
    expect(accent()).toBe('#f0b24a')
    expect(myEquippedTheme).not.toHaveBeenCalled()
  })

  it('puts the worn theme on once signed in', async () => {
    myEquippedTheme.mockResolvedValue({ accent: '#e85fb0' })
    auth = { loading: false, session: { user: { id: 'me' } } }
    render(<ThemeApplier />)
    await waitFor(() => expect(accent()).toBe('#e85fb0'))
  })

  it('keeps the remembered theme if the worn one cannot be loaded', async () => {
    applyTheme({ accent: '#f0b24a' })
    myEquippedTheme.mockRejectedValue(new Error('network'))
    auth = { loading: false, session: { user: { id: 'me' } } }
    render(<ThemeApplier />)
    await waitFor(() => expect(myEquippedTheme).toHaveBeenCalled())
    expect(accent()).toBe('#f0b24a')
  })

  it('goes back to the default look when signed out', () => {
    applyTheme({ accent: '#f0b24a' })
    auth = { loading: false, session: null }
    render(<ThemeApplier />)
    expect(accent()).toBe('')
  })
})
