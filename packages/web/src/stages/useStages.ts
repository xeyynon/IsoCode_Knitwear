import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, apiFetch, getClaims } from '../api/session'
import { isUnreachable } from '../api/sessionRules'
import type { IdbStore } from '../queue/idbStore'
import { istDate } from '../dates'
import { translate, type Lang } from '../i18n'
import { DEFAULT_REASONS, usableReasons, type Reason } from '../notes/reasons'

export interface Stage {
  orderId: string
  po: string
  style: string
  colour: string
  stage: string
  sequence: number
  qty: number
  plannedEnd: string
  produced: number
  todayQty: number
  complete: boolean
}

const CACHE_KEY = 'stages'
/**
 * phoneDay: the phone's India date when the copy was saved (absent on copies from older versions).
 * owner: who was signed in when it was saved; on a shared phone nobody else is shown it.
 */
export interface Saved { today: string; phoneDay?: string; owner?: string; stages: Stage[]; savedAt: number }

/** The saved copy, only if `who` saved it; a copy that records nobody (older versions) is not trusted. */
export function savedFor(saved: Saved | undefined, who: string | null | undefined): Saved | undefined {
  return saved && who && saved.owner === who ? saved : undefined
}

const dayMs = 86_400_000
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * dayMs).toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / dayMs)

/**
 * The saved list, opened on `phoneDay` with no signal. If the phone's day has moved on since it was
 * saved, the server's day moves on by as much (so a phone clock ahead of the server is not dated in
 * the future), never back; and the saved "today" figures belong to an earlier day, so they become 0.
 */
export function restoreSaved(saved: Saved, phoneDay: string): { today: string; stages: Stage[] } {
  const moved = daysBetween(saved.phoneDay ?? saved.today, phoneDay)
  if (moved <= 0) return { today: saved.today, stages: saved.stages }
  return { today: addDays(saved.today, moved), stages: saved.stages.map((s) => ({ ...s, todayQty: 0 })) }
}

/** The reason list: fresh from the server when possible, else the copy on the phone, else the built-in list. */
export function useReasons(idb: IdbStore | null): Reason[] {
  const [reasons, setReasons] = useState<Reason[]>(DEFAULT_REASONS)
  useEffect(() => {
    let live = true
    void idb?.getMeta<unknown>('reasons').then((c) => { if (live && c) setReasons(usableReasons(c)) }).catch(() => undefined)
    apiFetch<{ reasons: unknown }>('/api/reasons').then((r) => {
      if (!live) return
      const list = usableReasons(r.reasons)
      setReasons(list)
      void idb?.setMeta('reasons', list).catch(() => undefined)
    }).catch(() => undefined)
    return () => { live = false }
  }, [idb])
  return reasons
}

export interface StagesState {
  stages: Stage[] | null
  today: string | null
  /** live: just fetched. saved: the last copy kept on the phone, because the server cannot be reached. */
  source: 'live' | 'saved' | null
  savedAt: number | null
  /** When the request that produced `stages` STARTED; used to know which sends it cannot include yet. */
  fetchStartedAt: number
  /** unreachable: no connection (the screen says so in the reader's language); otherwise the server's message. */
  error: { message: string; unreachable: boolean } | null
  reload: () => Promise<void>
}

/** The load error in the reader's language. The server's own words are English, so Tamil gets a plain Tamil sentence instead. */
export function stagesErrorText(error: NonNullable<StagesState['error']>, lang: Lang): string {
  if (error.unreachable) return translate(lang, 'err.unreachable')
  return lang === 'en' ? error.message : translate(lang, 'today.loadFailed')
}

/** The supervisor's stages: live when possible, otherwise the last copy kept on the phone. */
export function useStages(idb: IdbStore | null, refetchKey: unknown): StagesState {
  const [stages, setStages] = useState<Stage[] | null>(null)
  const [today, setToday] = useState<string | null>(null)
  const [source, setSource] = useState<'live' | 'saved' | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<StagesState['error']>(null)
  const [fetchStartedAt, setFetchStartedAt] = useState(0)
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const mine = ++seq.current
    const startedAt = Date.now()
    try {
      const r = await apiFetch<{ today: string; stages: Stage[] }>('/api/my/stages')
      if (mine !== seq.current) return                      // a newer request owns the screen
      setStages(r.stages); setToday(r.today); setSource('live'); setError(null); setFetchStartedAt(startedAt)
      void idb?.setMeta(CACHE_KEY, { today: r.today, phoneDay: istDate(), owner: getClaims()?.sub, stages: r.stages, savedAt: Date.now() } satisfies Saved).catch(() => undefined)
    } catch (e) {
      if (mine !== seq.current) return
      const unreachable = isUnreachable(e)
      if (unreachable) {
        const saved = savedFor(await idb?.getMeta<Saved>(CACHE_KEY).catch(() => undefined), getClaims()?.sub)
        if (saved && mine === seq.current) { const r = restoreSaved(saved, istDate()); setStages(r.stages); setToday(r.today); setSource('saved'); setSavedAt(saved.savedAt); setError(null); setFetchStartedAt(saved.savedAt); return }
      }
      setError({ message: e instanceof ApiError ? e.message : 'Could not load your orders.', unreachable })
    }
  }, [idb])

  useEffect(() => { void reload() }, [reload, refetchKey])
  return { stages, today, source, savedAt, fetchStartedAt, error, reload }
}
