// The demo logins shown on the sign-in screen for evaluators. Only in a build made with VITE_DEMO_ACCESS=1 (the hosted review
// demo): a real deployment never shows a password. These are the throwaway accounts loaded by packages/server/src/demoSeed.ts
// (a server test checks the two lists agree), not anyone's real details.
/** The two sign-in roles (the same strings as loginRules.LoginMode; kept here so this file needs nothing from the browser). */
export type LoginMode = 'merchandiser' | 'supervisor'

export interface DemoLogin { id: string; secret: string; idLabel: string; secretLabel: string; who: string }

export const DEMO_ACCESS: Record<LoginMode, DemoLogin[]> = {
  merchandiser: [{ id: 'merch@companya.test', secret: 'demo knitwear 2026', idLabel: 'Email', secretLabel: 'Password', who: 'Merchandiser (Priya): board, order setup, review queue' }],
  supervisor: [
    { id: '90000 10001', secret: '4826', idLabel: 'Phone', secretLabel: 'PIN', who: 'Unit 1: B-PO-88240 finishing, B-PO-88213 stitching' },
    { id: '90000 10002', secret: '5937', idLabel: 'Phone', secretLabel: 'PIN', who: 'Unit 2: B-PO-88302, B-PO-88315, C-PO-0502' },
    { id: '90000 10003', secret: '6048', idLabel: 'Phone', secretLabel: 'PIN', who: 'Unit 3: the printed styles (C-PO-0488, C-PO-0511)' },
  ],
}

/** Read-only buyer pages: each opens one buyer's own orders and nothing else. */
export const DEMO_BUYER_LINKS = [
  { name: 'Company B (UK)', token: 'bl_demoCompanyB_readonly_2026' },
  { name: 'Company C (Germany)', token: 'bl_demoCompanyC_readonly_2026' },
]

export const demoAccessOn = (flag: string | undefined): boolean => flag === '1' || flag === 'true'

/** A secret as dots: at most ten, so a long password still fits one line on a phone and its length is not given away. */
export const masked = (secret: string): string => '•'.repeat(Math.min(secret.length, 10))
