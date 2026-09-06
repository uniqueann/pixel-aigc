import type { AssetId, GenerationId, ImageAsset, VideoAsset } from '@/editor/types'

interface ImageAssetInput {
  id?: AssetId
  name: string
  url: string
  width: number
  height: number
  source?: ImageAsset['source']
  generationId?: GenerationId
  createdAt?: string
}

export function createImageAsset(input: ImageAssetInput): ImageAsset {
  return {
    id: input.id ?? crypto.randomUUID(),
    type: 'image',
    name: input.name,
    url: input.url,
    mimeType: inferMimeType(input.url, 'image/png'),
    width: input.width,
    height: input.height,
    source: input.source ?? 'upload',
    generationId: input.generationId,
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
}

export function createVideoAsset(input: Omit<ImageAssetInput, 'source'> & { duration?: number }): VideoAsset {
  return {
    id: input.id ?? crypto.randomUUID(),
    type: 'video',
    name: input.name,
    url: input.url,
    mimeType: inferMimeType(input.url, 'video/mp4'),
    width: input.width,
    height: input.height,
    duration: input.duration ?? 0,
    source: 'generation',
    generationId: input.generationId,
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
}

function inferMimeType(url: string, fallback: string) {
  if (url.startsWith('data:')) return url.slice(5, url.indexOf(';')) || fallback
  const parts = url.split(/[?#]/)[0].split('.')
  const extension = parts[parts.length - 1]?.toLowerCase()
  const types: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  }
  return extension ? types[extension] ?? fallback : fallback
}
