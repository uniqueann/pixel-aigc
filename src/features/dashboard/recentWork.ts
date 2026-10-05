import { WORKSTATION_SLUGS, TOOLBOX_SLUGS } from '@shared/preferences'

export const RECENT_WORK_CHANGED = 'pixel:recent-work-changed'
const LIMIT = 3

export interface RecentToolEntry { href: string; visitedAt: string }
export interface RecentProjectEntry { id: string; name: string; updatedAt: string; localPending: boolean }
export interface RecentWork { tools: RecentToolEntry[]; projects: RecentProjectEntry[] }

export function recentWorkKey(ownerId: string) {
  return `pixel:recent-work:v1:${window.location.origin}:${ownerId}`
}

/** 只记录可直达的工具及邮件模式，不保存输入内容或任意查询参数。 */
export function normalizeToolHref(href: string): string | undefined {
  if (!href.startsWith('/') || href.startsWith('//')) return
  const [path, search = ''] = href.split('?')
  if (path === '/email') return `/email?mode=${new URLSearchParams(search).get('mode') === 'batch' ? 'batch' : 'single'}`
  if (WORKSTATION_SLUGS.some(slug => path === `/image-workstation/${slug}`)
    || TOOLBOX_SLUGS.some(slug => path === `/toolbox/${slug}`)) return path
}

const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))

export function readRecentWork(ownerId: string): RecentWork {
  const empty = { tools: [], projects: [] }
  if (typeof window === 'undefined') return empty
  try {
    const raw = JSON.parse(localStorage.getItem(recentWorkKey(ownerId)) ?? 'null')
    if (raw?.version !== 1) return empty
    const tools: RecentToolEntry[] = Array.isArray(raw.tools) ? raw.tools.flatMap((item: RecentToolEntry) => {
      const href = typeof item?.href === 'string' ? normalizeToolHref(item.href) : undefined
      return href && validDate(item.visitedAt) ? [{ href, visitedAt: item.visitedAt }] : []
    }) : []
    const projects: RecentProjectEntry[] = Array.isArray(raw.projects) ? raw.projects.flatMap((item: RecentProjectEntry) =>
      typeof item?.id === 'string' && item.id.length > 0 && item.id.length <= 150
      && typeof item.name === 'string' && item.name.length <= 100 && validDate(item.updatedAt)
        ? [{ id: item.id, name: item.name, updatedAt: item.updatedAt, localPending: item.localPending !== false }] : []) : []
    return {
      tools: tools.filter((item, index) => tools.findIndex(other => other.href === item.href) === index).slice(0, LIMIT),
      projects: projects.filter((item, index) => projects.findIndex(other => other.id === item.id) === index).slice(0, LIMIT),
    }
  } catch { return empty }
}

function writeRecentWork(ownerId: string, work: RecentWork) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(recentWorkKey(ownerId), JSON.stringify({ version: 1, ...work }))
    window.dispatchEvent(new CustomEvent(RECENT_WORK_CHANGED, { detail: ownerId }))
  } catch { /* 存储受限时保留当前工作，不阻止工具访问和项目保存。 */ }
}

export function rememberTool(ownerId: string, href: string, visitedAt = new Date().toISOString()) {
  const normalized = normalizeToolHref(href)
  if (!normalized) return
  const work = readRecentWork(ownerId)
  writeRecentWork(ownerId, { ...work, tools: [{ href: normalized, visitedAt }, ...work.tools.filter(item => item.href !== normalized)].slice(0, LIMIT) })
}

export function seedRecentTool(ownerId: string, previousPage: string) {
  if (readRecentWork(ownerId).tools.length === 0) rememberTool(ownerId, previousPage)
}

/** 仅在本机存档成功后维护摘要，首页无需扫描完整项目。 */
export function rememberSavedProject(ownerId: string, snapshot: {
  project: { id: string; name: string; updatedAt: string }
  cloud?: { pending: boolean; conflict?: boolean }
}) {
  const { project, cloud } = snapshot
  if (typeof project?.id !== 'string' || !project.id || typeof project.name !== 'string' || !validDate(project.updatedAt)) return
  const work = readRecentWork(ownerId)
  const item = { id: project.id, name: project.name.slice(0, 100), updatedAt: project.updatedAt,
    localPending: !cloud || cloud.pending || Boolean(cloud.conflict) }
  const projects = [item, ...work.projects.filter(other => other.id !== item.id)]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)).slice(0, LIMIT)
  writeRecentWork(ownerId, { ...work, projects })
}
