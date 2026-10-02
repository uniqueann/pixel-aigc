import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from '@/editor/store'
import { DEMO_IMAGE_ASSET } from '@/editor/services/demoImageAsset'
import { ensureFreeCanvasContent } from '@/features/free-canvas/initialize'
import { Capability } from '@/types'
import { defaultDrafts, type ProjectSnapshot } from './types'
import { parseSnapshot, persistableSnapshot, restoreHistoryCommands, serializeSnapshot } from './snapshot'
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
    expect(parseSnapshot(serializeSnapshot(snapshot))).toEqual({ ...snapshot, history: { undo: [], redo: [] } })
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

  it('重复字节只保留一份，云端图不内嵌，无人引用的素材在导出时丢弃，撤销仍能恢复', () => {
    const scene = snapshot.project.document.scenes[0]
    const source = scene.nodes[0]
    if (source.type !== 'image') throw new Error('测试数据类型错误')
    const payloadC = `data:image/jpeg;base64,${'C'.repeat(2000)}`
    const payloadD = `data:image/jpeg;base64,${'D'.repeat(1500)}`
    const payloadB = `data:image/jpeg;base64,${'B'.repeat(1800)}`
    const payloadRemoved = 'data:image/png;base64,removed-unique'
    const image = (id: string, url: string, objectKey?: string) => ({
      id, name: id, type: 'image' as const, source: 'upload' as const, createdAt: '2026-01-01T00:00:00.000Z',
      width: 40, height: 30, mimeType: 'image/jpeg', url, ...(objectKey ? { objectKey } : {}),
    })
    const node = (id: string, assetId: string, x: number) => ({ ...source, id, assetId, name: id, x, y: 20 })
    const removed = node('node-removed', 'asset-removed', 12)
    snapshot.project.assets = {
      'asset-a': image('asset-a', payloadC),
      'asset-b': image('asset-b', payloadC),
      'asset-cloud': image('asset-cloud', payloadB, 'generated/demo/0.jpg'),
      'asset-orphan': { ...image('asset-orphan', payloadD), generationId: 'gen-stale' },
      'asset-removed': image('asset-removed', payloadRemoved),
    }
    snapshot.project.generations = {
      'gen-stale': {
        id: 'gen-stale', capability: Capability.Variation, status: 'succeeded', input: {},
        inputAssetIds: [], outputAssetIds: ['asset-orphan'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      },
    }
    scene.nodes = [node('node-a', 'asset-a', 10), node('node-b', 'asset-b', 80), node('node-cloud', 'asset-cloud', 160)]
    snapshot.history = {
      undo: [{ type: 'remove-node', id: 'cmd-remove', sceneId: scene.id, nodeId: removed.id, removedNode: removed }],
      redo: [],
    }
    const json = serializeSnapshot(snapshot)
    expect(json.split(payloadC).length - 1).toBe(1)
    expect(json).not.toContain(payloadD)
    expect(json).not.toContain(payloadB)
    expect(json.split(payloadRemoved).length - 1).toBe(1)
    expect(json).toContain('generated/demo/0.jpg')
    expect(json).toContain(`/__aigc_asset__/${encodeURIComponent('asset-cloud')}`)
    expect(json).not.toContain('gen-stale')
    const restored = parseSnapshot(json)
    expect(restored.project.assets['asset-a'].url).toBe(payloadC)
    expect(restored.project.assets['asset-b'].url).toBe(payloadC)
    expect(restored.project.assets['asset-orphan']).toBeUndefined()
    expect(restored.project.assets['asset-cloud']).toMatchObject({ objectKey: 'generated/demo/0.jpg', url: `/__aigc_asset__/${encodeURIComponent('asset-cloud')}` })
    expect(restored.project.document.scenes[0].nodes.map(item => ({ id: item.id, x: item.x, y: item.y }))).toEqual([
      { id: 'node-a', x: 10, y: 20 },
      { id: 'node-b', x: 80, y: 20 },
      { id: 'node-cloud', x: 160, y: 20 },
    ])
    expect(serializeSnapshot(restored)).toBe(json)
    useEditorStore.getState().loadProject(restored.project)
    const history = restoreHistoryCommands(restored.history, restored.project.assets)
    useEditorStore.getState().restoreHistory(history.undo, history.redo)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().project?.document.scenes[0].nodes.some(item => item.id === 'node-removed')).toBe(true)
    expect(useEditorStore.getState().project?.assets['asset-orphan']).toBeUndefined()
  })

  it('超过 40 条的历史不再保留更早命令独占的素材', () => {
    const scene = snapshot.project.document.scenes[0]
    const source = scene.nodes[0]
    if (source.type !== 'image') throw new Error('测试数据类型错误')
    const commands = Array.from({ length: 41 }, (_, index) => {
      const id = `old-asset-${index}`
      snapshot.project.assets[id] = {
        id, name: id, type: 'image', source: 'upload', createdAt: '2026-01-01T00:00:00.000Z',
        width: 20, height: 20, mimeType: 'image/png', url: `data:image/png;base64,old-${index}`,
      }
      return {
        type: 'remove-node' as const,
        id: `cmd-${index}`,
        sceneId: scene.id,
        nodeId: `old-node-${index}`,
        removedNode: { ...source, id: `old-node-${index}`, assetId: id },
      }
    })
    snapshot.history = { undo: commands, redo: [] }
    const persisted = persistableSnapshot(snapshot)
    expect(persisted.history?.undo).toHaveLength(40)
    expect(persisted.project.assets['old-asset-0']).toBeUndefined()
    expect(persisted.project.assets['old-asset-1']).toBeDefined()
    expect(persisted.project.assets[DEMO_IMAGE_ASSET.id]).toBeDefined()
  })
})
