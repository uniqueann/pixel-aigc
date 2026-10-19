import { describe, expect, it } from 'vitest'
import { MINIMAX_H3_VIDEO_MODEL, SEEDANCE_VIDEO_MODEL, videoModelCredits } from '@shared/video-models'
import { selectedCanvasVideoModel, videoModelIdForDraft, videoRetryParametersSupported } from './videoParameters'
describe('视频模型选择与原始报价', () => {
  const models = [{ ...SEEDANCE_VIDEO_MODEL, available: false }, { ...MINIMAX_H3_VIDEO_MODEL, available: true }]
  it('新文生和图生视频默认 H3，图生未开放时不选择 H3', () => {
    expect(selectedCanvasVideoModel(models, 'text_to_video')?.id).toBe('minimax-h3')
    expect(selectedCanvasVideoModel(models, 'image_to_video')?.id).toBe('minimax-h3')
    expect(selectedCanvasVideoModel([models[0], { ...models[1], availableModes: ['text_to_video'] }], 'image_to_video')).toBeUndefined()
  })
  it('旧 720p 草稿保留 Seedance，H3 无声任务必须先修改参数', () => {
    expect(videoModelIdForDraft({ resolution: '720p' })).toBe(SEEDANCE_VIDEO_MODEL.id)
    expect(videoModelIdForDraft({ modelProfileId: 'minimax-h3', videoResolution: '2k' })).toBe('minimax-h3')
    expect(videoRetryParametersSupported(MINIMAX_H3_VIDEO_MODEL, 'image_to_video', { generateAudio: false })).toBe(false)
    expect(videoRetryParametersSupported(MINIMAX_H3_VIDEO_MODEL, 'image_to_video', { generateAudio: true })).toBe(true)
    expect(videoRetryParametersSupported({ ...MINIMAX_H3_VIDEO_MODEL, availableModes: ['text_to_video'] }, 'image_to_video', { generateAudio: true })).toBe(false)
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
