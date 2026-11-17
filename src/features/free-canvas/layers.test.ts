import { describe, expect, it } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import type { EditorNode, GenerationJob } from '@/editor/types'
import { Capability } from '@/types'
import { buildLayerItems } from './layers'

function imageNode(id: string, zIndex: number, assetId = `asset-${id}`): EditorNode {
  return {
    id, type: 'image', assetId, name: `图片 ${id}`,
    x: 0, y: 0, width: 100, height: 80, rotation: 0, opacity: 1, visible: true, locked: false, zIndex,
  }
}

const imageAsset = createImageAsset({
  id: 'asset-a', name: 'A', url: 'data:image/png;base64,aa', width: 100, height: 80,
})

function generationJob(status: GenerationJob['status']): GenerationJob {
  return {
    id: 'gen-1', capability: Capability.TextToImage, status,
    input: {}, inputAssetIds: [], outputAssetIds: [],
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }
}

describe('图层列表数据', () => {
  it('顶层在前，与画布叠放顺序一致', () => {
    const items = buildLayerItems([imageNode('a', 0), imageNode('b', 2), imageNode('c', 1)], {}, {})
    expect(items.map((item) => item.id)).toEqual(['b', 'c', 'a'])
  })

  it('忽略画布不渲染的节点类型', () => {
    const textNode: EditorNode = {
      id: 't', type: 'text', text: 'hi', fontFamily: 'sans', fontSize: 14,
      x: 0, y: 0, width: 10, height: 10, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 5,
    }
    expect(buildLayerItems([textNode], {}, {})).toEqual([])
  })

  it('图片给出缩略图与尺寸，素材缺失时标记不可用', () => {
    const items = buildLayerItems([imageNode('a', 0, 'asset-a')], { 'asset-a': imageAsset }, {})
    expect(items[0]).toMatchObject({ meta: '100×80', broken: false, thumbnail: imageAsset.url })

    const missing = buildLayerItems([imageNode('a', 0, 'asset-gone')], {}, {})
    expect(missing[0]).toMatchObject({ meta: '素材不可用', broken: true })
    expect(missing[0].thumbnail).toBeUndefined()
  })

  it('占位符 URL 不作为缩略图', () => {
    const placeholder = createImageAsset({ id: 'asset-a', name: 'A', url: '/__aigc_asset__/x', width: 10, height: 10 })
    const items = buildLayerItems([imageNode('a', 0, 'asset-a')], { 'asset-a': placeholder }, {})
    expect(items[0].thumbnail).toBeUndefined()
    expect(items[0].broken).toBe(false)
  })

  it('视频不使用 asset.url 当缩略图', () => {
    const videoAsset = {
      ...imageAsset, type: 'video' as const, id: 'asset-v', url: 'blob:xyz', duration: 5,
    }
    const node: EditorNode = {
      id: 'v', type: 'video', assetId: 'asset-v', name: '视频 v',
      x: 0, y: 0, width: 100, height: 80, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0,
      duration: 10,
    }
    const items = buildLayerItems([node], { 'asset-v': videoAsset }, {})
    expect(items[0].thumbnail).toBeUndefined()
    // 同尺寸的 5 秒 / 10 秒结果需要区分，时长排在尺寸前面
    expect(items[0].meta).toBe('10 秒 · 100×80')
  })

  it('生成占位显示任务状态，失败态标记为异常', () => {
    const node: EditorNode = {
      id: 'g', type: 'generation', generationId: 'gen-1', name: '生成占位 1',
      x: 0, y: 0, width: 320, height: 320, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0,
    }
    expect(buildLayerItems([node], {}, { 'gen-1': generationJob('processing') })[0])
      .toMatchObject({ meta: '生成中', broken: false })
    expect(buildLayerItems([node], {}, { 'gen-1': generationJob('failed') })[0])
      .toMatchObject({ meta: '生成失败', broken: true })
    // 任务还没登记时按排队中展示，不当作异常。
    expect(buildLayerItems([node], {}, {})[0]).toMatchObject({ meta: '排队中', broken: false })
  })

  it('同名副本从下往上编号，原件保留原名', () => {
    const sameName = (id: string, zIndex: number): EditorNode => ({ ...imageNode(id, zIndex), name: '示例商品图' })
    const items = buildLayerItems([sameName('a', 0), sameName('b', 1), sameName('c', 2)], {}, {})
    // 列表顶层在前：最上面的是最后复制出来的，原件在最下面且不带序号。
    expect(items.map((item) => item.name)).toEqual(['示例商品图 3', '示例商品图 2', '示例商品图'])
  })

  it('没有名称时用类型兜底', () => {
    const node = { ...imageNode('a', 0), name: undefined } as EditorNode
    expect(buildLayerItems([node], {}, {})[0].name).toBe('图片')
  })
})
