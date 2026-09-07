import type { AssetId, ImageAsset } from '@/editor/types'

interface ImageAssetStripProps {
  assets: ImageAsset[]
  selectedAssetId?: AssetId
  onSelect: (assetId: AssetId) => void
}

/** 智能编辑生成结果候选条，选中的结果会成为下一次编辑输入。 */
export default function ImageAssetStrip({ assets, selectedAssetId, onSelect }: ImageAssetStripProps) {
  if (assets.length === 0) return null

  return (
    <div className="workstation-result-strip" aria-label="智能编辑候选结果">
      <span>候选结果</span>
      <div className="workstation-result-list">
        {assets.map((asset, index) => (
          <button
            type="button"
            key={asset.id}
            className={`workstation-result-item${asset.id === selectedAssetId ? ' is-selected' : ''}`}
            aria-label={`选择候选结果 ${index + 1}`}
            aria-pressed={asset.id === selectedAssetId}
            onClick={() => onSelect(asset.id)}
          >
            <img src={asset.url} alt={`候选结果 ${index + 1}`} />
          </button>
        ))}
      </div>
    </div>
  )
}
