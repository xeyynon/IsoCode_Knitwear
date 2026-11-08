import { useEffect } from 'react'

/**
 * The browser tab's title, from the screen's own heading: "Board | Order tracking". Every shell (the app bar, the public pages, the sign-in) calls it,
 * so no screen can forget and the words are the ones on screen, in the language on screen. With no heading it is the app's name alone.
 */
export const pageTitle = (heading: string | undefined, appName: string): string => (heading && heading !== appName ? `${heading} | ${appName}` : appName)

export function useDocumentTitle(heading: string | undefined, appName: string): void {
  useEffect(() => { document.title = pageTitle(heading, appName) }, [heading, appName])
}
