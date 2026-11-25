import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
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
import { activeLocale, formatMegabytes } from '@/i18n/format'
import { MAX_BATCH_BYTES, MAX_FILES, MAX_IMAGE_BYTES } from './shared/inspect'
import { resultStatusLabel } from './shared/resultStatus'
import CreditActionButton from '@/features/credits/CreditActionButton'
import type { CreditQuote } from '@/features/credits/quotes'

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

const statusIcons = {
  pending: <ClockCircleOutlined />,
  processing: <LoadingOutlined spin />,
  succeeded: <CheckOutlined />,
  failed: <CloseCircleOutlined />,
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
  retryQuote,
}: {
  status: ToolboxImageItem['status']
  hasOutput: boolean
  retry?: boolean
  busy?: boolean
  onDownload: () => void
  onRetry: () => void
  retryQuote?: CreditQuote
}) {
  const { t } = useTranslation(['toolbox', 'common'])
  const showRetry = status === 'failed' || retry
  const canDownload = status === 'succeeded' && hasOutput
  const downloadLockedTip = t('imageCard.downloadAfterComplete')
  return (
    <>
      {showRetry && (
        <CreditActionButton size="small" autoInsertSpace={false} icon={<RedoOutlined />} disabled={busy} quote={retryQuote} onClick={onRetry}>
          {t('common:actions.retry')}
        </CreditActionButton>
      )}
      {status !== 'failed' && (canDownload ? (
        <Button size="small" autoInsertSpace={false} icon={<DownloadOutlined />} onClick={onDownload}>
          {t('common:actions.download')}
        </Button>
      ) : (
        <Tooltip title={downloadLockedTip}>
          <span className="toolbox-preview-download-lock" title={downloadLockedTip}>
            <Button size="small" autoInsertSpace={false} icon={<DownloadOutlined />} disabled>
              {t('common:actions.download')}
            </Button>
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
      {error && <p className="toolbox-preview-error" role="alert" title={error}>{error}</p>}
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
  processingHint,
}: CardProps) {
  const { t } = useTranslation('toolbox')
  const resolvedHint = processingHint ?? t('imageCard.defaultProcessingHint')
  const inputRef = useRef<HTMLInputElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const dragDepth = useRef(0)
  const atLimit = items.length >= MAX_FILES
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
      aria-label={t('imageCard.title')}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="toolbox-section-heading">
        <div><strong>{t('imageCard.title')}</strong><span>{t('imageCard.count', { count: items.length, max: MAX_FILES })}</span></div>
        {items.length > 0 && <Button size="small" autoInsertSpace={false} disabled={disabled} onClick={onClear}>{t('imageCard.clear')}</Button>}
      </div>

      {items.length === 0 ? (
        <button type="button" className="toolbox-image-drop" disabled={disabled} onClick={openPicker}>
          <span className="toolbox-image-drop-icon" aria-hidden><PictureOutlined /></span>
          <span className="toolbox-image-drop-copy">
            <strong>{t('imageCard.emptyTitle')}</strong>
            <span>{t('imageCard.emptySub', { max: MAX_FILES, hint: resolvedHint })}</span>
          </span>
        </button>
      ) : (
        <div className={`toolbox-image-strip-frame${showFade ? ' is-overflowing' : ''}`}>
          <div className="toolbox-image-strip" ref={stripRef} onScroll={measure}>
            <button
              type="button"
              className="toolbox-image-add"
              disabled={disabled || atLimit}
              title={atLimit ? t('imageCard.maxFilesTitle', { max: MAX_FILES }) : undefined}
              onClick={openPicker}
            >
              <span aria-hidden><PlusOutlined /></span>
              <span>{atLimit ? t('imageCard.atLimit') : t('imageCard.addImage')}</span>
            </button>
            {items.map(item => {
              const statusLabel = resultStatusLabel(item.status)
              const detail = [statusLabel, item.note, item.error].filter(Boolean).join(' · ')
              const removeLabel = t('imageCard.removeItemAria', { name: item.name })
              return (
                <div key={item.id} data-image-tile className={`toolbox-image-tile${item.id === selectedId ? ' is-selected' : ''}`}>
                  <button
                    type="button"
                    className="toolbox-image-select"
                    title={item.name}
                    aria-label={t('imageCard.previewItemAria', { name: item.name, detail })}
                    aria-current={item.id === selectedId ? 'true' : undefined}
                    onClick={() => onSelect(item.id)}
                  >
                    <img src={item.url} alt="" />
                  </button>
                  <span className={`toolbox-image-badge is-${item.status}`} title={detail}>
                    {statusIcons[item.status]}{statusLabel}
                  </span>
                  <button
                    type="button"
                    className="toolbox-image-remove"
                    aria-label={removeLabel}
                    title={disabled ? undefined : removeLabel}
                    disabled={disabled}
                    onClick={() => onRemove(item.id)}
                  >
                    <CloseOutlined />
                  </button>
                </div>
              )
            })}
          </div>
          {hiddenCount > 0 && <div className="toolbox-image-more">{t('imageCard.moreCount', { count: hiddenCount })}</div>}
        </div>
      )}

      <p className="toolbox-hint">
        {t('imageCard.limitsDesktop', {
          maxSingle: formatMegabytes(MAX_IMAGE_BYTES),
          maxBatch: formatMegabytes(MAX_BATCH_BYTES),
        })}
        {items.length > 0 && `${activeLocale() === 'en-US' ? ' ' : ''}${t('imageCard.dragAddHint')}`}
      </p>
      {dragOver && <div className="toolbox-image-drop-hint" role="status"><span aria-hidden><ArrowUpOutlined /></span>{t('imageCard.dropHint')}</div>}
      <input
        ref={inputRef}
        className="toolbox-image-file"
        type="file"
        accept={ACCEPT}
        multiple
        tabIndex={-1}
        aria-hidden="true"
        aria-label={t('imageCard.selectInputAria')}
        onChange={event => {
          addFiles(event.target.files)
          event.target.value = ''
        }}
      />
    </section>
  )
}
