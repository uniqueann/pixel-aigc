import type { Asset } from '@/editor/types'
import { currentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { listHistoryMetadata, readHistoryImage } from '@/features/assets/workstationHistory'
import type { ProjectSnapshot } from './types'

function durableKey(key?: string) {
  return !!key && !key.startsWith('temporary/')
}

function decodeDataUrl(url: string) {
  const comma = url.indexOf(',')
  if (comma < 0 || !/;base64/i.test(url.slice(0, comma))) return undefined
  try {
    const binary = atob(url.slice(comma + 1))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return undefined
  }
}

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function digest(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return hex(await crypto.subtle.digest('SHA-256', copy))
}

/**
 * 把仍内嵌在项目里、且能对上「我的资产」的图片补上持久 objectKey。
 * 只改项目引用，不删除资产库或 R2 里的对象。匹配失败时保持原样。
 */
export async function linkOwnedAssetKeys(snapshot: ProjectSnapshot): Promise<ProjectSnapshot> {
  const pending = Object.values(snapshot.project.assets).filter((asset): asset is Asset & { url: string } => (
    asset.type === 'image' && asset.url.startsWith('data:') && !asset.objectKey && !asset.storage?.objectKey
  ))
  if (!pending.length) return snapshot
  try {
    const ownerId = currentWorkstationHistoryOwner()
    const records = (await listHistoryMetadata(ownerId)).filter(record => durableKey(record.objectKey))
    const keys = new Map<string, string>()
    for (const record of records) {
      const blob = await readHistoryImage(ownerId, { id: record.id, objectKey: record.objectKey })
      if (!blob || !record.objectKey) continue
      keys.set(await digest(new Uint8Array(await blob.arrayBuffer())), record.objectKey)
    }
    for (const asset of pending) {
      const bytes = decodeDataUrl(asset.url)
      if (!bytes) continue
      const key = keys.get(await digest(bytes))
      if (key) asset.objectKey = key
    }
  } catch {
    // 账号未就绪或本地历史不可用时保留内嵌图，下次登录再匹配。
  }
  return snapshot
}
