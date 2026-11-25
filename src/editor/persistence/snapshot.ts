import { VIDEO_REPLICATION_RATIOS } from '@shared/video-replication'
import { assetPlaceholder } from '@/cloud/assets'
import { deserializeCommand, type SerializedEditorCommand } from '@/editor/commands'
import { MAX_PERSISTED_HISTORY } from '@/editor/store/historySlice'
import type { Asset, EditorNode, PixelProject } from '@/editor/types'
import { i18n } from '@/i18n'
import { Capability } from '@/types'
import { defaultDrafts, type ProjectHistory, type ProjectSnapshot } from './types'

const MEDIA_PREFIX = '/__aigc_media__/'

function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(i18n.t('canvas:snapshot.errors.expectedObject'))
}
function string(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(i18n.t('canvas:snapshot.errors.missingText'))
}
function finite(value: unknown, positive = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) throw new Error(i18n.t('canvas:snapshot.errors.invalidNumber'))
}
function array(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(i18n.t('canvas:snapshot.errors.expectedArray'))
}
function mediaUrl(value: unknown) {
  string(value)
  if (value !== value.trim()) throw new Error(i18n.t('canvas:snapshot.errors.invalidMediaUrl'))
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value)
  const allowedScheme = /^https?:/i.test(value) || /^data:(image|video|audio)\//i.test(value)
  if ((hasScheme && !allowedScheme) || (/^data:/i.test(value) && !/^data:(image|video|audio)\//i.test(value))) {
    throw new Error(i18n.t('canvas:snapshot.errors.invalidMediaUrl'))
  }
}
function validateNode(value: unknown, project: PixelProject) {
  object(value)
  string(value.id)
  for (const key of ['x', 'y', 'rotation', 'zIndex', 'opacity']) finite(value[key])
  finite(value.width, true); finite(value.height, true)
  if (typeof value.visible !== 'boolean' || typeof value.locked !== 'boolean') throw new Error(i18n.t('canvas:snapshot.errors.invalidNodeState'))
  if (value.type === 'image' || value.type === 'video') {
    string(value.assetId)
    if (project.assets[value.assetId]?.type !== value.type) throw new Error(i18n.t('canvas:snapshot.errors.invalidNodeAssetRef'))
  } else if (value.type === 'generation') {
    string(value.generationId)
    if (!project.generations[value.generationId]) throw new Error(i18n.t('canvas:snapshot.errors.missingNodeGeneration'))
    if (value.resultIndex !== undefined && (!Number.isInteger(value.resultIndex) || Number(value.resultIndex) < 0)) throw new Error(i18n.t('canvas:snapshot.errors.invalidResultIndex'))
  } else if (value.type === 'text') {
    if (typeof value.text !== 'string') throw new Error(i18n.t('canvas:snapshot.errors.invalidTextNode'))
    string(value.fontFamily); finite(value.fontSize, true)
  } else if (value.type === 'shape') {
    if (!['rect', 'ellipse'].includes(String(value.shape))) throw new Error(i18n.t('canvas:snapshot.errors.invalidShapeNode'))
    string(value.fill)
  } else throw new Error(i18n.t('canvas:snapshot.errors.unsupportedNodeType'))
}

