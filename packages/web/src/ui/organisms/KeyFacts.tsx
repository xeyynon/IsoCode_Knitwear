import './KeyFacts.css'

export interface Fact { label: string; value: string; hint?: string }

/**
 * The few numbers an order page is opened for, as tiles (UI/UX plan, slice 3.6). A description list, so a screen reader hears
 * "Quantity, 4,550" as a pair. States: no facts = nothing is drawn; a fact without a hint = a smaller tile. It never colours a
 * value: status is drawn by StatusBadge alone (frontendskill.md hard rule), so a tile is the same in greyscale.
 */
export function KeyFacts({ facts }: { facts: Fact[] }) {
  if (facts.length === 0) return null
  return (
    <dl className="keyfacts">
      {facts.map((f) => (
        <div key={f.label} className="keyfacts__tile">
          <dt>{f.label}</dt>
          <dd className="mono">{f.value}</dd>
          {f.hint && <dd className="keyfacts__hint">{f.hint}</dd>}
        </div>
      ))}
    </dl>
  )
}
