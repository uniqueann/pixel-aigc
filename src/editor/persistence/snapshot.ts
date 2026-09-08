import { assetPlaceholder } from '@/cloud/assets'
import type { PixelProject } from '@/editor/types'
import { Capability } from '@/types'
import { defaultDrafts, type ProjectSnapshot } from './types'

function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('项目字段必须是对象')
}
function string(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('项目缺少必要的文本字段')
}
function finite(value: unknown, positive = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) throw new Error('项目含有无效尺寸或数值')
}
function array(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error('项目字段必须是数组')
}
function mediaUrl(value: unknown) {
  string(value)
  if (value !== value.trim()) throw new Error('媒体地址不可恢复，请使用上传地址或内嵌媒体')
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value)
  const allowedScheme = /^https?:/i.test(value) || /^data:(image|video|audio)\//i.test(value)
  if ((hasScheme && !allowedScheme) || (/^data:/i.test(value) && !/^data:(image|video|audio)\//i.test(value))) {
    throw new Error('媒体地址不可恢复，请使用上传地址或内嵌媒体')
  }
}
function validateNode(value: unknown, project: PixelProject) {
  object(value)
  string(value.id)
  for (const key of ['x', 'y', 'rotation', 'zIndex', 'opacity']) finite(value[key])
  finite(value.width, true); finite(value.height, true)
  if (typeof value.visible !== 'boolean' || typeof value.locked !== 'boolean') throw new Error('节点状态无效')
  if (value.type === 'image' || value.type === 'video') {
    string(value.assetId)
    if (project.assets[value.assetId]?.type !== value.type) throw new Error('节点引用的素材不存在或类型不匹配')
  } else if (value.type === 'generation') {
    string(value.generationId)
    if (!project.generations[value.generationId]) throw new Error('占位引用的 Generation 不存在')
    if (value.resultIndex !== undefined && (!Number.isInteger(value.resultIndex) || Number(value.resultIndex) < 0)) throw new Error('结果序号无效')
  } else if (value.type === 'text') {
    if (typeof value.text !== 'string') throw new Error('文本节点无效')
    string(value.fontFamily); finite(value.fontSize, true)
  } else if (value.type === 'shape') {
    if (!['rect', 'ellipse'].includes(String(value.shape))) throw new Error('形状节点无效')
    string(value.fill)
  } else throw new Error('不支持的节点类型')
}