function validateProject(value: unknown): asserts value is PixelProject {
  object(value)
  string(value.id)
  if (typeof value.name !== 'string') throw new Error(i18n.t('canvas:snapshot.errors.invalidProjectName'))
  string(value.createdAt); string(value.updatedAt)
  object(value.document); object(value.assets); object(value.generations)
  if (value.document.version !== 1) throw new Error(i18n.t('canvas:snapshot.errors.unsupportedDocumentVersion'))
  array(value.document.scenes)
  string(value.document.activeSceneId)
  const project = value as unknown as PixelProject
  for (const [id, asset] of Object.entries(value.assets)) {
    object(asset)
    if (id !== asset.id) throw new Error(i18n.t('canvas:snapshot.errors.assetIdMismatch'))
    string(asset.id); string(asset.name); string(asset.mimeType); string(asset.createdAt); mediaUrl(asset.url)
    if (asset.objectKey !== undefined) string(asset.objectKey)
    if (asset.storage !== undefined) {
      object(asset.storage)
      if (asset.storage.provider !== 'r2') throw new Error(i18n.t('canvas:snapshot.errors.invalidAssetStorage'))
      string(asset.storage.objectKey); string(asset.storage.projectId)
    }
    if (!['upload', 'generation', 'derived'].includes(String(asset.source))) throw new Error(i18n.t('canvas:snapshot.errors.invalidAssetSource'))
    if (!['image', 'video', 'audio'].includes(String(asset.type))) throw new Error(i18n.t('canvas:snapshot.errors.invalidAssetType'))
    if (asset.type !== 'audio') { finite(asset.width, true); finite(asset.height, true) }
    if (asset.type !== 'image') { finite(asset.duration); if (Number(asset.duration) < 0) throw new Error(i18n.t('canvas:snapshot.errors.invalidMediaDuration')) }
    if (asset.generationId !== undefined && !project.generations[String(asset.generationId)]) throw new Error(i18n.t('canvas:snapshot.errors.missingAssetGeneration'))
  }
  for (const [id, job] of Object.entries(value.generations)) {
    object(job)
    if (id !== job.id) throw new Error(i18n.t('canvas:snapshot.errors.generationIdMismatch'))
    string(job.id); string(job.createdAt); string(job.updatedAt)
    if (job.backendTaskId !== undefined) string(job.backendTaskId)
    if (job.error !== undefined && typeof job.error !== 'string') throw new Error(i18n.t('canvas:snapshot.errors.invalidGenerationError'))
    if (!Object.values(Capability).includes(job.capability as Capability)) throw new Error(i18n.t('canvas:snapshot.errors.invalidGenerationCapability'))
    if (!['pending', 'queued', 'processing', 'succeeded', 'failed', 'cancelled'].includes(String(job.status))) throw new Error(i18n.t('canvas:snapshot.errors.invalidGenerationStatus'))
    for (const key of ['inputAssetIds', 'outputAssetIds']) {
      array(job[key])
      for (const assetId of job[key]) if (typeof assetId !== 'string' || !project.assets[assetId]) throw new Error(i18n.t('canvas:snapshot.errors.missingGenerationAssetRef'))
    }
    for (const key of ['parentGenerationId', 'retryOfGenerationId']) {
      if (job[key] !== undefined && !project.generations[String(job[key])]) throw new Error(i18n.t('canvas:snapshot.errors.missingGenerationLink'))
    }
  }
  for (const key of ['parentGenerationId', 'retryOfGenerationId'] as const) {
    for (const job of Object.values(project.generations)) {
      const visited = new Set<string>()
      let current: typeof job | undefined = job
      while (current) {
        if (visited.has(current.id)) throw new Error(i18n.t('canvas:snapshot.errors.generationCycle'))
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
    if (sceneIds.has(scene.id)) throw new Error(i18n.t('canvas:snapshot.errors.duplicateSceneId'))
    sceneIds.add(scene.id)
    finite(scene.width, true); finite(scene.height, true)
    object(scene.viewport)
    finite(scene.viewport.zoom, true); finite(scene.viewport.panX); finite(scene.viewport.panY)
    array(scene.nodes)
    for (const node of scene.nodes) {
      validateNode(node, project)
      const id = (node as { id: string }).id
      if (nodeIds.has(id)) throw new Error(i18n.t('canvas:snapshot.errors.duplicateNodeId'))
      nodeIds.add(id)
    }
  }
  if (!sceneIds.has(value.document.activeSceneId)) throw new Error(i18n.t('canvas:snapshot.errors.missingActiveScene'))
}

/** 裸项目是历史格式；迁移时不推测自动重试额度。 */
export function parseSnapshot(input: unknown): ProjectSnapshot {
  const value = typeof input === 'string' ? JSON.parse(input) as unknown : input
  object(value)
  if ('schemaVersion' in value && value.schemaVersion !== 1) throw new Error(i18n.t('canvas:snapshot.errors.unsupportedProjectVersion'))
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
      if (typeof draft.prompt !== 'string' || !['1:1', '4:3', '3:4', '16:9', '9:16'].includes(String(draft.presetKey))) throw new Error(i18n.t('canvas:snapshot.errors.invalidGenerationDraft'))
      if ((typeof draft.count !== 'number' || ![1, 2, 3, 4].includes(draft.count)) || (typeof draft.durationSeconds !== 'number' || ![5, 10].includes(draft.durationSeconds))) throw new Error(i18n.t('canvas:snapshot.errors.invalidGenerationDraftParams'))
      if (draft.modelProfileId !== undefined) string(draft.modelProfileId)
      if (draft.resolution !== undefined && !(mode === 'text-to-video' ? ['720p'] : ['1k', '2k', '4k']).includes(String(draft.resolution))) throw new Error(i18n.t('canvas:snapshot.errors.invalidGenerationDraftResolution'))
      if ('videoResolution' in draft && draft.videoResolution !== undefined && (mode !== 'text-to-video' || !['720p', '768p', '2k'].includes(String(draft.videoResolution)))) throw new Error(i18n.t('canvas:snapshot.errors.invalidVideoDraftResolution'))
      if (draft.generateAudio !== undefined && typeof draft.generateAudio !== 'boolean') throw new Error(i18n.t('canvas:snapshot.errors.invalidVideoAudioSetting'))
      if (draft.enableThinking !== undefined && typeof draft.enableThinking !== 'boolean') throw new Error(i18n.t('canvas:snapshot.errors.invalidAutoExpandSetting'))
    }
    if (value.drafts.videoReplication !== undefined) {
      const draft = value.drafts.videoReplication
      object(draft); string(draft.ownerId)
      if (typeof draft.prompt !== 'string' || !VIDEO_REPLICATION_RATIOS.some(ratio => ratio === draft.ratio)
        || typeof draft.durationSeconds !== 'number' || !Number.isInteger(draft.durationSeconds)
        || draft.durationSeconds < 4 || draft.durationSeconds > 15) throw new Error(i18n.t('canvas:snapshot.errors.invalidReplicationDraft'))
      if (draft.productAssetId !== undefined) string(draft.productAssetId)
      if (draft.reference !== undefined) {
        const reference = draft.reference
        object(reference); string(reference.key); string(reference.name)
        finite(reference.width, true); finite(reference.height, true)
        if (typeof reference.durationSeconds !== 'number' || !Number.isFinite(reference.durationSeconds)
          || reference.durationSeconds < 2 || reference.durationSeconds > 15
          || typeof reference.retentionExpiresAt !== 'string' || !Number.isFinite(Date.parse(reference.retentionExpiresAt))) {
          throw new Error(i18n.t('canvas:snapshot.errors.invalidReferenceDraft'))
        }
        if (reference.assetId !== undefined) string(reference.assetId)
      }
    }
    if (value.drafts.derived !== undefined) {
      const draft = value.drafts.derived
      object(draft)
      if (!['variation', 'image-to-video'].includes(String(draft.mode)) || typeof draft.prompt !== 'string') throw new Error(i18n.t('canvas:snapshot.errors.invalidDerivedDraft'))
      validateNode(draft.sourceNode, project)
      object(draft.sourceNode)
      if (draft.sourceNode.type !== 'image' || draft.sourceNode.assetId !== draft.sourceAssetId) throw new Error(i18n.t('canvas:snapshot.errors.derivedNodeAssetMismatch'))
      if (project.assets[String(draft.sourceAssetId)]?.type !== 'image') throw new Error(i18n.t('canvas:snapshot.errors.missingDerivedSourceAsset'))
      if ((typeof draft.count !== 'number' || ![1, 2, 3, 4].includes(draft.count)) || (typeof draft.durationSeconds !== 'number' || ![5, 10].includes(draft.durationSeconds))) throw new Error(i18n.t('canvas:snapshot.errors.invalidDerivedParams'))
      if (draft.modelProfileId !== undefined) string(draft.modelProfileId)
      if (draft.resolution !== undefined && !(draft.mode === 'image-to-video' ? ['720p', '1k', '2k', '4k'] : ['1k', '2k', '4k']).includes(String(draft.resolution))) throw new Error(i18n.t('canvas:snapshot.errors.invalidDerivedResolution'))
      if (draft.videoResolution !== undefined && (draft.mode !== 'image-to-video' || !['720p', '768p', '2k'].includes(String(draft.videoResolution)))) throw new Error(i18n.t('canvas:snapshot.errors.invalidVideoDraftResolution'))
      if (draft.generateAudio !== undefined && typeof draft.generateAudio !== 'boolean') throw new Error(i18n.t('canvas:snapshot.errors.invalidVideoAudioSetting'))
    }
    for (const [id, record] of Object.entries(value.recoveries)) {
      object(record); object(record.request); object(record.context)
      if (id !== record.request.requestId || record.projectId !== project.id || !project.document.scenes.some((scene) => scene.id === record.sceneId)) throw new Error(i18n.t('canvas:snapshot.errors.invalidRecoveryOwnership'))
      string(record.request.requestId)
      if (record.ownerId !== undefined) string(record.ownerId)
      if (record.request.modelProfileId !== undefined) string(record.request.modelProfileId)
      if (record.request.priceVersion !== undefined) string(record.request.priceVersion)
      if (![Capability.TextToImage, Capability.TextToVideo, Capability.Variation].includes(record.request.capability as Capability)) throw new Error(i18n.t('canvas:snapshot.errors.invalidRecoveryCapability'))
      object(record.request.params)
      const params = record.request.params
      object(params.size); finite(params.size.width, true); finite(params.size.height, true)
      if ((typeof params.count !== 'number' || ![1, 2, 3, 4].includes(params.count))) throw new Error(i18n.t('canvas:snapshot.errors.invalidRecoveryCount'))
      if (params.resolution !== undefined && !(record.request.capability === Capability.TextToVideo ? ['720p', '768p', '2k'] : ['1k', '2k', '4k']).includes(String(params.resolution))) throw new Error(i18n.t('canvas:snapshot.errors.invalidRecoveryResolution'))
      if (params.generateAudio !== undefined && typeof params.generateAudio !== 'boolean') throw new Error(i18n.t('canvas:snapshot.errors.invalidVideoAudioSetting'))
      if (params.enableThinking !== undefined && typeof params.enableThinking !== 'boolean') throw new Error(i18n.t('canvas:snapshot.errors.invalidAutoExpandSetting'))
      if (record.request.capability === Capability.Variation) {
        if (params.sourceImageKey !== undefined) {
          string(params.sourceImageKey)
          if (!['1k', '2k', '4k'].includes(String(params.resolution))) throw new Error(i18n.t('canvas:snapshot.errors.missingVariationResolution'))
        } else mediaUrl(params.sourceImageUrl)
        if (params.prompt !== undefined && typeof params.prompt !== 'string') throw new Error(i18n.t('canvas:snapshot.errors.invalidVariationPrompt'))
      } else if (typeof params.prompt !== 'string' || (params.mode !== 'video_replication' && !params.prompt.trim())) throw new Error(i18n.t('canvas:snapshot.errors.invalidRecoveryPrompt'))
      if (record.request.capability === Capability.TextToVideo) {
        if (params.count !== 1 || typeof params.durationSeconds !== 'number') throw new Error(i18n.t('canvas:snapshot.errors.invalidVideoTaskParams'))
        if (params.mode === 'video_replication') {
          string(params.referenceVideoKey); string(params.sourceImageKey)
          if (params.resolution !== '720p' || params.generateAudio !== false || !Number.isInteger(params.durationSeconds)
            || params.durationSeconds < 4 || params.durationSeconds > 15
            || !VIDEO_REPLICATION_RATIOS.some(ratio => ratio === params.ratio)) throw new Error(i18n.t('canvas:snapshot.errors.invalidReplicationTaskParams'))
        } else if (![5, 10].includes(params.durationSeconds)) throw new Error(i18n.t('canvas:snapshot.errors.invalidVideoTaskParams'))
      }
      if (params.sourceImageUrl !== undefined) mediaUrl(params.sourceImageUrl)
      if ((typeof record.context.autoRetryRemaining !== 'number' || ![0, 1].includes(record.context.autoRetryRemaining)) || typeof record.context.automaticRetry !== 'boolean' || typeof record.applied !== 'boolean') throw new Error(i18n.t('canvas:snapshot.errors.invalidRetryRecoveryState'))
      array(record.context.inputAssetIds)
      if (record.context.referenceLabel !== undefined) string(record.context.referenceLabel)
      if (record.abandoned !== undefined && typeof record.abandoned !== 'boolean') throw new Error(i18n.t('canvas:snapshot.errors.invalidRecoveryState'))
      if (record.backendTaskId !== undefined) string(record.backendTaskId)
      array(record.placements); array(record.replacedPlaceholderIds)
      for (const id of record.replacedPlaceholderIds) string(id)
      for (const placement of record.placements) {
        object(placement); finite(placement.x); finite(placement.y); finite(placement.width, true); finite(placement.height, true)
      }
      if (!record.abandoned) {
        const missingGeneration = record.backendTaskId !== undefined && !project.generations[`generation:${record.backendTaskId}`]
        const context = record.context as { inputAssetIds: unknown[]; parentGenerationId?: unknown; retryOfGenerationId?: unknown }
        const missingAsset = context.inputAssetIds.some((assetId) => !project.assets[String(assetId)])
        const missingParent = (context.parentGenerationId !== undefined && !project.generations[String(context.parentGenerationId)])
          || (context.retryOfGenerationId !== undefined && !project.generations[String(context.retryOfGenerationId)])
        if (missingGeneration || missingAsset || missingParent) {
          record.abandoned = true
        }
      }
    }
    snapshot.drafts = value.drafts as unknown as ProjectSnapshot['drafts']
    snapshot.recoveries = value.recoveries as unknown as ProjectSnapshot['recoveries']
  }
  if ('schemaVersion' in value && value.cloud !== undefined) {
    object(value.cloud)
    if (!Number.isInteger(value.cloud.revision) || Number(value.cloud.revision) < 1 || typeof value.cloud.pending !== 'boolean') throw new Error(i18n.t('canvas:snapshot.errors.invalidCloudSyncVersion'))
    snapshot.cloud = { revision: Number(value.cloud.revision), pending: value.cloud.pending, conflict: value.cloud.conflict === true }
  }
  if ('schemaVersion' in value && value.history !== undefined) {
    snapshot.history = parseHistory(value.history, project)
  }
  const restored = structuredClone(snapshot)
  expandSharedMedia(restored.project)
  return restored
}

