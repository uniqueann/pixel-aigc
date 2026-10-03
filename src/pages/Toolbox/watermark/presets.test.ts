import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { DEFAULT_WATERMARK_SETTINGS } from './types'
import { deletePreset, listPresets, savePreset } from './presets'

describe('本机水印模板', () => {
  it('按用户范围保存、读取和删除，包含 Logo 文件', async () => {
    const logo = new Blob(['logo'], { type: 'image/png' })
    const saved = await savePreset('user-a', '品牌', { ...DEFAULT_WATERMARK_SETTINGS, kind: 'logo', logo, logoName: 'logo.png' })
    expect((await listPresets('user-a'))[0].settings.logo?.size).toBe(4)
    expect(await listPresets('user-b')).toEqual([])
    await deletePreset(saved.id)
    expect(await listPresets('user-a')).toEqual([])
  })

  it('旧模板缺少平铺参数时仍按单点模式读取', async () => {
    const legacy: Partial<typeof DEFAULT_WATERMARK_SETTINGS> = { ...DEFAULT_WATERMARK_SETTINGS }
    delete legacy.layout
    delete legacy.tileGapPercent
    delete legacy.tileRotation
    const saved = await savePreset('legacy-user', '旧模板', legacy as typeof DEFAULT_WATERMARK_SETTINGS)
    const [record] = await listPresets('legacy-user')
    expect(record.settings.layout).toBe('single')
    expect(record.settings.tileGapPercent).toBe(DEFAULT_WATERMARK_SETTINGS.tileGapPercent)
    await deletePreset(saved.id)
  })

  it('旧模板没有颜色模式时保留原颜色，新模板可以保存自动模式', async () => {
    const legacy: Partial<typeof DEFAULT_WATERMARK_SETTINGS> = { ...DEFAULT_WATERMARK_SETTINGS, color: '#112233', text: '旧水印' }
    delete legacy.colorMode
    delete legacy.readability
    const oldPreset = await savePreset('legacy-color', '旧颜色', legacy as typeof DEFAULT_WATERMARK_SETTINGS)
    const [oldRecord] = await listPresets('legacy-color')
    expect(oldRecord.settings.colorMode).toBe('custom')
    expect(oldRecord.settings.color).toBe('#112233')
    expect(oldRecord.settings.readability).toBe(true)

    const created = await savePreset('legacy-color', '新模板', { ...DEFAULT_WATERMARK_SETTINGS, text: 'PIXEL TEST', readability: false })
    const records = await listPresets('legacy-color')
    expect(records.find(record => record.id === created.id)?.settings).toMatchObject({ colorMode: 'auto', readability: false, text: 'PIXEL TEST' })
    await deletePreset(oldPreset.id)
    await deletePreset(created.id)
  })
})
