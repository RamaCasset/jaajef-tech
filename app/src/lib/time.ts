import { dateLocale } from '../i18n/lang'

/** "2 hours ago", in the current language. Returns an empty string when the date is missing or not a date. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN
  if (Number.isNaN(t)) return ''
  const seconds = Math.round((t - now) / 1000)
  const rtf = new Intl.RelativeTimeFormat(dateLocale(), { numeric: 'auto' })
  const abs = Math.abs(seconds)
  if (abs < 60) return rtf.format(0, 'second')
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), 'day')
  if (abs < 86400 * 365) return rtf.format(Math.round(seconds / (86400 * 30)), 'month')
  return rtf.format(Math.round(seconds / (86400 * 365)), 'year')
}
