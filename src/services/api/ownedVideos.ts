import { isCurrentWorkstationHistoryOwner, currentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { signedOwnedObject } from './objects'

export interface OwnedVideoReference {
  objectKey?: string
  url?: string
  expiresAt?: number
  retentionExpiresAt?: string
}

export function assertVideoRetention(reference: OwnedVideoReference) {
  if (reference.retentionExpiresAt && new Date(reference.retentionExpiresAt).getTime() <= Date.now()) throw new Error('视频已过期，无法继续播放或下载')
}

/** 视频仅获取签名地址，播放和下载均由浏览器直接读取 R2。 */
export async function readOwnedVideoUrl(reference: OwnedVideoReference, options: { ownerId?: string; signal?: AbortSignal; force?: boolean } = {}) {
  const ownerId = options.ownerId ?? currentWorkstationHistoryOwner()
  if (!isCurrentWorkstationHistoryOwner(ownerId)) throw new Error('账号已切换，无法读取视频')
  assertVideoRetention(reference)
  let result: { url: string; expiresAt?: number }
  if (reference.objectKey) result = await signedOwnedObject(reference.objectKey, options.signal)
  else if (reference.url && !reference.url.startsWith('/__aigc_asset__/')) result = { url: reference.url, expiresAt: reference.expiresAt }
  else throw new Error('视频文件不可用，请重新生成')
  if (options.signal?.aborted || !isCurrentWorkstationHistoryOwner(ownerId)) throw new Error('视频读取已取消')
  return result
}

export async function downloadOwnedVideo(reference: OwnedVideoReference, filename = '视频.mp4', ownerId = currentWorkstationHistoryOwner()) {
  if (!isCurrentWorkstationHistoryOwner(ownerId)) throw new Error('账号已切换，无法下载视频')
  assertVideoRetention(reference)
  const signed = reference.objectKey ? await signedOwnedObject(reference.objectKey, undefined, filename)
    : await readOwnedVideoUrl(reference, { ownerId })
  if (!isCurrentWorkstationHistoryOwner(ownerId)) throw new Error('账号已切换，停止下载')
  const link = document.createElement('a')
  link.href = signed.url
  link.download = filename
  link.rel = 'noopener'
  link.click()
}
