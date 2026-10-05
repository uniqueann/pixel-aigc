import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Space, Spin } from 'antd'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { cloudEnabled } from '@/cloud/client'
import { openCloudProject, openLocalProject, useCloudStore } from '@/cloud/sync'
import { useEditorStore } from '@/editor/store'
import { persistenceScope } from '@/editor/persistence/database'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { hasUnfinishedGeneration } from '@/editor/persistence/projectPersistence'
import { currentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { useUserStore } from '@/store/useUserStore'
import FreeCanvas from '@/pages/FreeCanvas'

function switchBlocked() {
  const state = usePersistenceStore.getState()
  if (!state.writable || state.phase !== 'ready') return '请先取得项目编辑权'
  if (hasUnfinishedGeneration()) return '当前画布有未完成任务，请先返回处理'
  if (state.status === 'error') return '当前画布保存失败，请先返回重新保存'
  if (state.cloud?.conflict) return '当前画布有版本冲突，请先返回处理'
  if (useCloudStore.getState().busy) return '当前正在同步，请完成后重试'
}

function ProjectOpenGate({ id, source, ownerId }: { id: string; source: string | null; ownerId: string }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const busy = useCloudStore(state => state.busy)
  const [stage, setStage] = useState<'idle' | 'opening' | 'confirm' | 'error'>('idle')
  const [error, setError] = useState<string>()
  const active = useRef(false)
  const committing = useRef(false)
  const controller = useRef<AbortController>()
  const check = useCallback(() => {
    const projectOwner = usePersistenceStore.getState().ownerId
    if (currentWorkstationHistoryOwner() !== ownerId || persistenceScope() !== ownerId || (projectOwner !== undefined && projectOwner !== ownerId)) throw new Error('账号已切换，已取消项目打开')
    if (!id.trim() || id.length > 150 || (source !== 'local' && source !== 'cloud')) throw new Error('项目打开参数无效，请从首页重新选择')
    if (source === 'cloud' && !cloudEnabled) throw new Error('当前环境未启用云端项目')
  }, [id, source, ownerId])

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
      if (active.current && currentWorkstationHistoryOwner() === ownerId) navigate(pathname, { replace: true })
    } catch (reason) {
      if (active.current && !controller.current?.signal.aborted) {
        setError(reason instanceof Error ? reason.message : '项目打开失败'); setStage('error')
      }
    }
  }, [check, id, source, ownerId, navigate, pathname])

  const prepare = useCallback(() => {
    try {
      check()
      // 继续当前画布时保留本机内容，允许回去处理任务或保存失败。
      if (useEditorStore.getState().project?.id === id) { navigate(pathname, { replace: true }); return }
      const blocked = switchBlocked()
      if (blocked) throw new Error(blocked)
      const state = usePersistenceStore.getState()
      if (useEditorStore.getState().project && (!state.cloud || state.cloud.pending || state.status !== 'saved')) setStage('confirm')
      else void run()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '项目打开失败'); setStage('error') }
  }, [check, id, navigate, pathname, run])

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
      <Alert type="info" showIcon message="保留当前画布并打开其他项目？"
        description="当前内容尚未同步到云端。继续后会先保存本机存档，可从首页最近画布返回。" />
      <Space wrap><Button type="primary" disabled={busy} onClick={() => void run()}>保留存档并打开</Button><Button onClick={cancel}>取消</Button></Space>
    </> : stage === 'error' ? <>
      <Alert type="error" showIcon message="无法打开项目" description={error} />
      <Space wrap><Button disabled={busy} onClick={prepare}>重试打开</Button><Button onClick={cancel}>返回当前画布</Button><Link to="/">返回首页</Link></Space>
    </> : <><Spin /><p>正在打开画布…</p><Button onClick={cancel}>取消打开</Button></>}
  </div>
}

export default function CanvasProjectRoute() {
  const [params] = useSearchParams()
  useUserStore(state => state.userId)
  if (!params.has('projectId')) return <FreeCanvas />
  let ownerId: string
  try { ownerId = currentWorkstationHistoryOwner() }
  catch { return <p role="status">正在准备账号…</p> }
  const id = params.get('projectId') ?? '', source = params.get('projectSource')
  return <ProjectOpenGate key={`${ownerId}:${id}:${source}`} id={id} source={source} ownerId={ownerId} />
}
