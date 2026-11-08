/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  /** 1 = show the demo logins on the sign-in screen (the hosted review demo only). */
  readonly VITE_DEMO_ACCESS?: string
}