function validateProject(value: unknown): asserts value is PixelProject {
  object(value)
  string(value.id)
  if (typeof value.name !== 'string') throw new Error('项目名称无效')
  string(value.createdAt); string(value.updatedAt)
  object(value.document); object(value.assets); object(value.generations)
  if (value.document.version !== 1) throw new Error('不支持的画布版本，请升级应用')
  array(value.document.scenes)
  string(value.document.activeSceneId)
  const project = value as unknown as PixelProject
  for (const [id, asset] of Object.entries(value.assets)) {
    object(asset)
    if (id !== asset.id) throw new Error('素材 ID 不一致')
    string(asset.id); string(asset.name); string(asset.mimeType); string(asset.createdAt); mediaUrl(asset.url)
    if (asset.storage !== undefined) {
      object(asset.storage)
      if (asset.storage.provider !== 'r2') throw new Error('素材存储类型无效')
      string(asset.storage.objectKey); string(asset.storage.projectId)
    }
    if (!['upload', 'generation', 'derived'].includes(String(asset.source))) throw new Error('素材来源无效')
    if (!['image', 'video', 'audio'].includes(String(asset.type))) throw new Error('素材类型无效')
    if (asset.type !== 'audio') { finite(asset.width, true); finite(asset.height, true) }
    if (asset.type !== 'image') { finite(asset.duration); if (Number(asset.duration) < 0) throw new Error('媒体时长无效') }
    if (asset.generationId !== undefined && !project.generations[String(asset.generationId)]) throw new Error('素材的 Generation 引用不存在')
  }
  for (const [id, job] of Object.entries(value.generations)) {
    object(job)
    if (id !== job.id) throw new Error('Generation ID 不一致')
    string(job.id); string(job.createdAt); string(job.updatedAt)
    if (job.backendTaskId !== undefined) string(job.backendTaskId)
    if (job.error !== undefined && typeof job.error !== 'string') throw new Error('任务错误信息无效')
    if (!Object.values(Capability).includes(job.capability as Capability)) throw new Error('生成能力无效')
    if (!['pending', 'queued', 'processing', 'succeeded', 'failed', 'cancelled'].includes(String(job.status))) throw new Error('生成状态无效')
    for (const key of ['inputAssetIds', 'outputAssetIds']) {
      array(job[key])
      for (const assetId of job[key]) if (typeof assetId !== 'string' || !project.assets[assetId]) throw new Error('Generation 的素材引用不存在')
    }
    for (const key of ['parentGenerationId', 'retryOfGenerationId']) {
      if (job[key] !== undefined && !project.generations[String(job[key])]) throw new Error('Generation 关联不存在')
    }
  }
  for (const key of ['parentGenerationId', 'retryOfGenerationId'] as const) {
    for (const job of Object.values(project.generations)) {
      const visited = new Set<string>()
      let current: typeof job | undefined = job
      while (current) {
        if (visited.has(current.id)) throw new Error('Generation 关联存在循环')
        visited.add(current.id)
        const next: string | undefined = current[key]
        current = next ? project.generations[next] : undefined
      }
    }
  }
  const sceneIds = new Set<string>()
  const nodeIds = new Set<string>()
  for (const scene of value.document.scenes) {
    object(scene); string(scene.id); string(scene.name)
    if (sceneIds.has(scene.id)) throw new Error('场景 ID 重复')
    sceneIds.add(scene.id)
    finite(scene.width, true); finite(scene.height, true)
    object(scene.viewport)
    finite(scene.viewport.zoom, true); finite(scene.viewport.panX); finite(scene.viewport.panY)
    array(scene.nodes)
    for (const node of scene.nodes) {
      validateNode(node, project)
      const id = (node as { id: string }).id
      if (nodeIds.has(id)) throw new Error('节点 ID 重复')
      nodeIds.add(id)
    }
  }
  if (!sceneIds.has(value.document.activeSceneId)) throw new Error('活动场景不存在')
}

