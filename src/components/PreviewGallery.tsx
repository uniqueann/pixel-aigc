import { Children, cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ImgHTMLAttributes, type ReactElement, type ReactNode } from 'react'
import { DownloadOutlined, RetweetOutlined } from '@ant-design/icons'
import { App, Button, Image, Spin, Tooltip } from 'antd'
import { blobFromImageSource, downloadFailureMessage, filenameWithMimeExtension } from '@/features/image-workstation/download'
import { useUserStore } from '@/store/useUserStore'
import { isCurrentWorkstationHistoryOwner, currentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { readOwnedImage, invalidateOwnedImage } from '@/services/api/ownedImages'
import { retainImageBlob, runtimeImageBlob } from '@/services/api/imageRuntime'
import CompareViewer from './CompareViewer'
import VideoPlayer from './VideoPlayer'
import { downloadOwnedVideo } from '@/services/api/ownedVideos'
import './preview.css'

type RcPreviewImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  imgRef?: { current: HTMLImageElement | null | undefined }
}

export interface PreviewItem {
  mediaType?: 'image' | 'video'
  retentionExpiresAt?: string
  posterKey?: string
  id: string
  thumbSrc: string
  fullSrc: string
  originalSrc?: string
  objectKey?: string
  historyId?: string
  ownerId?: string
  expiresAt?: number
  title?: string
  meta?: { tool?: string; resolution?: string; createdAt?: string }
}

export interface PreviewGalleryProps {
  items: PreviewItem[]
  open: boolean
  current: number
  onClose: () => void
  onChange: (index: number) => void
  onDownload?: (item: PreviewItem) => Promise<void> | void
}

