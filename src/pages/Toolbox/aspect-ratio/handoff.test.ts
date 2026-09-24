import { describe, expect, it } from 'vitest'
import { presetForHandoff, setOutpaintHandoff, takeOutpaintHandoff } from './handoff'

describe('扩图失败交接', () => {
  it('取出后清空，并按平台 id 找到预设', () => {
    const file = new File(['source'], '商品.png', { type: 'image/png' })
    setOutpaintHandoff({ file, presetId: 'tiktok-main' })
    expect(takeOutpaintHandoff()?.file).toBe(file)
    expect(takeOutpaintHandoff()).toBeNull()
    expect(presetForHandoff('tiktok-main')).toMatchObject({ platform: 'tiktok', width: 1080, height: 1440 })
    expect(presetForHandoff('missing')).toBeNull()
  })
})
