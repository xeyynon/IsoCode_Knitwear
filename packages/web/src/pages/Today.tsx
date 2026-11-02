import { AppBar } from '../ui/AppBar'

/** Supervisor home. The real screens (my orders, daily update, offline queue) are step 7; this says so plainly. */
export default function Today() {
  return (
    <>
      <AppBar title="My orders today" />
      <main className="page">
        <div className="card">
          <h2>Not available yet</h2>
          <p>The daily update screen is still being built. You are signed in.</p>
        </div>
      </main>
    </>
  )
}
