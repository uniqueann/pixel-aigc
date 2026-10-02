import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from '@/editor/store'
import { DEMO_IMAGE_ASSET } from '@/editor/services/demoImageAsset'
import { ensureFreeCanvasContent } from '@/features/free-canvas/initialize'
import { Capability } from '@/types'
import { defaultDrafts, type ProjectSnapshot } from './types'
import { parseSnapshot, persistableSnapshot, serializeSnapshot } from './snapshot'
import { restoreTaskDrafts } from './restoreDrafts'

let snapshot: ProjectSnapshot
beforeEach(() => {
  useEditorStore.setState({ project: null })
  ensureFreeCanvasContent()
  snapshot = { schemaVersion: 1, project: structuredClone(useEditorStore.getState().project!), drafts: defaultDrafts(), recoveries: {} }
})

describe('项目快照校验与迁移', () => {
  it('完整保存节点变换、视口、草稿和内嵌图片，往返保持一致', () => {
    const scene = snapshot.project.document.scenes[0]
    scene.nodes[0] = { ...scene.nodes[0], rotation: 37, x: -120, y: 600, opacity: 0.7, zIndex: 4 }
    scene.viewport = { zoom: 0.7, panX: 80, panY: -200 }
    snapshot.drafts['text-to-image'].prompt = '未提交的草稿'
    expect(parseSnapshot(serializeSnapshot(snapshot))).toEqual(snapshot)
  })

  it('迁移裸项目时使用空草稿与保守恢复记录', () => {
    expect(parseSnapshot(snapshot.project)).toEqual(snapshot)
  })

  it('保留主动清空的画布，不重新插入示例', () => {
    snapshot.project.document.scenes[0].nodes = []
    useEditorStore.getState().loadProject(parseSnapshot(snapshot).project)
    ensureFreeCanvasContent()
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toEqual([])
  })

  it.each(['blob:lost', 'javascript:alert(1)', 'file:///tmp/private.png', 'data:text/html,test'])('拒绝不可恢复的媒体地址 %s', (url) => {
    snapshot.project.assets[DEMO_IMAGE_ASSET.id].url = url
    expect(() => parseSnapshot(snapshot)).toThrow('媒体地址不可恢复')
  })

  it('拒绝未来版本、非法尺寸、重复节点和悬空引用', () => {
    expect(() => parseSnapshot({ ...snapshot, schemaVersion: 2 })).toThrow('版本')
    const scene = snapshot.project.document.scenes[0]
    scene.width = NaN
    expect(() => parseSnapshot(snapshot)).toThrow('数值')
    scene.width = 1280
    scene.nodes.push({ ...scene.nodes[0] })
    expect(() => parseSnapshot(snapshot)).toThrow('重复')
    scene.nodes.pop()
    snapshot.project.assets = {}
    expect(() => parseSnapshot(snapshot)).toThrow('素材')
  })

  it('拒绝可被恢复按钮直接提交的空提示词', () => {
    snapshot.recoveries.request = {
      projectId: snapshot.project.id,
      sceneId: snapshot.project.document.activeSceneId,
      request: { capability: Capability.TextToImage, requestId: 'request', params: { prompt: '  ', size: { width: 1024, height: 1024 }, count: 1 } },
      context: { inputAssetIds: [], autoRetryRemaining: 0, automaticRetry: false },
      placements: [{ x: 0, y: 0, width: 320, height: 320 }],
      replacedPlaceholderIds: [], applied: false,
    }
    expect(() => parseSnapshot(snapshot)).toThrow('提示词')
  })

  it('恢复提交中的派生参数和源节点快照，不依赖源节点还在画布上', () => {
    const source = snapshot.project.document.scenes[0].nodes[0]
    if (source.type !== 'image') throw new Error('测试数据类型错误')
    snapshot.drafts.derived = { mode: 'image-to-video', sourceAssetId: source.assetId, sourceNode: source, prompt: '旧草稿', count: 1, durationSeconds: 5 }
    snapshot.project.document.scenes[0].nodes = []
    snapshot.recoveries.request = {
      projectId: snapshot.project.id, sceneId: snapshot.project.document.activeSceneId,
      request: { capability: Capability.TextToVideo, requestId: 'request', params: { sourceImageUrl: DEMO_IMAGE_ASSET.url, prompt: '镜头推进', size: { width: 1280, height: 960 }, count: 1, durationSeconds: 10 } },
      context: { inputAssetIds: [source.assetId], autoRetryRemaining: 0, automaticRetry: true },
      placements: [{ x: 1400, y: 0, width: 320, height: 240 }], replacedPlaceholderIds: [], applied: false,
    }
    const restored = parseSnapshot(serializeSnapshot(snapshot))
    expect(restored.recoveries.request.context.autoRetryRemaining).toBe(0)
    expect(restoreTaskDrafts(restored).derived).toMatchObject({ prompt: '镜头推进', durationSeconds: 10, sourceNode: source })
  })

  it('兼容仅含对象键的真实裂变，完整保留模型、分辨率、账号和草稿', () => {
    const node = snapshot.project.document.scenes[0].nodes[0]
    if (node.type !== 'image') throw new Error('测试数据类型错误')
    snapshot.drafts.derived = { mode: 'variation', sourceAssetId: node.assetId, sourceNode: node, prompt: '旧描述', count: 4, durationSeconds: 5, modelProfileId: 'old-model', resolution: '1k' }
    snapshot.recoveries.request = {
      ownerId: '11111111-1111-4111-8111-111111111111', projectId: snapshot.project.id, sceneId: snapshot.project.document.activeSceneId,
      request: { capability: Capability.Variation, requestId: 'request', modelProfileId: 'chosen-model', params: { sourceImageKey: 'owned-key', resolution: '2k', sourceWidth: 1280, sourceHeight: 960, size: { width: 2048, height: 1536 }, count: 2, prompt: '柔和光线' } },
      context: { inputAssetIds: [node.assetId], autoRetryRemaining: 0, automaticRetry: false }, placements: [], replacedPlaceholderIds: [], applied: false,
    }
    const restored = parseSnapshot(serializeSnapshot(snapshot))
    expect(restored.recoveries.request).toEqual(snapshot.recoveries.request)
    expect(restoreTaskDrafts(restored).derived).toMatchObject({ modelProfileId: 'chosen-model', resolution: '2k', count: 2, prompt: '柔和光线' })
  })

  it('私有图片存档只依赖对象键，不保存签名过期时间或运行时地址', () => {
    const asset = snapshot.project.assets[DEMO_IMAGE_ASSET.id]
    asset.objectKey = 'owned-key'
    asset.url = 'https://images.example/temporary?signature=expired'
    asset.accessExpiresAt = 100
    const persisted = persistableSnapshot(snapshot)
    expect(persisted.project.assets[asset.id]).toMatchObject({ objectKey: 'owned-key', url: `/__aigc_asset__/${encodeURIComponent(asset.id)}` })
    expect(persisted.project.assets[asset.id].accessExpiresAt).toBeUndefined()
    expect(asset.url).toContain('signature=expired')
    expect(parseSnapshot(serializeSnapshot(persisted))).toEqual(persisted)
  })

  it('导出 JSON 对云端/资产图片只保留引用，本地图只内嵌一份', () => {
    const local = structuredClone(DEMO_IMAGE_ASSET)
    local.id = 'asset-local'
    local.name = 'mug.jpg'
    const owned = structuredClone(DEMO_IMAGE_ASSET)
    owned.id = 'asset-owned'
    owned.name = '资产图片'
    owned.objectKey = 'owned-result'
    owned.url = `data:image/png;base64,${'A'.repeat(12000)}`
    snapshot.project.assets = { [local.id]: local, [owned.id]: owned }
    const localNode = { ...snapshot.project.document.scenes[0].nodes[0], id: 'node-local', assetId: local.id }
    const ownedNode = { ...snapshot.project.document.scenes[0].nodes[0], id: 'node-owned', assetId: owned.id }
    snapshot.project.document.scenes[0].nodes = [localNode, ownedNode]
    snapshot.recoveries.request = {
      projectId: snapshot.project.id, sceneId: snapshot.project.document.activeSceneId,
      request: { capability: Capability.Variation, requestId: 'request', params: { sourceImageUrl: owned.url, sourceImageKey: 'owned-result', resolution: '2k', size: { width: 1024, height: 1024 }, count: 1 } },
      context: { inputAssetIds: [owned.id], autoRetryRemaining: 0, automaticRetry: false },
      placements: [], replacedPlaceholderIds: [], applied: false,
    }
    const json = serializeSnapshot(snapshot)
    expect(json).not.toContain('A'.repeat(12000))
    expect(json).toContain(`/__aigc_asset__/${encodeURIComponent(owned.id)}`)
    expect(json).toContain(local.url)
    expect(json.split(local.url).length - 1).toBe(1)
    const restored = parseSnapshot(json)
    expect(restored.project.assets[local.id].url).toBe(local.url)
    expect(restored.project.assets[owned.id]).toMatchObject({ objectKey: 'owned-result', url: `/__aigc_asset__/${encodeURIComponent(owned.id)}` })
    expect(restored.project.document.scenes[0].nodes.map(node => node.id)).toEqual(['node-local', 'node-owned'])
  })

  it('有界撤销历史可随快照往返，且不把已存档图片再内嵌一份', () => {
    const node = snapshot.project.document.scenes[0].nodes[0]
    const asset = snapshot.project.assets[DEMO_IMAGE_ASSET.id]
    snapshot.history = {
      undo: [{ type: 'insert-generated', id: 'cmd-1', sceneId: snapshot.project.document.activeSceneId, asset, node }],
      redo: [],
    }
    const persisted = persistableSnapshot(snapshot)
    expect(persisted.history?.undo[0]).toMatchObject({ type: 'insert-generated', id: 'cmd-1' })
    if (persisted.history?.undo[0].type === 'insert-generated') {
      expect(persisted.history.undo[0].asset.url).toBe(`/__aigc_asset__/${encodeURIComponent(asset.id)}`)
    }
    expect(parseSnapshot(serializeSnapshot(persisted)).history?.undo).toHaveLength(1)
  })
})
