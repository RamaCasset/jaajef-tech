import code from '../assets/art/companion-code.svg'
import palette from '../assets/art/companion-palette.svg'
import infinity from '../assets/art/companion-infinity.svg'
import shield from '../assets/art/companion-shield.svg'
import type { ClanKey } from '../i18n/fr'

const BY_CLAN: Record<ClanKey, string> = {
  griot_du_code: code,
  forgeron: palette,
  saltigue: infinity,
  buur_linguere: shield,
}

/** The little robot of each clan, from Marie's designs. Decorative. */
export function Companion({ clan, size = 64 }: { clan: ClanKey; size?: number }) {
  return <img className="companion" src={BY_CLAN[clan]} alt="" width={size} height={size} />
}
