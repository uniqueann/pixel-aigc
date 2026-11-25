import { PlayCircleOutlined, ZoomInOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { useTranslation } from 'react-i18next'
import PreviewGallery, { type PreviewItem } from './PreviewGallery'
import { usePreviewGallery } from './usePreviewGallery'
import VideoPoster from './VideoPoster'

export default function PreviewResultStrip({ items, onDownload }: { items: PreviewItem[]; onDownload?: (item: PreviewItem) => Promise<void> | void }) {
  const { t } = useTranslation('common')
  const { openAt, galleryProps } = usePreviewGallery(items)
  if (!items.length) return null
  const hasVideo = items.some((item) => item.mediaType === 'video')
  return <>
    <p className="preview-result-caption">
      {t('preview.onCanvasCaption', { count: items.length })}{hasVideo ? t('preview.videoRetentionSuffix') : ''}
    </p>
    <div className="preview-result-strip" aria-label={t('preview.stripAria')}>
      {items.map((item, index) => <div className="preview-result-tile" key={item.id}>
        {item.mediaType === 'video' ? <VideoPoster posterKey={item.posterKey} ownerId={item.ownerId} retentionExpiresAt={item.retentionExpiresAt} /> : <img src={item.thumbSrc} alt={item.title ?? t('preview.resultTitle', { index: index + 1 })} />}
        {item.mediaType === 'video' && item.durationLabel ? <span className="preview-video-duration">{item.durationLabel}</span> : null}
        <Button className={item.mediaType === 'video' ? 'preview-video-play' : 'preview-zoom-button'} size="small" type="text"
          icon={item.mediaType === 'video' ? <PlayCircleOutlined /> : <ZoomInOutlined />} aria-label={item.mediaType === 'video' ? t('preview.playResultAria', { index: index + 1 }) : t('preview.zoomResultAria', { index: index + 1 })} onClick={() => openAt(item.id)} />
      </div>)}
    </div>
    <PreviewGallery {...galleryProps} onDownload={onDownload} />
  </>
}
