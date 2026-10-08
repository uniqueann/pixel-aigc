import { referenceImageLimitMessage } from '@shared/image-models'
import { COMING_SOON_SUBMIT_MESSAGE } from '@/features/image-workstation/tools/registry'
import { emptyMaskMessage } from './maskExport'

export function workstationGenerateBlockReason(input: {
  toolReady: boolean
  configurationPending?: boolean
  configurationError?: boolean
  hasInput: boolean
  formLocked: boolean
  submitting?: boolean
  maskRequired: boolean
  hasMaskPaint: boolean
  repaintBlocked: boolean
  retouchBlocked?: boolean
  fusionBlocked?: boolean
  referenceCount?: number
  maxRefImages?: number
  mode?: 'remove' | 'repaint'
}): string | undefined {
  if (input.submitting) return undefined
  if (input.configurationPending) return '正在加载功能配置，请稍候'
  if (input.configurationError) return '功能配置加载失败，请重试'
  if (!input.toolReady) return COMING_SOON_SUBMIT_MESSAGE
  if (input.fusionBlocked) return '请先上传商品图和场景图'
  if (!input.hasInput) return '请先上传需要处理的图片'
  if (
    typeof input.maxRefImages === 'number'
    && typeof input.referenceCount === 'number'
    && input.referenceCount > input.maxRefImages
  ) return referenceImageLimitMessage(input.maxRefImages)
  if (input.formLocked) return '请等待当前任务完成'
  if (input.retouchBlocked) return '请先选择精修方向'
  if (input.repaintBlocked) return '重绘尚未配置'
  if (input.maskRequired && !input.hasMaskPaint) return emptyMaskMessage(input.mode)
  return undefined
}
