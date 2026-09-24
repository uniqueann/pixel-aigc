import { uploadImage } from '@/services/api/upload'
import { createTask, getTask } from '@/services/api/task'
import { Capability } from '@/types'
import type { BatchImage } from './types'

const ACTIVE = new Set(['pending', 'queued', 'processing'])

async function readSize(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}

export async function requestMatte(image: BatchImage, shouldStop: () => boolean) {
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
