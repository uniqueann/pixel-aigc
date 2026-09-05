import { Button, Slider, Space, Tooltip } from 'antd'
import {
  AimOutlined,
  ClearOutlined,
  DeleteOutlined,
  EditOutlined,
  RedoOutlined,
  UndoOutlined,
} from '@ant-design/icons'

export type PaintTool = 'brush' | 'eraser'

interface Props {
  brushSize: number
  tool: PaintTool
  smartSelectEnabled: boolean
  canUndo: boolean
  canRedo: boolean
  onBrushSizeChange: (size: number) => void
  onToolChange: (tool: PaintTool) => void
  onSmartSelectToggle: () => void
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
}

export default function BrushToolbar({
  brushSize,
  tool,
  smartSelectEnabled,
  canUndo,
  canRedo,
  onBrushSizeChange,
  onToolChange,
  onSmartSelectToggle,
  onUndo,
  onRedo,
  onClear,
}: Props) {
  return (
    <Space
      size={6}
      wrap
      style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--color-surface)', boxShadow: '0 4px 16px #0006' }}
    >
      <Tooltip title="画笔">
        <Button
          aria-label="画笔"
          type={tool === 'brush' && !smartSelectEnabled ? 'primary' : 'text'}
          icon={<EditOutlined />}
          onClick={() => onToolChange('brush')}
        />
      </Tooltip>
      <Tooltip title="橡皮擦">
        <Button
          aria-label="橡皮擦"
          type={tool === 'eraser' && !smartSelectEnabled ? 'primary' : 'text'}
          icon={<DeleteOutlined />}
          onClick={() => onToolChange('eraser')}
        />
      </Tooltip>
      <Tooltip title="点击画布创建智能选区">
        <Button
          aria-label="智能选区"
          type={smartSelectEnabled ? 'primary' : 'text'}
          icon={<AimOutlined />}
          onClick={onSmartSelectToggle}
        />
      </Tooltip>
      <span style={{ width: 84, padding: '0 8px' }}>
        <Slider
          aria-label="笔刷大小"
          min={4}
          max={80}
          value={brushSize}
          onChange={onBrushSizeChange}
          tooltip={{ formatter: (value) => `${value}px` }}
        />
      </span>
      <Tooltip title="撤销">
        <Button aria-label="撤销" type="text" icon={<UndoOutlined />} disabled={!canUndo} onClick={onUndo} />
      </Tooltip>
      <Tooltip title="重做">
        <Button aria-label="重做" type="text" icon={<RedoOutlined />} disabled={!canRedo} onClick={onRedo} />
      </Tooltip>
      <Tooltip title="清空蒙版">
        <Button aria-label="清空蒙版" type="text" danger icon={<ClearOutlined />} onClick={onClear} />
      </Tooltip>
    </Space>
  )
}
