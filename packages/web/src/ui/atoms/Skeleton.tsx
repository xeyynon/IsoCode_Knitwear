import './Skeleton.css'

/**
 * A grey block standing where content will be (UI/UX plan, slice 4.2). Used only where the wait was measured over 1 s on an emulated
 * Slow 3G (Today's list after sign-in). It is a shape, never a status: neutral grey, no words, hidden from a screen reader (the
 * region that holds the blocks carries the "loading" word). States: waiting (a slow pulse), reduced motion (still).
 */
export function Skeleton({ width = '100%', height = 16 }: { width?: string; height?: number }) {
  return <span className="skeleton" aria-hidden="true" style={{ width, height }} />
}
