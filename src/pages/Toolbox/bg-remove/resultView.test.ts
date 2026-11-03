import { describe, expect, it } from 'vitest'
import { footerMode, previewAlt, previewKind, previewMeta, previewOverlay, previewSource, progressLabel, resultStatusLabel, showCheckerboard } from './resultView'

describe('抠图结果视图', () => {
  it('结果模式优先使用预览，原图模式切回源图', () => {
    expect(previewSource('result', 'blob:result', 'blob:source')).toBe('blob:result')
    expect(previewSource('result', null, 'blob:source')).toBe('blob:source')
    expect(previewSource('source', 'blob:result', 'blob:source')).toBe('blob:source')
  })

  it('预览状态不会把处理中或失败描述成抠图结果', () => {
    expect(previewKind({ mode: 'result', hasResult: true, status: 'succeeded' })).toBe('result')
    expect(previewKind({ mode: 'result', hasResult: false, status: 'processing' })).toBe('processing')
    expect(previewKind({ mode: 'result', hasResult: true, status: 'processing' })).toBe('processing')
    expect(previewKind({ mode: 'result', hasResult: true, status: 'failed' })).toBe('failed')
    expect(previewKind({ mode: 'result', hasResult: false, status: 'pending' })).toBe('pending')
    expect(previewKind({ mode: 'source', hasResult: true, status: 'succeeded' })).toBe('source')
  })

  it('alt、meta 与棋盘格跟随预览状态', () => {
    expect(previewAlt('result', 'cup.png')).toBe('cup.png 的抠图预览')
    expect(previewAlt('source', 'cup.png')).toBe('cup.png 原图')
    expect(previewAlt('processing', 'cup.png')).toBe('cup.png 原图，抠图处理中')
    expect(previewAlt('failed', 'cup.png')).toBe('cup.png 原图，未生成抠图结果')
    expect(previewMeta('result', 'transparent')).toBe('透明背景')
    expect(previewMeta('result', 'color')).toBe('纯色背景')
    expect(previewMeta('processing', 'transparent')).toBe('处理中')
    expect(previewMeta('failed', 'transparent')).toBe('未生成结果')
    expect(showCheckerboard('result', 'transparent')).toBe(true)
    expect(showCheckerboard('processing', 'transparent')).toBe(false)
    expect(showCheckerboard('failed', 'transparent')).toBe(false)
    expect(showCheckerboard('source', 'transparent')).toBe(false)
    expect(previewOverlay('processing')).toBe('正在抠图…')
    expect(previewOverlay('failed')).toBe('未生成结果，当前为原图')
    expect(previewOverlay('result')).toBeNull()
  })

  it('进度文案覆盖空、处理、失败、全部完成', () => {
    expect(progressLabel({ itemCount: 0, completedCount: 0, failedCount: 0, processing: false })).toBe('尚未添加图片')
    expect(progressLabel({ itemCount: 2, completedCount: 1, failedCount: 0, processing: true })).toBe('1 / 2 张已完成')
    expect(progressLabel({ itemCount: 2, completedCount: 1, failedCount: 1, processing: true })).toBe('1 / 2 张已完成，1 张失败')
    expect(progressLabel({ itemCount: 2, completedCount: 1, failedCount: 1, processing: false })).toBe('1 / 2 张已完成，1 张失败')
    expect(progressLabel({ itemCount: 2, completedCount: 2, failedCount: 0, processing: false })).toBe('全部 2 张已完成，可打包下载')
    expect(progressLabel({ itemCount: 2, completedCount: 1, failedCount: 0, processing: false })).toBe('1 / 2 张已完成')
  })

  it('结果网格使用一致的状态文案', () => {
    expect(resultStatusLabel('succeeded')).toBe('完成')
    expect(resultStatusLabel('processing')).toBe('处理中')
    expect(resultStatusLabel('failed')).toBe('失败')
    expect(resultStatusLabel('pending')).toBe('等待')
  })

  it('底部主行动只保留一个', () => {
    expect(footerMode({ processing: true, itemCount: 2, allDone: false, failedCount: 0 })).toBe('cancel')
    expect(footerMode({ processing: false, itemCount: 2, allDone: true, failedCount: 0 })).toBe('download')
    expect(footerMode({ processing: false, itemCount: 2, allDone: false, failedCount: 1 })).toBe('retry')
    expect(footerMode({ processing: false, itemCount: 0, allDone: false, failedCount: 0 })).toBe('empty')
    expect(footerMode({ processing: false, itemCount: 2, allDone: false, failedCount: 0 })).toBe('process')
  })
})
