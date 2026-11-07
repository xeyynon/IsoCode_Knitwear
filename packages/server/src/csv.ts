// CSV for Excel, built by hand so the rules are in one small place that a test can hold to.

/** Characters that make a spreadsheet read a cell as a formula (OWASP: = + - @ and a leading tab or carriage return). */
const FORMULA_START = /^[=+\-@\t\r]/

/**
 * Text a person typed could begin with = + - or @ and run as a formula when the file is opened
 * ("=HYPERLINK(...)"). A leading apostrophe makes Excel show the text as it is.
 */
export function neutraliseCell(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text
}

/** One cell: text is made safe first, then quoted when it holds a comma, a quote or a line break. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  // A real number is not text, so a minus sign on it is a sign, not a formula.
  const text = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : neutraliseCell(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export const csvRow = (cells: (string | number | null | undefined)[]): string => cells.map(csvCell).join(',')

/** UTF-8 byte order mark: without it Excel reads Tamil as mojibake. */
export const BOM = '﻿'

/** The whole file: the BOM, then rows ending in CRLF (what Excel writes and expects). */
export const toCsv = (rows: (string | number | null | undefined)[][]): string => BOM + rows.map(csvRow).join('\r\n') + '\r\n'
