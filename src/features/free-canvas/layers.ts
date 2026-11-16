import type { Asset, EditorNode, GenerationJob, NodeId } from '@/editor/types'

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

const KIND_LABELS: Record<LayerKind, string> = {
  image: '图片',
  video: '视频',
  generation: '生成占位',
}

const STATUS_LABELS: Record<string, string> = {
  pending: '准备中',
  queued: '排队中',
  processing: '生成中',
  succeeded: '生成完成',
  failed: '生成失败',
  cancelled: '已取消',
}

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
        return {
          id: node.id,
          name: node.name?.trim() || KIND_LABELS.generation,
          kind: 'generation' as const,
          meta: (status && STATUS_LABELS[status]) ?? STATUS_LABELS.queued,
          broken: status === 'failed' || status === 'cancelled',
        }
      }
      const broken = isBrokenAsset(assets[node.assetId], node.type)
      return {
        id: node.id,
        name: node.name?.trim() || KIND_LABELS[node.type],
        kind: node.type,
        meta: broken ? '素材不可用' : `${Math.round(node.width)}×${Math.round(node.height)}`,
        // 视频没有可直接放进 <img> 的封面，交回 kind 图标。
        thumbnail: !broken && node.type === 'image' && displayable(assets[node.assetId]?.url)
          ? assets[node.assetId].url
          : undefined,
        broken,
      }
    })
}