function parseHistory(value: unknown, project: PixelProject): ProjectHistory {
  object(value)
  array(value.undo)
  array(value.redo)
  return {
    undo: value.undo.map(item => validateSerializedCommand(item, project)),
    redo: value.redo.map(item => validateSerializedCommand(item, project)),
  }
}

function validateSerializedCommand(value: unknown, project: PixelProject, depth = 0): SerializedEditorCommand {
  object(value)
  string(value.id)
  string(value.sceneId)
  if (depth > 4) throw new Error(i18n.t('canvas:snapshot.errors.historyTooDeep'))
  if (!project.document.scenes.some(scene => scene.id === value.sceneId)) throw new Error(i18n.t('canvas:snapshot.errors.missingHistoryScene'))
  if (value.type === 'composite') {
    array(value.commands)
    for (const command of value.commands) validateSerializedCommand(command, project, depth + 1)
    return value as SerializedEditorCommand
  }
  if (value.type === 'add-node') {
    validateNode(value.node, project)
    return value as SerializedEditorCommand
  }
  if (value.type === 'remove-node') {
    string(value.nodeId)
    if (value.removedNode !== undefined) validateNode(value.removedNode, project)
    return value as SerializedEditorCommand
  }
  if (value.type === 'update-node') {
    string(value.nodeId)
    object(value.changes)
    if (value.previous !== undefined) validateNode(value.previous, project)
    return value as SerializedEditorCommand
  }
  if (value.type === 'insert-generated') {
    object(value.asset)
    string((value.asset as { id?: string }).id)
    if (project.assets[(value.asset as { id: string }).id]?.type !== (value.asset as { type?: string }).type
      && !['image', 'video', 'audio'].includes(String((value.asset as { type?: string }).type))) {
      throw new Error(i18n.t('canvas:snapshot.errors.invalidHistoryAsset'))
    }
    validateNode(value.node, { ...project, assets: { ...project.assets, [(value.asset as { id: string }).id]: value.asset as unknown as Asset } })
    return value as SerializedEditorCommand
  }
  if (value.type === 'resolve-generation') {
    array(value.placeholderNodeIds)
    array(value.outputs)
    for (const id of value.placeholderNodeIds) string(id)
    const assets = { ...project.assets }
    for (const output of value.outputs) {
      object(output)
      object(output.asset)
      string((output.asset as { id?: string }).id)
      assets[(output.asset as { id: string }).id] = output.asset as unknown as Asset
      validateNode(output.node, { ...project, assets })
    }
    return value as SerializedEditorCommand
  }
  throw new Error(i18n.t('canvas:snapshot.errors.unsupportedHistoryCommand'))
}

