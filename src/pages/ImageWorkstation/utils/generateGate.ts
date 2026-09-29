import { COMING_SOON_SUBMIT_MESSAGE } from '@/features/image-workstation/tools/registry'
import { emptyMaskMessage } from './maskExport'

export function workstationGenerateBlockReason(input: {
  toolReady: boolean
  hasInput: boolean
  formLocked: boolean
  submitting?: boolean
  maskRequired: boolean
  hasMaskPaint: boolean
  repaintBlocked: boolean
  retouchBlocked?: boolean
  mode?: 'remove' | 'repaint'
}): string | undefined {
  if (input.submitting) return undefined
  if (!input.toolReady) return COMING_SOON_SUBMIT_MESSAGE
  if (!input.hasInput) return '请先上传需要处理的图片'
  if (input.formLocked) return '请等待当前任务完成'
  if (input.retouchBlocked) return '请先选择精修方向'
  if (input.repaintBlocked) return '重绘尚未配置'
  if (input.maskRequired && !input.hasMaskPaint) return emptyMaskMessage(input.mode)
  return undefined
}
