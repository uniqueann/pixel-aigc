import { describe, expect, it } from 'vitest'
import { MINIMAX_H3_VIDEO_MODEL, SEEDANCE_VIDEO_MODEL, videoModelCredits } from '@shared/video-models'
import { selectedCanvasVideoModel } from './videoParameters'
describe('视频模型选择与原始报价', () => {
  const models = [{ ...SEEDANCE_VIDEO_MODEL, available: false }, { ...MINIMAX_H3_VIDEO_MODEL, available: true }]
  it('新文生视频默认 H3，图生入口不选择 H3', () => {
    expect(selectedCanvasVideoModel(models, 'text_to_video')?.id).toBe('minimax-h3')
    expect(selectedCanvasVideoModel(models, 'image_to_video')).toBeUndefined()
  })
  it('保留不可用的原模型，不把历史任务换成其他供应商', () => {
    expect(selectedCanvasVideoModel(models, 'text_to_video', SEEDANCE_VIDEO_MODEL.id)?.available).toBe(false)
    expect(selectedCanvasVideoModel(models, 'text_to_video', '已删除的历史模型')).toBeUndefined()
  })
  it('分辨率分别报价，缺价不使用默认档位替代', () => {
    expect(videoModelCredits(MINIMAX_H3_VIDEO_MODEL, '768p', 5)).toBe(50)
    expect(videoModelCredits(MINIMAX_H3_VIDEO_MODEL, '2k', 10)).toBe(160)
    expect(videoModelCredits(MINIMAX_H3_VIDEO_MODEL, '720p', 5)).toBeUndefined()
    expect(videoModelCredits({ ...MINIMAX_H3_VIDEO_MODEL, pricing: { ...MINIMAX_H3_VIDEO_MODEL.pricing, creditsByResolution: { '768p': { 5: 50, 10: 100 } } } }, '2k', 5)).toBeUndefined()
  })
})
