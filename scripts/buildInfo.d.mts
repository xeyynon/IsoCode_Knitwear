export const KEEP_BUILDS: number
export function publicBuilds<T extends { n: number; date: string; title: string; summary: string }>(
  reports: T[],
  keep?: number,
): { n: number; date: string; title: string; summary: string }[]
