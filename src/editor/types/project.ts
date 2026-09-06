import type { Asset } from './asset'
import type { PixelDocument } from './document'
import type { GenerationJob } from './generation'
import type { AssetId, GenerationId, ProjectId } from './ids'

export interface PixelProject {
  id: ProjectId
  name: string
  document: PixelDocument
  assets: Record<AssetId, Asset>
  generations: Record<GenerationId, GenerationJob>
  createdAt: string
  updatedAt: string
}
