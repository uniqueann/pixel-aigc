import { authEnabled, supabase } from '@/cloud/client'
import { uploadImage } from '@/services/api/upload'
import { createTask, getTask, liveCapabilityReady } from '@/services/api/task'
import { Capability } from '@/types'
import type { BatchImage } from './types'

const ACTIVE = new Set(['pending', 'queued', 'processing'])

async function readSize(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

async function requestTencentMatte(image: BatchImage) {
  const dataBase64 = await fileToBase64(image.file)
  const token = authEnabled
    ? (await supabase!.auth.getSession()).data.session?.access_token
    : localStorage.getItem('access_token')
  const response = await fetch('/api/bg-remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ mimeType: image.sourceMime, dataBase64 }),
    signal: AbortSignal.timeout(55000),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error || '抠图失败')
  }
  return response.blob()
}

export async function requestMatte(image: BatchImage, shouldStop: () => boolean) {
  if (!liveCapabilityReady(Capability.BgRemove)) {
    const blob = await requestTencentMatte(image)
    const size = await readSize(blob)
    if (size.width !== image.width || size.height !== image.height) throw new Error('抠图结果尺寸与原图不一致')
    return blob
  }
  const uploaded = await uploadImage(image.file)
  let current: Awaited<ReturnType<typeof getTask>> = await createTask({
    capability: Capability.BgRemove,
    requestId: crypto.randomUUID(),
    params: { sourceImageUrl: uploaded.url, size: { width: image.width, height: image.height } },
  })
  while (ACTIVE.has(current.status)) {
    if (shouldStop()) throw new Error('处理已取消')
    await new Promise(resolve => setTimeout(resolve, 2000))
    if (shouldStop()) throw new Error('处理已取消')
    current = await getTask(current.id)
  }
  if (current.status !== 'succeeded') throw new Error(current.errorMessage || '抠图失败')
  const url = current.resultUrls?.[0]
  if (!url) throw new Error('抠图没有返回图片')
  const response = await fetch(url)
  if (!response.ok) throw new Error('抠图结果下载失败')
  const blob = await response.blob()
  const size = await readSize(blob)
  if (size.width !== image.width || size.height !== image.height) throw new Error('抠图结果尺寸与原图不一致')
  return blob
}
