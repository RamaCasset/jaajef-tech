import { Link } from 'react-router-dom'
import { Icon } from './Icon'

/** A small "back" link with an arrow, shown at the top of a page. */
export function BackLink({ to, children }: { to: string; children: string }) {
  return <Link to={to} className="back-link muted tiny"><Icon name="back" size={14} /> {children}</Link>
}
