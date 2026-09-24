import { describe, expect, it } from 'vitest'
import { encodeMockMatte } from './mockMatte'

describe('模拟抠图结果', () => {
  it('生成指定尺寸的透明 PNG', async () => {
    const url = await encodeMockMatte(12, 8)
    const bytes = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), char => char.charCodeAt(0))
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(16)).toBe(12)
    expect(view.getUint32(20)).toBe(8)
    expect(bytes[25]).toBe(6)
  })
})
