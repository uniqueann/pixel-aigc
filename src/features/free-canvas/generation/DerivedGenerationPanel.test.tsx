// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultImageModel, publicImageModel } from '@shared/image-models'
import { createImageAsset } from '@/editor/services/assetService'
import { useEditorStore } from '@/editor/store'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { Capability, type GenerationTask, type VariationTaskParams } from '@/types'
import { useUserStore } from '@/store/useUserStore'
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
  afterEach(() => {
    cleanup()
    usePersistenceStore.setState({ recoveries: {} })
    useUserStore.setState({ userId: null, credits: 0, creditsLoaded: false })
  })

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

  it('图生视频未开放时保留源图，隐藏收费表单', () => {
    renderPanel({ mode: 'image-to-video', prompt: '镜头推进', generateDisabled: true, estimatedCredits: undefined })
    expect(screen.getByText('视频生成即将上线。')).toBeTruthy()
    expect(screen.getByText('mug.jpg')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /^生成/ })).toBeNull()
    expect(screen.queryByText(/积分预估|预计消耗|服务配置/)).toBeNull()
  })

  it('刷新后失败裂变丢掉模型编号时，仍按原模型报价并允许重试', () => {
    const original = publicImageModel(defaultImageModel('variation')!)
    const current = { ...original, id: 'draft-model', label: '当前草稿', pricing: { ...original.pricing, creditsPerImage: { '1k': 9, '2k': 9, '4k': 9 } } }
    const task: GenerationTask<VariationTaskParams> = {
      id: 'variation-task', capability: Capability.Variation,
      params: { prompt: '柔和光线', sourceImageKey: 'owned', count: 2, resolution: '2k', size: { width: 2048, height: 1152 } },
      status: 'failed', creditsCost: 0, createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z',
    }
    const project = useEditorStore.getState().createProject('裂变重试报价')
    const retry = vi.fn()
    usePersistenceStore.setState({
      recoveries: {
        'retry-request': {
          projectId: project.id, sceneId: project.document.activeSceneId,
          request: { capability: Capability.Variation, requestId: 'retry-request', modelProfileId: original.id, params: task.params },
          context: { inputAssetIds: ['source'], autoRetryRemaining: 0, automaticRetry: false },
          placements: [], replacedPlaceholderIds: [], backendTaskId: task.id, applied: false,
        },
      },
    })
    renderPanel({
      task, models: [original, current], modelProfileId: current.id, resolution: '1k', count: 4, estimatedCredits: 9, onRetry: retry,
    })
    expect(screen.getByText('手动重试将按原参数创建新任务，生成 2 张，预计预扣 12 积分。')).toBeTruthy()
    expect(screen.queryByText('原模型报价暂不可用，请修改参数后重新生成。')).toBeNull()
    expect(screen.queryByText('报价暂不可用，请重新加载。')).toBeNull()
    const button = screen.getByRole('button', { name: '按原参数重试 2 张 · 12 积分' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('缺失裂变报价时不显示零积分，并禁止提交', () => {
    renderPanel({ estimatedCredits: undefined })
    expect(screen.queryByText(/预扣 0 积分/)).toBeNull()
    expect((screen.getByRole('button', { name: /生成 \d+ 张.*报价暂不可用/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('只有一个裂变模型时显示名称，多个模型才使用下拉框', () => {
    const only = publicImageModel(defaultImageModel('variation')!)
    const other = { ...only, id: 'other-model', label: '另一个裂变模型' }
    renderPanel({ models: [only], modelProfileId: only.id, estimatedCredits: 4 })
    expect(screen.getByText(only.label)).toBeTruthy()
    expect(screen.queryByRole('combobox', { name: '裂变模型' })).toBeNull()
    cleanup()
    renderPanel({ models: [only, other], modelProfileId: only.id, estimatedCredits: 4 })
    expect(screen.getByRole('combobox', { name: '裂变模型' })).toBeTruthy()
  })

  it('已知余额低于裂变报价时禁用生成，未知余额不拦截', () => {
    const only = publicImageModel(defaultImageModel('variation')!)
    useUserStore.setState({ userId: '11111111-1111-4111-8111-111111111111', credits: 0, creditsLoaded: false })
    const unknown = renderPanel({ models: [only], modelProfileId: only.id, estimatedCredits: 6 })
    expect((screen.getByRole('button', { name: /生成 1 张 · 6 积分/ }) as HTMLButtonElement).disabled).toBe(false)
    expect(unknown.container.textContent).not.toContain('积分不足')
    unknown.unmount()

    useUserStore.setState({ credits: 1, creditsLoaded: true })
    renderPanel({ models: [only], modelProfileId: only.id, estimatedCredits: 6 })
    expect((screen.getByRole('button', { name: /生成 1 张 · 6 积分/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/积分不足，本次需要 6 积分，当前 1/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '去充值' })).toBeTruthy()
  })
})
