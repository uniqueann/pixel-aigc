import type { AssetId, GenerationId } from './ids'

interface BaseAsset {
  id: AssetId
  name: string
  url: string
  mimeType: string
  createdAt: string
  source: 'upload' | 'generation' | 'derived'
  generationId?: GenerationId
}

export interface ImageAsset extends BaseAsset {
  type: 'image'
  width: number
  height: number
}

export interface VideoAsset extends BaseAsset {
  type: 'video'
  width: number
  height: number
  duration: number
}

export interface AudioAsset extends BaseAsset {
  type: 'audio'
  duration: number
}

export type Asset = ImageAsset | VideoAsset | AudioAsset
