// What the order form decides, without React. The server checks everything again; this exists so
// a merchandiser is told what is wrong in plain words BEFORE pressing Create.

export interface SizeRow { id: number; size: string; qty: string }

export const SIZE_PRESETS = ['S', 'M', 'L', 'XL']

export interface ParsedSizes { sizes: Record<string, number>; total: number; errors: string[] }

/**
 * Size and quantity rows -> a size-to-quantity map. The form starts with S, M, L and XL already
 * named, so a size with no quantity just means "not ordered" and is skipped. Every other mistake is named.
 */
export function parseSizes(rows: SizeRow[]): ParsedSizes {
  const sizes: Record<string, number> = {}
  const errors: string[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    const size = r.size.trim()
    const qtyText = r.qty.trim()
    if (!size && !qtyText) continue
    if (!size) { errors.push('A quantity has no size name.'); continue }
    if (!qtyText) continue
    const key = size.toLowerCase()
    if (seen.has(key)) { errors.push(`Size ${size} is listed twice.`); continue }
    seen.add(key)
    if (!/^\d+$/.test(qtyText)) { errors.push(`Size ${size}: enter the quantity as a whole number.`); continue }
    const qty = Number(qtyText)
    if (qty > 10_000_000) { errors.push(`Size ${size}: that quantity is too large.`); continue }
    sizes[size] = qty
  }
  const total = Object.values(sizes).reduce((a, b) => a + b, 0)
  if (!Object.keys(sizes).length && !errors.length) errors.push('Enter the quantity for at least one size.')
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

export type FormErrors = Partial<Record<'buyerId' | 'po' | 'style' | 'colour' | 'exFactory' | 'templateId' | 'sizes', string>>

/** Plain-words problems with the form as it stands. Empty = ready to create. */
export function validateOrder(f: OrderForm): FormErrors {
  const e: FormErrors = {}
  if (!f.buyerId) e.buyerId = 'Choose a buyer.'
  if (!f.po.trim()) e.po = 'Enter the PO number.'
  if (!f.style.trim()) e.style = 'Enter the style.'
  if (!f.colour.trim()) e.colour = 'Enter the colour.'
  if (!f.templateId) e.templateId = 'Choose a TNA template.'
  if (!f.exFactory) e.exFactory = 'Choose the ex-factory date.'
  else if (!isRealDate(f.exFactory)) e.exFactory = 'That is not a real date.'
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
