// Fonts shipped with the app, so a phone with no Tamil font does not show boxes. Only the subsets
// and weights styles.css uses (400 body, 600 labels, 700 headings and buttons): Latin for Noto Sans,
// Tamil for Noto Sans Tamil. Each file has font-display: swap, and the token font stacks
// (packages/design/tokens.css) keep the system fonts as the fallback while a file loads.
import '@fontsource/noto-sans/latin-400.css'
import '@fontsource/noto-sans/latin-600.css'
import '@fontsource/noto-sans/latin-700.css'
import '@fontsource/noto-sans-tamil/tamil-400.css'
import '@fontsource/noto-sans-tamil/tamil-600.css'
import '@fontsource/noto-sans-tamil/tamil-700.css'
