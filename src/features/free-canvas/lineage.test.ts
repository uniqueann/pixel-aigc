import { describe, expect, it } from 'vitest'
import type { EditorNode, GenerationJob, ImageAsset } from '@/editor/types'
import { Capability } from '@/types'
import { resolveLineage, taskIdFromNodeId } from './lineage'

function asset(id: string, generationId?: string): ImageAsset {
  return {
    id, type: 'image', name: id, url: `data:image/png;base64,aa`, mimeType: 'image/png',
    width: 100, height: 80, source: generationId ? 'generation' : 'upload', createdAt: '2026-01-01T00:00:00Z',
    ...(generationId ? { generationId } : {}),
  }
}

function imageNode(id: string, assetId: string): EditorNode {
  return {
    id, type: 'image', assetId, name: id,
    x: 0, y: 0, width: 100, height: 80, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0,
  }
}

function job(id: string, overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id, capability: Capability.TextToImage, status: 'succeeded',
    input: {}, inputAssetIds: [], outputAssetIds: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('生成血缘推导', () => {
  it('从节点 id 前缀取任务 id，其余返回 undefined', () => {
    expect(taskIdFromNodeId('generated-node:task_a:0')).toBe('task_a')
    expect(taskIdFromNodeId('generation-node:task_b:3')).toBe('task_b')
    expect(taskIdFromNodeId('image-node:whatever')).toBeUndefined()
    expect(taskIdFromNodeId('9f2c-uuid')).toBeUndefined()
  })

  it('同批结果互为兄弟；复制出来的副本不算', () => {
    const nodes = [
      imageNode('generated-node:t1:0', 'a0'),
      imageNode('generated-node:t1:1', 'a1'),
      imageNode('generated-node:t2:0', 'b0'),
      imageNode('copy-uuid', 'a0'),   // ⌘D 出来的副本：同一素材，但没有任务前缀
    ]
    const assets = { a0: asset('a0', 'generation:t1'), a1: asset('a1', 'generation:t1'), b0: asset('b0', 'generation:t2') }
    const lineage = resolveLineage(nodes[0], nodes, assets, {})
    expect(lineage.siblings).toEqual(['generated-node:t1:1'])
    expect(lineage.derived).toBeUndefined()
  })

  it('占位节点同样成批', () => {
    const placeholder: EditorNode = {
      id: 'generation-node:t3:0', type: 'generation', generationId: 'generation:t3', name: '占位',
      x: 0, y: 0, width: 320, height: 320, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0,
    }
    const other = { ...placeholder, id: 'generation-node:t3:1' }
    expect(resolveLineage(placeholder, [placeholder, other], {}, {}).siblings).toEqual(['generation-node:t3:1'])
  })

  it('派生关系指向父任务在画布上的产出', () => {
    const nodes = [
      imageNode('generated-node:src:0', 'sourceAsset'),
      imageNode('generated-node:var:0', 'variantAsset'),
    ]
    const assets = { sourceAsset: asset('sourceAsset', 'generation:src'), variantAsset: asset('variantAsset', 'generation:var') }
    const generations = {
      'generation:src': job('generation:src', { outputAssetIds: ['sourceAsset'] }),
      'generation:var': job('generation:var', { outputAssetIds: ['variantAsset'], parentGenerationId: 'generation:src' }),
    }
    expect(resolveLineage(nodes[1], nodes, assets, generations).derived).toEqual({
      generationId: 'generation:src',
      sourceNodeIds: ['generated-node:src:0'],
    })
  })

  it('父任务产出不在画布上时不给派生线', () => {
    const nodes = [imageNode('generated-node:var:0', 'variantAsset')]
    const assets = { variantAsset: asset('variantAsset', 'generation:var') }
    const generations = {
      'generation:var': job('generation:var', { outputAssetIds: ['variantAsset'], parentGenerationId: 'generation:src' }),
    }
    expect(resolveLineage(nodes[0], nodes, assets, generations).derived).toBeUndefined()
  })

  it('没有选中或节点没有生成来源时返回空关系', () => {
    expect(resolveLineage(undefined, [], {}, {})).toEqual({ siblings: [] })
    const imported = imageNode('image-node:1', 'plain')
    expect(resolveLineage(imported, [imported], { plain: asset('plain') }, {})).toEqual({ siblings: [] })
  })
})
