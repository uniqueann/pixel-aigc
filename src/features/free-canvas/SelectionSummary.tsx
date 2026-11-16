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

const TYPE_LABELS: Record<string, string> = {
  image: '张图片',
  video: '段视频',
  generation: '个生成占位',
  text: '个文本',
  shape: '个形状',
}

function typeSummary(nodes: EditorNode[]) {
  const counts = new Map<EditorNode['type'], number>()
  for (const node of nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1)
  return [...counts.entries()]
    .map(([type, count]) => `${count} ${TYPE_LABELS[type]}`)
    .join(' · ')
}

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
  const withAsset = nodes.filter((node) => node.type === 'image' || node.type === 'video')
  const missingAssets = withAsset.filter((node) => {
    const asset = assets[node.assetId]
    return !asset || asset.missing
  }).length

  return (
    <aside className="free-canvas-generation-panel free-canvas-selection-panel" aria-label="多选操作">
      <div>
        <h2>已选 {nodes.length} 项</h2>
        <p>多选用于移动、缩放、复制、层级与删除；生成参数在单选时显示。</p>
      </div>
      <dl className="free-canvas-selection-summary">
        <div><dt>类型</dt><dd>{typeSummary(nodes)}</dd></div>
        <div><dt>尺寸</dt><dd>{sizeSummary(nodes)}</dd></div>
        {missingAssets > 0 && <div><dt>素材</dt><dd>{missingAssets} 个不可用</dd></div>}
      </dl>
      {blockedReason && <p className="free-canvas-selection-blocked" role="status">{blockedReason}</p>}
      <div className="free-canvas-selection-actions">
        <Tooltip title={canDuplicate ? '复制所选（⌘/Ctrl+D）' : blockedReason ?? '所选内容无法复制'}>
          <span>
            <Button block icon={<CopyOutlined />} disabled={!canDuplicate} onClick={onDuplicate}>复制</Button>
          </span>
        </Tooltip>
        <Tooltip title={canDelete ? '删除所选（Delete）' : blockedReason ?? '所选内容无法删除'}>
          <span>
            <Button block danger icon={<DeleteOutlined />} disabled={!canDelete} onClick={onDelete}>删除</Button>
          </span>
        </Tooltip>
      </div>
      <button type="button" className="free-canvas-selection-clear" onClick={onClearSelection}>
        取消选择（Esc）
      </button>
    </aside>
  )
}
