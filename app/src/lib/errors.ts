import { fr } from '../i18n/fr'

/** Turns a database or sign-in error into a short French sentence. Unknown errors get a generic message. */
export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return fr.errors.invalidCredentials
  if (m.includes('already registered') || m.includes('already been registered')) return fr.errors.emailTaken
  if (m.includes('password should be at least') || m.includes('weak password')) return fr.errors.weakPassword
  if (m.includes('already chosen')) return fr.errors.characterLocked
  if (m.includes('sign in first') || m.includes('not authenticated')) return fr.errors.notSignedIn
  return fr.common.unknownError
}
