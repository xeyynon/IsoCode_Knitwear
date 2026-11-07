// The board's secondary filters, for a phone (UI/UX plan, slice 3.2). Pure, so the rules are tested without a browser.
//
// On a phone the board spent three quarters of its first screen on controls. Status chips and the search stay in view; buyer, sort,
// unit and ship week sit behind one "Filters (n)" button, and each one that is on shows as a chip that removes it, so nobody has to
// open the panel to see what is narrowing the list or to clear it.
import type { ShipWeek, Sort } from './boardLogic'

export interface PanelFilters { buyer: string | null; unit: string | null; week: ShipWeek | null; sort: Sort }

/** Worst status first is the default view, not a filter. */
export const DEFAULT_SORT: Sort = 'status'

/** How many of the panel's filters are on: buyer, unit, ship week, and a sort other than the default. */
export function panelFilterCount(f: PanelFilters): number {
  return (f.buyer ? 1 : 0) + (f.unit ? 1 : 0) + (f.week ? 1 : 0) + (f.sort !== DEFAULT_SORT ? 1 : 0)
}

export const filtersButtonText = (count: number): string => (count > 0 ? `Filters (${count})` : 'Filters')

export interface AppliedFilter { key: 'buyer' | 'unit' | 'week' | 'sort'; text: string }

/**
 * One entry per filter that is on, in a fixed order, with the key that removes it. A buyer or unit named by a shared link that no
 * longer exists is shown as "Unknown", never hidden: an invisible filter over an empty list is the confusing case.
 */
export function appliedFilters(
  f: PanelFilters,
  names: { buyers: { id: string; name: string }[]; units: { id: string; name: string }[]; week: (w: ShipWeek) => string; sort: (s: Sort) => string },
): AppliedFilter[] {
  const out: AppliedFilter[] = []
  if (f.buyer) out.push({ key: 'buyer', text: `Buyer: ${names.buyers.find((b) => b.id === f.buyer)?.name ?? 'Unknown buyer'}` })
  if (f.unit) out.push({ key: 'unit', text: `Unit: ${names.units.find((u) => u.id === f.unit)?.name ?? 'Unknown unit'}` })
  if (f.week) out.push({ key: 'week', text: `Ship: ${names.week(f.week)}` })
  if (f.sort !== DEFAULT_SORT) out.push({ key: 'sort', text: `Sort: ${names.sort(f.sort)}` })
  return out
}
