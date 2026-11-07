import raw from '../../../../build-info.json'
import { buildLabel, recentBuilds, type BuildInfo } from './releaseInfo'

// build-info.json is written by scripts/changelog.mjs and baked into the bundle at build time, so the label
// is the build that was shipped, not whatever the server says.
const info: BuildInfo = raw

/** "Build 1006 - 3 Nov 2026", or null when no build has been recorded. */
export const BUILD_LABEL: string | null = buildLabel(info)

/** The newest builds with their public release wording. */
export const RECENT_BUILDS = recentBuilds(info)
