// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultImageModel, IMAGE_MODEL_PROFILES, publicImageModel } from '@shared/image-models'
import { VIDEO_PROMPT_MAX } from '@shared/prompt-limits'
import { VARIATION_USER_PROMPT_MAX } from '@shared/variation'
import { MINIMAX_H3_VIDEO_MODEL, SEEDANCE_VIDEO_MODEL } from '@shared/video-models'
import { adaptGenerationTask } from '@/editor/adapters/taskAdapter'
import { parseSnapshot } from '@/editor/persistence/snapshot'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { createImageAsset, createVideoAsset } from '@/editor/services/assetService'
import { useEditorStore } from '@/editor/store'
import type { EditorNode, GenerationJob } from '@/editor/types'
import { useLocaleStore } from '@/i18n/store'
import { useUserStore } from '@/store/useUserStore'
import { Capability, type GenerationTask, type TextToImageTaskParams } from '@/types'
import CanvasEmptyState from '@/features/free-canvas/CanvasEmptyState'
import CanvasNoticeBar from '@/features/free-canvas/CanvasNoticeBar'
import SelectionSummary from '@/features/free-canvas/SelectionSummary'
import { IMAGE_EXAMPLE_PROMPTS, VIDEO_EXAMPLE_PROMPTS, localizeExamplePrompt } from '@/features/free-canvas/emptyStatePrompts'
import { ensureFreeCanvasContent } from '@/features/free-canvas/initialize'
import { buildLayerItems } from '@/features/free-canvas/layers'
import { IMAGE_SIZE_PRESETS, getAspectRatioTooltip } from '@/features/free-canvas/generation/config'
import DerivedGenerationPanel from '@/features/free-canvas/generation/DerivedGenerationPanel'
import GenerationPanel from '@/features/free-canvas/generation/GenerationPanel'
import { formatElapsed, placeholderDetail } from '@/features/free-canvas/generation/placeholderCopy'
import {
  buildImageToVideoRequest,
  buildTextToImageRequest,
  buildTextToVideoRequest,
  buildVariationRequest,
} from '@/features/free-canvas/generation/requestBuilder'
import VideoAvailabilityNotice from '@/features/free-canvas/generation/VideoAvailabilityNotice'
import VideoCreditEstimate from '@/features/free-canvas/generation/VideoCreditEstimate'
import VideoGenerationSettings from '@/features/free-canvas/generation/VideoGenerationSettings'
import VideoReplicationPanel from '@/features/free-canvas/generation/VideoReplicationPanel'
import { videoCreditEstimateText, videoCreditShortfallText } from '@/features/free-canvas/generation/videoCredits'
import CanvasAssetPicker from '@/features/free-canvas/images/CanvasAssetPicker'
import CanvasAddImageButton from './CanvasAddImageButton'
import { CANVAS_MODES, VIDEO_REPLICATION_MODE, canvasModeLabel } from './modes'

vi.mock('@/cloud/client', () => ({ authEnabled: false, cloudEnabled: false }))
vi.mock('@/features/assets/workstationHistory', () => ({
  HISTORY_CHANGED: 'pixel-history-changed',
  listHistoryPreviews: vi.fn(async () => []),
}))
vi.mock('@/features/assets/hydrateImageJobs', () => ({
  hydrateWorkstationHistoryFromImageJobs: vi.fn(async () => ({ failed: 0 })),
}))
vi.mock('@/editor/persistence/projectPersistence', () => ({
  initializePersistence: vi.fn(async () => undefined),
  acquireEditLock: vi.fn(async () => true),
  releaseEditLock: vi.fn(async () => undefined),
  reclaimEditAccess: vi.fn(async () => undefined),
  restartAfterLoadError: vi.fn(async () => undefined),
  downloadJson: vi.fn(),
}))

import PersistenceGate from '@/editor/persistence/PersistenceGate'

const CJK_RE = /[\u4e00-\u9fff]/

function assertNoCjkInDom(container: HTMLElement) {
  expect(container.textContent ?? '').not.toMatch(CJK_RE)
  for (const el of container.querySelectorAll('[aria-label], [aria-valuetext], [title], [alt], [placeholder]')) {
    for (const attr of ['aria-label', 'aria-valuetext', 'title', 'alt', 'placeholder']) {
      const value = el.getAttribute(attr)
      if (value) expect(value).not.toMatch(CJK_RE)
    }
  }
}