function contentHash(payload: string) {
  const prime = 0x100000001b3n
  const mask = (1n << 64n) - 1n
  let high = 0xcbf29ce484222325n
  let low = 0x84222325cbf29ce4n
  for (let index = 0; index < payload.length; index += 1) {
    const code = BigInt(payload.charCodeAt(index))
    high = ((high ^ code) * prime) & mask
    low = ((low ^ code) * prime) & mask
  }
  return high.toString(16).padStart(16, '0') + low.toString(16).padStart(16, '0')
}

function dataPayload(url: string) {
  if (!url.startsWith('data:')) return undefined
  const comma = url.indexOf(',')
  if (comma < 0) return undefined
  return url.slice(comma + 1)
}

function expandSharedMedia(project: PixelProject) {
  const canonical = new Map<string, string>()
  for (const asset of Object.values(project.assets)) {
    const payload = dataPayload(asset.url)
    if (payload === undefined) continue
    const hash = contentHash(payload)
    const current = canonical.get(hash)
    if (!current || dataPayload(current) === payload) canonical.set(hash, current ?? asset.url)
  }
  for (const asset of Object.values(project.assets)) {
    if (!asset.url.startsWith(MEDIA_PREFIX)) continue
    const url = canonical.get(asset.url.slice(MEDIA_PREFIX.length))
    if (url) asset.url = url
  }
}

