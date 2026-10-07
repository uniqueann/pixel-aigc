import { WORKSTATION_TOOLS } from '@/pages/ImageWorkstation/tools'
import { TOOLBOX_TOOLS } from '@/pages/Toolbox/tools'
import { CANVAS_MODES } from '@/pages/FreeCanvas/modes'
import { EMAIL_OPERATIONS } from '@/features/email-assistant/options'
import type { CapabilityFlags } from '@/services/api/capabilities'
import { normalizeToolHref } from './recentWork'

export interface QuickStartEntry { href: string; label: string; capability?: keyof CapabilityFlags }
export interface QuickStartGroup { id: string; title: string; description: string; entries: QuickStartEntry[] }

const workstationCapabilities: Record<string, keyof CapabilityFlags> = {
  'smart-edit': 'imageEdit', relight: 'imageEdit', remove: 'erase', repaint: 'repaint',
  variation: 'variation', fusion: 'imageEdit', outpaint: 'outpaint', retouch: 'imageEdit',
}
const workstation = (slugs: string[]): QuickStartEntry[] => slugs.map(slug => ({
  href: `/image-workstation/${slug}`, label: WORKSTATION_TOOLS.find(tool => tool.slug === slug)!.label,
  capability: workstationCapabilities[slug],
}))
const toolbox = TOOLBOX_TOOLS.filter(tool => tool.slug !== 'pipeline').map(tool => ({
  href: `/toolbox/${tool.slug}`, label: tool.label, ...(tool.slug === 'bg-remove' ? { capability: 'bgRemove' as const } : {}),
}))

export const QUICK_START_GROUPS: QuickStartGroup[] = [
  { id: 'image', title: '图片处理', description: '编辑与整理商品图片', entries: [
    ...workstation(['smart-edit', 'relight', 'remove', 'repaint', 'outpaint', 'retouch']), ...toolbox,
  ] },
  { id: 'batch', title: '批量出图', description: '生成变体、融合场景与批量处理', entries: [
    ...workstation(['variation', 'fusion']), { href: '/toolbox/pipeline', label: '流水线' },
  ] },
  { id: 'generate', title: '从零生成', description: '在画布中生成图片或视频', entries: CANVAS_MODES.map(mode => ({
    href: `/canvas/${mode.slug}`, label: mode.label, capability: mode.slug === 'text-to-image' ? 'textToImage' : 'textToVideo',
  })) },
  { id: 'email', title: '邮件处理', description: '处理单封邮件或批量邮件', entries: [
    ...['reply', 'summarize', 'polish', 'grammar'].map(operation => ({
      href: `/email?mode=single&operation=${operation}`, label: EMAIL_OPERATIONS.find(item => item.value === operation)!.label,
    })), { href: '/email?mode=batch', label: '批量邮件' },
  ] },
]

const allEntries = QUICK_START_GROUPS.flatMap(group => group.entries)
export function findToolEntry(href: string): QuickStartEntry | undefined {
  const normalized = normalizeToolHref(href)
  if (normalized?.startsWith('/email')) return { href: normalized, label: normalized.endsWith('batch') ? '批量邮件' : '单个邮件' }
  return allEntries.find(entry => entry.href === normalized)
}

export function entryReady(entry: QuickStartEntry, capabilities: Partial<Record<keyof CapabilityFlags, boolean | undefined>>) {
  return entry.capability ? capabilities[entry.capability] : true
}

export function dashboardTime(value: string) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '时间未知'
}
