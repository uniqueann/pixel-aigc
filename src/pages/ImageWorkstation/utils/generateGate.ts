import { referenceImageLimitMessage } from '@shared/image-models'
import { INSUFFICIENT_CREDITS_REASON } from '@/features/credits/imageCredits'
import { COMING_SOON_SUBMIT_MESSAGE, FUSION_INPUTS_REQUIRED_REASON } from '@/features/image-workstation/tools/registry'
import { emptyMaskMessage } from './maskExport'

export const TASK_RUNNING_REASON = '请等待当前任务完成'

/** 零扩图时服务端会直接返回原图副本，提交前按当前目标给出可执行的下一步。 */
export const OUTPAINT_IDLE_REASONS = {
  // 结果生成后当前图就是结果，再说「尚未扩图」会与结果条矛盾。
  free: '当前目标与当前图片尺寸相同：请拖拽绿色边框或输入更大的目标尺寸',
  preset: '当前平台输出与源图尺寸相同，请更换平台或返回自由扩展',
} as const

export type OutpaintIdleMode = keyof typeof OUTPAINT_IDLE_REASONS

/**
 * 能力未接入时的唯一文案来源：右卡 CapabilityStatus 与页脚禁用原因共用，
 * 避免同一句话在页面上出现两次（之前消除重复两遍、重绘两处说法还不一致）。
 */
export const UNAVAILABLE_SERVICE_MESSAGES = {
  remove: '消除服务暂不可用，请稍后重试或联系客服。',
  repaint: '重绘服务暂不可用，请稍后重试或联系客服。',
} as const

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
  removeBlocked?: boolean
  retouchBlocked?: boolean
  fusionBlocked?: boolean
  promptRequired?: boolean
  promptEmpty?: boolean
  referenceCount?: number
  maxRefImages?: number
  insufficientCredits?: boolean
  outpaintIdle?: OutpaintIdleMode
  outpaintLimitError?: string
  mode?: 'remove' | 'repaint'
}): string | undefined {
  if (input.submitting) return undefined
  if (input.configurationPending) return '正在加载功能配置，请稍候'
  if (input.configurationError) return '功能配置加载失败，请重试'
  if (!input.toolReady) return COMING_SOON_SUBMIT_MESSAGE
  if (input.fusionBlocked) return FUSION_INPUTS_REQUIRED_REASON
  if (!input.hasInput) return '请先上传需要处理的图片'
  if (
    typeof input.maxRefImages === 'number'
    && typeof input.referenceCount === 'number'
    && input.referenceCount > input.maxRefImages
  ) return referenceImageLimitMessage(input.maxRefImages)
  if (input.formLocked) return TASK_RUNNING_REASON
  if (input.outpaintLimitError) return input.outpaintLimitError
  if (input.outpaintIdle) return OUTPAINT_IDLE_REASONS[input.outpaintIdle]
  if (input.retouchBlocked) return '请先选择精修方向'
  if (input.repaintBlocked) return UNAVAILABLE_SERVICE_MESSAGES.repaint
  if (input.removeBlocked) return UNAVAILABLE_SERVICE_MESSAGES.remove
  if (input.maskRequired && !input.hasMaskPaint) return emptyMaskMessage(input.mode)
  if (input.promptRequired && input.promptEmpty) {
    return input.mode === 'repaint' ? '请先填写重绘描述' : '请先填写编辑要求'
  }
  if (input.insufficientCredits) return INSUFFICIENT_CREDITS_REASON
  return undefined
}
