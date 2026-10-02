import type { ImageAsset } from '@/editor/types'
import { blobFromImageSource } from '@/features/image-workstation/download'
import { uploadTaskInput } from './upload'

export const imageObjectKey = (asset: ImageAsset) => asset.objectKey ?? asset.storage?.objectKey

/** 同一次提交复用对象键；没有远端对象的原图先上传，原始本地内容继续保留。 */
export async function taskInputKey(asset: ImageAsset, message: string, options?: { ownerId: string; signal: AbortSignal }) {
  if (options?.signal.aborted) throw new DOMException('提交已取消', 'AbortError')
  const existing = imageObjectKey(asset)
  if (existing) return existing
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
