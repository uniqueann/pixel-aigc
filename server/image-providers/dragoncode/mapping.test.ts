import { describe, expect, it } from 'vitest'
import { RESOLUTION_DOWNGRADED_4K } from '../../../shared/image-models.js'
import { mapDragonCodeRequest } from './mapping.js'

describe('mapDragonCodeRequest', () => {
  it('按原图像素映射比例并扇出 count', () => {
    const mapped = mapDragonCodeRequest({
      operation: 'image_edit',
      prompt: '换成白底',
      images: [{ source: { kind: 'r2', objectKey: 'temporary/a' }, width: 1200, height: 800 }],
      target: { size: { width: 2048, height: 1365 }, resolution: '2k' },
      count: 3,
    }, 'gpt-image-2')
    expect(mapped).toMatchObject({
      fanOut: 3,
      warnings: [],
      expectedAspect: 1.5,
      providerParams: { model: 'gpt-image-2', size: '3:2', resolution: '2k', n: 1 },
    })
  })

  it('优先使用原图像素而不是放大后的 size', () => {
    const mapped = mapDragonCodeRequest({
      operation: 'image_edit',
      prompt: 'x',
      images: [{ source: { kind: 'url', url: 'https://example.com/a.png' }, width: 1600, height: 1200 }],
      target: { size: { width: 4096, height: 3072 }, resolution: '2k' },
      count: 1,
    }, 'gpt-image-2')
    expect(mapped.providerParams.size).toBe('4:3')
  })

  it('1:1 原图请求 4k 时降为 2k 并带警告', () => {
    const mapped = mapDragonCodeRequest({
      operation: 'image_edit',
      prompt: 'x',
      images: [{ source: { kind: 'r2', objectKey: 'k' }, width: 1000, height: 1000 }],
      target: { resolution: '4k' },
      count: 1,
    }, 'gpt-image-2')
    expect(mapped.providerParams).toMatchObject({ size: '1:1', resolution: '2k' })
    expect(mapped.warnings).toEqual([RESOLUTION_DOWNGRADED_4K])
  })

  it('显式比例在 4k 不支持时同样降级', () => {
    const mapped = mapDragonCodeRequest({
      operation: 'text_to_image',
      prompt: 'x',
      images: [],
      target: { aspectRatio: '1:1', resolution: '4k' },
      count: 1,
    }, 'gpt-image-2')
    expect(mapped.providerParams).toMatchObject({ size: '1:1', resolution: '2k' })
    expect(mapped.warnings).toContain(RESOLUTION_DOWNGRADED_4K)
  })

  it('把 count 限制在 1..4', () => {
    expect(mapDragonCodeRequest({
      operation: 'image_edit', prompt: 'x', images: [],
      target: { resolution: '1k' }, count: 9,
    }, 'gpt-image-2').fanOut).toBe(4)
    expect(mapDragonCodeRequest({
      operation: 'image_edit', prompt: 'x', images: [],
      target: { resolution: '1k' }, count: 0,
    }, 'gpt-image-2').fanOut).toBe(1)
  })
})
