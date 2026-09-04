import { Segmented } from 'antd'
import type { InteractionMode } from '../tools'

interface Props {
  interactionMode: InteractionMode
}

/**
 * 中间画布区。不同交互模式渲染不同的工具条：
 * - mask-paint（消除/重绘）：需要画笔工具条，用 fabric.js 的 FreeDrawingBrush 实现蒙版涂抹
 * - drag-resize（扩图）：需要可拖拽的扩展边框
 * - multi-source（融合）：需要多图上传网格
 * - light-control（打光）：需要方向/强度控件叠加在画布上
 * - params-only：画布只做原图/效果对比展示
 * 具体实现见后续迭代，这里先占位。
 */
export default function CanvasArea({ interactionMode }: Props) {
  return (
    <div
      style={{
        flex: 1,
        border: '1px dashed var(--color-border-strong)',
        borderRadius: 10,
        background: 'var(--color-canvas)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        position: 'relative',
      }}
    >
      <div style={{ position: 'absolute', top: 12 }}>
        <Segmented options={['原图', '效果']} />
      </div>
      <div style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
        画布区（当前交互模式：{interactionMode}）
      </div>
      {interactionMode === 'mask-paint' && (
        <div style={{ position: 'absolute', bottom: 12, fontSize: 12, color: 'var(--color-text-muted)' }}>
          TODO: 接入 fabric.js 画笔工具条（笔刷大小 / 橡皮擦 / 智能选区 / 撤销重做）
        </div>
      )}
      {interactionMode === 'drag-resize' && (
        <div style={{ position: 'absolute', bottom: 12, fontSize: 12, color: 'var(--color-text-muted)' }}>
          TODO: 接入可拖拽扩展边框 + 平台尺寸预设（见 constants/platformSizes.ts）
        </div>
      )}
    </div>
  )
}
