import { useRef, useState, type KeyboardEvent } from 'react'
import { Button, Modal } from 'antd'
import { CloseOutlined, DownloadOutlined, LeftOutlined, RetweetOutlined, RightOutlined } from '@ant-design/icons'
import CompareViewer from '@/components/CompareViewer'
import type { PreviewItem } from '@/components/PreviewGallery'

interface Props {
  items: PreviewItem[]
  open: boolean
  current: number
  onClose: () => void
  onChange: (index: number) => void
  onDownload?: (item: PreviewItem) => Promise<void> | void
  downloadLabel?: string
  downloadTooltip?: string
  /** 透明结果在画廊里也需要棋盘格，否则透明区域会露出背后的页面。 */
  checkerboard?: boolean
}

export default function ResultGallery({
  items,
  open,
  current,
  onClose,
  onChange,
  onDownload,
  downloadLabel = '下载结果大图',
  downloadTooltip = '下载抠图结果',
  checkerboard = false,
}: Props) {
  const [comparing, setComparing] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const item = items[current]

  if (!item) return null

  const title = item.title ?? '图片'
  const canGoPrevious = current > 0
  const canGoNext = current < items.length - 1

  function close() {
    setComparing(false)
    onClose()
  }

  function change(index: number) {
    if (!items[index]?.originalSrc) setComparing(false)
    onChange(index)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft' && canGoPrevious) {
      event.preventDefault()
      change(current - 1)
    }
    if (event.key === 'ArrowRight' && canGoNext) {
      event.preventDefault()
      change(current + 1)
    }
  }

  return (
    <>
      <Modal
        open={open}
        title={<span className="sr-only">{title} 抠图结果预览</span>}
        footer={null}
        closable={false}
        centered
        width="min(96vw, 1180px)"
        className="result-gallery-modal"
        destroyOnHidden
        focusTriggerAfterClose
        onCancel={close}
        afterOpenChange={visible => {
          if (!visible) return
          // 每次打开都从结果视图开始，避免上次的对比状态残留。
          setComparing(false)
          closeRef.current?.focus()
        }}
        styles={{ body: { padding: 0 } }}
      >
        <div className="result-gallery" onKeyDown={onKeyDown}>
          <header className="result-gallery-head">
            <div>
              <strong>{title}</strong>
              <span aria-live="polite">{current + 1} / {items.length} · 抠图结果预览</span>
            </div>
            <Button ref={closeRef} type="text" icon={<CloseOutlined />} onClick={close}>关闭</Button>
          </header>
          <div className={`result-gallery-stage${checkerboard ? ' is-transparent' : ''}`}>
            <img src={item.fullSrc} alt={`${title} 的抠图结果`} />
          </div>
          <footer className="result-gallery-actions">
            <div className="result-gallery-nav">
              <Button icon={<LeftOutlined />} disabled={!canGoPrevious} onClick={() => change(current - 1)}>上一张</Button>
              <Button icon={<RightOutlined />} disabled={!canGoNext} onClick={() => change(current + 1)}>下一张</Button>
            </div>
            <div className="result-gallery-primary">
              {item.originalSrc && (
                <Button icon={<RetweetOutlined />} onClick={() => setComparing(true)}>对比原图</Button>
              )}
              {onDownload && (
                <Button type="primary" icon={<DownloadOutlined />} title={downloadTooltip} onClick={() => void onDownload(item)}>
                  {downloadLabel}
                </Button>
              )}
            </div>
          </footer>
        </div>
      </Modal>
      {open && comparing && item.originalSrc && (
        <CompareViewer
          items={items}
          current={current}
          onChange={change}
          onClose={() => setComparing(false)}
        />
      )}
    </>
  )
}
