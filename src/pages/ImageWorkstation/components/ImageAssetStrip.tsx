import { DownloadOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import type { AssetId, ImageAsset } from '@/editor/types'

interface ImageAssetStripProps {
  assets: ImageAsset[]
  selectedAssetId?: AssetId
  downloadingAssetId?: AssetId
  onSelect: (assetId: AssetId) => void
  onDownload?: (asset: ImageAsset, index: number) => void
}

/** 智能编辑生成结果候选条，选中的结果会成为下一次编辑输入。 */
export default function ImageAssetStrip({
  assets,
  selectedAssetId,
  downloadingAssetId,
  onSelect,
  onDownload,
}: ImageAssetStripProps) {
  if (assets.length === 0) return null

  return (
    <div className="workstation-result-strip" aria-label="候选结果">
      <span>候选结果</span>
      <div className="workstation-result-list">
        {assets.map((asset, index) => (
          <div
            key={asset.id}
            className={`workstation-result-item${asset.id === selectedAssetId ? ' is-selected' : ''}`}
          >
            <button
              type="button"
              className="workstation-result-thumb"
              aria-label={`选择候选结果 ${index + 1}`}
              aria-pressed={asset.id === selectedAssetId}
              onClick={() => onSelect(asset.id)}
            >
              <img src={asset.url} alt={`候选结果 ${index + 1}`} />
            </button>
            {onDownload ? (
              <Button
                className="workstation-result-download"
                size="small"
                type="text"
                icon={<DownloadOutlined />}
                aria-label={`下载候选结果 ${index + 1}`}
                loading={downloadingAssetId === asset.id}
                onClick={(event) => {
                  event.stopPropagation()
                  onDownload(asset, index)
                }}
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
