import { ZoomInOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import PreviewGallery, { type PreviewItem } from './PreviewGallery'
import { usePreviewGallery } from './usePreviewGallery'

export default function PreviewResultStrip({ items, onDownload }: { items: PreviewItem[]; onDownload?: (item: PreviewItem) => Promise<void> | void }) {
  const { openAt, galleryProps } = usePreviewGallery(items)
  if (!items.length) return null
  return <>
    <div className="preview-result-strip" aria-label="生成结果预览">
      {items.map((item, index) => <div className="preview-result-tile" key={item.id}>
        <img src={item.thumbSrc} alt={item.title ?? `结果 ${index + 1}`} />
        <Button className="preview-zoom-button" size="small" type="text" icon={<ZoomInOutlined />} aria-label={`放大结果 ${index + 1}`} onClick={() => openAt(item.id)} />
      </div>)}
    </div>
    <PreviewGallery {...galleryProps} onDownload={onDownload} />
  </>
}
