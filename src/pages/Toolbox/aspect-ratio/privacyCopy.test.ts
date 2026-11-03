import { describe, expect, it } from 'vitest'
import { aspectRatioPrivacyNote, aspectRatioProcessingHint } from './privacyCopy'

describe('转比例隐私文案', () => {
  it('留白填充明确写本机处理', () => {
    expect(aspectRatioProcessingHint('letterbox')).toBe('图片仅在本机处理')
    expect(aspectRatioPrivacyNote('letterbox')).toBe('图片在本机处理。')
  })

  it('智能裁剪提示主体识别可能上传缩略图', () => {
    expect(aspectRatioProcessingHint('crop')).toContain('主体识别可能上传缩略图')
    expect(aspectRatioPrivacyNote('crop')).toContain('主体识别可能上传缩略图')
  })

  it('智能扩展明确写会上传图片', () => {
    expect(aspectRatioProcessingHint('outpaint')).toBe('智能扩展会上传图片生成背景')
    expect(aspectRatioPrivacyNote('outpaint')).toBe('智能扩展会上传图片生成背景。')
  })
})
