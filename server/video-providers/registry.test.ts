import { describe, expect, it } from 'vitest'
import { publicVideoModels, videoGenerationAvailable, videoModelAvailable } from './registry.js'

const env = { VIDEO_GENERATION_ENABLED: 'true', AI_GATEWAY_VIDEO_ENABLED: 'true', AI_GATEWAY_API_KEY: 'test-key',
  AIGC_DATABASE_URL: 'test-db', R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', R2_BUCKET: 'test', VIDEO_CRON_SECRET: 'test' }
describe('独立视频模型开关', () => {
  it('没有 Ark 凭据仍可仅开放 H3 文生视频', () => {
    expect(videoModelAvailable('minimax-h3', 'text_to_video', env)).toBe(true)
    expect(videoGenerationAvailable('text_to_video', env)).toBe(true)
    expect(videoGenerationAvailable('image_to_video', env)).toBe(false)
    expect(videoModelAvailable('seedance-2-0-fast', 'text_to_video', env)).toBe(false)
  })
  it('关闸后仍有报价，缺凭据或关闭通道不能提交', () => {
    const disabled = { ...env, VIDEO_GENERATION_ENABLED: 'false' }
    expect(publicVideoModels(disabled)).toHaveLength(2)
    expect(publicVideoModels(disabled).every(model => model.available === false)).toBe(true)
    expect(publicVideoModels(disabled)[1].pricing.creditsByResolution?.['2k']).toEqual({ 5: 80, 10: 160 })
    expect(videoGenerationAvailable('text_to_video', { ...env, AI_GATEWAY_VIDEO_ENABLED: 'false' })).toBe(false)
    expect(videoGenerationAvailable('text_to_video', { ...env, AI_GATEWAY_API_KEY: '' })).toBe(false)
  })
})