/** 裸项目是历史格式；迁移时不推测自动重试额度。 */
export function parseSnapshot(input: unknown): ProjectSnapshot {
  const value = typeof input === 'string' ? JSON.parse(input) as unknown : input
  object(value)
  if ('schemaVersion' in value && value.schemaVersion !== 1) throw new Error('不支持的项目版本，请升级应用')
  const project = 'schemaVersion' in value ? value.project : value
  validateProject(project)
  const snapshot: ProjectSnapshot = {
    schemaVersion: 1,
    project,
    drafts: defaultDrafts(),
    recoveries: {},
  }
  if ('schemaVersion' in value) {
    object(value.drafts); object(value.recoveries)
    for (const mode of ['text-to-image', 'text-to-video'] as const) {
      const draft = value.drafts[mode]
      object(draft)
      if (typeof draft.prompt !== 'string' || !['1:1', '4:3', '3:4', '16:9', '9:16'].includes(String(draft.presetKey))) throw new Error('生成草稿无效')
      if ((typeof draft.count !== 'number' || ![1, 2, 3, 4].includes(draft.count)) || (typeof draft.durationSeconds !== 'number' || ![5, 10].includes(draft.durationSeconds))) throw new Error('生成草稿参数无效')
    }
    if (value.drafts.derived !== undefined) {
      const draft = value.drafts.derived
      object(draft)
      if (!['variation', 'image-to-video'].includes(String(draft.mode)) || typeof draft.prompt !== 'string') throw new Error('派生草稿无效')
      validateNode(draft.sourceNode, project)
      object(draft.sourceNode)
      if (draft.sourceNode.type !== 'image' || draft.sourceNode.assetId !== draft.sourceAssetId) throw new Error('派生源节点与素材不匹配')
      if (project.assets[String(draft.sourceAssetId)]?.type !== 'image') throw new Error('派生源素材不存在')
      if ((typeof draft.count !== 'number' || ![1, 2, 3, 4].includes(draft.count)) || (typeof draft.durationSeconds !== 'number' || ![5, 10].includes(draft.durationSeconds))) throw new Error('派生参数无效')
    }
    for (const [id, record] of Object.entries(value.recoveries)) {
      object(record); object(record.request); object(record.context)
      if (id !== record.request.requestId || record.projectId !== project.id || !project.document.scenes.some((scene) => scene.id === record.sceneId)) throw new Error('任务恢复归属无效')
      string(record.request.requestId)
      if (![Capability.TextToImage, Capability.TextToVideo, Capability.Variation].includes(record.request.capability as Capability)) throw new Error('任务恢复能力无效')
      object(record.request.params)
      const params = record.request.params
      object(params.size); finite(params.size.width, true); finite(params.size.height, true)
      if ((typeof params.count !== 'number' || ![1, 2, 3, 4].includes(params.count))) throw new Error('任务恢复数量无效')
      if (record.request.capability === Capability.Variation) {
        mediaUrl(params.sourceImageUrl)
        if (params.prompt !== undefined && typeof params.prompt !== 'string') throw new Error('裂变提示词无效')
      } else if (typeof params.prompt !== 'string' || !params.prompt.trim()) throw new Error('任务恢复提示词无效')
      if (record.request.capability === Capability.TextToVideo && (params.count !== 1 || (typeof params.durationSeconds !== 'number' || ![5, 10].includes(params.durationSeconds)))) throw new Error('视频任务参数无效')
      if (params.sourceImageUrl !== undefined) mediaUrl(params.sourceImageUrl)
      if ((typeof record.context.autoRetryRemaining !== 'number' || ![0, 1].includes(record.context.autoRetryRemaining)) || typeof record.context.automaticRetry !== 'boolean' || typeof record.applied !== 'boolean') throw new Error('重试恢复状态无效')
      array(record.context.inputAssetIds)
      for (const assetId of record.context.inputAssetIds) if (!project.assets[String(assetId)]) throw new Error('任务恢复源素材不存在')
      for (const key of ['parentGenerationId', 'retryOfGenerationId']) if (record.context[key] !== undefined && !project.generations[String(record.context[key])]) throw new Error('任务恢复关联不存在')
      if (record.abandoned !== undefined && typeof record.abandoned !== 'boolean') throw new Error('恢复记录状态无效')
      if (record.backendTaskId !== undefined) string(record.backendTaskId)
      array(record.placements); array(record.replacedPlaceholderIds)
      for (const id of record.replacedPlaceholderIds) string(id)
      for (const placement of record.placements) {
        object(placement); finite(placement.x); finite(placement.y); finite(placement.width, true); finite(placement.height, true)
      }
      if (record.backendTaskId !== undefined && !project.generations[`generation:${record.backendTaskId}`]) throw new Error('恢复任务对应的 Generation 不存在')
    }
    snapshot.drafts = value.drafts as unknown as ProjectSnapshot['drafts']
    snapshot.recoveries = value.recoveries as unknown as ProjectSnapshot['recoveries']
  }
  if ('schemaVersion' in value && value.cloud !== undefined) {
    object(value.cloud)
    if (!Number.isInteger(value.cloud.revision) || Number(value.cloud.revision) < 1 || typeof value.cloud.pending !== 'boolean') throw new Error('云端同步版本无效')
    snapshot.cloud = { revision: Number(value.cloud.revision), pending: value.cloud.pending, conflict: value.cloud.conflict === true }
  }
  return structuredClone(snapshot)
}

export function persistableSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
  const copy = parseSnapshot(snapshot)
  for (const asset of Object.values(copy.project.assets)) {
    if (asset.storage?.provider === 'r2') {
      asset.url = assetPlaceholder(asset.id)
      delete asset.accessExpiresAt
    }
  }
  return copy
}
export function serializeSnapshot(snapshot: ProjectSnapshot) {
  return JSON.stringify(persistableSnapshot(snapshot), null, 2)
}