const sampleImage = createImageAsset({
  id: 'asset:img-1',
  name: 'product.png',
  url: 'data:image/png;base64,aa',
  width: 1024,
  height: 1024,
})

const sampleVideo = createVideoAsset({
  id: 'asset:vid-1',
  name: 'clip.mp4',
  url: 'https://example.com/clip.mp4',
  width: 1280,
  height: 720,
  duration: 5,
})

beforeEach(async () => {
  if (typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })
  }
  useUserStore.setState({ userId: 'u1', credits: 10, creditsLoaded: true })
  useEditorStore.setState({ project: null, activeSceneId: null, selectedNodeIds: [], undoStack: [], redoStack: [] })
  usePersistenceStore.setState({
    phase: 'ready',
    writable: true,
    lockPhase: 'held',
    status: 'saved',
    error: undefined,
    raw: undefined,
    recoveries: {},
  })
  await useLocaleStore.getState().setLocale('en-US')
})

afterEach(async () => {
  cleanup()
  await useLocaleStore.getState().setLocale('zh-CN')
})

afterAll(async () => {
  await useLocaleStore.getState().setLocale('zh-CN')
})

describe('FreeCanvas & Editor en-US i18n', () => {
  it('translates helpers, validation errors, layers, and editor defaults into English without CJK', () => {
    for (const mode of [...CANVAS_MODES, VIDEO_REPLICATION_MODE]) {
      expect(canvasModeLabel(mode.slug)).not.toMatch(CJK_RE)
    }

    for (const prompt of [...IMAGE_EXAMPLE_PROMPTS, ...VIDEO_EXAMPLE_PROMPTS]) {
      const localized = localizeExamplePrompt(prompt)
      expect(localized).not.toMatch(CJK_RE)
      expect(localized).not.toBe(prompt)
    }

    for (const ratio of ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3']) {
      expect(getAspectRatioTooltip(ratio)).not.toMatch(CJK_RE)
    }
    for (const preset of IMAGE_SIZE_PRESETS) {
      expect(preset.tooltip).toBeTruthy()
      expect(preset.tooltip!).not.toMatch(CJK_RE)
    }

    const now = Date.parse('2026-10-01T00:02:05Z')
    const job: GenerationJob = {
      id: 'generation:t1',
      capability: Capability.TextToVideo,
      status: 'processing',
      input: {},
      inputAssetIds: [],
      outputAssetIds: [],
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    }
    expect(formatElapsed(5_000)).not.toMatch(CJK_RE)
    expect(formatElapsed(60_000)).not.toMatch(CJK_RE)
    expect(formatElapsed(125_000)).not.toMatch(CJK_RE)
    for (const status of ['pending', 'queued', 'processing', 'failed', 'cancelled'] as const) {
      expect(placeholderDetail(status, job, now)).not.toMatch(CJK_RE)
      expect(placeholderDetail(status, undefined, now)).not.toMatch(CJK_RE)
    }
    for (const phase of ['submitting', 'queued', 'generating', 'transferring'] as const) {
      expect(placeholderDetail('processing', job, now, phase)).not.toMatch(CJK_RE)
    }

    expect(videoCreditEstimateText(50, false)).not.toMatch(CJK_RE)
    expect(videoCreditEstimateText(undefined, false)).not.toMatch(CJK_RE)
    expect(videoCreditEstimateText(50, true)).not.toMatch(CJK_RE)
    expect(videoCreditShortfallText(100, 40, false)!).not.toMatch(CJK_RE)

    const nodes: EditorNode[] = [
      { id: 'n1', type: 'image', assetId: sampleImage.id, name: '', x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 1 },
      { id: 'n2', type: 'video', assetId: sampleVideo.id, name: '', x: 0, y: 0, width: 200, height: 120, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 2, duration: 5, startTime: 0 },
      { id: 'n3', type: 'generation', generationId: job.id, name: '', x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 3 },
      { id: 'n4', type: 'image', assetId: 'missing', name: 'Broken', x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 4 },
    ]
    const layerItems = buildLayerItems(nodes, { [sampleImage.id]: sampleImage, [sampleVideo.id]: sampleVideo }, { [job.id]: job })
    for (const item of layerItems) {
      expect(item.name).not.toMatch(CJK_RE)
      expect(item.meta).not.toMatch(CJK_RE)
    }

    expect(() => buildTextToImageRequest('   ', IMAGE_SIZE_PRESETS[0], 1)).toThrow(/^[^\u4e00-\u9fff]+$/)
    expect(() => buildTextToVideoRequest('a'.repeat(VIDEO_PROMPT_MAX + 1), IMAGE_SIZE_PRESETS[0], 5)).toThrow(/^[^\u4e00-\u9fff]+$/)
    expect(() => buildVariationRequest({ url: '', width: 100, height: 100 }, '', 1)).toThrow(/^[^\u4e00-\u9fff]+$/)
    expect(() => buildVariationRequest(sampleImage, 'a'.repeat(VARIATION_USER_PROMPT_MAX + 1), 1)).toThrow(/^[^\u4e00-\u9fff]+$/)
    expect(() => buildImageToVideoRequest(sampleImage, '   ', 5)).toThrow(/^[^\u4e00-\u9fff]+$/)

    expect(() => parseSnapshot(null)).toThrow(/^[^\u4e00-\u9fff]+$/)
    expect(() => parseSnapshot({ schemaVersion: 99 })).toThrow(/^[^\u4e00-\u9fff]+$/)

    const adapted = adaptGenerationTask({
      id: 't1',
      capability: Capability.TextToImage,
      status: 'succeeded',
      params: { prompt: 'coffee', size: { width: 512, height: 512 }, count: 1 },
      resultUrls: ['https://example.com/1.png'],
      creditsCost: 4,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:01Z',
    })
    expect(adapted.assets[0]?.name).not.toMatch(CJK_RE)

    ensureFreeCanvasContent()
    const createdProject = useEditorStore.getState().project
    expect(createdProject?.name).not.toMatch(CJK_RE)
    expect(createdProject?.document.scenes[0]?.name).not.toMatch(CJK_RE)
  })

  it('renders CanvasEmptyState in both image and video modes in English without CJK', () => {
    const onUsePrompt = vi.fn()
    const { container, rerender } = render(
      <CanvasEmptyState mode="image" onUsePrompt={onUsePrompt} onFocusPrompt={vi.fn()} onPickAsset={vi.fn()} />,
    )
    expect(screen.getByRole('heading', { name: /generate your first image/i })).toBeTruthy()
    assertNoCjkInDom(container)

    rerender(<CanvasEmptyState mode="video" onUsePrompt={onUsePrompt} onFocusPrompt={vi.fn()} onPickAsset={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /generate your first video/i })).toBeTruthy()
    assertNoCjkInDom(container)
    const firstVideoPrompt = localizeExamplePrompt(VIDEO_EXAMPLE_PROMPTS[0])
    fireEvent.click(screen.getByRole('button', { name: firstVideoPrompt }))
    expect(onUsePrompt).toHaveBeenCalledWith(firstVideoPrompt)
  })

  it('renders core canvas UI components in English without CJK', () => {
    const selectedNodes: EditorNode[] = [
      { id: 'i1', type: 'image', assetId: sampleImage.id, name: 'product.png', x: 0, y: 0, width: 512, height: 512, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 1 },
      { id: 'v1', type: 'video', assetId: 'missing-video', name: 'clip.mp4', x: 10, y: 10, width: 640, height: 360, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 2, duration: 5, startTime: 0 },
    ]
    const components = [
      <CanvasAddImageButton key="add" importing={false} disabled={false} onUpload={vi.fn()} onPickAsset={vi.fn()} />,
      <CanvasNoticeBar
        key="notices"
        notices={[
          { key: '1', level: 'warning', message: 'Notice 1', description: 'Details 1' },
          { key: '2', level: 'info', message: 'Notice 2' },
        ]}
      />,
      <SelectionSummary
        key="selection"
        nodes={selectedNodes}
        assets={{ [sampleImage.id]: sampleImage }}
        canDuplicate
        canDelete
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onClearSelection={vi.fn()}
      />,
      <VideoAvailabilityNotice key="va-soon" state="soon" />,
      <VideoAvailabilityNotice key="va-err" state="error" onRetry={vi.fn()} />,
      <VideoAvailabilityNotice key="va-load" state="loading" />,
      <VideoCreditEstimate key="vce-1" credits={50} mockGateway={false} />,
      <VideoCreditEstimate key="vce-2" credits={undefined} mockGateway={false} />,
      <VideoCreditEstimate key="vce-3" credits={50} mockGateway />,
      <VideoGenerationSettings
        key="vgs-seed"
        generateAudio={false}
        onAudioChange={vi.fn()}
        disabled={false}
        loading={false}
        configured
        model={SEEDANCE_VIDEO_MODEL}
        models={[SEEDANCE_VIDEO_MODEL, MINIMAX_H3_VIDEO_MODEL]}
        resolution="720p"
        onModelChange={vi.fn()}
        onResolutionChange={vi.fn()}
      />,
      <VideoGenerationSettings
        key="vgs-h3"
        generateAudio
        disabled={false}
        loading={false}
        configured
        model={MINIMAX_H3_VIDEO_MODEL}
        models={[MINIMAX_H3_VIDEO_MODEL]}
        resolution="768p"
        mode="image_to_video"
        onResolutionChange={vi.fn()}
      />,
    ]
    for (const element of components) {
      const { container, unmount } = render(<App>{element}</App>)
      assertNoCjkInDom(container)
      unmount()
    }
  })

  it('renders GenerationPanel, DerivedGenerationPanel, and VideoReplicationPanel in English without CJK', () => {
    const defaultImgModel = publicImageModel(defaultImageModel('text_to_image')!)
    const qwenModel = publicImageModel(IMAGE_MODEL_PROFILES.find(item => item.id === 'bailian:qwen-image-3.0')!)
    const failedTask: GenerationTask<TextToImageTaskParams> = {
      id: 'task-1',
      capability: Capability.TextToImage,
      modelProfileId: defaultImgModel.id,
      params: { prompt: 'forest', size: { width: 1024, height: 1024 }, count: 2, resolution: '2k' },
      status: 'failed',
      errorCode: 'SERVICE_UNAVAILABLE',
      errorMessage: '服务暂时不可用，请稍后重试',
      creditsCost: 0,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:01Z',
    }
    const baseGenProps = {
      prompt: 'neon city at night',
      presetKey: '1:1',
      count: 2,
      durationSeconds: 5,
      submitting: false,
      active: false,
      formLocked: false,
      polling: false,
      onPromptChange: vi.fn(),
      onPresetChange: vi.fn(),
      onCountChange: vi.fn(),
      onDurationChange: vi.fn(),
      onGenerate: vi.fn(),
      onRetry: vi.fn(),
      onModifyParameters: vi.fn(),
      onRefetch: vi.fn(),
      mockGateway: false,
    }
    const panels = [
      <GenerationPanel
        key="t2i"
        {...baseGenProps}
        mode="text-to-image"
        models={[defaultImgModel, qwenModel]}
        modelProfileId={qwenModel.id}
        resolution="2k"
        estimatedCredits={20}
        resolutionAdjusted
        ratioAdjusted
        countAdjusted
        task={failedTask}
      />,
      <GenerationPanel
        key="t2v"
        {...baseGenProps}
        mode="text-to-video"
        videoConfigured
        videoModel={SEEDANCE_VIDEO_MODEL}
        videoModels={[SEEDANCE_VIDEO_MODEL, MINIMAX_H3_VIDEO_MODEL]}
        videoResolution="720p"
        estimatedCredits={50}
      />,
      <DerivedGenerationPanel
        key="var"
        mode="variation"
        sourceAsset={sampleImage}
        prompt="studio lighting"
        count={2}
        durationSeconds={5}
        submitting={false}
        autoRetrying={false}
        active={false}
        formLocked={false}
        polling={false}
        onBack={vi.fn()}
        onPromptChange={vi.fn()}
        onCountChange={vi.fn()}
        onDurationChange={vi.fn()}
        onGenerate={vi.fn()}
        onRetry={vi.fn()}
        onModifyParameters={vi.fn()}
        onRefetch={vi.fn()}
        models={[defaultImgModel]}
        modelProfileId={defaultImgModel.id}
        resolution="2k"
        resolutionAdjusted
        estimatedCredits={20}
        mockGateway={false}
      />,
      <DerivedGenerationPanel
        key="i2v"
        mode="image-to-video"
        sourceAsset={sampleImage}
        prompt="slow push in"
        count={1}
        durationSeconds={5}
        videoConfigured
        videoModel={SEEDANCE_VIDEO_MODEL}
        videoModels={[SEEDANCE_VIDEO_MODEL, MINIMAX_H3_VIDEO_MODEL]}
        videoResolution="720p"
        estimatedCredits={50}
        submitting={false}
        autoRetrying={false}
        active={false}
        formLocked={false}
        polling={false}
        onBack={vi.fn()}
        onPromptChange={vi.fn()}
        onCountChange={vi.fn()}
        onDurationChange={vi.fn()}
        onGenerate={vi.fn()}
        onRetry={vi.fn()}
        onModifyParameters={vi.fn()}
        onRefetch={vi.fn()}
        mockGateway={false}
      />,
      <VideoReplicationPanel
        key="rep"
        draft={{
          ownerId: 'u1',
          prompt: 'keep matte finish',
          ratio: '9:16',
          durationSeconds: 5,
          reference: {
            key: 'ref-1',
            name: 'demo.mp4',
            width: 720,
            height: 1280,
            durationSeconds: 5,
            retentionExpiresAt: '2099-01-01T00:00:00Z',
          },
          productAssetId: sampleImage.id,
        }}
        status={{
          task: undefined,
          submitting: false,
          autoRetrying: false,
          pendingSubmission: undefined,
          resumeSubmission: vi.fn(),
          abandonSubmission: vi.fn(),
          active: false,
          formLocked: false,
          submissionError: 'Video pricing updated. Refresh configuration and confirm again.',
          preparationPhase: undefined,
          historyError: undefined,
          historySaved: false,
          retryHistory: vi.fn(),
          protocolError: undefined,
          pollError: null,
          polling: false,
          generate: vi.fn(),
          generateDerived: vi.fn(),
          retry: vi.fn(),
          modifyParameters: vi.fn(),
          dismissTask: vi.fn(),
          refetch: vi.fn(),
          observeRecoveredTask: vi.fn(),
        }}
        available
        cloud={false}
        locked={false}
        busy={false}
        preview="https://example.com/ref.mp4"
        referenceExpired={false}
        product={sampleImage}
        referenceChoices={[sampleVideo]}
        productChoices={[sampleImage]}
        credits={50}
        balance={10}
        onChange={vi.fn()}
        onUploadVideo={vi.fn()}
        onUploadImage={vi.fn()}
        onSelectVideo={vi.fn()}
        onReload={vi.fn()}
        onGenerate={vi.fn()}
      />,
    ]
    for (const element of panels) {
      const { container, unmount } = render(<App>{element}</App>)
      assertNoCjkInDom(container)
      unmount()
    }
  })

  it('renders CanvasAssetPicker and PersistenceGate recovery states in English without CJK', async () => {
    const picker = render(
      <App>
        <CanvasAssetPicker ownerId="u1" busy={false} onSelect={vi.fn()} onClose={vi.fn()} />
      </App>,
    )
    await waitFor(() => expect(screen.getByText(/No saved image assets yet/i)).toBeTruthy())
    assertNoCjkInDom(document.body)
    picker.unmount()

    usePersistenceStore.setState({ phase: 'ready', writable: false, lockPhase: 'blocked', raw: { schemaVersion: 1 } })
    const readonlyGate = render(
      <App>
        <MemoryRouter initialEntries={['/canvas/text-to-image']}>
          <PersistenceGate><div>Child</div></PersistenceGate>
        </MemoryRouter>
      </App>,
    )
    expect(screen.getByText(/Another tab is currently editing/i)).toBeTruthy()
    assertNoCjkInDom(readonlyGate.container)
    readonlyGate.unmount()

    usePersistenceStore.setState({ phase: 'error', error: 'Corrupted archive', writable: true, lockPhase: 'held', raw: { schemaVersion: 1 } })
    const errorGate = render(
      <App>
        <MemoryRouter initialEntries={['/canvas/text-to-image']}>
          <PersistenceGate><div>Child</div></PersistenceGate>
        </MemoryRouter>
      </App>,
    )
    expect(screen.getByText(/Unable to recover local project/i)).toBeTruthy()
    assertNoCjkInDom(errorGate.container)
    errorGate.unmount()
  })
})
