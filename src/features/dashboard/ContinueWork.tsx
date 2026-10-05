import { useQuery } from '@tanstack/react-query'
import { Button, Skeleton } from 'antd'
import { Link } from 'react-router-dom'
import { cloudEnabled, cloudRequest } from '@/cloud/client'
import { useEditorStore } from '@/editor/store'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { persistenceScope } from '@/editor/persistence/database'
import { currentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { useCapabilities } from '@/hooks/useCapabilities'
import type { ProjectSummary } from '@shared/cloud'
import type { RecentWork } from './recentWork'
import { entryReady, findToolEntry, dashboardTime } from './catalog'
import { ToolEntry } from './QuickStart'
import { resumeProjects } from './projects'

export default function ContinueWork({ ownerId, work }: { ownerId: string; work: RecentWork }) {
  const project = useEditorStore(state => state.project)
  const projectOwner = usePersistenceStore(state => state.ownerId)
  const { capabilities, error: capabilityError } = useCapabilities()
  const query = useQuery({
    queryKey: ['dashboard-projects', ownerId], enabled: cloudEnabled && ownerId !== 'anonymous', staleTime: 60000,
    queryFn: async ({ signal }) => {
      const result = await cloudRequest<{ items: ProjectSummary[] }>('/projects', 'GET', undefined, { expectedUserId: ownerId, signal })
      if (currentWorkstationHistoryOwner() !== ownerId) throw new Error('账号已切换')
      return result.items
    },
  })
  const current = project && projectOwner === ownerId && persistenceScope() === ownerId
    ? { id: project.id, name: project.name, updatedAt: project.updatedAt, source: 'local' as const } : undefined
  const projects = resumeProjects(work.projects, query.data ?? [], current)
  const tools = work.tools.flatMap(item => { const entry = findToolEntry(item.href); return entry ? [{ ...item, entry }] : [] })
  if (!projects.length && !tools.length && !query.isFetching && !query.error) return null
  return <section className="dashboard-section" aria-labelledby="dashboard-continue-title">
    <div className="dashboard-section-heading"><h2 id="dashboard-continue-title">继续工作</h2><span>接着完成上次的工作</span></div>
    <div className="dashboard-continue-grid">
      <div className="dashboard-panel"><h3>最近画布</h3>
        {projects.length ? projects.map(item => <div className="dashboard-resume-row" key={item.id}>
          <div className="dashboard-resume-copy"><strong title={item.name}>{item.name || '未命名画布'}</strong>
            <span>{item.source === 'local' ? '本机存档' : '云端项目'} · {dashboardTime(item.updatedAt)}</span></div>
          <Link className="dashboard-resume-link" to={`/canvas/text-to-image?projectId=${encodeURIComponent(item.id)}&projectSource=${item.source}`} aria-label={`继续编辑${item.name || '未命名画布'}`}>继续编辑</Link>
        </div>) : query.isFetching ? <Skeleton active title={false} paragraph={{ rows: 2 }} /> : <p className="dashboard-empty">暂无可继续的画布</p>}
        {query.error ? <div className="dashboard-inline-error" role="status">云端项目读取失败<Button type="link" size="small" onClick={() => void query.refetch()}>重试</Button></div> : null}
      </div>
      <div className="dashboard-panel"><h3>最近工具</h3>
        {tools.length ? tools.map(item => <div className="dashboard-recent-tool" key={item.href}>
          <ToolEntry entry={item.entry} ready={entryReady(item.entry, capabilities)} error={Boolean(capabilityError)} recent />
          <span>上次访问 {dashboardTime(item.visitedAt)}</span>
        </div>) : <p className="dashboard-empty">访问工具后，可从这里继续使用</p>}
      </div>
    </div>
  </section>
}
