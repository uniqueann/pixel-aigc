import { CheckOutlined, DownloadOutlined, ZoomInOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AssetId, ImageAsset } from '@/editor/types'

interface VariationResultGridProps {
  assets: ImageAsset[]
  selectedAssetId?: AssetId
  downloadingAssetId?: AssetId
  downloadingAll?: boolean
  onSelect: (assetId: AssetId) => void
  onDownload: (asset: ImageAsset, index: number) => void
  onPreview: (assetId: AssetId) => void
  onDownloadAll?: () => void
}

/**
 * 裂变结果网格：多张变体并排，先看差异再决定下载或继续编辑。
 * 点击图片放大对比；「继续编辑」是卡片上的次操作，不抢放大与下载的主路径。
 */
export default function VariationResultGrid({
  assets,
  selectedAssetId,
  downloadingAssetId,
  downloadingAll = false,
  onSelect,
  onDownload,
  onPreview,
  onDownloadAll,
}: VariationResultGridProps) {
  const { t } = useTranslation('workstation')
  if (assets.length === 0) return null
  const selectedIndex = assets.findIndex(asset => asset.id === selectedAssetId)
  const hint = selectedIndex >= 0
    ? t('results.variationGrid.selectedHint', { index: selectedIndex + 1 })
    : t('results.variationGrid.unselectedHint')

  return (
    <section className="workstation-result-strip workstation-variation-results" aria-label={t('results.variationGrid.title')}>
      <div className="workstation-result-strip-head workstation-variation-results-head">
        <span className="workstation-result-strip-title">{t('results.variationGrid.title')}</span>
        <span className="workstation-variation-results-count">
          {t(assets.length === 1 ? 'results.countOne' : 'results.countOther', { count: assets.length })}
        </span>
        <span className="workstation-result-strip-hint">{hint}</span>
        {assets.length > 1 && onDownloadAll ? (
          <Button
            className="workstation-variation-results-download"
            size="small"
            icon={<DownloadOutlined aria-hidden="true" />}
            loading={downloadingAll}
            onClick={onDownloadAll}
          >
            {t('results.downloadAll')}
          </Button>
        ) : null}
      </div>
      <ul className="workstation-variation-grid" data-count={assets.length}>
        {assets.map((asset, index) => {
          const selected = asset.id === selectedAssetId
          return (
            <li key={asset.id} className={`workstation-variation-card${selected ? ' is-selected' : ''}`}>
              <button
                type="button"
                className="workstation-variation-card-media"
                aria-label={t('results.variationGrid.previewAria', { index: index + 1 })}
                onClick={() => onPreview(asset.id)}
              >
                <img src={asset.url} alt="" />
                <span className="workstation-variation-card-index" aria-hidden="true">{index + 1}</span>
                {selected ? <span className="workstation-variation-card-selected" aria-hidden="true">{t('results.variationGrid.selectedBadge')}</span> : null}
                <span className="workstation-variation-card-zoom" aria-hidden="true"><ZoomInOutlined /></span>
              </button>
              <div className="workstation-variation-card-meta">
                <span className="workstation-variation-card-size">{asset.width}×{asset.height}</span>
                <div className="workstation-variation-card-actions">
                  <Button
                    size="small"
                    type={selected ? 'primary' : 'default'}
                    aria-pressed={selected}
                    aria-label={t('results.variationGrid.selectAria', { index: index + 1 })}
                    onClick={() => onSelect(asset.id)}
                  >
                    {selected ? <><CheckOutlined aria-hidden="true" /> {t('results.variationGrid.selectedButton')}</> : t('results.continueEdit')}
                  </Button>
                  <Button
                    size="small"
                    type="text"
                    icon={<DownloadOutlined aria-hidden="true" />}
                    aria-label={t('results.variationGrid.downloadAria', { index: index + 1 })}
                    loading={downloadingAssetId === asset.id}
                    onClick={() => onDownload(asset, index)}
                  />
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
