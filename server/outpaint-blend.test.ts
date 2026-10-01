import { describe, expect, it } from 'vitest'
import { blendOutpaintEdges } from './outpaint-blend'

function pixels(width: number, height: number, value: number) {
  return { data: Buffer.alloc(width * height * 3, value), width, height, channels: 3 as const }
}
const at = (image: { data: Buffer; width: number }, x: number, y: number) => image.data[(y * image.width + x) * 3]

describe('扩图边缘融合', () => {
  it('颜色匹配显著降低接缝跳变，远处背景和原图内部保持原像素', async () => {
    const source = pixels(512, 384, 200), background = pixels(1024, 384, 180)
    const result = await blendOutpaintEdges(source, background, { left: 256, right: 256, top: 0, bottom: 0 })
    const jump = Math.abs(at(result, 255, 192) - at(result, 256, 192))
    expect(jump).toBeLessThan(10)
    expect(at(result, 0, 192)).toBe(180)
    expect(at(result, 512, 192)).toBe(200)
    expect(source.data.every(value => value === 200)).toBe(true)
    expect(background.data.every(value => value === 180)).toBe(true)
  })
  it('只融合扩展边，保护内部纹理，并让角落连续', async () => {
    const source = pixels(640, 384, 120), background = pixels(832, 576, 102)
    for (let y = 0; y < source.height; y += 1) for (let x = 80; x < 560; x += 1) {
      const i = (y * source.width + x) * 3
      source.data.fill(x % 4 < 2 ? 20 : 230, i, i + 3)
    }
    const result = await blendOutpaintEdges(source, background, { left: 96, right: 96, top: 96, bottom: 96 })
    for (let y = 80; y < 300; y += 17) for (let x = 80; x < 560; x += 19) {
      expect(at(result, x + 96, y + 96)).toBe(at(source, x, y))
    }
    expect(Math.abs(at(result, 96, 95) - at(result, 96, 96))).toBeLessThan(5)
    const smoothResult = await blendOutpaintEdges(pixels(640, 384, 120), background, { left: 96, right: 96, top: 96, bottom: 96 })
    expect(Math.abs(at(smoothResult, 607, 100) - at(smoothResult, 608, 100))).toBeLessThan(5)
  })
  it('单边扩图不修改其余三条边的内部像素', async () => {
    const source = pixels(320, 240, 210), background = pixels(480, 240, 190)
    const result = await blendOutpaintEdges(source, background, { left: 160, right: 0, top: 0, bottom: 0 })
    expect(at(result, 300, 0)).toBe(210)
    expect(at(result, 479, 239)).toBe(210)
  })
  it('透明原图按透明度与背景合成，不产生白色方块', async () => {
    const source = { data: Buffer.alloc(256 * 256 * 4), width: 256, height: 256, channels: 4 as const }
    const result = await blendOutpaintEdges(source, pixels(384, 256, 150), { left: 128, right: 0, top: 0, bottom: 0 })
    expect(result.data.every(value => value === 150)).toBe(true)
  })
  it('原地处理的边缘快照与独立缓冲区在四边和透明角落产生相同结果', async () => {
    const source = { data: Buffer.alloc(320 * 240 * 4), width: 320, height: 240, channels: 4 as const }
    for (let i = 0; i < source.data.length; i += 4) { source.data[i] = 120; source.data[i + 1] = 170; source.data[i + 2] = 80; source.data[i + 3] = i % 13 === 0 ? 128 : 255 }
    const background = pixels(512, 432, 102)
    for (let y = 0; y < background.height; y += 1) for (let x = 0; x < background.width; x += 1) background.data[(y * background.width + x) * 3] += Math.round(x / 10)
    const padding = { left: 96, right: 96, top: 96, bottom: 96 }
    const expected = await blendOutpaintEdges(source, background, padding)
    const actual = await blendOutpaintEdges(source, { ...background, data: Buffer.from(background.data) }, padding, undefined, undefined, true)
    expect(actual.data.equals(expected.data)).toBe(true)
  })

  it('截止时间到达后拒绝合成', async () => {
    await expect(blendOutpaintEdges(pixels(10, 10, 1), pixels(20, 10, 1), { left: 10, right: 0, top: 0, bottom: 0 }, undefined, 0)).rejects.toThrow('合成超时')
  })
})