function shareEmbeddedBytes(assets: Record<string, Asset>) {
  const canonical = new Map<string, { id: string; url: string }>()
  for (const asset of Object.values(assets)) {
    if (durableObjectKey(asset)) continue
    const payload = dataPayload(asset.url)
    if (payload === undefined) continue
    const hash = contentHash(payload)
    const current = canonical.get(hash)
    if (!current) {
      canonical.set(hash, { id: asset.id, url: asset.url })
      continue
    }
    if (asset.id === current.id || dataPayload(current.url) !== payload) continue
    asset.url = `${MEDIA_PREFIX}${hash}`
  }
}

function durableObjectKey(asset: Asset) {
  const key = asset.objectKey ?? asset.storage?.objectKey
  if (!key || key.startsWith('temporary/')) return undefined
  return key
}

function referenceCloudAssets(assets: Record<string, Asset>) {
  for (const asset of Object.values(assets)) {
    const key = durableObjectKey(asset)
    if (!key) continue
    asset.objectKey = key
    asset.url = assetPlaceholder(asset.id)
    delete asset.accessExpiresAt
  }
}

function collectNodeRefs(node: unknown, assets: Set<string>, generations: Set<string>) {
  if (!node || typeof node !== 'object') return
  const value = node as Partial<EditorNode> & { assetId?: string; outputAssetId?: string }
  if (typeof value.assetId === 'string') assets.add(value.assetId)
  if (typeof value.outputAssetId === 'string') assets.add(value.outputAssetId)
  if (value.type === 'generation' && typeof value.generationId === 'string') generations.add(value.generationId)
}

