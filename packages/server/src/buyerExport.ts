import type { BuyerView } from './buyerService.js'
import { toCsv } from './csv.js'

/**
 * The weekly file for one buyer, built ONLY from what the buyer page already shows: PO, style, colour,
 * quantity, ship date, each stage's planned finish, and warnings a merchandiser has confirmed. It is built
 * from BuyerView (not from a new query) so the two can never drift apart: a column added here has to
 * exist there first, and the buyer view is the one place that decides what a buyer may see.
 *
 * Deliberately not here: the engine's projected finish, rates, shortfalls, colours, notes and photos.
 * A projected date is worked out from internal rates and no person has confirmed it.
 */
export const EXPORT_HEADER = ['PO', 'Style', 'Colour', 'Quantity', 'Ex-factory', 'Stage', 'Planned finish', 'Notice from the factory']

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function buyerExportCsv(view: BuyerView): string {
  const rows: (string | number | null)[][] = [EXPORT_HEADER]
  for (const o of view.orders) {
    const head = [o.po, o.style, o.colour, o.qty, o.exFactory]
    const noticeFor = (stage: string) => o.warnings.filter((w) => w.stage === stage).map((w) => w.text).join('; ')
    for (const m of o.milestones) rows.push([...head, cap(m.stage), m.plannedEnd, noticeFor(m.stage)])
    // A confirmed notice for a stage with no planned date still reaches the buyer on the page, so it reaches the file.
    const planned = new Set(o.milestones.map((m) => m.stage))
    for (const stage of new Set(o.warnings.map((w) => w.stage))) if (!planned.has(stage)) rows.push([...head, cap(stage), null, noticeFor(stage)])
    if (!o.milestones.length && !o.warnings.length) rows.push([...head, null, null, null])
  }
  return toCsv(rows)
}

/** orders-<buyer name as letters and digits>-<date>.csv: nothing from the name can break out of the header. */
export function exportFileName(buyerName: string, date: string): string {
  const slug = buyerName.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40)
  return `orders-${slug || 'buyer'}-${date}.csv`
}
