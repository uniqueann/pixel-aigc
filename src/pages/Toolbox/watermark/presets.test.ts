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
})
