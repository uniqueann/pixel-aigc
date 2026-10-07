import { useEffect, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Alert, App, Button, Space } from 'antd'
import { isCanvasRoute } from '@/layouts/projectActions'
import { acquireEditLock, downloadJson, initializePersistence, reclaimEditAccess, releaseEditLock, restartAfterLoadError } from './projectPersistence'
import { usePersistenceStore } from './persistenceStore'

function RecoveryScreen({ mode }: { mode: 'error' | 'readonly' }) {
  const error = usePersistenceStore((state) => state.error)
  const raw = usePersistenceStore((state) => state.raw)
  const writable = usePersistenceStore((state) => state.writable)
  const phase = usePersistenceStore((state) => state.phase)
  const { modal, message } = App.useApp()
  const failed = mode === 'error'
  return <div className="project-recovery-screen">
    <Alert
      type={failed ? 'error' : 'info'}
      showIcon
      message={failed ? '无法恢复本地项目' : '本站的其他标签页正在编辑这个项目'}
      description={failed
        ? (error ?? '读取项目失败')
        : '此页面已变为只读。重新取得编辑权时，正在编辑的标签页会先保存存档，再变为只读。'}
    />
    <Space wrap>
      <Button onClick={() => { void reclaimEditAccess() }}>重新读取并取得编辑权</Button>
      {raw !== undefined && <Button onClick={() => downloadJson(raw, '项目原始存档.json')}>下载原始存档</Button>}
      {failed && phase === 'error' && writable && <Button danger onClick={() => modal.confirm({
        title: '重新开始将替换本地存档', content: '建议先下载原始存档，以便以后恢复。', okText: '重新开始', cancelText: '取消',
        onOk: async () => { try { await restartAfterLoadError() } catch (err) { message.error(String(err)); throw err } },
      })}>重新开始</Button>}
    </Space>
  </div>
}

export default function PersistenceGate({ children }: { children: ReactNode }) {
  const phase = usePersistenceStore((state) => state.phase)
  const writable = usePersistenceStore((state) => state.writable)
  const lockPhase = usePersistenceStore((state) => state.lockPhase)
  const epoch = usePersistenceStore((state) => state.epoch)
  const onCanvas = isCanvasRoute(useLocation().pathname)
  useEffect(() => { void initializePersistence() }, [])
  useEffect(() => {
    if (phase !== 'ready' || !onCanvas) return
    let active = true
    void acquireEditLock().catch((reason: unknown) => {
      if (!active) return
      usePersistenceStore.setState({
        phase: 'error',
        writable: false,
        lockPhase: 'blocked',
        error: reason instanceof Error ? reason.message : '无法取得项目编辑权',
      })
    })
    return () => { active = false }
  }, [onCanvas, phase])
  useEffect(() => {
    if (onCanvas) return
    void releaseEditLock()
  }, [onCanvas])
  if (phase === 'idle' || phase === 'loading') return <div className="free-canvas-loading">正在恢复本地项目…</div>
  if (phase === 'error') return <RecoveryScreen mode="error" />
  if (onCanvas && !writable && lockPhase === 'blocked') return <RecoveryScreen mode="readonly" />
  if (onCanvas && !writable) return <div className="free-canvas-loading">正在取得项目编辑权…</div>
  return <div key={epoch} className="project-app-root">{children}</div>
}
