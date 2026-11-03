// Shrink a phone photo before it is stored or sent. A raw camera photo is several megabytes; on a
// weak connection that is the difference between "sent" and "waiting for an hour". Re-drawing it
// on a canvas also strips the hidden location data (EXIF) a camera embeds.

export const MAX_EDGE = 1280
export const JPEG_QUALITY = 0.72

/** The size to draw at: the longest side at most `max`, the shape unchanged, never enlarged. */
export function fitWithin(width: number, height: number, max = MAX_EDGE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) throw new Error('The picture has no size.')
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** "182 KB" / "1.4 MB" for the supervisor's confirmation. */
export function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A camera file in, a small JPEG out. Throws a plain message if the file is not a picture. */
export async function resizeToJpeg(file: Blob): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not a picture.')
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) }      // applies the camera's rotation for us
  catch { throw new Error('That picture could not be read. Try taking it again.') }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This phone cannot prepare pictures.')
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob) throw new Error('This phone could not prepare the picture.')
    return blob
  } finally { bitmap.close() }
}
