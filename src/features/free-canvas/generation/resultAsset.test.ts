import { describe, expect, it } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import { Capability, type GenerationTask } from '@/types'
import { resultAssetForTask } from './resultAsset'

const task: GenerationTask<unknown> = { id: 'task', capability: Capability.TextToImage, params: {}, status: 'succeeded', creditsCost: 3,
  createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z',
  resultImages: [{ url: 'expired.png', width: 1000, height: 1000, mimeType: 'image/png', objectKey: 'generated/original', ordinal: 2 }],
}
const image = (id: string, objectKey: string) => createImageAsset({ id, name: '结果', url: 'blob:runtime', width: 1000, height: 1000, objectKey })

describe('画布结果资产关联', () => {
  it('部分成功按原始ordinal找到资产，云端替换对象键后仍保留同一结果', () => {
    const asset = image('asset:task:o2', 'media/cloud-copy')
    expect(resultAssetForTask(task, 0, { [asset.id]: asset })).toBe(asset)
  })

  it('兼容旧结果索引标识，稳定ordinal标识优先', () => {
    const stable = image('asset:task:o2', 'media/stable')
    const legacy = image('asset:task:0', 'media/legacy')
    expect(resultAssetForTask(task, 0, { [stable.id]: stable, [legacy.id]: legacy })).toBe(stable)
    expect(resultAssetForTask(task, 0, { [legacy.id]: legacy })).toBe(legacy)
  })

  it('旧项目自定义资产标识时按对象键兜底，不误匹配其他结果', () => {
    const matched = image('custom', 'generated/original')
    const other = image('other', 'generated/other')
    expect(resultAssetForTask(task, 0, { [matched.id]: matched, [other.id]: other })).toBe(matched)
    expect(resultAssetForTask(task, 0, { [other.id]: other })).toBeUndefined()
    expect(resultAssetForTask(undefined, 0, { [matched.id]: matched })).toBeUndefined()
  })
})
