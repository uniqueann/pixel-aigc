// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultImageModel, publicImageModel } from '@shared/image-models'
import { createImageAsset } from '@/editor/services/assetService'
import { Capability, type GenerationTask, type TextToImageTaskParams } from '@/types'
import { useUserStore } from '@/store/useUserStore'
import GenerationPanel from './GenerationPanel'

const model = publicImageModel(defaultImageModel('text_to_image')!)
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

describe('自由画布文生图侧栏', () => {
  beforeEach(() => useUserStore.setState({ userId: '11111111-1111-4111-8111-111111111111' }))
  afterEach(() => { cleanup(); useUserStore.setState({ userId: null }) })

  it('配置加载期间阻止生成，完成后按有效分辨率展示积分', () => {
    const { rerender } = renderPanel({ modelsLoading: true, generateDisabled: true })
    expect(screen.getByText('正在加载文生图模型配置…')).toBeTruthy()
    expect((screen.getByRole('button', { name: '生成到画布' }) as HTMLButtonElement).disabled).toBe(true)
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
    expect((screen.getByRole('button', { name: '生成到画布' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(/预计预扣 0 积分/)).toBeNull()
  })

  it('恢复的超长提示词被模型长度限制阻止提交', () => {
    renderPanel({ prompt: '图'.repeat(11), models: [{ ...model, ui: { ...model.ui, promptMaxLength: 10 } }] })
    expect((screen.getByRole('button', { name: '生成到画布' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('手动重试展示原请求参数的数量和积分，而不套用当前草稿', () => {
    const retry = vi.fn()
    renderPanel({ task: failedTask, count: 1, resolution: '1k', estimatedCredits: 2, onRetry: retry })
    expect(screen.getByText('手动重试将按原参数创建新任务，生成 2 张，预计预扣 6 积分。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '按原参数重试 2 张' }))
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

  it('未开放的视频禁用提交，并保留时长和声音设置', () => {
    renderPanel({ mode: 'text-to-video', generateDisabled: true })
    expect(screen.getByText('视频生成尚未开放，请检查登录与服务配置。')).toBeTruthy()
    expect((screen.getByRole('button', { name: '生成视频到画布' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('combobox', { name: '文生图模型' })).toBeNull()
    expect(screen.getByText('10 秒')).toBeTruthy()
    expect(screen.getByRole('switch', { name: '生成声音' }).getAttribute('aria-checked')).toBe('false')
  })
})
