/** A Souk theme changes the colours of the whole app. Its data holds an accent colour, and may hold more. */
const HEX = /^#[0-9a-fA-F]{6}$/

// The colours a theme may change, and the CSS variable each one sets.
const KEYS: Record<string, string> = {
  accent: '--accent',
  bg: '--bg',
  glow: '--bg-glow',
  panel: '--panel',
  raised: '--panel-raised',
  line: '--line',
  lineStrong: '--line-strong',
}
const ALL_VARS = [...Object.values(KEYS), '--accent-soft']
const CACHE = 'jaajef.theme'

function soft(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.12)`
}

/** The CSS variables a theme sets. Anything that is not a plain #rrggbb colour is ignored. */
export function themeVars(data: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!data) return out
  for (const [key, cssVar] of Object.entries(KEYS)) {
    const v = data[key]
    if (typeof v === 'string' && HEX.test(v)) out[cssVar] = v
  }
  if (out['--accent']) out['--accent-soft'] = soft(out['--accent'])
  return out
}

/** Puts a theme on the page now. With no theme (null) the default look comes back. */
export function applyTheme(data: Record<string, unknown> | null | undefined, remember = true): void {
  if (typeof document === 'undefined') return
  const style = document.documentElement.style
  for (const name of ALL_VARS) style.removeProperty(name)
  const vars = themeVars(data)
  for (const [name, value] of Object.entries(vars)) style.setProperty(name, value)
  if (!remember) return
  try {
    if (Object.keys(vars).length > 0) localStorage.setItem(CACHE, JSON.stringify(data))
    else localStorage.removeItem(CACHE)
  } catch { /* storage can be blocked; the theme still applies for this visit */ }
}

/** At start-up: the theme used last time, so the page does not flash the default colours. */
export function applyRememberedTheme(): void {
  try {
    const raw = localStorage.getItem(CACHE)
    if (raw) applyTheme(JSON.parse(raw) as Record<string, unknown>, false)
  } catch { /* nothing remembered */ }
}
