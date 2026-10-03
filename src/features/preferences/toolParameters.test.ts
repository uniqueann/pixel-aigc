import { describe, expect, it } from 'vitest'
import { defaultPreferences } from '@shared/preferences'
import { defaultImageModel } from '@shared/image-models'
import { DEFAULT_WATERMARK_SETTINGS } from '@/pages/Toolbox/watermark/types'
import { initialWorkstationParameters, initialAspectRatioSettings, initialBgRemoveSettings, initialWatermarkSettings, effectiveImageParameters, watermarkMemory, aspectRatioMemory } from './toolParameters'

describe('工具默认参数与记忆', () => {
  it('记忆优先且各工具独立，关闭后采用个人默认值', () => {
    const p = defaultPreferences(); p.image.counts.variation = 3; p.image.resolution = '1k'
    p.image.lastUsed.variation = { count: 4, resolution: '4k' }
    expect(initialWorkstationParameters(p, 'variation')).toMatchObject({ count: 4, resolution: '4k' })
    expect(initialWorkstationParameters(p, 'smart-edit')).toMatchObject({ count: 1, resolution: '1k' })
    p.image.rememberParameters = false
    expect(initialWorkstationParameters(p, 'variation')).toMatchObject({ count: 3, resolution: '1k' })
  })
  it('模型和比例限制调整本次有效值', () => {
    const ui = { ...defaultImageModel('image_edit')!.ui, maxCount: 2 }
    expect(effectiveImageParameters(4, '4k', { width: 1024, height: 1024 }, ui)).toEqual({ count: 2, resolution: '2k' })
    expect(effectiveImageParameters(4, '4k', { width: 1080, height: 1920 }, ui)).toEqual({ count: 2, resolution: '4k' })
    expect(effectiveImageParameters(3, '4k', undefined, { ...ui, resolutions: ['1k'] })).toEqual({ count: 2, resolution: '1k' })
  })
  it('工具箱不恢复裁剪焦点或 Logo 文件', () => {
    const p = defaultPreferences()
    p.image.lastUsed['aspect-ratio'] = { strategy: 'crop', selectedPresetId: 'temu-main' }
    p.image.lastUsed['bg-remove'] = { background: '#ffffff' }; p.image.lastUsed.watermark = { text: '我的水印', opacity: 40 }
    expect(initialAspectRatioSettings(p)).toMatchObject({ strategy: 'crop', selectedPresetId: 'temu-main', fx: 0.5, fy: 0.5 })
    expect(initialBgRemoveSettings(p).background).toBe('#ffffff')
    expect(initialWatermarkSettings(p)).toMatchObject({ text: '我的水印', opacity: 40, logo: null, kind: 'text', colorMode: 'custom', readability: true })
    const memory = watermarkMemory({ ...DEFAULT_WATERMARK_SETTINGS, logo: new Blob(['logo']), logoName: 'logo.png', kind: 'logo', colorMode: 'auto', readability: false })
    expect(memory).not.toHaveProperty('logo')
    expect(memory).toMatchObject({ colorMode: 'auto', readability: false })
    p.image.lastUsed.watermark = memory
    expect(initialWatermarkSettings(p)).toMatchObject({ colorMode: 'auto', readability: false, logo: null })
    p.image.rememberParameters = false
    expect(initialWatermarkSettings(p)).toMatchObject({ colorMode: 'auto', readability: true, text: '' })
    expect(aspectRatioMemory(initialAspectRatioSettings(p))).not.toHaveProperty('fx')
  })
  it('没有参数记忆时文字水印默认自动配色并打开描边', () => {
    expect(initialWatermarkSettings(defaultPreferences())).toMatchObject({ colorMode: 'auto', readability: true, color: '#ffffff', text: '' })
  })
})
