import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Button, Tooltip } from 'antd'
import {
  ArrowUpOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  CloseOutlined,
  DownloadOutlined,
  LoadingOutlined,
  PictureOutlined,
  PlusOutlined,
  RedoOutlined,
} from '@ant-design/icons'
import { MAX_FILES } from './shared/inspect'

export interface ToolboxImageItem {
  id: string
  name: string
  url: string
  status: 'pending' | 'processing' | 'succeeded' | 'failed'
  error?: string
  note?: string
}

interface CardProps {
  items: ToolboxImageItem[]
  selectedId: string | null
  disabled: boolean
  onAdd: (file: File) => void
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onClear: () => void
  processingHint?: string
}

const ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'

const statusMeta = {
  pending: { label: '等待', icon: <ClockCircleOutlined /> },
  processing: { label: '处理中', icon: <LoadingOutlined spin /> },
  succeeded: { label: '完成', icon: <CheckOutlined /> },
  failed: { label: '失败', icon: <CloseCircleOutlined /> },
} as const

function isNarrowViewport() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches
}

function countHiddenImages(strip: HTMLElement) {
  if (strip.clientHeight === 0) return 0
  const visibleBottom = strip.scrollTop + strip.clientHeight
  let hidden = 0
  strip.querySelectorAll<HTMLElement>('[data-image-tile]').forEach(tile => {
    if (tile.offsetTop >= visibleBottom - 8) hidden += 1
  })
  return hidden
}

export function PreviewResultActions({
  status,
  hasOutput,
  retry = false,
  busy = false,
  onDownload,
  onRetry,
}: {
  status: ToolboxImageItem['status']
  hasOutput: boolean
  retry?: boolean
  busy?: boolean
  onDownload: () => void
  onRetry: () => void
}) {
  const showRetry = status === 'failed' || retry
  const canDownload = status === 'succeeded' && hasOutput
  return (
    <>
      {showRetry && (
        <Button size="small" autoInsertSpace={false} icon={<RedoOutlined />} disabled={busy} onClick={onRetry}>重试</Button>
      )}
      {status !== 'failed' && (canDownload ? (
        <Button size="small" autoInsertSpace={false} icon={<DownloadOutlined />} onClick={onDownload}>下载</Button>
      ) : (
        <Tooltip title="处理完成后可下载">
          <span className="toolbox-preview-download-lock" title="处理完成后可下载">
            <Button size="small" autoInsertSpace={false} icon={<DownloadOutlined />} disabled>下载</Button>
          </span>
        </Tooltip>
      ))}
    </>
  )
}

export function PreviewItemNotice({ error, note, warning = false }: { error?: string; note?: string; warning?: boolean }) {
  if (!error && !note) return null
  return (
    <>
      {error && <p className="toolbox-preview-error" title={error}>{error}</p>}
      {note && <p className={warning ? 'toolbox-crop-notice' : 'toolbox-hint'} role="status" title={note}>{note}</p>}
    </>
  )
}

