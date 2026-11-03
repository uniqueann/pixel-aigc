import { describe, expect, it } from 'vitest'
import { watermarkPreviewAlt, watermarkPreviewMeta, watermarkPreviewSource } from './preview'

describe('水印预览视图', () => {
  it('结果模式优先结果，其次实时预览，最后回退源图', () => {
    expect(watermarkPreviewSource({ mode: 'result', resultUrl: 'blob:result', previewUrl: 'blob:preview', sourceUrl: 'blob:source' })).toBe('blob:result')
    expect(watermarkPreviewSource({ mode: 'result', previewUrl: 'blob:preview', sourceUrl: 'blob:source' })).toBe('blob:preview')
    expect(watermarkPreviewSource({ mode: 'result', sourceUrl: 'blob:source' })).toBe('blob:source')
  })

  it('原图模式始终显示源图', () => {
    expect(watermarkPreviewSource({ mode: 'source', resultUrl: 'blob:result', previewUrl: 'blob:preview', sourceUrl: 'blob:source' })).toBe('blob:source')
  })

  it('alt 与 meta 跟随当前展示内容', () => {
    expect(watermarkPreviewAlt({ mode: 'source', name: 'cat.png', hasResult: true })).toBe('cat.png 原图')
    expect(watermarkPreviewAlt({ mode: 'result', name: 'cat.png', hasResult: true })).toBe('cat.png 的水印结果')
    expect(watermarkPreviewAlt({ mode: 'result', name: 'cat.png', hasResult: false })).toBe('cat.png 的水印预览')
    expect(watermarkPreviewMeta({ mode: 'source', hasResult: true })).toBe('原图')
    expect(watermarkPreviewMeta({ mode: 'result', hasResult: true })).toBe('水印结果')
    expect(watermarkPreviewMeta({ mode: 'result', hasResult: false })).toBe('水印预览')
  })
})
