import { Button } from 'antd'
import { EXAMPLE_PROMPTS } from './emptyStatePrompts'

interface CanvasEmptyStateProps {
  onUsePrompt: (prompt: string) => void
  onFocusPrompt: () => void
  onPickAsset: () => void
}

/**
 * 画板为空时的引导。放在画布中央，代替过去的"预置示例图片"：
 * 新人第一眼看到的应该是"写一句描述就能生成"，而不是一张要删掉的假图。
 */
export default function CanvasEmptyState({ onUsePrompt, onFocusPrompt, onPickAsset }: CanvasEmptyStateProps) {
  return (
    <div className="free-canvas-empty">
      <p className="free-canvas-empty-kicker">空白画布</p>
      <h2>写一句描述，就能生成第一张图</h2>
      <p className="free-canvas-empty-note">结果会落在画板中央，之后可以拖动、复制，或继续裂变、做视频。</p>
      <div className="free-canvas-empty-prompts" role="group" aria-label="示例画面描述">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <button key={prompt} type="button" className="free-canvas-empty-prompt" onClick={() => onUsePrompt(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
      <div className="free-canvas-empty-actions">
        <Button type="primary" size="small" onClick={onFocusPrompt}>去填写描述</Button>
        <Button size="small" onClick={onPickAsset}>添加图片</Button>
      </div>
      <p className="free-canvas-empty-hint">也可以把图片直接拖进画布 · ⌘D 复制 · 方向键微调 · ⌘A 全选 · 图层面板找回被盖住的内容</p>
    </div>
  )
}
