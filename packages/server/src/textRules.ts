// What may not be in text a person reads back (BE-078).
//
// A control character (tab, newline, NUL...) breaks a one-line field, and a bidirectional control (U+202E "right-to-left override",
// the isolates U+2066 to U+2069, the marks U+200E, U+200F, U+061C) changes the order a line is DRAWN in: "PO" + U+202E + "123" shows as
// "PO321", so one PO could pass for another on the board, the buyer page and the CSV. Names, PO numbers, sizes and labels refuse them.
// Free text (a supervisor's note) is not refused, because a note arrives from a phone and must still be saved: it has the bidi controls
// taken out instead (`stripBidi`). Zero-width joiners are left alone: some scripts need them.
//
// The characters are built from their code points on purpose: written out in the source they would be invisible (or would reorder the
// line they sit in), which is the very problem this file guards against.

const chars = (from: number, to = from): string => Array.from({ length: to - from + 1 }, (_, i) => String.fromCharCode(from + i)).join('')

/** U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069. */
const BIDI_SET = chars(0x061c) + chars(0x200e, 0x200f) + chars(0x202a, 0x202e) + chars(0x2066, 0x2069)
/** C0 controls (tab and newline included), DEL, C1 controls, and the line and paragraph separators. */
const CONTROL_SET = chars(0x00, 0x1f) + chars(0x7f, 0x9f) + chars(0x2028, 0x2029)

const BIDI = new RegExp(`[${BIDI_SET}]`)
const BIDI_ALL = new RegExp(`[${BIDI_SET}]`, 'g')
const CONTROL = new RegExp(`[${CONTROL_SET}]`)
const CONTROL_ALL = new RegExp(`[${CONTROL_SET}]+`, 'g')

/** True when the text holds a control character or a bidirectional control. */
export const hasUnsafeText = (s: string): boolean => CONTROL.test(s) || BIDI.test(s)

/** The text without its bidirectional controls. */
export const stripBidi = (s: string): string => s.replace(BIDI_ALL, '')

/** Optional one-line text, cleaned instead of refused: bidi controls out, any run of control characters becomes one space, trimmed. */
export const cleanLine = (s: string): string => stripBidi(s).replace(CONTROL_ALL, ' ').trim()
