// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { SEEDANCE_VIDEO_MODEL, type VideoModelProfile } from '@shared/video-models'
import { createImageAsset } from '@/editor/services/assetService'
import { useUserStore } from '@/store/useUserStore'
import DerivedGenerationPanel from './DerivedGenerationPanel'
import GenerationPanel from './GenerationPanel'
import { videoCreditsForDuration } from './videoCredits'

const PANEL_CSS = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8')
const source = createImageAsset({ id: 'source', name: 'mug.jpg', url: 'data:image/png;base64,aa', width: 800, height: 600 })
const customModel: VideoModelProfile = {
  ...SEEDANCE_VIDEO_MODEL,
  pricing: { version: 'panel-test', creditsPerVideo: { 5: 7, 10: 11 } },
}

function TextVideoPanel({ model, configured = true, generateDisabled = false, mockGateway = false }: {
  model?: VideoModelProfile
  configured?: boolean
  generateDisabled?: boolean
  mockGateway?: boolean
}) {
  const [duration, setDuration] = useState(5)
  const [audio, setAudio] = useState(false)
  return (
    <GenerationPanel
      mode="text-to-video"
      prompt="一杯咖啡冒着热气"
      presetKey="1:1"
      count={1}
      durationSeconds={duration}
      generateAudio={audio}
      onAudioChange={setAudio}
      videoConfigured={configured}
      videoModel={model}
      submitting={false}
      active={false}
      formLocked={false}
      polling={false}
      onPromptChange={() => undefined}
      onPresetChange={() => undefined}
      onCountChange={() => undefined}
      onDurationChange={setDuration}
      onGenerate={() => undefined}
      onRetry={() => undefined}
      onModifyParameters={() => undefined}
      onRefetch={() => undefined}
      estimatedCredits={videoCreditsForDuration(model, duration)}
      generateDisabled={generateDisabled}
      mockGateway={mockGateway}
    />
  )
}

function ImageVideoPanel({ model, configured = true, generateDisabled = false }: {
  model?: VideoModelProfile
  configured?: boolean
  generateDisabled?: boolean
}) {
  const [duration, setDuration] = useState(5)
  const [audio, setAudio] = useState(false)
  return (
    <DerivedGenerationPanel
      mode="image-to-video"
      sourceAsset={source}
      prompt="镜头缓慢推进"
      count={1}
      durationSeconds={duration}
      generateAudio={audio}
      onAudioChange={setAudio}
      videoConfigured={configured}
      videoModel={model}
      submitting={false}
      autoRetrying={false}
      active={false}
      formLocked={false}
      polling={false}
      onBack={() => undefined}
      onPromptChange={() => undefined}
      onCountChange={() => undefined}
      onDurationChange={setDuration}
      onGenerate={() => undefined}
      onRetry={() => undefined}
      onModifyParameters={() => undefined}
      onRefetch={() => undefined}
      estimatedCredits={videoCreditsForDuration(model, duration)}
      mockGateway={false}
      generateDisabled={generateDisabled}
    />
  )
}

