/** One loading state for every wait on the network. It fades in after a short delay so a quick load never flashes it. */
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading" role="status" aria-label={label}>
      <span className="loading__ring" aria-hidden="true" />
      <span className="loading__label">{label}…</span>
    </div>
  )
}
