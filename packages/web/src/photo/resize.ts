// Shrink a phone photo before it is stored or sent. A raw camera photo is several megabytes; on a
// weak connection that is the difference between "sent" and "waiting for an hour". Re-drawing it
// on a canvas also strips the hidden location data (EXIF) a camera embeds, so the camera's "turn it
// a quarter" note (also EXIF) must be acted on first, or a portrait photo goes out sideways.

import { translate, type Key } from '../i18n'
import { orientationMatrix, orientedSize, readExifOrientation, type Orientation } from './orientation'

export const MAX_EDGE = 1280
export const JPEG_QUALITY = 0.72

/** A plain message the phone can show in either language: `key` for the screen, the English text as the message. */
export class PhotoError extends Error {
  constructor(readonly key: Key) { super(translate('en', key)) }
}

/** The size to draw at: the longest side at most `max`, the shape unchanged, never enlarged. */
export function fitWithin(width: number, height: number, max = MAX_EDGE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) throw new PhotoError('photo.noSize')
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** "182 KB" / "1.4 MB" for the supervisor's confirmation. */
export function sizeText(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The server refuses a photo smaller than this (a blank or broken picture), so the phone refuses it first. */
export const MIN_PHOTO_BYTES = 1024

/** The prepared JPEG, or a plain message: missing, or too small for the server to accept. */
export function checkPrepared(blob: Blob | null): Blob {
  if (!blob) throw new PhotoError('photo.couldNotPrepare')
  if (blob.size < MIN_PHOTO_BYTES) throw new PhotoError('photo.tooSmall')
  return blob
}

/**
 * How to draw a decoded picture so it comes out upright and small: the canvas size, the size to
 * draw the raw pixels at, and the canvas matrix. `orientation` is 1 when the browser has already
 * turned the bitmap (nothing left to do) or the camera left it upright.
 */
export function drawPlan(orientation: Orientation, rawWidth: number, rawHeight: number, max = MAX_EDGE) {
  const upright = orientedSize(orientation, rawWidth, rawHeight)
  const canvas = fitWithin(upright.width, upright.height, max)
  const draw = orientedSize(orientation, canvas.width, canvas.height)       // a quarter turn swaps back to the raw shape
  return { canvas, draw, matrix: orientationMatrix(orientation, draw.width, draw.height) }
}

/** The first 64 KB hold every header segment, so the orientation tag is read from there only. */
const HEADER_BYTES = 65536

/**
 * Decode with the camera's rotation applied before the hidden tag is lost. Modern browsers do it when
 * asked ("from-image"). A browser that refuses that option is older and leaves the picture as the
 * sensor saw it, so the tag is read here and the turn is made when drawing.
 */
async function decode(file: Blob): Promise<{ bitmap: ImageBitmap; orientation: Orientation }> {
  try { return { bitmap: await createImageBitmap(file, { imageOrientation: 'from-image' }), orientation: 1 } }
  catch { /* option not understood, or not a picture: the plain call below tells which */ }
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) }
  catch { throw new PhotoError('photo.unreadable') }
  let orientation: Orientation = 1
  try { orientation = readExifOrientation(new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer())) } catch { /* upright */ }
  return { bitmap, orientation }
}

/** A camera file in, a small JPEG out, the right way up. Throws a plain message if the file is not a picture. */
export async function resizeToJpeg(file: Blob): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new PhotoError('photo.notPicture')
  const { bitmap, orientation } = await decode(file)
  try {
    const plan = drawPlan(orientation, bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = plan.canvas.width; canvas.height = plan.canvas.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new PhotoError('photo.cannotPrepare')
    ctx.setTransform(...plan.matrix)
    ctx.drawImage(bitmap, 0, 0, plan.draw.width, plan.draw.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    return checkPrepared(blob)
  } finally { bitmap.close() }
}
