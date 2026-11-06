import { fr } from '../i18n/fr'

/** Turns a database or sign-in error into a short French sentence. Unknown errors get a generic message. */
export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return fr.errors.invalidCredentials
  if (m.includes('already registered') || m.includes('already been registered')) return fr.errors.emailTaken
  if (m.includes('password should be at least') || m.includes('weak password')) return fr.errors.weakPassword
  if (m.includes('post not found')) return fr.errors.postNotFound
  if (m.includes('hidden by staff')) return fr.errors.postHidden
  if (m.includes('publishing too fast')) return fr.errors.publishingTooFast
  if (m.includes('title needs at least')) return fr.errors.titleShort
  if (m.includes('write something first')) return fr.errors.writeSomething
  if (m.includes('cover image must be')) return fr.errors.coverSecure
  if (m.includes('already chosen')) return fr.errors.characterLocked
  if (m.includes('not enough kopeks')) return fr.errors.notEnoughKopeks
  if (m.includes('already own')) return fr.errors.alreadyOwned
  if (m.includes('not for sale')) return fr.errors.notForSale
  if (m.includes('saved as many offers')) return fr.errors.saveLimit
  if (m.includes('connect your github')) return fr.errors.needGithub
  if (m.includes('another member')) return fr.errors.githubTaken
  if (m.includes('your own github name')) return fr.errors.notYourRepo
  if (m.includes('already listed')) return fr.errors.alreadyListed
  if (m.includes('limit of projects')) return fr.errors.projectLimit
  if (m.includes('sign in first') || m.includes('not authenticated')) return fr.errors.notSignedIn
  return fr.common.unknownError
}
