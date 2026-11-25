import { Button } from 'antd'
import { IMAGE_EXAMPLE_PROMPTS, VIDEO_EXAMPLE_PROMPTS } from './emptyStatePrompts'

interface CanvasEmptyStateProps {
  /** 随生成模式切换引导和示例 */
  mode?: 'image' | 'video'
  onUsePrompt: (prompt: string) => void
  onFocusPrompt: () => void
  onPickAsset: () => void
}

/**
 * 画板为空时的引导。放在画布中央，代替过去的"预置示例图片"：
 * 新人第一眼看到的应该是"写一句描述就能生成"，而不是一张要删掉的假图。
 */
export default function CanvasEmptyState({ mode = 'image', onUsePrompt, onFocusPrompt, onPickAsset }: CanvasEmptyStateProps) {
  const isVideo = mode === 'video'
  const prompts = isVideo ? VIDEO_EXAMPLE_PROMPTS : IMAGE_EXAMPLE_PROMPTS
  const title = isVideo ? '写一句描述，就能生成第一条视频' : '写一句描述，就能生成第一张图'
  const note = isVideo
    ? '描述主体动作或镜头运动，成片会出现在当前视野中央。'
    : '结果会落在当前视野中央，之后可以拖动、复制，或继续裂变、做视频。'
  return (
    <div className="free-canvas-empty">
      <p className="free-canvas-empty-kicker">空白画布</p>
      <h2>{title}</h2>
      <p className="free-canvas-empty-note">{note}</p>
      <div className="free-canvas-empty-prompts" role="group" aria-label="示例画面描述">
        {prompts.map((prompt) => (
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
