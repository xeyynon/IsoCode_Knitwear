// What the order form decides, without React. The server checks everything again; this exists so
// a merchandiser is told what is wrong in plain words BEFORE pressing Create.

export interface SizeRow { id: number; size: string; qty: string }

export const SIZE_PRESETS = ['S', 'M', 'L', 'XL']

/** The server accepts at most this many sizes on one order, so the form stops offering rows here instead of failing at Create (FE-M-18). */
export const MAX_SIZE_ROWS = 30

const SIZE_SCALE = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL', '4XL']

/**
 * An order's sizes in the order a person reads them (FE-M-09): the usual scale (XS S M L XL XXL), then numbers by value (32 34 36), then any other
 * name in the order it came. The database hands sizes back in key order (L M S XL), which reads as a mistake.
 */
export function sizeEntries(sizes: Record<string, number>): [string, number][] {
  const rank = (name: string, position: number): number => {
    const i = SIZE_SCALE.indexOf(name.toUpperCase())
    if (i >= 0) return i
    if (/^\d+$/.test(name)) return 100 + Number(name)
    return 100_000 + position
  }
  return Object.entries(sizes)
    .map((e, position) => ({ e, r: rank(e[0], position) }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.e)
}

export interface ParsedSizes { sizes: Record<string, number>; total: number; errors: string[] }

/**
 * Size and quantity rows -> a size-to-quantity map. The form starts with S, M, L and XL already
 * named, so a size with no quantity just means "not ordered" and is skipped. Every other mistake is named.
 */
export function parseSizes(rows: SizeRow[]): ParsedSizes {
  const sizes: Record<string, number> = {}
  const errors: string[] = []
  const seen = new Set<string>()
  let sawZero = false
  for (const r of rows) {
    const size = r.size.trim()
    const qtyText = r.qty.trim()
    if (!size && !qtyText) continue
    if (!size) { errors.push('A quantity has no size name.'); continue }
    if (!qtyText) continue
    const key = size.toLowerCase()
    if (seen.has(key)) { errors.push(`Size ${size} is listed twice.`); continue }
    seen.add(key)
    // The forms the Update screen accepts (dates.ts parsePieces): "1,000", "1 000", "1,000,000" and "1,00,000" all mean the same number (FE-M-07, W-12).
    // Anything else is refused outright: stripping "-3", "1.5" or "1,5" down to digits would change what was meant.
    const grouped = qtyText.replace(/\s+/g, ',')
    if (!/^\d+$/.test(grouped) && !/^\d{1,3}(,\d{3})+$/.test(grouped) && !/^\d{1,2}(,\d{2})*,\d{3}$/.test(grouped)) { errors.push(`Size ${size}: enter the quantity as a whole number.`); continue }
    const qty = Number(grouped.replace(/,/g, ''))
    if (qty === 0) { sawZero = true; continue }   // nothing ordered in this size: not stored (FE-M-18)
    if (qty > 10_000_000) { errors.push(`Size ${size}: that quantity is too large.`); continue }
    sizes[size] = qty
  }
  const total = Object.values(sizes).reduce((a, b) => a + b, 0)
  if (!Object.keys(sizes).length && !errors.length) errors.push(sawZero ? 'The order quantity must be more than 0.' : 'Enter the quantity for at least one size.')
  else if (total <= 0 && !errors.length) errors.push('The order quantity must be more than 0.')
  return { sizes, total, errors }
}

export interface OrderForm {
  buyerId: string
  po: string
  style: string
  colour: string
  exFactory: string
  templateId: string
  rows: SizeRow[]
}

export const isRealDate = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export type ExFactoryRule = { kind: 'refuse' | 'confirm'; text: string }

/**
 * How far from today an ex-factory date may be (FE-M-03, FE-M-08): up to two years ahead, up to a year back. A date that has already passed
 * is allowed only as a confirmed late move (the order then shows as late); anything further out is refused with a reason, because a slip of
 * the keyboard (2099, 1999) would otherwise rewrite every stage date and add permanent history rows. Null = fine, or not a real date.
 */
export function exFactoryRule(date: string, today: string): ExFactoryRule | null {
  if (!isRealDate(date) || !isRealDate(today)) return null
  const d = daysBetween(today, date)
  if (d > 730) return { kind: 'refuse', text: 'That date is more than two years away. Use the real ex-factory date: up to two years ahead.' }
  if (d < -365) return { kind: 'refuse', text: 'That date is more than a year ago. Use a date from the last year up to two years ahead.' }
  if (d < 0) return { kind: 'confirm', text: 'This date has already passed, so the order will show as late.' }
  return null
}

export type FormErrors = Partial<Record<'buyerId' | 'po' | 'style' | 'colour' | 'exFactory' | 'templateId' | 'sizes', string>>

/** Plain-words problems with the form as it stands. Empty = ready to create. */
export function validateOrder(f: OrderForm, today?: string): FormErrors {
  const e: FormErrors = {}
  if (!f.buyerId) e.buyerId = 'Choose a buyer.'
  if (!f.po.trim()) e.po = 'Enter the PO number.'
  if (!f.style.trim()) e.style = 'Enter the style.'
  if (!f.colour.trim()) e.colour = 'Enter the colour.'
  if (!f.templateId) e.templateId = 'Choose a TNA template.'
  if (!f.exFactory) e.exFactory = 'Choose the ex-factory date.'
  else if (!isRealDate(f.exFactory)) e.exFactory = 'That is not a real date.'
  else if (today && exFactoryRule(f.exFactory, today)?.kind === 'refuse') e.exFactory = exFactoryRule(f.exFactory, today)!.text
  const sizes = parseSizes(f.rows)
  if (sizes.errors.length) e.sizes = sizes.errors[0]
  return e
}

/** Whole calendar days from a to b (negative if b is earlier). Date-only: no time zone can shift it. */
export function daysBetween(a: string, b: string): number {
  const t = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)))
  return Math.round((t(b) - t(a)) / 86_400_000)
}

/** "2 days after plan", "on plan", "1 day before plan". */
export function slipText(planned: string, projected: string | null): string | null {
  if (!projected) return null
  const d = daysBetween(planned, projected)
  if (d === 0) return 'on plan'
  const n = Math.abs(d)
  return `${n} day${n === 1 ? '' : 's'} ${d > 0 ? 'after' : 'before'} plan`
}
