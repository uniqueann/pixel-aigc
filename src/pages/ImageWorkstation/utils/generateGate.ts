import { i18n } from '@/i18n'
import zhWorkstation from '@/i18n/locales/zh-CN/workstation.json'
import { insufficientCreditsReason } from '@/features/credits/imageCredits'
import {
  COMING_SOON_SUBMIT_MESSAGE,
  FUSION_INPUTS_REQUIRED_REASON,
  comingSoonSubmitMessage,
  fusionInputsRequiredReason,
} from '@/features/image-workstation/tools/registry'
import { emptyMaskMessage } from './maskExport'

export const TASK_RUNNING_REASON = zhWorkstation.blockReasons.taskRunning

/** Empty-operation prompt when outpaint dimensions match source. */
export const OUTPAINT_IDLE_REASONS = {
  free: zhWorkstation.blockReasons.outpaintIdleFree,
  preset: zhWorkstation.blockReasons.outpaintIdlePreset,
} as const

export type OutpaintIdleMode = keyof typeof OUTPAINT_IDLE_REASONS

/**
 * Sync inpaint unavailable notices shown directly in generate block reason.
 */
export const UNAVAILABLE_SERVICE_MESSAGES = {
  remove: zhWorkstation.blockReasons.removeUnavailable,
  repaint: zhWorkstation.blockReasons.repaintUnavailable,
} as const

export function taskRunningReason() {
  return i18n.t('workstation:blockReasons.taskRunning')
}

export function outpaintIdleReason(mode: OutpaintIdleMode) {
  return mode === 'free'
    ? i18n.t('workstation:blockReasons.outpaintIdleFree')
    : i18n.t('workstation:blockReasons.outpaintIdlePreset')
}

export function unavailableServiceMessage(mode: 'remove' | 'repaint') {
  return mode === 'remove'
    ? i18n.t('workstation:blockReasons.removeUnavailable')
    : i18n.t('workstation:blockReasons.repaintUnavailable')
}

export { COMING_SOON_SUBMIT_MESSAGE, FUSION_INPUTS_REQUIRED_REASON }

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
  if (input.configurationPending) return i18n.t('workstation:blockReasons.loadingConfig')
  if (input.configurationError) return i18n.t('workstation:blockReasons.configLoadFailed')
  if (!input.toolReady) return comingSoonSubmitMessage()
  if (input.fusionBlocked) return fusionInputsRequiredReason()
  if (!input.hasInput) return i18n.t('workstation:blockReasons.uploadImageFirst')
  if (
    typeof input.maxRefImages === 'number'
    && typeof input.referenceCount === 'number'
    && input.referenceCount > input.maxRefImages
  ) return i18n.t('workstation:errors.maxReferenceImages', { max: input.maxRefImages })
  if (input.formLocked) return taskRunningReason()
  if (input.outpaintLimitError) return input.outpaintLimitError
  if (input.outpaintIdle) return outpaintIdleReason(input.outpaintIdle)
  if (input.retouchBlocked) return i18n.t('workstation:validation.retouchDirectionsRequired')
  if (input.repaintBlocked) return unavailableServiceMessage('repaint')
  if (input.removeBlocked) return unavailableServiceMessage('remove')
  if (input.maskRequired && !input.hasMaskPaint) return emptyMaskMessage(input.mode)
  if (input.promptRequired && input.promptEmpty) {
    return input.mode === 'repaint'
      ? i18n.t('errors:client.repaintEmptyPrompt')
      : i18n.t('workstation:validation.smartEditPromptRequired')
  }
  if (input.insufficientCredits) return insufficientCreditsReason()
  return undefined
}
