/** The small tiles of the streak, from Marie's designs: a day done, today (not done yet), a day still to come. */
export function StreakDay({ state }: { state: 'done' | 'today' | 'later' }) {
  if (state === 'done') {
    return (
      <svg width="29" height="31" viewBox="0 0 29 31" fill="none" aria-hidden="true">
        <rect x="0.5" y="0.5" width="28" height="30" rx="9.5" fill="#342B20" />
        <rect x="0.5" y="0.5" width="28" height="30" rx="9.5" stroke="#293B55" />
        <path d="M19.1664 12L12.7504 18.4162L9.83398 15.4997" stroke="#F5B94F" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  }
  if (state === 'today') {
    return (
      <svg width="29" height="31" viewBox="0 0 29 31" fill="none" aria-hidden="true">
        <rect x="0.5" y="0.5" width="28" height="30" rx="9.5" fill="#342B20" />
        <rect x="0.5" y="0.5" width="28" height="30" rx="9.5" stroke="#F5B94F" />
        <path d="M14.4998 10.25C14.8887 11.8056 15.6666 13.0696 16.8334 14.0418C18.0002 15.0141 18.5836 16.0836 18.5836 17.2503C18.5836 18.3333 18.1534 19.372 17.3875 20.1378C16.6216 20.9036 15.5829 21.3338 14.4998 21.3338C13.4167 21.3338 12.378 20.9036 11.6121 20.1378C10.8463 19.372 10.416 18.3333 10.416 17.2503C10.416 16.6192 10.6207 16.0051 10.9994 15.5002C10.9994 15.887 11.1531 16.258 11.4266 16.5315C11.7001 16.805 12.0711 16.9586 12.4579 16.9586C12.8447 16.9586 13.2157 16.805 13.4892 16.5315C13.7628 16.258 13.9164 15.887 13.9164 15.5002C13.9164 14.3335 13.0413 13.7501 13.0413 12.5834C13.0413 11.8056 13.5275 11.0278 14.4998 10.25Z" stroke="#F5B94F" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="29" height="31" viewBox="0 0 29 31" fill="none" aria-hidden="true">
      <rect x="0.5" y="0.5" width="28" height="30" rx="9.5" fill="#17263D" />
      <rect x="0.5" y="0.5" width="28" height="30" rx="9.5" stroke="#293B55" />
      <circle cx="14.5" cy="15.5" r="2" fill="#7287A5" />
    </svg>
  )
}

/** The flame tile at the top of the streak card. */
export function FlameTile() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
      <rect width="44" height="44" rx="15" fill="#342B20" />
      <path d="M22.0002 12.25C22.7225 15.139 24.1671 17.4863 26.334 19.292C28.501 21.0976 29.5844 23.0838 29.5844 25.2505C29.5844 27.2619 28.7854 29.1908 27.3631 30.613C25.9407 32.0352 24.0117 32.8342 22.0002 32.8342C19.9888 32.8342 18.0597 32.0352 16.6374 30.613C15.2151 29.1908 14.416 27.2619 14.416 25.2505C14.416 24.0785 14.7962 22.9381 15.4995 22.0004C15.4995 22.7187 15.7848 23.4076 16.2928 23.9156C16.8008 24.4235 17.4897 24.7089 18.2081 24.7089C18.9265 24.7089 19.6154 24.4235 20.1234 23.9156C20.6314 23.4076 20.9168 22.7187 20.9168 22.0004C20.9168 19.8337 19.2916 18.7503 19.2916 16.5835C19.2916 15.139 20.1945 13.6945 22.0002 12.25Z" stroke="#F5B94F" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
