import { describe, expect, it } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import type { ImageNode } from '@/editor/types'
import { AddNodeCommand, deserializeCommand, InsertGeneratedAssetCommand, RemoveNodeCommand, ResolveGenerationCommand, UpdateNodeCommand } from './index'

const node: ImageNode = {
  id: 'node-1', type: 'image', assetId: 'asset-1', name: '图',
  x: 0, y: 0, width: 100, height: 80, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0,
}

describe('命令序列化', () => {
  it('往返后仍能撤销与重做同一条插入命令', () => {
    const asset = createImageAsset({ id: 'asset-1', name: '图', url: 'data:image/png;base64,aa', width: 100, height: 80 })
    const command = new InsertGeneratedAssetCommand('scene-1', asset, node)
    const restored = deserializeCommand(command.serialize())
    expect(restored.serialize()).toEqual(command.serialize())
    expect(deserializeCommand(new AddNodeCommand('scene-1', node).serialize())).toBeInstanceOf(AddNodeCommand)
    expect(deserializeCommand(new RemoveNodeCommand('scene-1', node.id, node).serialize())).toBeInstanceOf(RemoveNodeCommand)
    expect(deserializeCommand(new UpdateNodeCommand('scene-1', node.id, { x: 8 }, node).serialize())).toBeInstanceOf(UpdateNodeCommand)
    expect(deserializeCommand(new ResolveGenerationCommand('scene-1', ['ph'], [{ asset, node }]).serialize())).toBeInstanceOf(ResolveGenerationCommand)
  })
})
