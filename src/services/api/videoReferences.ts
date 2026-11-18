import { VIDEO_REFERENCE_MAX_BYTES, type VideoReference } from '@shared/video-replication'
import { apiClient } from './client'

export type PreviewVideoReference = VideoReference & { url: string }

export function inspectVideoReference(key: string, signal?: AbortSignal) {
  return apiClient.post<unknown, PreviewVideoReference>('/video-references/inspect', { key }, { signal, timeout: 30_000 })
}

export async function uploadVideoReference(file: File, signal: AbortSignal) {
  if (!file.size || file.size > VIDEO_REFERENCE_MAX_BYTES || !/\.mp4$/i.test(file.name)) {
    throw new Error('请选择 50 MB 以内的 H.264 MP4 文件')
  }
  const { uploadId, uploadUrl } = await apiClient.post<unknown, { uploadId: string; uploadUrl: string }>(
    '/video-references/uploads', { size: file.size }, { signal },
  )
  const upload = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: file, signal })
  if (!upload.ok) throw new Error('参考视频上传失败，请重试')
  return apiClient.post<unknown, PreviewVideoReference>('/video-references/complete', { uploadId, size: file.size }, { signal, timeout: 55_000 })
}
