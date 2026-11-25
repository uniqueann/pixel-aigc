import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Space, Spin } from 'antd'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { cloudEnabled } from '@/cloud/client'
import { openCloudProject, openLocalProject, useCloudStore } from '@/cloud/sync'
import { useEditorStore } from '@/editor/store'
import { persistenceScope } from '@/editor/persistence/database'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { hasUnfinishedGeneration } from '@/editor/persistence/projectPersistence'
import { currentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { useUserStore } from '@/store/useUserStore'
import FreeCanvas from '@/pages/FreeCanvas'
import TaskRecoveryPanel from '@/features/task-center/TaskRecoveryPanel'
import { useRecoveredTask } from '@/features/task-center/useRecoveredTask'
import { i18n } from '@/i18n'

function switchBlocked() {
  const state = usePersistenceStore.getState()
  if (!state.writable || state.phase !== 'ready') return i18n.t('dashboard:projectOpen.needEditAccess')
  if (hasUnfinishedGeneration()) return i18n.t('dashboard:projectOpen.unfinishedTasks')
  if (state.status === 'error') return i18n.t('dashboard:projectOpen.saveFailed')
  if (state.cloud?.conflict) return i18n.t('dashboard:projectOpen.conflict')
  if (useCloudStore.getState().busy) return i18n.t('dashboard:projectOpen.syncing')
}

function ProjectOpenGate({ id, source, ownerId, taskScene }: { id: string; source: string | null; ownerId: string; taskScene?: string }) {
  const { t } = useTranslation(['dashboard', 'common'])
  const navigate = useNavigate()
  const { pathname, search } = useLocation()
  const resolvedPath = useMemo(() => { const next = new URLSearchParams(search); next.delete('projectId'); next.delete('projectSource'); if (taskScene) next.set('sceneId', taskScene); return `${pathname}${next.size ? `?${next}` : ''}` }, [pathname, search, taskScene])
  const busy = useCloudStore(state => state.busy)
  const [stage, setStage] = useState<'idle' | 'opening' | 'confirm' | 'error'>('idle')
  const [error, setError] = useState<string>()
  const active = useRef(false)
  const committing = useRef(false)
  const controller = useRef<AbortController>()
  const check = useCallback(() => {
    const projectOwner = usePersistenceStore.getState().ownerId
    if (currentWorkstationHistoryOwner() !== ownerId || persistenceScope() !== ownerId || (projectOwner !== undefined && projectOwner !== ownerId)) throw new Error(t('dashboard:projectOpen.accountSwitched'))
    if (!id.trim() || id.length > 150 || (source !== 'local' && source !== 'cloud')) throw new Error(t('dashboard:projectOpen.invalidParams'))
    if (source === 'cloud' && !cloudEnabled) throw new Error(t('dashboard:projectOpen.cloudDisabled'))
  }, [id, source, ownerId, t])

  const run = useCallback(async () => {
    try {
      check()
      const blocked = switchBlocked()
      if (blocked) throw new Error(blocked)
      const request = new AbortController()
      controller.current = request
      committing.current = false
      setStage('opening'); setError(undefined)
      await (source === 'local' ? openLocalProject : openCloudProject)(id, {
        expectedUserId: ownerId, signal: request.signal, onCommitStart: () => { committing.current = true },
      })
      if (active.current && currentWorkstationHistoryOwner() === ownerId) navigate(resolvedPath, { replace: true })
    } catch (reason) {
      if (active.current && !controller.current?.signal.aborted) {
        setError(reason instanceof Error ? reason.message : t('dashboard:projectOpen.openFailed')); setStage('error')
      }
    }
  }, [check, id, source, ownerId, navigate, resolvedPath, t])

  const prepare = useCallback(() => {
    try {
      check()
      // 继续当前画布时保留本机内容，允许回去处理任务或保存失败。
      if (useEditorStore.getState().project?.id === id) { navigate(resolvedPath, { replace: true }); return }
      const blocked = switchBlocked()
      if (blocked) throw new Error(blocked)
      const state = usePersistenceStore.getState()
      if (useEditorStore.getState().project && (!state.cloud || state.cloud.pending || state.status !== 'saved')) setStage('confirm')
      else void run()
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('dashboard:projectOpen.openFailed')); setStage('error') }
  }, [check, id, navigate, resolvedPath, run, t])

  useEffect(() => {
    let lifetime = true
    active.current = true
    queueMicrotask(() => { if (lifetime) prepare() })
    return () => {
      lifetime = false
      active.current = false
      // 项目替换会主动卸载业务页面；这个卸载不能取消已经开始的保存事务。
      if (!committing.current || usePersistenceStore.getState().phase !== 'loading') controller.current?.abort()
    }
  }, [prepare])

  const cancel = () => { controller.current?.abort(); navigate(pathname, { replace: true }) }
  return <div className="dashboard-project-open" aria-live="polite">
    {stage === 'confirm' ? <>
      <Alert type="info" showIcon message={t('dashboard:projectOpen.confirmTitle')}
        description={t('dashboard:projectOpen.confirmDescription')} />
      <Space wrap><Button type="primary" disabled={busy} onClick={() => void run()}>{t('dashboard:projectOpen.confirmOk')}</Button><Button onClick={cancel}>{t('common:actions.cancel')}</Button></Space>
    </> : stage === 'error' ? <>
      <Alert type="error" showIcon message={t('dashboard:projectOpen.errorTitle')} description={error} />
      <Space wrap><Button disabled={busy} onClick={prepare}>{t('dashboard:projectOpen.retryOpen')}</Button><Button onClick={cancel}>{t('dashboard:projectOpen.backToCanvas')}</Button><Link to="/">{t('dashboard:projectOpen.backToHome')}</Link></Space>
      <TaskRecoveryPanel tools={['text-to-image', 'variation', 'text-to-video', 'image-to-video']} projectId={id} />
    </> : <><Spin /><p>{t('dashboard:projectOpen.opening')}</p><Button onClick={cancel}>{t('dashboard:projectOpen.cancelOpen')}</Button></>}
  </div>
}

export default function CanvasProjectRoute() {
  const { t } = useTranslation('common')
  const [params] = useSearchParams()
  useUserStore(state => state.userId)
  if (!params.has('projectId')) return <FreeCanvas />
  let ownerId: string
  try { ownerId = currentWorkstationHistoryOwner() }
  catch { return <p role="status">{t('status.preparingAccount')}</p> }
  const id = params.get('projectId') ?? '', source = params.get('projectSource')
  if (params.has('task')) return <TaskProjectTarget id={id} ownerId={ownerId} />
  return <ProjectOpenGate key={`${ownerId}:${id}:${source}`} id={id} source={source} ownerId={ownerId} />
}
const canvasTools = ['text-to-image', 'variation', 'text-to-video', 'image-to-video'] as const
function TaskProjectTarget({ id, ownerId }: { id: string; ownerId: string }) {
  const recovery = useRecoveredTask(canvasTools, id, false)
  const origin = recovery.data?.task.origin
  if (origin?.entry === 'canvas') return <ProjectOpenGate key={`${ownerId}:${origin.projectId}:${origin.projectSource}`} id={origin.projectId} source={origin.projectSource} ownerId={ownerId} taskScene={origin.sceneId} />
  return <div className="dashboard-project-open"><TaskRecoveryPanel tools={canvasTools} projectId={id} /></div>
}
