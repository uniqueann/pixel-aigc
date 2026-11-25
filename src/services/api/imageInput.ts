import type { ImageAsset } from '@/editor/types'
import { blobFromImageSource } from '@/features/image-workstation/download'
import { i18n } from '@/i18n'
import { uploadTaskInput } from './upload'

export const imageObjectKey = (asset: ImageAsset) => asset.objectKey ?? asset.storage?.objectKey

/** Reuse existing objectKey in a single submit; upload local sources first while retaining local state. */
export async function taskInputKey(asset: ImageAsset, message: string, options?: { ownerId: string; signal: AbortSignal; forceUpload?: boolean }) {
  if (options?.signal.aborted) throw new DOMException(i18n.t('errors:client.submitCancelled'), 'AbortError')
  const existing = imageObjectKey(asset)
  if (existing && !options?.forceUpload) return existing
  let blob: Blob
  try { blob = await blobFromImageSource(asset.url, undefined, options) }
  catch (error) {
    if (options?.signal.aborted) throw error
    const failure = new Error(message)
    Object.defineProperty(failure, 'cause', { value: error })
    throw failure
  }
  return uploadTaskInput(blob, blob.type || asset.mimeType, options?.signal)
}
