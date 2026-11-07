/** The name the file is saved under: letters and digits from the buyer's name, then the day. Same rule as the server's header. */
export function exportFileName(buyerName: string, date: string): string {
  const slug = buyerName.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40)
  return `orders-${slug || 'buyer'}-${date}.csv`
}

/** The calm sentence for a download that did not happen. Nothing says which kind of refusal it was. */
export function downloadProblem(status: number): string {
  if (status === 401) return 'This link is not valid any more. Ask your contact for a new one.'
  if (status === 0 || status >= 500) return 'The file could not be downloaded. Check your connection and try again.'
  return 'The file could not be downloaded. Please try again.'
}
