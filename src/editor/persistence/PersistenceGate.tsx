import { useEffect, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Alert, App, Button, Space } from 'antd'
import { i18n } from '@/i18n'
import { isCanvasRoute } from '@/layouts/projectActions'
import { acquireEditLock, downloadJson, initializePersistence, reclaimEditAccess, releaseEditLock, restartAfterLoadError } from './projectPersistence'
import { usePersistenceStore } from './persistenceStore'
import PostLoginLoading from '@/components/brand/PostLoginLoading'

function RecoveryScreen({ mode }: { mode: 'error' | 'readonly' }) {
  const { t } = useTranslation(['canvas', 'common'])
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
      message={failed ? t('canvas:persistence.recovery.errorTitle') : t('canvas:persistence.recovery.readonlyTitle')}
      description={failed
        ? (error ?? t('canvas:persistence.errors.readFailed'))
        : t('canvas:persistence.recovery.readonlyDescription')}
    />
    <Space wrap>
      <Button onClick={() => { void reclaimEditAccess() }}>{t('canvas:persistence.recovery.reclaimButton')}</Button>
      {raw !== undefined && <Button onClick={() => downloadJson(raw, t('canvas:persistence.recovery.rawArchiveFilename'))}>{t('canvas:persistence.recovery.downloadRawButton')}</Button>}
      {failed && phase === 'error' && writable && <Button danger onClick={() => modal.confirm({
        title: t('canvas:persistence.recovery.restartConfirmTitle'), content: t('canvas:persistence.recovery.restartConfirmContent'), okText: t('canvas:persistence.recovery.restartButton'), cancelText: t('common:actions.cancel'),
        onOk: async () => { try { await restartAfterLoadError() } catch (err) { message.error(String(err)); throw err } },
      })}>{t('canvas:persistence.recovery.restartButton')}</Button>}
    </Space>
  </div>
}

export default function PersistenceGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation('canvas')
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
        error: reason instanceof Error ? reason.message : i18n.t('canvas:persistence.errors.acquireLockFailed'),
      })
    })
    return () => { active = false }
  }, [onCanvas, phase])
  useEffect(() => {
    if (onCanvas) return
    void releaseEditLock()
  }, [onCanvas])
  if (phase === 'idle' || phase === 'loading') return <PostLoginLoading label={t('persistence.loading.restoringProject')} />
  if (phase === 'error') return <RecoveryScreen mode="error" />
  if (onCanvas && !writable && lockPhase === 'blocked') return <RecoveryScreen mode="readonly" />
  if (onCanvas && !writable) return <div className="free-canvas-loading">{t('persistence.loading.acquiringLock')}</div>
  return <div key={epoch} className="project-app-root">{children}</div>
}
