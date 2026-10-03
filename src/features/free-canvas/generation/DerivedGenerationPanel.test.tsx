// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import DerivedGenerationPanel from './DerivedGenerationPanel'

const source = createImageAsset({ id: 'source', name: 'mug.jpg', url: 'data:image/png;base64,aa', width: 800, height: 600 })

function renderPanel(props: Partial<Parameters<typeof DerivedGenerationPanel>[0]> = {}) {
  return render(
    <DerivedGenerationPanel
      mode="variation"
      sourceAsset={source}
      prompt=""
      count={1}
      durationSeconds={5}
      submitting={false}
      autoRetrying={false}
      active={false}
      formLocked={false}
      polling={false}
      onBack={() => undefined}
      onPromptChange={() => undefined}
      onCountChange={() => undefined}
      onDurationChange={() => undefined}
      onGenerate={() => undefined}
      onRetry={() => undefined}
      onModifyParameters={() => undefined}
      onRefetch={() => undefined}
      mockGateway={false}
      estimatedCredits={0}
      {...props}
    />,
  )
}

describe('裂变侧栏能力状态', () => {
  afterEach(() => cleanup())

  it('配置加载中显示加载文案，不显示未就绪错误，源卡片跟随传入素材', () => {
    renderPanel({ generateDisabled: true, modelsLoading: true })
    expect(screen.getByText('正在加载模型配置…')).toBeTruthy()
    expect(screen.queryByText('裂变模型尚未就绪，请检查登录与模型配置。')).toBeNull()
    expect(screen.getByText('mug.jpg')).toBeTruthy()
    expect(screen.getByText('800 × 600')).toBeTruthy()
  })

  it('配置确认不可用后才显示未就绪错误', () => {
    renderPanel({ generateDisabled: true, modelsLoading: false })
    expect(screen.getByText('裂变模型尚未就绪，请检查登录与模型配置。')).toBeTruthy()
    expect(screen.queryByText('正在加载模型配置…')).toBeNull()
  })

  it('图生视频未开放时禁用提交并说明真人素材限制', () => {
    renderPanel({ mode: 'image-to-video', prompt: '镜头推进', generateDisabled: true })
    expect(screen.getByText('视频生成尚未开放，请检查登录与服务配置。')).toBeTruthy()
    expect((screen.getByRole('button', { name: '生成视频' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
