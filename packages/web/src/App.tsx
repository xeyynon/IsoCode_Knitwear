import { lazy, Suspense, useSyncExternalStore, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { getClaims, snapshot, subscribe } from './api/session'
import { homeFor, type Role } from './api/sessionRules'
import { ChunkErrorBoundary } from './ui/ChunkErrorBoundary'
import { Loading } from './ui/Loading'

// One chunk per screen, so a supervisor's phone never downloads the board.
const Login = lazy(() => import('./pages/Login'))
const Board = lazy(() => import('./pages/Board'))
const Today = lazy(() => import('./pages/Today'))
const Status = lazy(() => import('./pages/Status'))

/** The server is the security boundary; this only decides which screen a signed-in person sees. */
function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  useSyncExternalStore(subscribe, snapshot)
  const claims = getClaims()
  if (!claims) return <Navigate to="/login" replace />
  if (claims.role !== role) return <Navigate to={homeFor(claims.role)} replace />
  return <>{children}</>
}

function Home() {
  useSyncExternalStore(subscribe, snapshot)
  const claims = getClaims()
  return <Navigate to={claims ? homeFor(claims.role) : '/login'} replace />
}

export default function App() {
  return (
    <ChunkErrorBoundary>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/status" element={<Status />} />
          <Route path="/board" element={<RequireRole role="merchandiser"><Board /></RequireRole>} />
          <Route path="/today" element={<RequireRole role="supervisor"><Today /></RequireRole>} />
          <Route path="*" element={<Home />} />
        </Routes>
      </Suspense>
    </ChunkErrorBoundary>
  )
}