function quoteButton(name: string) {
  const estimate = screen.getByText(/预计消耗/)
  const button = screen.getByRole('button', { name: new RegExp(`^${name} ·`) })
  expect(estimate.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  return button as HTMLButtonElement
}

describe('视频面板积分预估', () => {
  afterEach(() => {
    cleanup()
    useUserStore.setState({ userId: null, credits: 0 })
  })

  it.each([
    ['文生视频', TextVideoPanel, '生成视频到画布'],
    ['图生视频', ImageVideoPanel, '生成视频'],
  ] as const)('%s 显示模型报价，切换时长后更新，声音不改变价格', (_label, Panel, buttonName) => {
    useUserStore.setState({ credits: 68 })
    render(<Panel model={customModel} />)
    expect(screen.getByText('预计消耗 7 积分')).toBeTruthy()
    expect(screen.queryByText('积分不足，需要 7 积分，当前 68')).toBeNull()
    expect(quoteButton(buttonName).disabled).toBe(false)
    fireEvent.click(screen.getByRole('switch', { name: '生成声音' }))
    expect(screen.getByRole('switch', { name: '生成声音' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('预计消耗 7 积分')).toBeTruthy()
    expect(screen.queryByText(/预计消耗 11/)).toBeNull()
    fireEvent.click(screen.getByText('10 秒'))
    expect(screen.getByText('预计消耗 11 积分')).toBeTruthy()
    expect(screen.queryByText('预计消耗 7 积分')).toBeNull()
    expect(screen.queryByText(/积分不足/)).toBeNull()
    expect(quoteButton(buttonName).disabled).toBe(false)
  })

  it.each([
    ['文生视频', TextVideoPanel, '生成视频到画布'],
    ['图生视频', ImageVideoPanel, '生成视频'],
  ] as const)('%s 在价格缺失时降级，不显示错误数字', (_label, Panel, buttonName) => {
    useUserStore.setState({ credits: 68 })
    const missing: VideoModelProfile = {
      ...SEEDANCE_VIDEO_MODEL,
      pricing: { version: 'missing', creditsPerVideo: {} as VideoModelProfile['pricing']['creditsPerVideo'] },
    }
    render(<Panel model={missing} />)
    expect(screen.getByText('积分预估暂不可用')).toBeTruthy()
    expect(screen.queryByText(/预计消耗/)).toBeNull()
    expect(screen.queryByText(/积分不足/)).toBeNull()
    expect(screen.queryByText(/undefined|NaN/)).toBeNull()
    expect((screen.getByRole('button', { name: new RegExp(`^${buttonName} ·`) }) as HTMLButtonElement).disabled).toBe(true)
  })

  it.each([
    ['文生视频', TextVideoPanel, '生成视频到画布'],
    ['图生视频', ImageVideoPanel, '生成视频'],
  ] as const)('%s 余额不足时提示并禁用提交，余额足够时不提示', (_label, Panel, buttonName) => {
    useUserStore.setState({ credits: 68 })
    render(<Panel model={SEEDANCE_VIDEO_MODEL} />)
    expect(screen.getByText('预计消耗 50 积分')).toBeTruthy()
    expect(screen.queryByText(/积分不足/)).toBeNull()
    expect((screen.getByRole('button', { name: new RegExp(`^${buttonName} ·`) }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByText('10 秒'))
    expect(screen.getByText('预计消耗 100 积分')).toBeTruthy()
    expect(screen.getByText('积分不足，需要 100 积分，当前 68')).toBeTruthy()
    expect((screen.getByRole('button', { name: new RegExp(`^${buttonName} ·`) }) as HTMLButtonElement).disabled).toBe(true)
  })

  it.each([
    ['文生视频', TextVideoPanel, '生成视频到画布'],
    ['图生视频', ImageVideoPanel, '生成视频'],
  ] as const)('%s 在生成开关关闭时隐藏报价和表单', (_label, Panel, buttonName) => {
    useUserStore.setState({ credits: 68 })
    render(<Panel model={SEEDANCE_VIDEO_MODEL} configured={false} generateDisabled />)
    expect(screen.getByText('视频生成即将上线。')).toBeTruthy()
    expect(screen.queryByText(/预计消耗|有声和无声同价|积分不足/)).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: new RegExp(`^${buttonName}`) })).toBeNull()
  })

  it('模拟模式不显示收费数字，也不因余额为 0 禁用提交', () => {
    useUserStore.setState({ credits: 0 })
    render(<TextVideoPanel model={SEEDANCE_VIDEO_MODEL} mockGateway />)
    expect(screen.getByText('模拟生成，不消耗积分')).toBeTruthy()
    expect(screen.queryByText(/预计消耗/)).toBeNull()
    expect(screen.queryByText(/积分不足/)).toBeNull()
    expect((screen.getByRole('button', { name: /^生成视频到画布 ·/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it.each([390, 320])('%ipx 下面板报价换行且样式不允许横向撑出', (width) => {
    useUserStore.setState({ credits: 68 })
    render(
      <div style={{ width, maxWidth: '100%' }}>
        <TextVideoPanel model={SEEDANCE_VIDEO_MODEL} />
      </div>,
    )
    const panel = document.querySelector('.free-canvas-generation-panel')
    const estimate = screen.getByText('预计消耗 50 积分')
    if (!panel) throw new Error('未渲染视频面板')
    expect(panel.getAttribute('class')).toContain('free-canvas-generation-panel')
    expect(estimate.closest('.free-canvas-generation-panel')).toBe(panel)
    expect((estimate as HTMLElement).style.whiteSpace).not.toBe('nowrap')
    expect(PANEL_CSS).toMatch(/\.free-canvas-generation-panel\s*\{[^}]*max-width:\s*100%/)
    expect(PANEL_CSS).toMatch(/\.free-canvas-generation-panel\s*\{[^}]*min-width:\s*0/)
    expect(PANEL_CSS).toMatch(/\.free-canvas-generation-panel p\s*\{[^}]*overflow-wrap:\s*anywhere/)
    expect(PANEL_CSS).toMatch(/\.free-canvas-generation-panel p\.free-canvas-credit-warning/)
    fireEvent.click(screen.getByText('10 秒'))
    const warning = screen.getByText('积分不足，需要 100 积分，当前 68')
    expect(warning.className).toContain('free-canvas-credit-warning')
    expect((warning as HTMLElement).style.whiteSpace).not.toBe('nowrap')
  })
})
