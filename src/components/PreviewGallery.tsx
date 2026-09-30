import { cloneElement, useState, type ImgHTMLAttributes, type ReactElement } from 'react'
import { DownloadOutlined, RetweetOutlined } from '@ant-design/icons'
import { App, Button, Image, Spin } from 'antd'
import CompareViewer from './CompareViewer'
import './preview.css'

export interface PreviewItem {
  id: string
  thumbSrc: string
  fullSrc: string
  originalSrc?: string
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

function PreviewImage({ image }: { image: ReactElement<ImgHTMLAttributes<HTMLImageElement>> }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  return <>
    {state !== 'ready' && <div className="preview-load-state">{state === 'loading' ? <Spin /> : <><span>图片加载失败</span><Button onClick={() => { setState('loading'); setAttempt(value => value + 1) }}>重试</Button></>}</div>}
    {cloneElement(image, {
      key: attempt,
      onLoad: event => { image.props.onLoad?.(event); setState('ready') },
      onError: event => { image.props.onError?.(event); setState('error') },
      style: { ...image.props.style, visibility: state === 'ready' ? 'visible' : 'hidden' },
    })}
  </>
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
        const response = await fetch(item.fullSrc)
        if (!response.ok) throw new Error('下载失败')
        const url = URL.createObjectURL(await response.blob())
        const link = document.createElement('a')
        link.href = url
        link.download = item.title || '图片'
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
        imageRender: image => <PreviewImage key={item?.fullSrc} image={image} />,
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
