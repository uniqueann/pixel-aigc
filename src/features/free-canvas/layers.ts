import type { Asset, EditorNode, GenerationJob, NodeId } from '@/editor/types'
import { i18n } from '@/i18n'

export type LayerKind = 'image' | 'video' | 'generation'

export interface LayerItem {
  id: NodeId
  name: string
  kind: LayerKind
  /** 右侧副标题：尺寸或生成状态 */
  meta: string
  /** 仅当可直接展示时给出（图片且 URL 可用） */
  thumbnail?: string
  broken: boolean
}

const KIND_KEYS = {
  image: 'canvas:layers.kinds.image',
  video: 'canvas:layers.kinds.video',
  generation: 'canvas:layers.kinds.generation',
} as const

const STATUS_KEYS = {
  pending: 'canvas:layers.status.pending',
  queued: 'canvas:layers.status.queued',
  processing: 'canvas:layers.status.processing',
  succeeded: 'canvas:layers.status.succeeded',
  failed: 'canvas:layers.status.failed',
  cancelled: 'canvas:layers.status.cancelled',
} as const

/** `<img>` 只接受这些协议；占位符 `__aigc_asset__` 之类一律不展示。 */
function displayable(url?: string) {
  return !!url && /^(https?:|data:|blob:)/.test(url)
}

function isBrokenAsset(asset: Asset | undefined, kind: LayerKind) {
  if (!asset || asset.type !== kind) return true
  return Boolean(asset.missing || asset.loadError)
}

/**
 * 图层列表的数据源：顶层在前（与画布叠放一致）。
 * 只列画布真正会渲染的节点类型（图片/视频/生成占位），与 `FreeCanvasStage` 的 reconcile 过滤保持一致。
 */
export function buildLayerItems(
  nodes: EditorNode[],
  assets: Record<string, Asset>,
  generations: Record<string, GenerationJob>,
): LayerItem[] {
  const items = rawLayerItems(nodes, assets, generations)
  return withDuplicateOrdinals(items)
}

/** 同名节点（复制出来的副本）按"从下往上"编序号，原件保留原名。 */
function withDuplicateOrdinals(items: LayerItem[]): LayerItem[] {
  const total = new Map<string, number>()
  for (const item of items) total.set(item.name, (total.get(item.name) ?? 0) + 1)
  const used = new Map<string, number>()
  const result = [...items]
  for (let index = result.length - 1; index >= 0; index -= 1) {
    const item = result[index]
    if ((total.get(item.name) ?? 0) < 2) continue
    const ordinal = (used.get(item.name) ?? 0) + 1
    used.set(item.name, ordinal)
    if (ordinal > 1) result[index] = { ...item, name: `${item.name} ${ordinal}` }
  }
  return result
}

function rawLayerItems(
  nodes: EditorNode[],
  assets: Record<string, Asset>,
  generations: Record<string, GenerationJob>,
): LayerItem[] {
  return nodes
    .filter((node): node is Extract<EditorNode, { type: LayerKind }> => (
      node.type === 'image' || node.type === 'video' || node.type === 'generation'
    ))
    .slice()
    .sort((a, b) => b.zIndex - a.zIndex)
    .map((node) => {
      if (node.type === 'generation') {
        const status = generations[node.generationId]?.status
        const statusKey = status && status in STATUS_KEYS
          ? STATUS_KEYS[status as keyof typeof STATUS_KEYS]
          : STATUS_KEYS.queued
        return {
          id: node.id,
          name: node.name?.trim() || i18n.t(KIND_KEYS.generation),
          kind: 'generation' as const,
          meta: i18n.t(statusKey),
          broken: status === 'failed' || status === 'cancelled',
        }
      }
      const broken = isBrokenAsset(assets[node.assetId], node.type)
      const size = `${Math.round(node.width)}×${Math.round(node.height)}`
      return {
        id: node.id,
        name: node.name?.trim() || i18n.t(KIND_KEYS[node.type]),
        kind: node.type,
        // 视频把时长放前面：同尺寸的 5 秒 / 10 秒结果需要区分。
        meta: broken
          ? i18n.t('canvas:layers.assetUnavailable')
          : node.type === 'video' && node.duration
            ? i18n.t('canvas:layers.videoMeta', { duration: Math.round(node.duration), size })
            : size,
        // 视频没有可直接放进 <img> 的封面，交回 kind 图标。
        thumbnail: !broken && node.type === 'image' && displayable(assets[node.assetId]?.url)
          ? assets[node.assetId].url
          : undefined,
        broken,
      }
    })
}
