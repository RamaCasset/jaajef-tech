import baobab from '../assets/art/baobab.svg'
import bouye from '../assets/art/bouye.svg'
import feuilles from '../assets/art/feuilles.svg'
import singe from '../assets/art/singe.svg'

/** Marie's line drawings in the four corners of the sign-in and sign-up screens. Purely decorative. */
export function CornerArt() {
  return (
    <div className="corner-art" aria-hidden="true">
      <img className="art-tl" src={baobab} alt="" />
      <img className="art-tr" src={singe} alt="" />
      <img className="art-bl" src={bouye} alt="" />
      <img className="art-br" src={feuilles} alt="" />
    </div>
  )
}
