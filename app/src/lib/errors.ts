import { fr } from '../i18n/fr'

/** Turns a database or sign-in error into a short French sentence. Unknown errors get a generic message. */
export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return fr.errors.invalidCredentials
  if (m.includes('already registered') || m.includes('already been registered')) return fr.errors.emailTaken
  if (m.includes('password should be at least') || m.includes('weak password')) return fr.errors.weakPassword
  if (m.includes('only staff') || m.includes('only shop staff')) return fr.errors.staffOnly
  if (m.includes('only an admin')) return fr.errors.adminOnly
  if (m.includes('report has already been handled')) return fr.errors.reportHandled
  if (m.includes('report not found')) return fr.errors.reportNotFound
  if (m.includes('cannot be sanctioned') || m.includes('only an admin can sanction')) return fr.errors.cannotSanction
  if (m.includes('a suspension lasts')) return fr.errors.suspensionDays
  if (m.includes('nothing to remove for a member')) return fr.errors.nothingToRemove
  if (m.includes('give a reason for the rejection')) return fr.errors.giveReason
  if (m.includes('not waiting for review')) return fr.errors.notWaiting
  if (m.includes('profiles_display_name_check')) return fr.editProfile.nameEmpty
  if (m.includes('post not found')) return fr.errors.postNotFound
  if (m.includes('hidden by staff')) return fr.errors.postHidden
  if (m.includes('publishing too fast')) return fr.errors.publishingTooFast
  if (m.includes('title needs at least')) return fr.errors.titleShort
  if (m.includes('write something first')) return fr.errors.writeSomething
  if (m.includes('cover image must be')) return fr.errors.coverSecure
  if (m.includes('cannot message this person')) return fr.errors.cannotMessage
  if (m.includes('cannot message yourself')) return fr.errors.cannotMessageSelf
  if (m.includes('message is empty')) return fr.errors.emptyMessage
  if (m.includes('only delete your own')) return fr.errors.notYourMessage
  if (m.includes('communities_slug_key')) return fr.errors.slugTaken
  if (m.includes('communities_slug_check')) return fr.errors.slugInvalid
  if (m.includes('limit of communities')) return fr.errors.communityLimit
  if (m.includes('community is private')) return fr.errors.privateCommunity
  if (m.includes('community is public')) return fr.errors.publicCommunity
  if (m.includes('already asked to join')) return fr.errors.alreadyAsked
  if (m.includes('too many pending')) return fr.errors.askedTooMuch
  if (m.includes('last request was declined')) return fr.errors.declinedRecently
  if (m.includes('slow down')) return fr.errors.slowDown
  if (m.includes('announcement channel')) return fr.errors.announcementOnlyError
  if (m.includes('not in this community')) return fr.errors.notInCommunity
  if (m.includes('owner cannot leave')) return fr.errors.ownerMustHandOver
  if (m.includes('maximum number of communities')) return fr.errors.ownerLimit
  if (m.includes('only the owner')) return fr.errors.onlyOwner
  if (m.includes('community address name')) return fr.errors.typeSlug
  if (m.includes('message is too long')) return fr.errors.messageTooLong
  if (m.includes('already applied')) return fr.errors.alreadyApplied
  if (m.includes('applying too fast')) return fr.errors.applyingTooFast
  if (m.includes('headline to your application') || m.includes('complete your application file')) return fr.errors.needFile
  if (m.includes('your own offer')) return fr.errors.ownOffer
  if (m.includes('offer not found')) return fr.errors.offerGone
  if (m.includes('account is suspended')) return fr.errors.suspended
  if (m.includes('secure (https)')) return fr.errors.secureLink
  if (m.includes('cannot be deleted yet')) return fr.errors.cannotDelete
  if (m.includes('different from the old password')) return fr.errors.sameAsOldPassword
  if (m.includes('rate limit') || m.includes('too many requests') || m.includes('for security purposes')) return fr.errors.tooManyRequests
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
