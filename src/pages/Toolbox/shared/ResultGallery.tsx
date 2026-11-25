import { useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
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
  /** 结果类型，用于 dialog 标题与图片 alt，默认“抠图结果”。 */
  resultLabel?: string
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
  downloadLabel,
  downloadTooltip,
  resultLabel,
  checkerboard = false,
}: Props) {
  const { t } = useTranslation(['toolbox', 'common'])
  const [comparing, setComparing] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const item = items[current]

  if (!item) return null

  const resolvedDownloadLabel = downloadLabel ?? t('bgRemove.downloadFull')
  const resolvedDownloadTooltip = downloadTooltip ?? t('bgRemove.downloadTooltip')
  const resolvedResultLabel = resultLabel ?? t('bgRemove.resultLabel')
  const title = item.title ?? t('shared.defaultImageTitle')
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
        title={<span className="sr-only">{t('resultGallery.previewTitle', { title, resultLabel: resolvedResultLabel })}</span>}
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
              <span aria-live="polite">{t('resultGallery.counter', { current: current + 1, total: items.length, resultLabel: resolvedResultLabel })}</span>
            </div>
            <Button ref={closeRef} type="text" icon={<CloseOutlined />} onClick={close}>{t('common:actions.close')}</Button>
          </header>
          <div className={`result-gallery-stage${checkerboard ? ' is-transparent' : ''}`}>
            <img src={item.fullSrc} alt={t('resultGallery.imageAlt', { title, resultLabel: resolvedResultLabel })} />
          </div>
          <footer className="result-gallery-actions">
            <div className="result-gallery-nav">
              <Button icon={<LeftOutlined />} disabled={!canGoPrevious} onClick={() => change(current - 1)}>{t('common:preview.prevImage')}</Button>
              <Button icon={<RightOutlined />} disabled={!canGoNext} onClick={() => change(current + 1)}>{t('common:preview.nextImage')}</Button>
            </div>
            <div className="result-gallery-primary">
              {item.originalSrc && (
                <Button icon={<RetweetOutlined />} onClick={() => setComparing(true)}>{t('resultGallery.compareOriginal')}</Button>
              )}
              {onDownload && (
                <Button type="primary" icon={<DownloadOutlined />} title={resolvedDownloadTooltip} onClick={() => void onDownload(item)}>
                  {resolvedDownloadLabel}
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
