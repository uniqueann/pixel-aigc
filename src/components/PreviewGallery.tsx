import { useEffect, useLayoutEffect, useRef, useState, type ImgHTMLAttributes, type ReactElement } from 'react'
import { DownloadOutlined, RetweetOutlined } from '@ant-design/icons'
import { App, Button, Image, Spin } from 'antd'
import { blobFromImageSource, filenameWithMimeExtension } from '@/features/image-workstation/download'
import CompareViewer from './CompareViewer'
import './preview.css'

type RcPreviewImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  imgRef?: { current: HTMLImageElement | null | undefined }
}

export interface PreviewItem {
  id: string
  thumbSrc: string
  fullSrc: string
  originalSrc?: string
  objectKey?: string
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

function PreviewImage({ image }: { image: ReactElement<RcPreviewImageProps> }) {
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
              <Button onClick={() => { setState('loading'); setAttempt(value => value + 1) }}>重试</Button>
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
  const change = (index: number) => {
    if (!items[index]?.originalSrc) setComparing(false)
    onChange(index)
  }

  const download = async () => {
    if (!item) return
    try {
      if (onDownload) await onDownload(item)
      else {
        const blob = await blobFromImageSource(item.fullSrc, item.objectKey)
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filenameWithMimeExtension(item.title || '图片', blob.type)
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch {
      message.error('下载失败，请重试')
    }
  }

  if (items.length === 0) return null
  return <>
    {!comparing && <Image.PreviewGroup
      items={items.map(entry => ({ src: entry.fullSrc, alt: entry.title ?? '图片预览' }))}
      preview={{
        visible: open,
        current,
        onVisibleChange: visible => { if (!visible && !comparing) onClose() },
        onChange: change,
        rootClassName: 'preview-gallery-overlay',
        imageRender: image => <PreviewImage image={image} />,
        toolbarRender: (originalNode) => <>
          {originalNode}
          <Button className="preview-toolbar-action" type="text" icon={<DownloadOutlined />} aria-label="下载原始大图" onClick={() => void download()} />
          {item?.originalSrc && <Button className="preview-toolbar-action" type="text" icon={<RetweetOutlined />} aria-label="对比原图与结果" onClick={() => setComparing(true)} />}
        </>,
      }}
    />}
    {open && comparing && item?.originalSrc && <CompareViewer key={item.id} items={items} current={current} onChange={change} onClose={() => setComparing(false)} />}
  </>
}