function collectCommandRefs(command: SerializedEditorCommand, assets: Set<string>, generations: Set<string>, embedded: Asset[]) {
  if (command.type === 'composite') {
    for (const child of command.commands) collectCommandRefs(child, assets, generations, embedded)
    return
  }
  if (command.type === 'add-node') collectNodeRefs(command.node, assets, generations)
  if (command.type === 'remove-node') collectNodeRefs(command.removedNode, assets, generations)
  if (command.type === 'update-node') {
    collectNodeRefs(command.previous, assets, generations)
    collectNodeRefs(command.changes, assets, generations)
  }
  if (command.type === 'insert-generated') {
    collectNodeRefs(command.node, assets, generations)
    assets.add(command.asset.id)
    embedded.push(command.asset)
  }
  if (command.type === 'resolve-generation') {
    for (const output of command.outputs) {
      collectNodeRefs(output.node, assets, generations)
      assets.add(output.asset.id)
      embedded.push(output.asset)
    }
  }
}

function sourceImageKey(input: unknown) {
  if (!input || typeof input !== 'object') return undefined
  const key = (input as { sourceImageKey?: unknown }).sourceImageKey
  if (typeof key !== 'string' || !key.trim() || key.startsWith('temporary/')) return undefined
  return key
}

/** 只保留当前画布、有限撤销历史和仍需要的生成记录引用的素材。不删除我的资产或 R2。 */
function compactSnapshot(snapshot: ProjectSnapshot) {
  const project = snapshot.project
  const undo = (snapshot.history?.undo ?? []).slice(-MAX_PERSISTED_HISTORY)
  const redo = (snapshot.history?.redo ?? []).slice(-MAX_PERSISTED_HISTORY)
  snapshot.history = { undo, redo }
  const keepAssets = new Set<string>()
  const keepGenerations = new Set<string>()
  const embedded: Asset[] = []
  for (const scene of project.document.scenes) {
    for (const node of scene.nodes) collectNodeRefs(node, keepAssets, keepGenerations)
  }
  for (const command of [...undo, ...redo]) collectCommandRefs(command, keepAssets, keepGenerations, embedded)
  if (snapshot.drafts.derived) keepAssets.add(snapshot.drafts.derived.sourceAssetId)
  if (snapshot.drafts.videoReplication?.productAssetId) keepAssets.add(snapshot.drafts.videoReplication.productAssetId)
  for (const [id, recovery] of Object.entries(snapshot.recoveries)) {
    if (recovery.abandoned || (recovery.backendTaskId && !project.generations[`generation:${recovery.backendTaskId}`])) {
      delete snapshot.recoveries[id]
      continue
    }
    for (const assetId of recovery.context.inputAssetIds) keepAssets.add(assetId)
    if (recovery.context.parentGenerationId) keepGenerations.add(recovery.context.parentGenerationId)
    if (recovery.context.retryOfGenerationId) keepGenerations.add(recovery.context.retryOfGenerationId)
    if (recovery.backendTaskId) keepGenerations.add(`generation:${recovery.backendTaskId}`)
  }
  for (const asset of embedded) {
    if (!keepAssets.has(asset.id)) continue
    const key = asset.objectKey ?? asset.storage?.objectKey
    const live = project.assets[asset.id]
    if (!live) {
      project.assets[asset.id] = { ...asset }
      continue
    }
    if (key && !key.startsWith('temporary/') && !live.objectKey && !live.storage?.objectKey) live.objectKey = key
    if (!live.storage && asset.storage?.provider === 'r2') live.storage = { ...asset.storage }
  }
  for (const id of [...keepAssets]) {
    const generationId = project.assets[id]?.generationId
    if (generationId) keepGenerations.add(generationId)
  }
  for (const generationId of [...keepGenerations]) {
    const job = project.generations[generationId]
    if (!job) continue
    for (const assetId of [...job.inputAssetIds, ...job.outputAssetIds]) keepAssets.add(assetId)
    const key = sourceImageKey(job.input)
    if (!key || job.inputAssetIds.length !== 1) continue
    const asset = project.assets[job.inputAssetIds[0]]
    if (asset && !asset.objectKey && !asset.storage?.objectKey) asset.objectKey = key
  }
  for (const id of Object.keys(project.generations)) {
    if (!keepGenerations.has(id)) delete project.generations[id]
  }
  for (const id of Object.keys(project.assets)) {
    if (!keepAssets.has(id)) delete project.assets[id]
  }
  for (const asset of Object.values(project.assets)) {
    if (asset.generationId && !project.generations[asset.generationId]) delete asset.generationId
  }
  for (const job of Object.values(project.generations)) {
    if (job.parentGenerationId && !project.generations[job.parentGenerationId]) delete job.parentGenerationId
    if (job.retryOfGenerationId && !project.generations[job.retryOfGenerationId]) delete job.retryOfGenerationId
    job.inputAssetIds = job.inputAssetIds.filter(id => project.assets[id])
    job.outputAssetIds = job.outputAssetIds.filter(id => project.assets[id])
  }
}