export default function ToolboxImageCard({
  items,
  selectedId,
  disabled,
  onAdd,
  onSelect,
  onRemove,
  onClear,
  processingHint = '图片仅在本机处理',
}: CardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const dragDepth = useRef(0)
  const [dragOver, setDragOver] = useState(false)
  const [hiddenCount, setHiddenCount] = useState(0)
  const [showFade, setShowFade] = useState(false)

  const measure = useCallback(() => {
    const strip = stripRef.current
    if (!strip) return
    if (isNarrowViewport()) {
      const overflow = strip.scrollWidth > strip.clientWidth + 1
      const atEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2
      setShowFade(overflow && !atEnd)
      setHiddenCount(0)
      return
    }
    setShowFade(false)
    setHiddenCount(countHiddenImages(strip))
  }, [])

  useLayoutEffect(() => {
    measure()
    const strip = stripRef.current
    if (!strip) return
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure())
    observer?.observe(strip)
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 640px)') : null
    const onMedia = () => measure()
    media?.addEventListener('change', onMedia)
    return () => {
      observer?.disconnect()
      media?.removeEventListener('change', onMedia)
    }
  }, [measure, items])

  function openPicker() {
    if (!disabled) inputRef.current?.click()
  }

  function addFiles(files: FileList | File[] | null | undefined) {
    if (disabled || !files) return
    Array.from(files).forEach(file => onAdd(file))
  }

  function onDragEnter(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    dragDepth.current += 1
    if (!disabled) setDragOver(true)
  }

  function onDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
  }

  function onDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragOver(false)
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    dragDepth.current = 0
    setDragOver(false)
    addFiles(event.dataTransfer?.files)
  }

  return (
    <section
      className={`toolbox-image-card${dragOver ? ' is-dragover' : ''}`}
      aria-label="图片"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="toolbox-section-heading">
        <div><strong>图片</strong><span>{items.length} / {MAX_FILES} 张</span></div>
        {items.length > 0 && <Button size="small" autoInsertSpace={false} disabled={disabled} onClick={onClear}>清空</Button>}
      </div>

      {items.length === 0 ? (
        <button type="button" className="toolbox-image-drop" disabled={disabled} onClick={openPicker}>
          <span className="toolbox-image-drop-icon" aria-hidden><PictureOutlined /></span>
          <span className="toolbox-image-drop-copy">
            <strong>拖入图片，或点击选择</strong>
            <span>静态 JPG / PNG / WebP，最多 20 张；{processingHint}</span>
          </span>
        </button>
      ) : (
        <div className={`toolbox-image-strip-frame${showFade ? ' is-overflowing' : ''}`}>
          <div className="toolbox-image-strip" ref={stripRef} onScroll={measure}>
            <button type="button" className="toolbox-image-add" disabled={disabled} onClick={openPicker}>
              <span aria-hidden><PlusOutlined /></span>
              <span>添加图片</span>
            </button>
            {items.map(item => {
              const meta = statusMeta[item.status]
              const detail = [meta.label, item.note, item.error].filter(Boolean).join(' · ')
              return (
                <div key={item.id} data-image-tile className={`toolbox-image-tile${item.id === selectedId ? ' is-selected' : ''}`}>
                  <button
                    type="button"
                    className="toolbox-image-select"
                    title={item.name}
                    aria-label={`预览 ${item.name}，${detail}`}
                    aria-current={item.id === selectedId ? 'true' : undefined}
                    onClick={() => onSelect(item.id)}
                  >
                    <img src={item.url} alt="" />
                  </button>
                  <span className={`toolbox-image-badge is-${item.status}`} title={detail}>
                    {meta.icon}{meta.label}
                  </span>
                  <button
                    type="button"
                    className="toolbox-image-remove"
                    aria-label={`移除 ${item.name}`}
                    title={disabled ? undefined : `移除 ${item.name}`}
                    disabled={disabled}
                    onClick={() => onRemove(item.id)}
                  >
                    <CloseOutlined />
                  </button>
                </div>
              )
            })}
          </div>
          {hiddenCount > 0 && <div className="toolbox-image-more">还有 {hiddenCount} 张 · 滚动查看</div>}
        </div>
      )}

      <p className="toolbox-hint">
        单张最多 20 MB，整批最多 150 MB；桌面设备最多 24 MP，触屏设备最多 12 MP。
        {items.length > 0 && '拖入图片到此卡片任意位置即可添加。'}
      </p>
      {dragOver && <div className="toolbox-image-drop-hint" role="status"><span aria-hidden><ArrowUpOutlined /></span>松开即可添加</div>}
      <input
        ref={inputRef}
        className="toolbox-image-file"
        type="file"
        accept={ACCEPT}
        multiple
        aria-label="选择图片"
        onChange={event => {
          addFiles(event.target.files)
          event.target.value = ''
        }}
      />
    </section>
  )
}
