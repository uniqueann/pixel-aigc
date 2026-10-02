import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Empty, Modal, Spin } from 'antd'
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

export default function CanvasAssetPicker({ ownerId, busy, onSelect, onClose }: {
  ownerId: string; busy: boolean; onSelect: (record: WorkstationHistoryListItem) => Promise<void>; onClose: () => void
}) {
  const [items, setItems] = useState<WorkstationHistoryListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const lifetime = useRef(new AbortController())
  const revision = useRef(0)
  const refresh = useCallback(async (hydrate = false, signal = lifetime.current.signal) => {
    if (signal.aborted) return
    const request = ++revision.current
    const current = () => !signal.aborted && request === revision.current && isCurrentWorkstationHistoryOwner(ownerId)
    setLoading(true)
    setError(undefined)
    try {
      if (hydrate && authEnabled) {
        const result = await hydrateWorkstationHistoryFromImageJobs(ownerId, { signal })
        if (result.failed && current()) setError('部分云端图片尚未补记，可重试读取')
      }
      const records = await listHistoryPreviews(ownerId)
      if (current()) setItems(records)
    } catch (err) {
      if (current()) setError(err instanceof Error ? err.message : '资产读取失败')
    } finally { if (current()) setLoading(false) }
  }, [ownerId])
  useEffect(() => {
    const abort = new AbortController()
    lifetime.current = abort
    queueMicrotask(() => { void refresh(true, abort.signal) })
    const changed = () => { void refresh() }
    window.addEventListener(HISTORY_CHANGED, changed)
    return () => { abort.abort(); window.removeEventListener(HISTORY_CHANGED, changed) }
  }, [refresh])
  return <Modal title="从我的资产添加图片" open onCancel={onClose} footer={null} width={680}>
    <p>选择一张图片，加入当前画布。资产列表按当前账号显示最近的图片结果。</p>
    {error && <Alert type="warning" showIcon message={error} action={<Button onClick={() => { setError(undefined); void refresh(true) }}>重试读取</Button>} />}
    {loading ? <Spin /> : items.length === 0 ? <Empty description="暂无图片资产，可以先上传本地图片" /> : <div className="canvas-asset-picker-grid">
      {items.map(item => <button key={item.id} className="canvas-asset-picker-item" disabled={busy} onClick={() => { void onSelect(item) }} aria-label={`添加${workstationToolLabel(item.toolSlug)} ${item.width}×${item.height}到画布`}>
        {item.thumbnail ? <HistoryThumbnail blob={item.thumbnail} label={workstationToolLabel(item.toolSlug)} /> : <span>图片</span>}
        <strong>{workstationToolLabel(item.toolSlug)}</strong><span>{item.width} × {item.height}</span>
      </button>)}
    </div>}
    {busy && <p role="status">正在读取并添加图片…</p>}
  </Modal>
}
