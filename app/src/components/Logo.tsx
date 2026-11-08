export function Logo({ size = 24 }: { size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: size }}>
      <span
        aria-hidden="true"
        style={{ display: 'inline-grid', placeItems: 'center', width: size * 1.4, height: size * 1.4, borderRadius: 8, border: '1px solid var(--line-strong)', background: 'var(--accent-soft)', color: 'var(--accent)', fontSize: size * 0.8, fontFamily: 'var(--font-mono)', fontWeight: 500 }}
      >
        j.
      </span>
      <span>
        jaajef<span style={{ color: 'var(--accent)' }}>.tech</span>
      </span>
    </span>
  )
}
