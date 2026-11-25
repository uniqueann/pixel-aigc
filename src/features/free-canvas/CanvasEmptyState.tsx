import { Button } from 'antd'
import { useTranslation } from 'react-i18next'
import { IMAGE_EXAMPLE_PROMPTS, VIDEO_EXAMPLE_PROMPTS, localizeExamplePrompt } from './emptyStatePrompts'

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
  const { t } = useTranslation('canvas')
  const isVideo = mode === 'video'
  const prompts = (isVideo ? VIDEO_EXAMPLE_PROMPTS : IMAGE_EXAMPLE_PROMPTS).map(localizeExamplePrompt)
  const title = isVideo ? t('emptyState.videoTitle') : t('emptyState.imageTitle')
  const note = isVideo
    ? t('emptyState.videoNote')
    : t('emptyState.imageNote')
  return (
    <div className="free-canvas-empty">
      <p className="free-canvas-empty-kicker">{t('emptyState.kicker')}</p>
      <h2>{title}</h2>
      <p className="free-canvas-empty-note">{note}</p>
      <div className="free-canvas-empty-prompts" role="group" aria-label={t('emptyState.promptsAria')}>
        {prompts.map((prompt) => (
          <button key={prompt} type="button" className="free-canvas-empty-prompt" onClick={() => onUsePrompt(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
      <div className="free-canvas-empty-actions">
        <Button type="primary" size="small" onClick={onFocusPrompt}>{t('emptyState.focusPrompt')}</Button>
        <Button size="small" onClick={onPickAsset}>{t('emptyState.addImage')}</Button>
      </div>
      <p className="free-canvas-empty-hint">{t('emptyState.hint')}</p>
    </div>
  )
}
