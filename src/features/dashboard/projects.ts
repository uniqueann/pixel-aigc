import type { ProjectSummary } from '@shared/cloud'
import type { RecentProjectEntry } from './recentWork'

export interface ResumeProject { id: string; name: string; updatedAt: string; source: 'local' | 'cloud' }

export function resumeProjects(local: RecentProjectEntry[], remote: ProjectSummary[], current?: ResumeProject): ResumeProject[] {
  const byId = new Map<string, ResumeProject>(local.map(item => [item.id, { ...item, source: 'local' }]))
  for (const item of remote) {
    if (!local.find(saved => saved.id === item.id)?.localPending) byId.set(item.id, { ...item, source: 'cloud' })
  }
  const sorted = [...byId.values()].filter(item => item.id !== current?.id)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  return (current ? [current, ...sorted] : sorted).slice(0, 3)
}
