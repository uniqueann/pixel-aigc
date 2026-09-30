import { afterEach, describe, expect, it, vi } from 'vitest'
import { isExactlySameImage, isVisuallySameImage, SOURCE_ECHO_ERROR } from './sourceEcho'

const jpeg = new Uint8Array([255, 216, 255, 224, 1, 2, 3, 4])
const other = new Uint8Array([255, 216, 255, 224, 9, 8, 7, 6])

afterEach(() => vi.unstubAllGlobals())

describe('原图回传识别', () => {
  it('同一地址直接视为回传', async () => {
    expect(await isVisuallySameImage('source.png', 'source.png')).toBe(true)
    expect(SOURCE_ECHO_ERROR).toContain('没有返回新的生成结果')
  })

  it('字节完全相同的结果视为回传', async () => {
    const blob = new Blob([jpeg], { type: 'image/jpeg' })
    expect(await isVisuallySameImage(blob, new Blob([jpeg], { type: 'image/jpeg' }))).toBe(true)
    expect(await isVisuallySameImage(blob, new Blob([other], { type: 'image/jpeg' }))).toBe(false)
    expect(await isExactlySameImage(blob, new Blob([jpeg], { type: 'image/jpeg' }))).toBe(true)
    expect(await isExactlySameImage(blob, new Blob([other], { type: 'image/jpeg' }))).toBe(false)
  })

  it('局部编辑不因整图采样相同而丢弃不同字节的结果', async () => {
    const sample = new Uint8ClampedArray(64 * 64 * 4).fill(128)
    vi.stubGlobal('createImageBitmap', async () => ({ close: () => {} }))
    vi.stubGlobal('document', { createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => {}, getImageData: () => ({ data: sample }) }),
    }) })
    const source = new Blob([jpeg], { type: 'image/jpeg' })
    const result = new Blob([other], { type: 'image/jpeg' })
    expect(await isVisuallySameImage(source, result)).toBe(true)
    expect(await isExactlySameImage(source, result)).toBe(false)
  })
})
