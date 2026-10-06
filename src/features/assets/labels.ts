import { Capability } from '@/types'
import { WORKSTATION_TOOLS } from '@/features/image-workstation/tools/registry'

const EMAIL_OPERATIONS: Record<string, string> = {
  summarize: '总结',
  reply: '回复',
  polish: '润色',
  grammar: '检查语法',
}

const CAPABILITY_LABELS: Partial<Record<Capability, string>> = {
  [Capability.TextToImage]: '文生图',
  [Capability.Inpaint]: '图片工作站',
  [Capability.Outpaint]: '扩图',
  [Capability.ImageEdit]: '智能编辑',
  [Capability.Variation]: '裂变',
  [Capability.EmailAssist]: '邮件助手',
  [Capability.BgRemove]: '智能抠图',
}

const TOOLBOX_HISTORY_LABELS: Record<string, string> = {
  'bg-remove': '智能抠图',
  'text-to-image': '文生图',
}

export function workstationToolLabel(slug?: string) {
  if (slug && TOOLBOX_HISTORY_LABELS[slug]) return TOOLBOX_HISTORY_LABELS[slug]
  return WORKSTATION_TOOLS.find((tool) => tool.slug === slug)?.label ?? '图片工作站'
}

export function workstationSlugForCapability(capability: Capability) {
  if (capability === Capability.TextToImage) return 'text-to-image'
  if (capability === Capability.ImageEdit) return 'smart-edit'
  if (capability === Capability.Variation) return 'variation'
  if (capability === Capability.Outpaint) return 'outpaint'
  return WORKSTATION_TOOLS.find((tool) => tool.capability === capability)?.slug
}

export function capabilityLabel(capability: Capability, slug?: string) {
  if (slug) return workstationToolLabel(slug)
  return CAPABILITY_LABELS[capability] ?? '生成任务'
}

export function emailOperationLabel(operation?: string) {
  if (!operation) return '邮件助手'
  return EMAIL_OPERATIONS[operation] ?? operation
}

export function taskStatusLabel(status: string) {
  if (status === 'succeeded') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  if (status === 'queued' || status === 'pending') return '排队中'
  if (status === 'processing') return '进行中'
  return status
}
