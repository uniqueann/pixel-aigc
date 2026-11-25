import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Empty, Modal } from 'antd'
import { authEnabled } from '@/cloud/client'
import { i18n } from '@/i18n'
import { isCurrentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { hydrateWorkstationHistoryFromImageJobs } from '@/features/assets/hydrateImageJobs'
import { listHistoryPreviews, HISTORY_CHANGED, type WorkstationHistoryListItem } from '@/features/assets/workstationHistory'
import { workstationToolLabel } from '@/features/assets/labels'

function HistoryThumbnail({ blob, label }: { blob: Blob; label: string }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob])
  useEffect(() => () => { URL.revokeObjectURL(url) }, [url])
  return <img src={url} alt={label} />
}

function PickerSkeleton() {
  const { t } = useTranslation('canvas')
  return (
    <div className="canvas-asset-picker-grid" aria-busy="true" aria-label={t('assetPicker.loadingAria')}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="canvas-asset-picker-skeleton" />
      ))}
    </div>
  )
}

export default function CanvasAssetPicker({ ownerId, busy, onSelect, onClose, targetLabel }: {
  ownerId: string; busy: boolean; onSelect: (record: WorkstationHistoryListItem) => Promise<void>; onClose: () => void; targetLabel?: string
}) {
  const { t } = useTranslation(['canvas', 'common'])
  const resolvedTarget = targetLabel ?? t('canvas:assetPicker.defaultTarget')
  const [items, setItems] = useState<WorkstationHistoryListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string>()
  const lifetime = useRef(new AbortController())
  const revision = useRef(0)

  /** 只读本地 IndexedDB，毫秒级，用于立即展示。 */
  const readLocal = useCallback(async (signal = lifetime.current.signal) => {
    const request = ++revision.current
    const current = () => !signal.aborted && request === revision.current && isCurrentWorkstationHistoryOwner(ownerId)
    try {
      const records = await listHistoryPreviews(ownerId)
      if (current()) setItems(records)
    } catch (err) {
      if (current()) setError(err instanceof Error ? err.message : i18n.t('canvas:assetPicker.readFailed'))
    }
  }, [ownerId])

  /** 云端补记在后台跑，不阻塞列表展示，完成后刷新一次。 */
  const hydrateInBackground = useCallback(async (signal = lifetime.current.signal) => {
    if (!authEnabled) return
    const request = ++revision.current
    const current = () => !signal.aborted && request === revision.current && isCurrentWorkstationHistoryOwner(ownerId)
    setSyncing(true)
    try {
      const result = await hydrateWorkstationHistoryFromImageJobs(ownerId, { signal })
      if (result.failed && current()) setError(i18n.t('canvas:assetPicker.partialHydrateError'))
      const records = await listHistoryPreviews(ownerId)
      if (current()) setItems(records)
    } catch (err) {
      if (current() && !signal.aborted) setError(err instanceof Error ? err.message : i18n.t('canvas:assetPicker.cloudSyncFailed'))
    } finally {
      if (current()) setSyncing(false)
    }
  }, [ownerId])

  const retry = useCallback(() => {
    setError(undefined)
    setSyncing(true)
    void hydrateInBackground()
  }, [hydrateInBackground])

  useEffect(() => {
    const abort = new AbortController()
    lifetime.current = abort
    queueMicrotask(() => {
      // 先读本地立即展示，再后台做云同步
      void readLocal(abort.signal).finally(() => {
        if (abort.signal.aborted) return
        setLoading(false)
        void hydrateInBackground(abort.signal)
      })
    })
    const changed = () => { void readLocal() }
    window.addEventListener(HISTORY_CHANGED, changed)
    return () => { abort.abort(); window.removeEventListener(HISTORY_CHANGED, changed) }
  }, [readLocal, hydrateInBackground])

  return <Modal title={t('canvas:assetPicker.modalTitle')} open onCancel={onClose} footer={null} width={680}>
    <p>{t('canvas:assetPicker.description', { target: resolvedTarget })}{syncing && !loading && <span className="canvas-asset-picker-syncing">{t('canvas:assetPicker.syncing')}</span>}</p>
    {error && <Alert type="warning" showIcon message={error} action={<Button size="small" onClick={retry}>{t('common:actions.retryLoad')}</Button>} />}
    {loading ? <PickerSkeleton /> : items.length === 0 ? <Empty description={t('canvas:assetPicker.empty')} /> : <div className="canvas-asset-picker-grid">
      {items.map(item => <button key={item.id} className="canvas-asset-picker-item" disabled={busy} onClick={() => { void onSelect(item) }} aria-label={t('canvas:assetPicker.itemAria', { tool: workstationToolLabel(item.toolSlug), width: item.width, height: item.height, target: resolvedTarget })}>
        {item.thumbnail ? <HistoryThumbnail blob={item.thumbnail} label={workstationToolLabel(item.toolSlug)} /> : <span>{t('canvas:assetPicker.imageFallback')}</span>}
        <strong>{workstationToolLabel(item.toolSlug)}</strong><span>{item.width} × {item.height}</span>
      </button>)}
    </div>}
    {busy && <p role="status">{t('canvas:assetPicker.adding')}</p>}
  </Modal>
}
