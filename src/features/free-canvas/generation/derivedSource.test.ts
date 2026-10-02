import { describe, expect, it } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import type { ImageNode, Scene } from '@/editor/types'
import { resolveSelectedImageSource } from './derivedSource'

const asset = createImageAsset({ id: 'local', name: 'mug.jpg', url: 'data:image/png;base64,aa', width: 800, height: 600 })
const other = createImageAsset({ id: 'owned', name: '资产图片', url: '/__aigc_asset__/owned', objectKey: 'owned-key', width: 1280, height: 1468 })
const localNode: ImageNode = {
  id: 'node-local', type: 'image', assetId: asset.id, name: asset.name,
  x: 10, y: 20, width: 200, height: 150, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 1,
}
const ownedNode: ImageNode = {
  id: 'node-owned', type: 'image', assetId: other.id, name: other.name,
  x: 10, y: 20, width: 200, height: 150, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 2,
}
const scene: Scene = {
  id: 'scene', name: '场景', width: 1280, height: 720,
  nodes: [localNode, ownedNode],
  viewport: { zoom: 1, panX: 0, panY: 0 },
}

describe('裂变源随当前选中节点', () => {
  it('选中本地图时返回该节点与素材，而不是其他资产', () => {
    expect(resolveSelectedImageSource(scene, { [asset.id]: asset, [other.id]: other }, localNode.id)).toEqual({
      node: localNode,
      asset,
    })
  })

  it('选中变化后切换到新的图片节点', () => {
    expect(resolveSelectedImageSource(scene, { [asset.id]: asset, [other.id]: other }, ownedNode.id)?.asset.name).toBe('资产图片')
    expect(resolveSelectedImageSource(scene, { [asset.id]: asset, [other.id]: other }, 'missing')).toBeUndefined()
  })
})