function persistableAsset(asset: Asset, assets: Record<string, Asset> = {}): Asset {
  const source = assets[asset.id] ?? asset
  const copy = { ...source }
  if (copy.storage?.provider === 'r2' || copy.objectKey || assets[copy.id]) {
    copy.url = assetPlaceholder(copy.id)
    delete copy.accessExpiresAt
  }
  return copy
}

function persistableMediaReference(url: unknown, assets: Record<string, Asset>, objectKey?: string) {
  if (typeof url !== 'string') return url
  if (objectKey || url.startsWith('data:') || /[?&]X-Amz-/i.test(url) || /\.r2\.cloudflarestorage\.com/i.test(url)) {
    const match = Object.values(assets).find(asset => (
      (objectKey && (asset.objectKey ?? asset.storage?.objectKey) === objectKey)
      || asset.url === url
      || (asset.objectKey && url.includes(asset.objectKey))
    ))
    if (match) return assetPlaceholder(match.id)
    if (objectKey) return undefined
  }
  return url
}

function persistableCommand(command: SerializedEditorCommand, assets: Record<string, Asset>): SerializedEditorCommand {
  if (command.type === 'composite') {
    return { ...command, commands: command.commands.map(child => persistableCommand(child, assets)) }
  }
  if (command.type === 'insert-generated') {
    return { ...command, asset: persistableAsset(command.asset, assets) }
  }
  if (command.type === 'resolve-generation') {
    return {
      ...command,
      outputs: command.outputs.map(output => ({ ...output, asset: persistableAsset(output.asset, assets) })),
    }
  }
  return command
}

