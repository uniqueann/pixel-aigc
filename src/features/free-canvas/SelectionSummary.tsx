import { useTranslation } from 'react-i18next'
import { CopyOutlined, DeleteOutlined } from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
import type { Asset, EditorNode } from '@/editor/types'

interface SelectionSummaryProps {
  nodes: EditorNode[]
  assets: Record<string, Asset>
  canDuplicate: boolean
  canDelete: boolean
  blockedReason?: string
  onDuplicate: () => void
  onDelete: () => void
  onClearSelection: () => void
}

const TYPE_KEYS = {
  image: 'selectionSummary.types.image',
  video: 'selectionSummary.types.video',
  generation: 'selectionSummary.types.generation',
  text: 'selectionSummary.types.text',
  shape: 'selectionSummary.types.shape',
} as const

function sizeSummary(nodes: EditorNode[]) {
  const sizes = nodes.map((node) => ({ width: Math.round(node.width), height: Math.round(node.height) }))
  const key = ({ width, height }: { width: number; height: number }) => width * height
  const smallest = sizes.reduce((min, size) => key(size) < key(min) ? size : min)
  const largest = sizes.reduce((max, size) => key(size) > key(max) ? size : max)
  const format = ({ width, height }: { width: number; height: number }) => `${width}×${height}`
  return key(smallest) === key(largest) ? format(largest) : `${format(smallest)} – ${format(largest)}`
}

/** 多选时的右栏：只保留批量操作与选择集摘要，生成表单在单选时才有意义。 */
export default function SelectionSummary({
  nodes,
  assets,
  canDuplicate,
  canDelete,
  blockedReason,
  onDuplicate,
  onDelete,
  onClearSelection,
}: SelectionSummaryProps) {
  const { t } = useTranslation('canvas')
  const withAsset = nodes.filter((node) => node.type === 'image' || node.type === 'video')
  const missingAssets = withAsset.filter((node) => {
    const asset = assets[node.assetId]
    return !asset || asset.missing
  }).length
  const counts = new Map<EditorNode['type'], number>()
  for (const node of nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1)
  const typeText = [...counts.entries()]
    .map(([type, count]) => t(TYPE_KEYS[type as keyof typeof TYPE_KEYS], { count }))
    .join(' · ')

  return (
    <aside className="free-canvas-generation-panel free-canvas-selection-panel" aria-label={t('selectionSummary.aria')}>
      <div>
        <h2>{t('selectionSummary.selectedCount', { count: nodes.length })}</h2>
        <p>{t('selectionSummary.description')}</p>
      </div>
      <dl className="free-canvas-selection-summary">
        <div><dt>{t('selectionSummary.typeLabel')}</dt><dd>{typeText}</dd></div>
        <div><dt>{t('selectionSummary.sizeLabel')}</dt><dd>{sizeSummary(nodes)}</dd></div>
        {missingAssets > 0 && <div><dt>{t('selectionSummary.assetLabel')}</dt><dd>{t('selectionSummary.missingAssets', { count: missingAssets })}</dd></div>}
      </dl>
      {blockedReason && <p className="free-canvas-selection-blocked" role="status">{blockedReason}</p>}
      <div className="free-canvas-selection-actions">
        <Tooltip title={canDuplicate ? t('selectionSummary.duplicateTooltip') : blockedReason ?? t('selectionSummary.duplicateBlocked')}>
          <span>
            <Button block icon={<CopyOutlined />} disabled={!canDuplicate} onClick={onDuplicate}>{t('selectionSummary.duplicate')}</Button>
          </span>
        </Tooltip>
        <Tooltip title={canDelete ? t('selectionSummary.deleteTooltip') : blockedReason ?? t('selectionSummary.deleteBlocked')}>
          <span>
            <Button block danger icon={<DeleteOutlined />} disabled={!canDelete} onClick={onDelete}>{t('selectionSummary.delete')}</Button>
          </span>
        </Tooltip>
      </div>
      <button type="button" className="free-canvas-selection-clear" onClick={onClearSelection}>
        {t('selectionSummary.clearSelection')}
      </button>
    </aside>
  )
}
