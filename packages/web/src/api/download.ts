import { API_BASE, clearToken, getToken } from './session'
import { downloadProblem } from '../review/exportLogic'

/**
 * Save a file the API sends (the Excel export). An <a href> cannot send the sign-in or link header, so the bytes
 * are fetched here and saved from a temporary address. Pass `linkToken` for a buyer's link; omit it for a sign-in.
 * Throws an Error whose message is fit to show.
 */
export async function downloadFile(path: string, fileName: string, linkToken?: string): Promise<void> {
  const token = linkToken ?? getToken()
  let res: Response
  try { res = await fetch(`${API_BASE}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }) }
  catch { throw new Error(downloadProblem(0)) }
  if (res.status === 401 && !linkToken) clearToken()
  if (!res.ok) throw new Error(downloadProblem(res.status))
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