export function persistableSnapshot(snapshot: ProjectSnapshot): ProjectSnapshot {
  const copy = parseSnapshot(snapshot)
  compactSnapshot(copy)
  const assets = copy.project.assets
  for (const job of Object.values(copy.project.generations)) {
    const input = job.input
    if (!input || typeof input !== 'object') continue
    const params = input as { sourceImageUrl?: string; sourceImageKey?: string }
    const next = persistableMediaReference(params.sourceImageUrl, assets, params.sourceImageKey)
    if (next === undefined) delete params.sourceImageUrl
    else if (typeof next === 'string') params.sourceImageUrl = next
  }
  for (const record of Object.values(copy.recoveries)) {
    const params = record.request.params as { sourceImageUrl?: string; sourceImageKey?: string }
    const next = persistableMediaReference(params.sourceImageUrl, assets, params.sourceImageKey)
    if (next === undefined) delete params.sourceImageUrl
    else if (typeof next === 'string') params.sourceImageUrl = next
  }
  referenceCloudAssets(assets)
  shareEmbeddedBytes(assets)
  copy.history = {
    undo: (copy.history?.undo ?? []).map(item => persistableCommand(item, assets)),
    redo: (copy.history?.redo ?? []).map(item => persistableCommand(item, assets)),
  }
  parseSnapshot(structuredClone(copy))
  return copy
}

export function serializeSnapshot(snapshot: ProjectSnapshot) {
  return JSON.stringify(persistableSnapshot(snapshot))
}

function hydrateSerializedCommand(command: SerializedEditorCommand, assets?: Record<string, Asset>): SerializedEditorCommand {
  if (!assets) return command
  if (command.type === 'composite') {
    return { ...command, commands: command.commands.map(child => hydrateSerializedCommand(child, assets)) }
  }
  if (command.type === 'insert-generated' && assets[command.asset.id]) {
    return { ...command, asset: assets[command.asset.id] }
  }
  if (command.type === 'resolve-generation') {
    return {
      ...command,
      outputs: command.outputs.map(output => ({
        ...output,
        asset: assets[output.asset.id] ?? output.asset,
      })),
    }
  }
  return command
}

export function restoreHistoryCommands(history?: ProjectHistory, assets?: Record<string, Asset>) {
  return {
    undo: (history?.undo ?? []).map(item => deserializeCommand(hydrateSerializedCommand(item, assets))),
    redo: (history?.redo ?? []).map(item => deserializeCommand(hydrateSerializedCommand(item, assets))),
  }
}
