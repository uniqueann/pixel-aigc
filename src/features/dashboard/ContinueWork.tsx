import { useQuery } from '@tanstack/react-query'
import { Button, Skeleton } from 'antd'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation(['dashboard', 'common'])
  const project = useEditorStore(state => state.project)
  const projectOwner = usePersistenceStore(state => state.ownerId)
  const { capabilities, error: capabilityError } = useCapabilities()
  const query = useQuery({
    queryKey: ['dashboard-projects', ownerId], enabled: cloudEnabled && ownerId !== 'anonymous', staleTime: 60000,
    queryFn: async ({ signal }) => {
      const result = await cloudRequest<{ items: ProjectSummary[] }>('/projects', 'GET', undefined, { expectedUserId: ownerId, signal })
      if (currentWorkstationHistoryOwner() !== ownerId) throw new Error(t('dashboard:continueWork.accountSwitched'))
      return result.items
    },
  })
  const current = project && projectOwner === ownerId && persistenceScope() === ownerId
    ? { id: project.id, name: project.name, updatedAt: project.updatedAt, source: 'local' as const } : undefined
  const projects = resumeProjects(work.projects, query.data ?? [], current)
  const tools = work.tools.flatMap(item => { const entry = findToolEntry(item.href); return entry ? [{ ...item, entry }] : [] })
  if (!projects.length && !tools.length && !query.isFetching && !query.error) return null
  const untitled = t('dashboard:continueWork.untitledCanvas')
  return <section className="dashboard-section" aria-labelledby="dashboard-continue-title">
    <div className="dashboard-section-heading"><h2 id="dashboard-continue-title">{t('dashboard:continueWork.title')}</h2><span>{t('dashboard:continueWork.subtitle')}</span></div>
    <div className="dashboard-continue-grid">
      <div className="dashboard-panel"><h3>{t('dashboard:continueWork.recentCanvases')}</h3>
        {projects.length ? projects.map(item => <div className="dashboard-resume-row" key={item.id}>
          <div className="dashboard-resume-copy"><strong title={item.name}>{item.name || untitled}</strong>
            <span>{item.source === 'local' ? t('dashboard:continueWork.localSave') : t('dashboard:continueWork.cloudProject')} · {dashboardTime(item.updatedAt)}</span></div>
          <Link className="dashboard-resume-link" to={`/canvas/text-to-image?projectId=${encodeURIComponent(item.id)}&projectSource=${item.source}`} aria-label={t('dashboard:continueWork.continueEditAria', { name: item.name || untitled })}>{t('dashboard:continueWork.continueEdit')}</Link>
        </div>) : query.isFetching ? <Skeleton active title={false} paragraph={{ rows: 2 }} /> : <p className="dashboard-empty">{t('dashboard:continueWork.noCanvases')}</p>}
        {query.error ? <div className="dashboard-inline-error" role="status">{t('dashboard:continueWork.cloudLoadFailed')}<Button type="link" size="small" onClick={() => void query.refetch()}>{t('common:actions.retry')}</Button></div> : null}
      </div>
      <div className="dashboard-panel"><h3>{t('dashboard:continueWork.recentTools')}</h3>
        {tools.length ? tools.map(item => <div className="dashboard-recent-tool" key={item.href}>
          <ToolEntry entry={item.entry} ready={entryReady(item.entry, capabilities)} error={Boolean(capabilityError)} recent />
          <span>{t('dashboard:continueWork.lastVisited', { time: dashboardTime(item.visitedAt) })}</span>
        </div>) : <p className="dashboard-empty">{t('dashboard:continueWork.noTools')}</p>}
      </div>
    </div>
  </section>
}
