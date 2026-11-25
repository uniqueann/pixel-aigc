import { i18n } from '@/i18n'
import { WORKSTATION_TOOLS } from '@/pages/ImageWorkstation/tools'
import { TOOLBOX_TOOLS } from '@/pages/Toolbox/tools'
import { CANVAS_MODES } from '@/pages/FreeCanvas/modes'
import type { CapabilityFlags } from '@/services/api/capabilities'
import { normalizeToolHref } from './recentWork'

export interface QuickStartEntry { href: string; label: string; capability?: keyof CapabilityFlags }
export interface QuickStartGroup { id: string; title: string; description: string; entries: QuickStartEntry[] }

const workstationCapabilities: Record<string, keyof CapabilityFlags> = {
  'smart-edit': 'imageEdit', relight: 'imageEdit', remove: 'erase', repaint: 'repaint',
  variation: 'variation', fusion: 'imageEdit', outpaint: 'outpaint', retouch: 'imageEdit',
}

function workstationEntries(slugs: string[]): QuickStartEntry[] {
  return slugs.map(slug => {
    const tool = WORKSTATION_TOOLS.find(item => item.slug === slug)!
    return {
      href: `/image-workstation/${tool.slug}`,
      label: i18n.t(`workstation:tools.${tool.slug}` as never),
      capability: workstationCapabilities[slug],
    }
  })
}

function toolboxEntries(): QuickStartEntry[] {
  return TOOLBOX_TOOLS.filter(tool => tool.slug !== 'pipeline').map(tool => ({
    href: `/toolbox/${tool.slug}`,
    label: i18n.t(`toolbox:tools.${tool.slug}` as never),
    ...(tool.slug === 'bg-remove' ? { capability: 'bgRemove' as const } : {}),
  }))
}

export function getQuickStartGroups(): QuickStartGroup[] {
  return [
    {
      id: 'image',
      title: i18n.t('dashboard:quickStart.groups.image.title'),
      description: i18n.t('dashboard:quickStart.groups.image.description'),
      entries: [
        ...workstationEntries(['smart-edit', 'relight', 'remove', 'repaint', 'outpaint', 'retouch']),
        ...toolboxEntries(),
      ],
    },
    {
      id: 'batch',
      title: i18n.t('dashboard:quickStart.groups.batch.title'),
      description: i18n.t('dashboard:quickStart.groups.batch.description'),
      entries: [
        ...workstationEntries(['variation', 'fusion']),
        { href: '/toolbox/pipeline', label: i18n.t('dashboard:quickStart.entries.pipeline') },
      ],
    },
    {
      id: 'generate',
      title: i18n.t('dashboard:quickStart.groups.generate.title'),
      description: i18n.t('dashboard:quickStart.groups.generate.description'),
      entries: CANVAS_MODES.map(mode => ({
        href: `/canvas/${mode.slug}`,
        label: i18n.t(`canvas:modes.${mode.slug}` as never),
        capability: mode.slug === 'text-to-image' ? 'textToImage' : 'textToVideo',
      })),
    },
    {
      id: 'email',
      title: i18n.t('dashboard:quickStart.groups.email.title'),
      description: i18n.t('dashboard:quickStart.groups.email.description'),
      entries: [
        ...(['reply', 'summarize', 'polish', 'grammar'] as const).map(operation => ({
          href: `/email?mode=single&operation=${operation}`,
          label: i18n.t(`email:operations.${operation}` as never),
        })),
        { href: '/email?mode=batch', label: i18n.t('dashboard:quickStart.entries.batchEmail') },
      ],
    },
  ]
}

export function findToolEntry(href: string): QuickStartEntry | undefined {
  const normalized = normalizeToolHref(href)
  if (normalized?.startsWith('/email')) {
    return {
      href: normalized,
      label: normalized.endsWith('batch')
        ? i18n.t('dashboard:quickStart.entries.batchEmail')
        : i18n.t('dashboard:quickStart.entries.singleEmail'),
    }
  }
  return getQuickStartGroups().flatMap(group => group.entries).find(entry => entry.href === normalized)
}

export function entryReady(entry: QuickStartEntry, capabilities: Partial<Record<keyof CapabilityFlags, boolean | undefined>>) {
  return entry.capability ? capabilities[entry.capability] : true
}

/** 保留旧导出名，时间实现已抽到共享工具，避免资产页反向依赖 dashboard。 */
export { formatShortDateTime as dashboardTime } from '@/utils/datetime'
