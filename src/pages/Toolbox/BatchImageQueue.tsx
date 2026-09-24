import { Button, Tag, Upload } from 'antd'
import { DeleteOutlined, DownloadOutlined, InboxOutlined, RedoOutlined } from '@ant-design/icons'

export interface BatchQueueItem {
  id: string
  name: string
  url: string
  width: number
  height: number
  status: 'pending' | 'processing' | 'succeeded' | 'failed'
  error?: string
}

interface Props {
  items: BatchQueueItem[]
  selectedId: string | null
  disabled: boolean
  onAdd: (file: File) => void
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onClear: () => void
  onRetry: (id: string) => void
  onDownload: (id: string) => void
  onRefine?: (id: string) => void
}

const statusLabels = {
  pending: '待处理',
  processing: '处理中',
  succeeded: '已完成',
  failed: '失败',
}

const statusColors = {
  pending: 'default',
  processing: 'processing',
  succeeded: 'success',
  failed: 'error',
}

export default function BatchImageQueue({ items, selectedId, disabled, onAdd, onSelect, onRemove, onClear, onRetry, onDownload, onRefine }: Props) {
  return (
    <section className="toolbox-batch-queue" aria-label="批量图片队列">
      <div className="toolbox-section-heading">
        <div>
          <strong>待处理图片</strong>
          <span>{items.length} / 20 张</span>
        </div>
        {items.length > 0 && <Button size="small" disabled={disabled} onClick={onClear}>清空</Button>}
      </div>
      <Upload.Dragger
        className="toolbox-upload"
        accept="image/jpeg,image/png,image/webp"
        multiple
        showUploadList={false}
        disabled={disabled}
        beforeUpload={(file) => { onAdd(file); return Upload.LIST_IGNORE }}
      >
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p>拖入图片，或点击选择</p>
        <p className="ant-upload-hint">静态 JPG / PNG / WebP，最多 20 张；图片仅在本机处理</p>
      </Upload.Dragger>
      {items.length > 0 && (
        <div className="toolbox-queue-grid">
          {items.map(item => (
            <article key={item.id} className={`toolbox-queue-card${item.id === selectedId ? ' is-selected' : ''}`}>
              <button type="button" className="toolbox-queue-select" onClick={() => onSelect(item.id)} aria-label={`预览 ${item.name}`}>
                <img src={item.url} alt="" />
                <span className="toolbox-queue-name" title={item.name}>{item.name}</span>
                <span className="toolbox-queue-size">{item.width} × {item.height}</span>
              </button>
              <div className="toolbox-queue-card-footer">
                <Tag color={statusColors[item.status]}>{statusLabels[item.status]}</Tag>
                <div className="toolbox-queue-actions">
                  {item.status === 'succeeded' && <Button size="small" type="text" icon={<DownloadOutlined />} aria-label={`下载 ${item.name}`} onClick={() => onDownload(item.id)} />}
                  {item.status === 'failed' && <Button size="small" type="text" disabled={disabled} icon={<RedoOutlined />} aria-label={`重试 ${item.name}`} onClick={() => onRetry(item.id)} />}
                  <Button size="small" type="text" disabled={disabled} icon={<DeleteOutlined />} aria-label={`移除 ${item.name}`} onClick={() => onRemove(item.id)} />
                </div>
              </div>
              {item.error && <div className="toolbox-queue-error" title={item.error}>{item.error}</div>}
              {item.status === 'failed' && onRefine && <Button size="small" type="link" disabled={disabled} onClick={() => onRefine(item.id)}>去工作站精修</Button>}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
