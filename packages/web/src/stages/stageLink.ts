/**
 * The link from Today to one stage's Update screen, and the way back. Stage names are free
 * text in templates ('50% check' is allowed), so the name is encoded into the path once.
 */
export function stageHref(orderId: string, stage: string): string {
  return `/today/${orderId}/${encodeURIComponent(stage)}`
}

/** React Router already decodes path params: decoding again throws on '%' or renames the stage. */
export function stageFromParam(param: string): string {
  return param
}
