import { PlayCircleOutlined, ZoomInOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import PreviewGallery, { type PreviewItem } from './PreviewGallery'
import { usePreviewGallery } from './usePreviewGallery'
import VideoPoster from './VideoPoster'

export default function PreviewResultStrip({ items, onDownload }: { items: PreviewItem[]; onDownload?: (item: PreviewItem) => Promise<void> | void }) {
  const { openAt, galleryProps } = usePreviewGallery(items)
  if (!items.length) return null
  return <>
    <div className="preview-result-strip" aria-label="生成结果预览">
      {items.map((item, index) => <div className="preview-result-tile" key={item.id}>
        {item.mediaType === 'video' ? <VideoPoster posterKey={item.posterKey} ownerId={item.ownerId} retentionExpiresAt={item.retentionExpiresAt} /> : <img src={item.thumbSrc} alt={item.title ?? `结果 ${index + 1}`} />}
        <Button className={item.mediaType === 'video' ? 'preview-video-play' : 'preview-zoom-button'} size="small" type="text"
          icon={item.mediaType === 'video' ? <PlayCircleOutlined /> : <ZoomInOutlined />} aria-label={`${item.mediaType === 'video' ? '播放' : '放大'}结果 ${index + 1}`} onClick={() => openAt(item.id)} />
      </div>)}
    </div>
    <PreviewGallery {...galleryProps} onDownload={onDownload} />
  </>
}
