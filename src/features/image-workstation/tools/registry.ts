import { normalizeRetouchDirections } from '@shared/retouch'
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

export const COMING_SOON_LABEL = '即将上线'
export const COMING_SOON_SUBMIT_MESSAGE = '该能力即将上线，目前还不能提交生成任务'

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
    label: '智能编辑',
    interactionMode: 'params-only',
    validate: (context) => context.prompt?.trim()
      ? { valid: true }
      : { valid: false, message: '请先填写编辑要求' },
    buildRequest: buildImageEditRequest,
  },
  {
    slug: 'relight',
    capability: Capability.Relight,
    label: '重新打光',
    interactionMode: 'params-only',
    buildRequest: buildRelightRequest,
  },
  { slug: 'remove', capability: Capability.Inpaint, label: '消除', interactionMode: 'mask-paint', buildRequest: (ctx) => buildInpaintRequest(ctx, 'remove') },
  {
    slug: 'repaint', capability: Capability.Inpaint, label: '重绘', interactionMode: 'mask-paint',
    validate: (ctx) => ctx.prompt?.trim() ? { valid: true } : { valid: false, message: '请先填写重绘描述' },
    buildRequest: (ctx) => buildInpaintRequest(ctx, 'repaint'),
  },
  { slug: 'variation', capability: Capability.Variation, label: '裂变', interactionMode: 'params-only', buildRequest: buildVariationRequest },
  {
    slug: 'fusion',
    capability: Capability.Fusion,
    label: '融合',
    interactionMode: 'multi-source',
    validate: (context) => context.sourceAsset.url && context.referenceAsset?.url
      ? { valid: true }
      : { valid: false, message: '请先上传商品图和场景图' },
    buildRequest: buildFusionRequest,
  },
  { slug: 'outpaint', capability: Capability.Outpaint, label: '扩图', interactionMode: 'drag-resize', buildRequest: buildOutpaintRequest },
  {
    slug: 'retouch',
    capability: Capability.Retouch,
    label: '精修',
    interactionMode: 'params-only',
    validate: (context) => normalizeRetouchDirections(context.retouchDirections).length
      ? { valid: true }
      : { valid: false, message: '请先选择精修方向' },
    buildRequest: buildRetouchRequest,
  },
]

export function getWorkstationTool(slug?: string) {
  return WORKSTATION_TOOLS.find((tool) => tool.slug === slug) ?? WORKSTATION_TOOLS[0]
}
