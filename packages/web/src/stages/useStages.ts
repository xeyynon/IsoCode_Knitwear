import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, apiFetch } from '../api/session'
import type { IdbStore } from '../queue/idbStore'

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
interface Saved { today: string; stages: Stage[]; savedAt: number }

export interface StagesState {
  stages: Stage[] | null
  today: string | null
  /** live: just fetched. saved: the last copy kept on the phone, because the server cannot be reached. */
  source: 'live' | 'saved' | null
  savedAt: number | null
  /** When the request that produced `stages` STARTED; used to know which sends it cannot include yet. */
  fetchStartedAt: number
  error: string | null
  reload: () => Promise<void>
}

/** The supervisor's stages: live when possible, otherwise the last copy kept on the phone. */
export function useStages(idb: IdbStore | null, refetchKey: unknown): StagesState {
  const [stages, setStages] = useState<Stage[] | null>(null)
  const [today, setToday] = useState<string | null>(null)
  const [source, setSource] = useState<'live' | 'saved' | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fetchStartedAt, setFetchStartedAt] = useState(0)
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const mine = ++seq.current
    const startedAt = Date.now()
    try {
      const r = await apiFetch<{ today: string; stages: Stage[] }>('/api/my/stages')
      if (mine !== seq.current) return                      // a newer request owns the screen
      setStages(r.stages); setToday(r.today); setSource('live'); setError(null); setFetchStartedAt(startedAt)
      void idb?.setMeta(CACHE_KEY, { today: r.today, stages: r.stages, savedAt: Date.now() } satisfies Saved).catch(() => undefined)
    } catch (e) {
      if (mine !== seq.current) return
      const unreachable = e instanceof ApiError && e.status === 0
      if (unreachable) {
        const saved = await idb?.getMeta<Saved>(CACHE_KEY).catch(() => undefined)
        if (saved && mine === seq.current) { setStages(saved.stages); setToday(saved.today); setSource('saved'); setSavedAt(saved.savedAt); setError(null); setFetchStartedAt(saved.savedAt); return }
      }
      setError(e instanceof ApiError ? e.message : 'Could not load your orders.')
    }
  }, [idb])

  useEffect(() => { void reload() }, [reload, refetchKey])
  return { stages, today, source, savedAt, fetchStartedAt, error, reload }
}
