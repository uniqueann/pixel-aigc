import { isCurrentWorkstationHistoryOwner, currentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { i18n } from '@/i18n'
import { signedOwnedObject } from './objects'

export interface OwnedVideoReference {
  objectKey?: string
  url?: string
  expiresAt?: number
  retentionExpiresAt?: string
}

export function assertVideoRetention(reference: OwnedVideoReference) {
  if (reference.retentionExpiresAt && new Date(reference.retentionExpiresAt).getTime() <= Date.now()) {
    throw new Error(i18n.t('errors:client.videoExpired'))
  }
}

/** Videos resolve to signed URLs; playback and download stream directly from R2. */
export async function readOwnedVideoUrl(reference: OwnedVideoReference, options: { ownerId?: string; signal?: AbortSignal; force?: boolean } = {}) {
  const ownerId = options.ownerId ?? currentWorkstationHistoryOwner()
  if (!isCurrentWorkstationHistoryOwner(ownerId)) throw new Error(i18n.t('errors:client.readVideoAccountSwitched'))
  assertVideoRetention(reference)
  let result: { url: string; expiresAt?: number }
  if (reference.objectKey) result = await signedOwnedObject(reference.objectKey, options.signal)
  else if (reference.url && !reference.url.startsWith('/__aigc_asset__/')) result = { url: reference.url, expiresAt: reference.expiresAt }
  else throw new Error(i18n.t('errors:client.videoUnavailable'))
  if (options.signal?.aborted || !isCurrentWorkstationHistoryOwner(ownerId)) throw new Error(i18n.t('errors:client.videoReadCancelled'))
  return result
}

export async function downloadOwnedVideo(reference: OwnedVideoReference, filename = i18n.t('common:files.defaultVideoName'), ownerId = currentWorkstationHistoryOwner(), options: {signal?:AbortSignal;isCurrent?:()=>boolean} = {}) {
  if (options.signal?.aborted || options.isCurrent?.()===false || !isCurrentWorkstationHistoryOwner(ownerId)) {
    throw new Error(i18n.t('errors:client.downloadVideoAccountSwitched'))
  }
  assertVideoRetention(reference)
  const signed = reference.objectKey ? await signedOwnedObject(reference.objectKey, options.signal, filename)
    : await readOwnedVideoUrl(reference, { ownerId,signal:options.signal })
  if (options.signal?.aborted || options.isCurrent?.()===false || !isCurrentWorkstationHistoryOwner(ownerId)) {
    throw new Error(i18n.t('errors:client.downloadVideoStopped'))
  }
  const link = document.createElement('a')
  link.href = signed.url
  link.download = filename
  link.rel = 'noopener'
  link.click()
}
