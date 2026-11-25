import { DownloadOutlined, EditOutlined, ZoomInOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AssetId, ImageAsset } from '@/editor/types'

interface ImageAssetStripProps {
  assets: ImageAsset[]
  selectedAssetId?: AssetId
  /**
   * next-input：选中结果作为下一轮输入；
   * inpaint-result：本次结果作为原图；
   * outpaint-result：本次结果已在扩图画布中显示，可继续扩图；
   * result：本次结果在主舞台预览。裂变结果改用网格组件。
   */
  variant?: 'next-input' | 'inpaint-result' | 'outpaint-result' | 'result'
  /** grid：多结果并排对比，卡片放大；默认横向候选条。 */
  layout?: 'strip' | 'grid'
  downloadingAssetId?: AssetId
  downloadingAll?: boolean
  onSelect: (assetId: AssetId) => void
  onDownload?: (asset: ImageAsset, index: number) => void
  onPreview: (assetId: AssetId) => void
  onDownloadAll?: () => void
  /** 在选中结果上继续编辑；仅精修传入，且选中结果不是当前输入时才显示。 */
  onContinue?: (asset: ImageAsset) => void
  continueLabel?: string
  continueDisabled?: boolean
}

/** 生成结果候选条；选中项的含义由 variant 决定。 */
export default function ImageAssetStrip({
  assets,
  selectedAssetId,
  variant = 'next-input',
  layout = 'strip',
  downloadingAssetId,
  downloadingAll = false,
  onSelect,
  onDownload,
  onPreview,
  onDownloadAll,
  onContinue,
  continueLabel,
  continueDisabled = false,
}: ImageAssetStripProps) {
  const { t } = useTranslation('workstation')
  if (assets.length === 0) return null
  const resolvedContinueLabel = continueLabel ?? t('results.continueEdit')
  const selectedIndex = assets.findIndex(asset => asset.id === selectedAssetId)
  const inpaintResult = variant === 'inpaint-result'
  const outpaintResult = variant === 'outpaint-result'
  const plainResult = variant === 'result'
  const grid = layout === 'grid'
  const hint = selectedIndex >= 0
    ? inpaintResult
      ? t('results.strip.hints.selectedInpaint', { index: selectedIndex + 1 })
      : outpaintResult
        ? t('results.strip.hints.selectedOutpaint', { index: selectedIndex + 1 })
        : plainResult
          ? t('results.strip.hints.selectedResult', { index: selectedIndex + 1 })
          : t('results.strip.hints.selectedNextInput', { index: selectedIndex + 1 })
    : inpaintResult
      ? t('results.strip.hints.unselectedInpaint')
      : outpaintResult
        ? t('results.strip.hints.unselectedOutpaint')
        : plainResult
          ? grid
            ? t('results.strip.hints.unselectedResultGrid')
            : t('results.strip.hints.unselectedResult')
          : t('results.strip.hints.unselectedNextInput')
  const badge = inpaintResult
    ? t('results.strip.badges.inpaint')
    : outpaintResult
      ? t('results.strip.badges.outpaint')
      : plainResult
        ? t('results.strip.badges.result')
        : t('results.strip.badges.nextInput')
  const resultLabel = inpaintResult || outpaintResult || plainResult
    ? t('results.strip.itemResult')
    : t('results.strip.itemCandidate')
  const stripLabel = inpaintResult || outpaintResult || plainResult
    ? t('results.strip.titleResult')
    : t('results.strip.titleCandidate')
  const selectedSuffix = inpaintResult
    ? t('results.strip.selectedSuffix.inpaint')
    : outpaintResult
      ? t('results.strip.selectedSuffix.outpaint')
      : plainResult
        ? t('results.strip.selectedSuffix.result')
        : t('results.strip.selectedSuffix.nextInput')

  return (
    <div className="workstation-result-strip" role="group" aria-label={stripLabel}>
      <div className={`workstation-result-strip-head${grid ? ' is-grid' : ''}`}>
        <span className="workstation-result-strip-title">{stripLabel}</span>
        {grid ? (
          <span className="workstation-result-count">
            {t(assets.length === 1 ? 'results.countOne' : 'results.countOther', { count: assets.length })}
          </span>
        ) : null}
        <span className="workstation-result-strip-hint">{hint}</span>
        {(onContinue && selectedIndex >= 0) || (grid && assets.length > 1 && onDownloadAll) ? (
          <span className="workstation-result-strip-actions">
            {onContinue && selectedIndex >= 0 ? (
              <Button
                className="workstation-result-continue"
                size="small"
                icon={<EditOutlined aria-hidden="true" />}
                disabled={continueDisabled}
                onClick={() => onContinue(assets[selectedIndex])}
              >
                {resolvedContinueLabel}
              </Button>
            ) : null}
            {grid && assets.length > 1 && onDownloadAll ? (
              <Button
                className="workstation-result-download-all"
                size="small"
                icon={<DownloadOutlined aria-hidden="true" />}
                loading={downloadingAll}
                onClick={onDownloadAll}
              >
                {t('results.downloadAll')}
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className={`workstation-result-list${grid ? ' is-grid' : ''}`} role="list">
        {assets.map((asset, index) => {
          const selected = asset.id === selectedAssetId
          return (
            <div
              key={asset.id}
              role="listitem"
              className={`workstation-result-item${selected ? ' is-selected' : ''}`}
            >
              <button
                type="button"
                className="workstation-result-thumb"
                aria-label={t('results.strip.selectAria', {
                  label: resultLabel,
                  index: index + 1,
                  suffix: selected ? selectedSuffix : '',
                })}
                aria-pressed={selected}
                onClick={() => onSelect(asset.id)}
              >
                <img src={asset.url} alt={t('results.strip.itemAlt', { label: resultLabel, index: index + 1 })} />
                <span className="workstation-result-index" aria-hidden="true">{index + 1}</span>
                {selected ? <span className="workstation-result-badge">{badge}</span> : null}
              </button>
              <div className="workstation-result-actions">
                <Button
                  className="preview-zoom-button"
                  size="small"
                  type="text"
                  icon={<ZoomInOutlined />}
                  aria-label={t('results.strip.zoomAria', { label: resultLabel, index: index + 1 })}
                  onClick={() => onPreview(asset.id)}
                />
                {onDownload ? (
                  <Button
                    className="workstation-result-download"
                    size="small"
                    type="text"
                    icon={<DownloadOutlined />}
                    aria-label={t('results.strip.downloadAria', { label: resultLabel, index: index + 1 })}
                    loading={downloadingAssetId === asset.id}
                    onClick={(event) => {
                      event.stopPropagation()
                      onDownload(asset, index)
                    }}
                  />
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
