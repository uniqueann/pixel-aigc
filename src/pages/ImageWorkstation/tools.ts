import { Capability } from '@/types'

export type InteractionMode = 'params-only' | 'mask-paint' | 'drag-resize' | 'multi-source' | 'light-control'

export interface WorkstationTool {
  slug: string
  key: Capability
  label: string
  /** 决定中间画布该渲染哪一种交互组件，参考此前讨论的 5 种交互模式 */
  interactionMode: InteractionMode
}

export const WORKSTATION_TOOLS: WorkstationTool[] = [
  { slug: 'smart-edit', key: Capability.ImageEdit, label: '智能编辑', interactionMode: 'params-only' },
  { slug: 'relight', key: Capability.Relight, label: '重新打光', interactionMode: 'light-control' },
  { slug: 'remove', key: Capability.Inpaint, label: '消除', interactionMode: 'mask-paint' },
  { slug: 'repaint', key: Capability.Inpaint, label: '重绘', interactionMode: 'mask-paint' },
  { slug: 'variation', key: Capability.Variation, label: '裂变', interactionMode: 'params-only' },
  { slug: 'fusion', key: Capability.Fusion, label: '融合', interactionMode: 'multi-source' },
  { slug: 'outpaint', key: Capability.Outpaint, label: '扩图', interactionMode: 'drag-resize' },
  { slug: 'retouch', key: Capability.Retouch, label: '精修', interactionMode: 'params-only' },
]
