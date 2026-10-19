import { VIDEO_MODELS, videoModel, videoModelModes, type VideoMode } from '../../shared/video-models.js'
import { aiGatewayVideoProvider } from './ai-gateway/index.js'
import { seedanceProvider } from './seedance/index.js'
import { seedanceGenerationAvailable } from './seedance/config.js'

export function videoProviderById(id: string) {
  const provider = [seedanceProvider, aiGatewayVideoProvider].find(item => item.id === id)
  if (!provider) throw new Error('视频供应商不存在')
  return provider
}

export function videoModelAvailable(id: string, mode: VideoMode, env = process.env) {
  const profile = videoModel(id)
  if (!profile || !videoModelModes(profile).includes(mode)) return false
  if (profile.provider === 'seedance') return seedanceGenerationAvailable(env)
  return env.VIDEO_GENERATION_ENABLED === 'true' && env.AI_GATEWAY_VIDEO_ENABLED === 'true'
    && (mode !== 'image_to_video' || env.AI_GATEWAY_IMAGE_TO_VIDEO_ENABLED === 'true')
    && Boolean(env.AI_GATEWAY_API_KEY?.trim() || env.VERCEL_OIDC_TOKEN?.trim() || env.VERCEL === '1')
    && ['AIGC_DATABASE_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'VIDEO_CRON_SECRET'].every(key => !!env[key])
}

export function videoGenerationAvailable(mode: VideoMode = 'text_to_video', env = process.env) {
  return VIDEO_MODELS.some(model => videoModelAvailable(model.id, mode, env))
}

export function publicVideoModels(env = process.env) {
  return VIDEO_MODELS.map(model => {
    const availableModes = videoModelModes(model).filter(mode => videoModelAvailable(model.id, mode, env))
    const available = availableModes.length > 0
    return { ...model, availableModes, available, unavailableReason: available ? null : '平台暂未开放此模型或配置不完整' }
  })
}
