// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultImageModel, IMAGE_MODEL_PROFILES, publicImageModel } from '@shared/image-models'
import { PROMPT_MAX_LENGTH } from '@shared/prompt-limits'
import { createImageAsset } from '@/editor/services/assetService'
import { useEditorStore } from '@/editor/store'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import type { GenerationRecovery } from '@/editor/persistence/types'
import { Capability, type GenerationTask, type TextToImageTaskParams } from '@/types'
import { useUserStore } from '@/store/useUserStore'
import GenerationPanel from './GenerationPanel'
import { buildTextToVideoRequest } from './requestBuilder'
import { IMAGE_SIZE_PRESETS } from './config'

const model = publicImageModel(defaultImageModel('text_to_image')!)
const qwen = publicImageModel(IMAGE_MODEL_PROFILES.find(item => item.id === 'bailian:qwen-image-3.0')!)
const failedTask: GenerationTask<TextToImageTaskParams> = {
  id: 'task', capability: Capability.TextToImage, modelProfileId: model.id,
  params: { prompt: '森林', size: { width: 2048, height: 1152 }, count: 2, resolution: '2k' },
  status: 'failed', creditsCost: 0, createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z',
}

function renderPanel(props: Partial<Parameters<typeof GenerationPanel>[0]> = {}) {
  return render(<GenerationPanel mode="text-to-image" prompt="森林" presetKey="1:1" count={1} durationSeconds={5}
    submitting={false} active={false} formLocked={false} polling={false}
    onPromptChange={() => undefined} onPresetChange={() => undefined} onCountChange={() => undefined}
    onDurationChange={() => undefined} onGenerate={() => undefined} onRetry={() => undefined}
    onModifyParameters={() => undefined} onRefetch={() => undefined}
    models={[model]} modelProfileId={model.id} resolution="2k" estimatedCredits={3} mockGateway={false} {...props} />)
}

function rememberRetry(task: GenerationTask<TextToImageTaskParams>, modelProfileId: string): GenerationRecovery {
  const project = useEditorStore.getState().createProject('重试报价')
  return {
    projectId: project.id,
    sceneId: project.document.activeSceneId,
    request: { capability: Capability.TextToImage, requestId: 'retry-request', modelProfileId, params: task.params },
    context: { inputAssetIds: [], autoRetryRemaining: 0, automaticRetry: false },
    placements: [],
    replacedPlaceholderIds: [],
    backendTaskId: task.id,
    applied: false,
  }
}

