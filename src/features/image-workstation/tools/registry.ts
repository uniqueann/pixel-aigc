import { Capability } from '@/types'
import type { WorkstationToolDefinition } from '../types'
import { buildInpaintRequest } from './requestBuilders/inpaint'
import { buildOutpaintRequest } from './requestBuilders/outpaint'

const unsupported = () => ({ valid: false, message: '当前工具的画布交互仍在后续迭代中' })
const buildBasicRequest = (capability: Capability): WorkstationToolDefinition['buildRequest'] => (context) => ({
  capability,
  params: { sourceImageUrl: context.sourceAsset.url },
  outputSize: { width: context.sourceAsset.width, height: context.sourceAsset.height },
})

export const WORKSTATION_TOOLS: WorkstationToolDefinition[] = [
  { slug: 'smart-edit', capability: Capability.ImageEdit, label: '智能编辑', interactionMode: 'params-only', validate: unsupported, buildRequest: buildBasicRequest(Capability.ImageEdit) },
  { slug: 'relight', capability: Capability.Relight, label: '重新打光', interactionMode: 'light-control', validate: unsupported, buildRequest: buildBasicRequest(Capability.Relight) },
  { slug: 'remove', capability: Capability.Inpaint, label: '消除', interactionMode: 'mask-paint', buildRequest: (ctx) => buildInpaintRequest(ctx, 'remove') },
  {
    slug: 'repaint', capability: Capability.Inpaint, label: '重绘', interactionMode: 'mask-paint',
    validate: (ctx) => ctx.prompt?.trim() ? { valid: true } : { valid: false, message: '请先填写重绘描述' },
    buildRequest: (ctx) => buildInpaintRequest(ctx, 'repaint'),
  },
  { slug: 'variation', capability: Capability.Variation, label: '裂变', interactionMode: 'params-only', validate: unsupported, buildRequest: buildBasicRequest(Capability.Variation) },
  { slug: 'fusion', capability: Capability.Fusion, label: '融合', interactionMode: 'multi-source', validate: unsupported, buildRequest: buildBasicRequest(Capability.Fusion) },
  { slug: 'outpaint', capability: Capability.Outpaint, label: '扩图', interactionMode: 'drag-resize', buildRequest: buildOutpaintRequest },
  { slug: 'retouch', capability: Capability.Retouch, label: '精修', interactionMode: 'params-only', validate: unsupported, buildRequest: buildBasicRequest(Capability.Retouch) },
]

export function getWorkstationTool(slug?: string) {
  return WORKSTATION_TOOLS.find((tool) => tool.slug === slug) ?? WORKSTATION_TOOLS[0]
}