function PreviewDownloadButton({ label, tooltip, split, onClick }: { label: string; tooltip: string; split: boolean; onClick: () => void }) {
  return (
    <Tooltip title={tooltip} zIndex={2100}>
      <div
        className={`ant-image-preview-operations-operation preview-toolbar-download${split ? ' preview-toolbar-download-split' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={label}
        onClick={onClick}
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onClick()
        }}
      >
        {split && <span className="preview-toolbar-divider" aria-hidden="true" />}
        <DownloadOutlined />
      </div>
    </Tooltip>
  )
}

function withPreviewDownload(originalNode: ReactNode, download: ReactElement, compare?: ReactElement) {
  const toolbar = isValidElement(originalNode)
    ? cloneElement(originalNode, {}, ...Children.toArray(originalNode.props.children), download)
    : <div className="ant-image-preview-operations">{download}</div>
  return <>{toolbar}{compare}</>
}

function PreviewImage({ image, onRetry }: { image: ReactElement<RcPreviewImageProps>; onRetry?: () => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const frameRef = useRef<HTMLDivElement>(null)
  const src = typeof image.props.src === 'string' ? image.props.src : undefined
  const previousSrc = useRef(src)

  useLayoutEffect(() => {
    const img = frameRef.current?.querySelector('img')
    const imgRef = image.props.imgRef
    if (img && imgRef) imgRef.current = img
  })

  useLayoutEffect(() => {
    if (previousSrc.current === src) return
    previousSrc.current = src
    setState('loading')
  }, [src])

  useEffect(() => {
    const img = frameRef.current?.querySelector('img')
    if (!img) return
    const onLoad = () => setState('ready')
    const onError = () => setState('error')
    img.addEventListener('load', onLoad)
    img.addEventListener('error', onError)
    if (attempt > 0) {
      const currentSrc = img.getAttribute('src')
      img.removeAttribute('src')
      if (currentSrc) img.setAttribute('src', currentSrc)
    } else if (img.complete && (img.naturalWidth || img.naturalHeight)) {
      onLoad()
    }
    return () => {
      img.removeEventListener('load', onLoad)
      img.removeEventListener('error', onError)
    }
  }, [attempt, src])

  return (
    <div
      ref={frameRef}
      className="preview-image-frame"
      data-state={state}
      onLoadCapture={() => setState('ready')}
      onErrorCapture={() => setState('error')}
    >
      {state !== 'ready' && (
        <div className="preview-load-state">
          {state === 'loading' ? <Spin /> : (
            <>
              <span>图片加载失败</span>
              <Button onClick={() => { setState('loading'); if (onRetry) onRetry(); else setAttempt(value => value + 1) }}>重试</Button>
            </>
          )}
        </div>
      )}
      {image}
    </div>
  )
}

export default function PreviewGallery({ items, open, current, onClose, onChange, onDownload }: PreviewGalleryProps) {
  const { message } = App.useApp()
  const [comparing, setComparing] = useState(false)
  const item = items[current]
  const isVideo = item?.mediaType === 'video'
  const { id: readId, objectKey: readKey, historyId: readHistoryId, ownerId: readOwnerId, fullSrc: readSrc, expiresAt: readExpiresAt } = item ?? {}
  const currentUserId = useUserStore(state => state.userId)
  const signatureOwnerRef = useRef<string>()
  const [resolved, setResolved] = useState<{ id: string; url: string; userId: string | null }>()
  const [readFailure, setReadFailure] = useState<{ id: string; message: string }>()
  const readError = readFailure?.id === item?.id ? readFailure?.message : undefined
  const [readAttempt, setReadAttempt] = useState(0)
  useEffect(() => {
    if (!open || isVideo || !readId || (!readKey && !readHistoryId)) return
    const controller = new AbortController()
    let active = true
    let lease: ReturnType<typeof retainImageBlob> | undefined
    queueMicrotask(() => { if (active) { setReadFailure(undefined); setResolved(undefined) } })
    if (readOwnerId && !isCurrentWorkstationHistoryOwner(readOwnerId)) {
      queueMicrotask(() => { if (active) setReadFailure({ id: readId, message: '账号已切换，无法读取其他账号的图片' }) })
      return () => { active = false; controller.abort() }
    }
    let ownerId: string
    try { ownerId = readOwnerId ?? currentWorkstationHistoryOwner() }
    catch { queueMicrotask(() => { if (active) setReadFailure({ id: readId, message: '登录账号尚未就绪' }) }); return () => { active = false; controller.abort() } }
    signatureOwnerRef.current ??= ownerId
    // 账号切换后不沿用旧签名，重新让本站接口验证当前账号的对象权限。
    const signedSrc = signatureOwnerRef.current === ownerId ? readSrc : undefined
    void readOwnedImage({ blob: readSrc ? runtimeImageBlob(readSrc) : undefined, objectKey: readKey, historyId: readHistoryId, url: signedSrc, expiresAt: readExpiresAt }, { ownerId, signal: controller.signal })
      .then(blob => {
        if (!active) return
        lease = retainImageBlob(blob)
        setResolved({ id: readId, url: lease.url, userId: currentUserId })
      }).catch(error => { if (active) setReadFailure({ id: readId, message: error instanceof Error ? error.message : '图片读取失败' }) })
    return () => { active = false; controller.abort(); lease?.release() }
  }, [open, isVideo, readId, readKey, readHistoryId, readOwnerId, readSrc, readExpiresAt, readAttempt, currentUserId])
  const requiresRead = !isVideo && Boolean(item?.objectKey || item?.historyId)
  const localSrc = resolved?.id === item?.id && resolved?.userId === currentUserId ? resolved?.url : undefined
  const retryImage = () => {
    if (readKey) { try { invalidateOwnedImage(readOwnerId ?? currentWorkstationHistoryOwner(), readKey) } catch { return } }
    setReadAttempt(value => value + 1)
  }
  const displayItems = items.map(entry => entry.id === item?.id && localSrc ? { ...entry, fullSrc: localSrc } : entry)
  const change = (index: number) => {
    if (!items[index]?.originalSrc) setComparing(false)
    onChange(index)
  }

  const download = async () => {
    if (!item) return
    try {
      if (item.ownerId && !isCurrentWorkstationHistoryOwner(item.ownerId)) throw new Error('账号已切换，无法下载其他账号的图片')
      if (isVideo) await downloadOwnedVideo({ objectKey: item.objectKey, url: item.fullSrc, retentionExpiresAt: item.retentionExpiresAt }, `${item.title ?? '视频'}.mp4`, item.ownerId)
      else if (onDownload) await onDownload({ ...item, fullSrc: localSrc ?? item.fullSrc })
      else {
        const currentBlob = localSrc ? runtimeImageBlob(localSrc) : undefined
        const blob = currentBlob ?? (item.historyId ? await readOwnedImage({ historyId: item.historyId, objectKey: item.objectKey }, { ownerId: item.ownerId }) : await blobFromImageSource(localSrc ?? item.fullSrc, item.objectKey))
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filenameWithMimeExtension(item.title || '图片', blob.type)
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (error) {
      message.error(downloadFailureMessage(error))
    }
  }

  if (items.length === 0) return null
  return <>
    {(!comparing || (requiresRead && !localSrc)) && (!isVideo || open) && <Image.PreviewGroup
      items={items.map(entry => ({ src: entry.id === item?.id && localSrc ? localSrc : entry.mediaType === 'video' || entry.objectKey || entry.historyId ? 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=' : entry.fullSrc, alt: entry.title ?? '媒体预览' }))}
      preview={{
        visible: open,
        current,
        onVisibleChange: visible => { if (!visible && (!comparing || (requiresRead && !localSrc))) { setComparing(false); onClose() } },
        onChange: change,
        rootClassName: 'preview-gallery-overlay',
        imageRender: image => isVideo && open ? <VideoPlayer key={item.id} ownerId={item.ownerId} reference={{ objectKey: item.objectKey, url: item.fullSrc, expiresAt: item.expiresAt, retentionExpiresAt: item.retentionExpiresAt }} /> : requiresRead && !localSrc ? <div className="preview-image-frame"><div className="preview-load-state">{readError ? <><span>{readError}</span><Button onClick={() => setReadAttempt(value => value + 1)}>重试读取</Button></> : <Spin />}</div></div> : <PreviewImage image={image} onRetry={requiresRead ? retryImage : undefined} />,
        toolbarRender: originalNode => withPreviewDownload(
          isVideo ? null : originalNode,
          <PreviewDownloadButton
            key="download"
            label={isVideo ? '下载视频' : '下载原始大图'}
            tooltip={isVideo ? '下载视频' : '下载原图'}
            split={!isVideo}
            onClick={() => void download()}
          />,
          !isVideo && item?.originalSrc
            ? <Button key="compare" className="preview-toolbar-action" type="text" icon={<RetweetOutlined />} aria-label="对比原图与结果" onClick={() => setComparing(true)} />
            : undefined,
        ),
      }}
    />}
    {open && comparing && item?.originalSrc && (!requiresRead || localSrc) && <CompareViewer key={item.id} items={displayItems} current={current} onChange={change} onClose={() => setComparing(false)} />}
  </>
}
