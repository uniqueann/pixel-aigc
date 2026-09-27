import { describe, expect, it } from 'vitest'
import { isVisuallySameImage, SOURCE_ECHO_ERROR } from './sourceEcho'

const jpeg = new Uint8Array([255, 216, 255, 224, 1, 2, 3, 4])
const other = new Uint8Array([255, 216, 255, 224, 9, 8, 7, 6])

describe('原图回传识别', () => {
  it('同一地址直接视为回传', async () => {
    expect(await isVisuallySameImage('source.png', 'source.png')).toBe(true)
    expect(SOURCE_ECHO_ERROR).toContain('没有返回新的生成结果')
  })

  it('字节完全相同的结果视为回传', async () => {
    const blob = new Blob([jpeg], { type: 'image/jpeg' })
    expect(await isVisuallySameImage(blob, new Blob([jpeg], { type: 'image/jpeg' }))).toBe(true)
    expect(await isVisuallySameImage(blob, new Blob([other], { type: 'image/jpeg' }))).toBe(false)
  })
})
