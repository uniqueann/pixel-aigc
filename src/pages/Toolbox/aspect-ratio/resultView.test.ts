import { describe, expect, it } from 'vitest'
import { previewAlt, previewKind, previewMeta, previewOverlay, previewSource, showCheckerboard } from './resultView'

describe('转比例结果视图', () => {
  it('结果模式优先使用预览，原图模式切回源图', () => {
    expect(previewSource('result', 'blob:result', 'blob:source')).toBe('blob:result')
    expect(previewSource('result', null, 'blob:source')).toBe('blob:source')
    expect(previewSource('source', 'blob:result', 'blob:source')).toBe('blob:source')
    expect(previewSource('failed', 'blob:result', 'blob:source')).toBe('blob:source')
  })

  it('预览状态不会把处理中或失败描述成转比例结果', () => {
    expect(previewKind({ mode: 'result', hasResult: true, status: 'succeeded' })).toBe('result')
    expect(previewKind({ mode: 'result', hasResult: false, status: 'processing' })).toBe('processing')
    expect(previewKind({ mode: 'result', hasResult: true, status: 'processing' })).toBe('processing')
    expect(previewKind({ mode: 'result', hasResult: true, status: 'failed' })).toBe('failed')
    expect(previewKind({ mode: 'result', hasResult: false, status: 'pending' })).toBe('pending')
    expect(previewKind({ mode: 'source', hasResult: true, status: 'succeeded' })).toBe('source')
  })

  it('alt、meta 与棋盘格跟随预览状态', () => {
    expect(previewAlt('result', 'cup.png')).toBe('cup.png 的转比例结果')
    expect(previewAlt('source', 'cup.png')).toBe('cup.png 的原图')
    expect(previewAlt('processing', 'cup.png')).toBe('cup.png 的原图，转比例处理中')
    expect(previewAlt('failed', 'cup.png')).toBe('cup.png 的原图，未生成转比例结果')
    expect(previewMeta('result')).toBe('转比例结果')
    expect(previewMeta('processing')).toBe('处理中')
    expect(previewMeta('failed')).toBe('未生成结果')
    expect(showCheckerboard('result', 'letterbox', 'transparent')).toBe(true)
    expect(showCheckerboard('processing', 'letterbox', 'transparent')).toBe(false)
    expect(showCheckerboard('failed', 'letterbox', 'transparent')).toBe(false)
    expect(showCheckerboard('source', 'letterbox', 'transparent')).toBe(false)
    expect(showCheckerboard('result', 'crop', 'transparent')).toBe(false)
    expect(previewOverlay('processing')).toBe('正在转比例…')
    expect(previewOverlay('failed')).toBe('未生成结果，当前为原图')
    expect(previewOverlay('result')).toBeNull()
  })
})
