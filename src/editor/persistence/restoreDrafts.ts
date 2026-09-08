import { Capability } from '@/types'
import type { ImageNode } from '@/editor/types'
import { IMAGE_SIZE_PRESETS } from '@/features/free-canvas/generation/config'
import type { ProjectSnapshot } from './types'

/** 已提交任务优先恢复实际请求，避免草稿与任务状态不一致。 */
export function restoreTaskDrafts(snapshot: ProjectSnapshot) {
  const { project, drafts } = snapshot
  const record = Object.values(snapshot.recoveries).find((item) => !item.applied && !item.abandoned)
  const placeholder = project.document.scenes.flatMap((scene) => scene.nodes).find((node) => node.type === 'generation')
  const job = placeholder?.type === 'generation' ? project.generations[placeholder.generationId] : undefined
  const request = record?.request ?? (job ? { capability: job.capability, params: job.input } : undefined)
  if (!request || !request.params || typeof request.params !== 'object') return drafts
  const params = request.params as { prompt?: string; size?: { width: number; height: number }; count?: number; durationSeconds?: number; sourceImageUrl?: string }
  const sourceId = record?.context.inputAssetIds[0] ?? job?.inputAssetIds[0]
  const source = sourceId ? project.assets[sourceId] : undefined
  if (source?.type === 'image' && (request.capability === Capability.Variation || params.sourceImageUrl)) {
    const currentSource = project.document.scenes.flatMap((scene) => scene.nodes).find((node): node is ImageNode => node.type === 'image' && node.assetId === source.id)
    const sourceNode: ImageNode = currentSource ?? drafts.derived?.sourceNode ?? {
      id: `restored-source:${source.id}`, type: 'image', assetId: source.id,
      x: 0, y: 0, width: Math.min(320, source.width), height: Math.min(320, source.height),
      rotation: 0, zIndex: 0, opacity: 1, visible: true, locked: false,
    }
    return { ...drafts, derived: {
      mode: request.capability === Capability.Variation ? 'variation' as const : 'image-to-video' as const,
      sourceNode, sourceAssetId: source.id, prompt: params.prompt ?? '', count: params.count ?? 4, durationSeconds: params.durationSeconds ?? 5,
    } }
  }
  const mode = request.capability === Capability.TextToVideo ? 'text-to-video' : 'text-to-image'
  const presetKey = IMAGE_SIZE_PRESETS.find((preset) => preset.width === params.size?.width && preset.height === params.size?.height)?.key ?? '1:1'
  return { ...drafts, derived: undefined, [mode]: { prompt: params.prompt ?? '', presetKey, count: params.count ?? 1, durationSeconds: params.durationSeconds ?? 5 } }
}