describe('自由画布文生图侧栏', () => {
  beforeEach(() => useUserStore.setState({ userId: '11111111-1111-4111-8111-111111111111' }))
  afterEach(() => {
    cleanup()
    useUserStore.setState({ userId: null })
    usePersistenceStore.setState({ recoveries: {} })
  })

  it('配置加载期间阻止生成，完成后按有效分辨率展示积分', () => {
    const { rerender } = renderPanel({ modelsLoading: true, generateDisabled: true })
    expect(screen.getByText('正在加载文生图模型配置…')).toBeTruthy()
    expect((screen.getByRole('button', { name: /^生成到画布 ·/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText('文生图模型尚未就绪，请检查登录与模型配置。')).toBeNull()
    rerender(<GenerationPanel mode="text-to-image" prompt="森林" presetKey="1:1" count={2} durationSeconds={5}
      submitting={false} active={false} formLocked={false} polling={false}
      onPromptChange={() => undefined} onPresetChange={() => undefined} onCountChange={() => undefined}
      onDurationChange={() => undefined} onGenerate={() => undefined} onRetry={() => undefined}
      onModifyParameters={() => undefined} onRefetch={() => undefined} models={[model]} modelProfileId={model.id}
      resolution="2k" estimatedCredits={6} resolutionAdjusted mockGateway={false} />)
    expect(screen.getByText('当前模型或画面比例不支持所选分辨率，已按 2K 计算本次参数与积分。')).toBeTruthy()
    expect(screen.getByText('本次预计预扣 6 积分，按实际成功张数结算。失败后由你决定是否再次生成。')).toBeTruthy()
  })

  it('缺少报价时显示重读提示，不伪装成免费生成', () => {
    renderPanel({ estimatedCredits: undefined, generateDisabled: true })
    expect(screen.getByText('模型积分报价尚未就绪，请重新读取文生图配置。')).toBeTruthy()
    expect((screen.getByRole('button', { name: /^生成到画布 ·/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(/预计预扣 0 积分/)).toBeNull()
  })

  it('模型列表未返回时仍按共享上限显示字数', () => {
    renderPanel({ models: [], modelProfileId: undefined, prompt: '' })
    expect(screen.getByText(`0 / ${PROMPT_MAX_LENGTH}`)).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: '生成数量' })).toBeTruthy()
  })

  it('文生视频画面描述按共享上限计数', () => {
    renderPanel({ mode: 'text-to-video', prompt: '', videoConfigured: true })
    expect(screen.getByText(`0 / ${PROMPT_MAX_LENGTH}`)).toBeTruthy()
  })

  it('恢复的超长提示词被模型长度限制阻止提交', () => {
    renderPanel({ prompt: '图'.repeat(11), models: [{ ...model, ui: { ...model.ui, promptMaxLength: 10 } }] })
    expect((screen.getByRole('button', { name: /^生成到画布 ·/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('只有千问模型显示自动扩写，默认关闭', () => {
    renderPanel()
    expect(screen.queryByRole('switch', { name: '自动扩写' })).toBeNull()
    cleanup()
    const onChange = vi.fn()
    renderPanel({ models: [qwen], modelProfileId: qwen.id, estimatedCredits: 3, onThinkingChange: onChange })
    expect(screen.getByText('开启后模型会自动丰富画面描述，生成约慢 3 倍，可能加入未要求的内容')).toBeTruthy()
    const toggle = screen.getByRole('switch', { name: '自动扩写' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(onChange.mock.calls[0]?.[0]).toBe(true)
    cleanup()
    renderPanel({ models: [qwen], modelProfileId: qwen.id, enableThinking: true })
    expect(screen.getByRole('switch', { name: '自动扩写' }).getAttribute('aria-checked')).toBe('true')
  })

  it('手动重试展示原请求参数的数量和积分，而不套用当前草稿', () => {
    const retry = vi.fn()
    renderPanel({ task: failedTask, count: 1, resolution: '1k', estimatedCredits: 2, onRetry: retry })
    expect(screen.getByText('手动重试将按原参数创建新任务，生成 2 张，预计预扣 6 积分。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '按原参数重试 2 张 · 6 积分' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('部分成功按真实序号预览运行时图片，云端更换对象键后仍可独立补存历史', () => {
    const retrySave = vi.fn()
    const task = { ...failedTask, status: 'succeeded' as const, creditsCost: 3,
      resultImages: [{ url: 'https://expired.example/image.png', width: 2048, height: 1152, mimeType: 'image/png', objectKey: 'users/owner/image.png', ordinal: 1 }],
    }
    const asset = createImageAsset({ id: 'asset:task:o1', name: '结果', url: 'blob:runtime-result', width: 2048, height: 1152, objectKey: 'media/cloud-copy.png' })
    renderPanel({ task, resultAssets: { [asset.id]: asset }, historyError: '写入失败', onRetrySave: retrySave })
    expect(screen.getByText('成功 1 / 2 张图片，实际消耗 3 积分')).toBeTruthy()
    expect(screen.getByAltText('生成结果 2').getAttribute('src')).toBe('blob:runtime-result')
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }))
    expect(retrySave).toHaveBeenCalledTimes(1)
  })

  it('未开放的视频只显示公告，不暴露表单和报价', () => {
    renderPanel({ mode: 'text-to-video', generateDisabled: true, estimatedCredits: undefined })
    expect(screen.getByText('视频生成即将上线。')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('switch', { name: '生成声音' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^生成视频到画布/ })).toBeNull()
    expect(screen.queryByText(/积分预估|预计消耗|检查登录与服务/)).toBeNull()
  })

  it('刷新后失败任务丢掉模型编号时，仍按恢复记录里的原模型报价并允许重试', () => {
    const qwenPro = publicImageModel(IMAGE_MODEL_PROFILES.find(item => item.id === 'bailian:qwen-image-3.0-pro')!)
    const reloaded = { ...failedTask, modelProfileId: undefined, params: { ...failedTask.params, count: 1, resolution: '2k' as const } }
    const retry = vi.fn()
    usePersistenceStore.setState({ recoveries: { 'retry-request': rememberRetry(reloaded, qwenPro.id) } })
    renderPanel({
      task: reloaded, count: 4, resolution: '1k', estimatedCredits: 2, onRetry: retry,
      models: [model, qwenPro], modelProfileId: model.id,
    })
    expect(screen.getByText('本次预计预扣 2 积分，按实际成功张数结算。失败后由你决定是否再次生成。')).toBeTruthy()
    expect(screen.getByText('手动重试将按原参数创建新任务，生成 1 张，预计预扣 8 积分。')).toBeTruthy()
    expect(screen.queryByText('原模型报价暂不可用，请修改参数后重新生成。')).toBeNull()
    expect(screen.queryByText('报价暂不可用，请重新加载。')).toBeNull()
    const button = screen.getByRole('button', { name: '按原参数重试 1 张 · 8 积分' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('刷新后原模型已不在报价列表时，不借用当前草稿模型', () => {
    const reloaded = { ...failedTask, modelProfileId: undefined }
    const retry = vi.fn()
    usePersistenceStore.setState({ recoveries: { 'retry-request': rememberRetry(reloaded, 'removed-model') } })
    renderPanel({ task: reloaded, onRetry: retry })
    expect(screen.getByText(/原模型报价暂不可用/)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('报价暂不可用，请重新加载。')
    const button = screen.getByRole('button', { name: /按原参数重试 2 张.*报价暂不可用/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(retry).not.toHaveBeenCalled()
    expect(screen.queryByText(/预计预扣 6 积分/)).toBeNull()
  })

  it('原模型不在报价列表中时禁止收费重试', () => {
    const retry = vi.fn()
    renderPanel({ task: { ...failedTask, modelProfileId: 'removed-model' }, onRetry: retry })
    const button = screen.getByRole('button', { name: /按原参数重试 2 张.*报价暂不可用/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(retry).not.toHaveBeenCalled()
  })

  it('关闭视频入口后仍保留原任务查询，不提供新生成或收费重试', () => {
    const refetch = vi.fn()
    const request = buildTextToVideoRequest('镜头缓慢推进', IMAGE_SIZE_PRESETS[0], 5)
    const task = { ...failedTask, capability: Capability.TextToVideo, params: request.params, status: 'processing' as const }
    renderPanel({ mode: 'text-to-video', task, active: true, formLocked: true, videoAvailability: 'soon', pollError: new Error('暂时断网'), onRefetch: refetch })
    expect(screen.getByText('视频生成即将上线。')).toBeTruthy()
    expect(screen.getByText('任务仍然保留，可以重新查询同一任务。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^生成视频到画布|按原参数重试/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重新查询' }))
    expect(refetch).toHaveBeenCalledOnce()
  })
})
