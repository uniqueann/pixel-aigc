import { normalizeRetouchDirections } from '@shared/retouch'
import { i18n } from '@/i18n'
import zhCommon from '@/i18n/locales/zh-CN/common.json'
import zhWorkstation from '@/i18n/locales/zh-CN/workstation.json'
import { liveCapabilityReady } from '@/services/api/task'
import { Capability } from '@/types'
import type { InteractionMode, WorkstationToolDefinition } from '../types'
import { buildInpaintRequest } from './requestBuilders/inpaint'
import { buildImageEditRequest } from './requestBuilders/imageEdit'
import { buildOutpaintRequest } from './requestBuilders/outpaint'
import { buildFusionRequest } from './requestBuilders/fusion'
import { buildRelightRequest } from './requestBuilders/relight'
import { buildRetouchRequest } from './requestBuilders/retouch'
import { buildVariationRequest } from './requestBuilders/variation'

export const COMING_SOON_LABEL = zhCommon.status.comingSoon
export const COMING_SOON_SUBMIT_MESSAGE = zhWorkstation.toolsMeta.comingSoonSubmit
/** 融合缺图时的唯一原因；页脚已按槽位给出下一步时不再重复展示。 */
export const FUSION_INPUTS_REQUIRED_REASON = zhWorkstation.errors.fusionInputsRequired

export function comingSoonSubmitMessage() {
  return i18n.t('workstation:toolsMeta.comingSoonSubmit')
}

export function fusionInputsRequiredReason() {
  return i18n.t('workstation:errors.fusionInputsRequired')
}

const WORKSTATION_TOOL_KEYS = {
  'smart-edit': 'workstation:tools.smart-edit',
  relight: 'workstation:tools.relight',
  remove: 'workstation:tools.remove',
  repaint: 'workstation:tools.repaint',
  variation: 'workstation:tools.variation',
  fusion: 'workstation:tools.fusion',
  outpaint: 'workstation:tools.outpaint',
  retouch: 'workstation:tools.retouch',
} as const

export function workstationToolLabel(slug: string) {
  const key = WORKSTATION_TOOL_KEYS[slug as keyof typeof WORKSTATION_TOOL_KEYS]
  return key ? i18n.t(key) : i18n.t('nav:routes.imageWorkstation')
}

/** 扩图、消除和重绘走独立接口，不依赖 /tasks。其余工具是否可提交只看 liveCapabilityReady。 */
export function isWorkstationToolReady(
  tool: WorkstationToolDefinition,
  capabilityReady: (capability: Capability) => boolean = liveCapabilityReady,
) {
  return tool.capability === Capability.Outpaint
    || tool.slug === 'remove'
    || tool.slug === 'repaint'
    || capabilityReady(tool.capability)
}

/** 融合是多图输入，不能沿用上一工具的单图预览。 */
export function workstationDisplaysSourcePreview(mode: InteractionMode) {
  return mode !== 'multi-source'
}

export const WORKSTATION_TOOLS: WorkstationToolDefinition[] = [
  {
    slug: 'smart-edit',
    capability: Capability.ImageEdit,
    label: zhWorkstation.tools['smart-edit'],
    interactionMode: 'params-only',
    validate: (context) => context.prompt?.trim()
      ? { valid: true }
      : { valid: false, message: i18n.t('workstation:validation.smartEditPromptRequired') },
    buildRequest: buildImageEditRequest,
  },
  {
    slug: 'relight',
    capability: Capability.Relight,
    label: zhWorkstation.tools.relight,
    interactionMode: 'params-only',
    buildRequest: buildRelightRequest,
  },
  {
    slug: 'remove',
    capability: Capability.Inpaint,
    label: zhWorkstation.tools.remove,
    interactionMode: 'mask-paint',
    buildRequest: (ctx) => buildInpaintRequest(ctx, 'remove'),
  },
  {
    slug: 'repaint',
    capability: Capability.Inpaint,
    label: zhWorkstation.tools.repaint,
    interactionMode: 'mask-paint',
    validate: (ctx) => ctx.prompt?.trim() ? { valid: true } : { valid: false, message: i18n.t('errors:client.repaintEmptyPrompt') },
    buildRequest: (ctx) => buildInpaintRequest(ctx, 'repaint'),
  },
  {
    slug: 'variation',
    capability: Capability.Variation,
    label: zhWorkstation.tools.variation,
    interactionMode: 'params-only',
    buildRequest: buildVariationRequest,
  },
  {
    slug: 'fusion',
    capability: Capability.Fusion,
    label: zhWorkstation.tools.fusion,
    interactionMode: 'multi-source',
    validate: (context) => context.sourceAsset.url && context.referenceAsset?.url
      ? { valid: true }
      : { valid: false, message: fusionInputsRequiredReason() },
    buildRequest: buildFusionRequest,
  },
  {
    slug: 'outpaint',
    capability: Capability.Outpaint,
    label: zhWorkstation.tools.outpaint,
    interactionMode: 'drag-resize',
    buildRequest: buildOutpaintRequest,
  },
  {
    slug: 'retouch',
    capability: Capability.Retouch,
    label: zhWorkstation.tools.retouch,
    interactionMode: 'params-only',
    validate: (context) => normalizeRetouchDirections(context.retouchDirections).length
      ? { valid: true }
      : { valid: false, message: i18n.t('workstation:validation.retouchDirectionsRequired') },
    buildRequest: buildRetouchRequest,
  },
]

export function getWorkstationTool(slug?: string) {
  return WORKSTATION_TOOLS.find((tool) => tool.slug === slug) ?? WORKSTATION_TOOLS[0]
}
