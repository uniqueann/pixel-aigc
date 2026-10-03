import { describe, expect, it } from 'vitest'
import { CENTER_CROP_UNAVAILABLE_NOTE } from '@/pages/Toolbox/aspect-ratio/subjectFocus'
import { pipelineProgressLabel, pipelineQueueNote } from './notices'
import type { PipelineItem } from './types'

function item(id: string, patch: Partial<PipelineItem> = {}): PipelineItem {
  return {
    id, file: new File([id], `${id}.png`, { type: 'image/png' }), sourceMime: 'image/png', width: 1000, height: 800,
    ratioStatus: 'succeeded', watermarkStatus: 'succeeded',
    output: { blob: new Blob(['成品']), mimeType: 'image/png', width: 1600, height: 1600 },
    ...patch,
  }
}

describe('流水线降级提示', () => {
  it('完成后仍在队列说明里保留居中裁剪提示，不把它写成普通成功', () => {
    const degraded = item('a', {
      cropFocus: { fx: 0.5, fy: 0.5, source: 'grid', unavailable: true, note: CENTER_CROP_UNAVAILABLE_NOTE },
    })
    expect(pipelineQueueNote(degraded, 'idle')).toBe('智能检测不可用，已按居中裁剪')
    expect(pipelineQueueNote(item('b', { phase: 'watermark', cropFocus: degraded.cropFocus }), 'running')).toBe('智能检测不可用，已按居中裁剪')
    expect(pipelineQueueNote(item('c'), 'idle')).toBe('转比例完成 · 水印完成')
  })

  it('两张降级成功时进度含批次计数，失败项不计入', () => {
    const focus = { fx: 0.5, fy: 0.5, source: 'grid' as const, unavailable: true, note: CENTER_CROP_UNAVAILABLE_NOTE }
    const items = [
      item('a', { cropFocus: focus }),
      item('b', { cropFocus: focus }),
      item('c', { ratioStatus: 'failed', watermarkStatus: 'pending', cropFocus: undefined }),
    ]
    expect(pipelineProgressLabel(items)).toBe('2 / 3 张已完成 · 1 张失败 · 2 张已降级为居中裁剪')
    expect(items.filter(entry => entry.cropFocus?.unavailable).every(entry => entry.ratioStatus === 'succeeded')).toBe(true)
  })
})