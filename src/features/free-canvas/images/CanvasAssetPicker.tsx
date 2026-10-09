import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Empty, Modal } from 'antd'
import { authEnabled } from '@/cloud/client'
import { isCurrentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { hydrateWorkstationHistoryFromImageJobs } from '@/features/assets/hydrateImageJobs'
import { listHistoryPreviews, HISTORY_CHANGED, type WorkstationHistoryListItem } from '@/features/assets/workstationHistory'
import { workstationToolLabel } from '@/features/assets/labels'

function HistoryThumbnail({ blob, label }: { blob: Blob; label: string }) {
  const image = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const url = URL.createObjectURL(blob)
    const element = image.current!
    element.src = url
    return () => { element.removeAttribute('src'); URL.revokeObjectURL(url) }
  }, [blob])
  return <img ref={image} alt={label} />
}

function PickerSkeleton() {
  return (
    <div className="canvas-asset-picker-grid" aria-busy="true" aria-label="正在加载资产">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="canvas-asset-picker-skeleton" />
      ))}
    </div>
  )
}

export default function CanvasAssetPicker({ ownerId, busy, onSelect, onClose }: {
  ownerId: string; busy: boolean; onSelect: (record: WorkstationHistoryListItem) => Promise<void>; onClose: () => void
}) {
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
      if (current()) setError(err instanceof Error ? err.message : '资产读取失败')
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
      if (result.failed && current()) setError('部分云端图片尚未补记，可重试读取')
      const records = await listHistoryPreviews(ownerId)
      if (current()) setItems(records)
    } catch (err) {
      if (current() && !signal.aborted) setError(err instanceof Error ? err.message : '云端同步失败，可重试读取')
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

  return <Modal title="从我的资产添加图片" open onCancel={onClose} footer={null} width={680}>
    <p>选择一张图片，加入当前画布。资产列表按当前账号显示最近的图片结果。{syncing && !loading && <span className="canvas-asset-picker-syncing">云端同步中…</span>}</p>
    {error && <Alert type="warning" showIcon message={error} action={<Button size="small" onClick={retry}>重试读取</Button>} />}
    {loading ? <PickerSkeleton /> : items.length === 0 ? <Empty description="暂无图片资产，可以先上传本地图片" /> : <div className="canvas-asset-picker-grid">
      {items.map(item => <button key={item.id} className="canvas-asset-picker-item" disabled={busy} onClick={() => { void onSelect(item) }} aria-label={`添加${workstationToolLabel(item.toolSlug)} ${item.width}×${item.height}到画布`}>
        {item.thumbnail ? <HistoryThumbnail blob={item.thumbnail} label={workstationToolLabel(item.toolSlug)} /> : <span>图片</span>}
        <strong>{workstationToolLabel(item.toolSlug)}</strong><span>{item.width} × {item.height}</span>
      </button>)}
    </div>}
    {busy && <p role="status">正在读取并添加图片…</p>}
  </Modal>
}
