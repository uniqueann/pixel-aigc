import type { Asset, EditorNode, GenerationId, GenerationJob, NodeId } from '@/editor/types'

/** 生成结果与占位节点的 id 都带任务前缀：`generated-node:<taskId>:<n>` / `generation-node:<taskId>:<n>`。 */
const NODE_ID_PATTERN = /^(?:generated-node|generation-node):(.+):\d+$/

/** 从节点 id 里取出产出它的任务 id；手工导入、复制出来的节点没有前缀，返回 undefined。 */
export function taskIdFromNodeId(nodeId: NodeId): string | undefined {
  return NODE_ID_PATTERN.exec(nodeId)?.[1]
}

export interface LineageRelation {
  /** 同批的其它节点（不含自己）。复制/粘贴出来的副本不带任务前缀，天然不会进来。 */
  siblings: NodeId[]
  /** 派生关系：源节点在画布上时才给 */
  derived?: { generationId: GenerationId; sourceNodeIds: NodeId[] }
}

const EMPTY: LineageRelation = { siblings: [] }

/**
 * 选中一个节点时的血缘关系（只读推导，不写任何数据）：
 * - 同批：节点 id 前缀里的任务 id 相同；
 * - 派生：该素材所属任务有 `parentGenerationId`，且父任务的产出在画布上还有节点。
 */
export function resolveLineage(
  selected: EditorNode | undefined,
  nodes: EditorNode[],
  assets: Record<string, Asset>,
  generations: Record<string, GenerationJob>,
): LineageRelation {
  if (!selected) return EMPTY
  const taskId = taskIdFromNodeId(selected.id)
  const siblings = taskId
    ? nodes
      .filter((node) => node.id !== selected.id && taskIdFromNodeId(node.id) === taskId)
      .map((node) => node.id)
    : []

  const generationId = selected.type === 'generation'
    ? selected.generationId
    : (selected.type === 'image' || selected.type === 'video' ? assets[selected.assetId]?.generationId : undefined)
  const parentId = generationId ? generations[generationId]?.parentGenerationId : undefined
  const parentOutputs = parentId ? new Set(generations[parentId]?.outputAssetIds ?? []) : undefined
  const sourceNodeIds = parentOutputs
    ? nodes
      .filter((node) => node.id !== selected.id
        && (node.type === 'image' || node.type === 'video')
        && parentOutputs.has(node.assetId))
      .map((node) => node.id)
    : []

  return {
    siblings,
    ...(parentId && sourceNodeIds.length ? { derived: { generationId: parentId, sourceNodeIds } } : {}),
  }
}
