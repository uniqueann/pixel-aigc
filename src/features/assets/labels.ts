import { WORKSTATION_TOOLS } from '@/features/image-workstation/tools/registry'
import { i18n } from '@/i18n'
import { Capability } from '@/types'

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

const TOOLBOX_TOOL_KEYS = {
  'bg-remove': 'toolbox:tools.bg-remove',
  watermark: 'toolbox:tools.watermark',
  'aspect-ratio': 'toolbox:tools.aspect-ratio',
  pipeline: 'toolbox:tools.pipeline',
} as const

const CANVAS_MODE_KEYS = {
  'text-to-image': 'canvas:modes.text-to-image',
  'text-to-video': 'canvas:modes.text-to-video',
  'video-replication': 'canvas:modes.video-replication',
} as const

const EMAIL_OPERATION_KEYS = {
  summarize: 'email:operations.summarize',
  reply: 'email:operations.reply',
  polish: 'email:operations.polish',
  grammar: 'email:operations.grammar',
} as const

export function workstationToolLabel(slug?: string): string {
  if (slug) {
    if (Object.hasOwn(WORKSTATION_TOOL_KEYS, slug)) {
      return i18n.t(WORKSTATION_TOOL_KEYS[slug as keyof typeof WORKSTATION_TOOL_KEYS])
    }
    if (Object.hasOwn(TOOLBOX_TOOL_KEYS, slug)) {
      return i18n.t(TOOLBOX_TOOL_KEYS[slug as keyof typeof TOOLBOX_TOOL_KEYS])
    }
    if (Object.hasOwn(CANVAS_MODE_KEYS, slug)) {
      return i18n.t(CANVAS_MODE_KEYS[slug as keyof typeof CANVAS_MODE_KEYS])
    }
  }
  return i18n.t('nav:routes.imageWorkstation')
}

export function workstationSlugForCapability(capability: Capability) {
  if (capability === Capability.TextToImage) return 'text-to-image'
  if (capability === Capability.ImageEdit) return 'smart-edit'
  if (capability === Capability.Variation) return 'variation'
  if (capability === Capability.Outpaint) return 'outpaint'
  return WORKSTATION_TOOLS.find((tool) => tool.capability === capability)?.slug
}

export function capabilityLabel(capability: Capability, slug?: string): string {
  if (slug) return workstationToolLabel(slug)
  switch (capability) {
    case Capability.TextToImage:
      return i18n.t('canvas:modes.text-to-image')
    case Capability.TextToVideo:
      return i18n.t('canvas:modes.text-to-video')
    case Capability.Inpaint:
      return i18n.t('nav:routes.imageWorkstation')
    case Capability.Outpaint:
      return i18n.t('workstation:tools.outpaint')
    case Capability.ImageEdit:
      return i18n.t('workstation:tools.smart-edit')
    case Capability.Relight:
      return i18n.t('workstation:tools.relight')
    case Capability.Fusion:
      return i18n.t('workstation:tools.fusion')
    case Capability.Retouch:
      return i18n.t('workstation:tools.retouch')
    case Capability.Variation:
      return i18n.t('workstation:tools.variation')
    case Capability.EmailAssist:
      return i18n.t('nav:routes.email')
    case Capability.BgRemove:
      return i18n.t('toolbox:tools.bg-remove')
    default:
      return i18n.t('assets:labels.generationTask')
  }
}

export function emailOperationLabel(operation?: string): string {
  if (!operation) return i18n.t('nav:routes.email')
  if (Object.hasOwn(EMAIL_OPERATION_KEYS, operation)) {
    return i18n.t(EMAIL_OPERATION_KEYS[operation as keyof typeof EMAIL_OPERATION_KEYS])
  }
  return operation
}

export function taskStatusLabel(status: string): string {
  if (status === 'succeeded') return i18n.t('assets:taskStatus.succeeded')
  if (status === 'failed') return i18n.t('assets:taskStatus.failed')
  if (status === 'cancelled') return i18n.t('assets:taskStatus.cancelled')
  if (status === 'queued' || status === 'pending') return i18n.t('assets:taskStatus.queued')
  if (status === 'processing') return i18n.t('assets:taskStatus.processing')
  return status
}
