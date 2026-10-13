import { EMAIL_MODELS } from './email-models.js'
import { findImageModel } from './image-models.js'
import { SEEDANCE_VIDEO_MODEL } from './video-models.js'

/**
 * 任务详情只展示目录里的名称。
 * 未知历史模型不回退成原始 id，也不拼接供应商或渠道。
 */
export function modelDisplayName(id: string | null | undefined) {
  if (!id) return '不适用'
  const image = findImageModel(id)
  if (image) return image.label
  const email = EMAIL_MODELS.find(model => model.id === id)
  if (email) return email.label
  if (id === SEEDANCE_VIDEO_MODEL.id) return SEEDANCE_VIDEO_MODEL.label
  return '历史模型'
}
