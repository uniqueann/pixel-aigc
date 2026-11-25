// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultImageModel, IMAGE_MODEL_PROFILES, publicImageModel } from '@shared/image-models'
import { RELIGHT_DEFAULT } from '@shared/relight'
import type { ImageAsset } from '@/editor/types'
import { Capability } from '@/types'
import { useLocaleStore } from '@/i18n/store'
import zhWorkstation from '@/i18n/locales/zh-CN/workstation.json'

const mocks = vi.hoisted(() => ({
  tool: 'smart-edit',
  capabilities: {
    imageEdit: true,
    variation: true,
    repaint: true,
    erase: true,
    smartSelect: true,
  } as Record<string, boolean | undefined>,
  controller: {
    outputAssets: [] as ImageAsset[],
    formLocked: false,
    replaceSourceAsset: vi.fn(),
    inputAsset: undefined as ImageAsset | undefined,
    resultReadError: undefined as string | undefined,
    resultReadFailureCount: 0,
    readingResults: false,
    retryRead: vi.fn(),
    generate: vi.fn(),
    selectOutput: vi.fn(),
    active: false,
    submitting: false,
    cancelling: false,
    cancel: vi.fn(),
    activeTask: undefined as unknown,
    modifyParameters: vi.fn(),
    refetch: vi.fn(),
    retry: vi.fn(),
    retrySave: vi.fn(),
    retryInputPreparation: vi.fn(),
    cancelInputPreparation: vi.fn(),
    historySaved: true,
    polling: false,
  },
  fusion: {
    product: undefined as ImageAsset | undefined,
    reference: undefined as ImageAsset | undefined,
    loading: { product: false, reference: false },
    errors: {} as { product?: string; reference?: string },
    load: vi.fn(),
    swap: vi.fn(),
    clear: vi.fn(),
    lastScene: undefined as { name: string; width: number; height: number; savedAt: string } | undefined,
    reusingLastScene: false,
    reuseLastScene: vi.fn(),
  },
}))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useParams: () => ({ tool: mocks.tool }),
  useNavigate: () => vi.fn(),
}))
vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ capabilities: mocks.capabilities, error: null, refetch: vi.fn() }),
}))
vi.mock('@/features/image-workstation/hooks/useImageWorkstationController', () => ({
  useImageWorkstationController: () => mocks.controller,
}))
vi.mock('@/features/credits/useImageModels', () => ({
  useImageModels: () => ({
    models: IMAGE_MODEL_PROFILES.map((profile) => publicImageModel(profile)),
    loading: false,
    refetch: vi.fn(),
  }),
}))
vi.mock('@/services/api/task', () => ({ liveCapabilityReady: () => false }))
vi.mock('@/features/image-workstation/hooks/useFusionImageSelection', () => ({
  useFusionImageSelection: () => mocks.fusion,
}))
vi.mock('@/features/task-center/TaskRecoveryPanel', () => ({ default: () => null }))
vi.mock('@/features/task-center/WorkstationRecovery', () => ({ default: () => null }))
vi.mock('@/features/credits/useKnownCreditBalance', () => ({ useKnownCreditBalance: () => 100 }))
vi.mock('./components/canvas/MaskPaintCanvas', async () => {
  const React = await import('react')
  return { default: React.forwardRef(() => null) }
})
vi.mock('./components/canvas/OutpaintCanvas', async () => {
  const React = await import('react')
  return { default: React.forwardRef(() => null) }
})

import ImageWorkstation from './index'
import ParamPanel from './components/ParamPanel'
import CanvasArea from './components/CanvasArea'
import CompareSlider from './components/CompareSlider'
import FusionInputStatus from './components/FusionInputStatus'
import ImageAssetStrip from './components/ImageAssetStrip'
import InpaintGuide from './components/InpaintGuide'
import RelightCompass from './components/RelightCompass'
import RelightDirectionOverlay from './components/RelightDirectionOverlay'
import VariationResultGrid from './components/VariationResultGrid'
import BrushToolbar from './components/canvas/BrushToolbar'
import FusionExample from './components/FusionExample'
import InpaintExample from './components/InpaintExample'
import OutpaintExample from './components/OutpaintExample'
import RelightExample from './components/RelightExample'
import RetouchExample from './components/RetouchExample'
import SmartEditExample from './components/SmartEditExample'
import VariationExample from './components/VariationExample'
import { workstationGenerateBlockReason } from './utils/generateGate'
import { emptyMaskMessage, remapMaskExportError } from './utils/maskExport'
import { translateSharedOutpaintError } from './utils/outpaintGeometry'
import {
  WORKSTATION_TOOLS,
  comingSoonSubmitMessage,
  fusionInputsRequiredReason,
  workstationToolLabel,
} from '@/features/image-workstation/tools/registry'
import { sourceEchoError } from '@/features/image-workstation/sourceEcho'
import { downloadFailureMessage, filenameForWorkstationResult } from '@/features/image-workstation/download'

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

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <App>
        <MemoryRouter>{ui}</MemoryRouter>
      </App>
    </QueryClientProvider>,
  )
}

const sampleAsset: ImageAsset = {
  id: 'asset:1',
  type: 'image',
  name: 'product.png',
  url: 'https://example.com/product.png',
  width: 1200,
  height: 1200,
  mimeType: 'image/png',
  source: 'upload',
  createdAt: '2026-01-01T00:00:00Z',
}

const resultAsset: ImageAsset = {
  ...sampleAsset,
  id: 'asset:2',
  name: 'result.png',
  url: 'https://example.com/result.png',
  source: 'generation',
}

beforeEach(async () => {
  mocks.tool = 'smart-edit'
  mocks.controller.inputAsset = undefined
  mocks.controller.outputAssets = []
  mocks.controller.resultReadError = undefined
  mocks.controller.resultReadFailureCount = 0
  mocks.fusion.product = undefined
  mocks.fusion.reference = undefined
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
  if (typeof globalThis.ResizeObserver !== 'function') {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  await useLocaleStore.getState().setLocale('en-US')
})

afterEach(() => {
  cleanup()
})

afterAll(async () => {
  await useLocaleStore.getState().setLocale('zh-CN')
})

describe('ImageWorkstation en-US i18n', () => {
  it('translates helper functions and block reasons into English without CJK', () => {
    for (const tool of WORKSTATION_TOOLS) {
      expect(workstationToolLabel(tool.slug)).not.toMatch(CJK_RE)
    }
    expect(comingSoonSubmitMessage()).not.toMatch(CJK_RE)
    expect(fusionInputsRequiredReason()).not.toMatch(CJK_RE)
    expect(sourceEchoError()).not.toMatch(CJK_RE)
    expect(emptyMaskMessage('remove')).not.toMatch(CJK_RE)
    expect(emptyMaskMessage('repaint')).not.toMatch(CJK_RE)
    expect(remapMaskExportError(new Error(emptyMaskMessage('remove')), 'repaint').message).not.toMatch(CJK_RE)
    expect(downloadFailureMessage(new Error('network error'))).not.toMatch(CJK_RE)
    expect(filenameForWorkstationResult({
      toolLabel: workstationToolLabel('smart-edit'),
      width: 800,
      height: 800,
    })).not.toMatch(CJK_RE)

    for (const msg of Object.values(zhWorkstation.outpaint.errors)) {
      expect(translateSharedOutpaintError(msg)).not.toMatch(CJK_RE)
    }

    const base = {
      toolReady: true,
      hasInput: true,
      formLocked: false,
      maskRequired: false,
      hasMaskPaint: false,
      repaintBlocked: false,
    }
    for (const input of [
      { ...base, configurationPending: true },
      { ...base, configurationError: true },
      { ...base, toolReady: false },
      { ...base, fusionBlocked: true },
      { ...base, hasInput: false },
      { ...base, referenceCount: 5, maxRefImages: 3 },
      { ...base, formLocked: true },
      { ...base, outpaintIdle: 'free' as const },
      { ...base, outpaintIdle: 'preset' as const },
      { ...base, retouchBlocked: true },
      { ...base, repaintBlocked: true },
      { ...base, removeBlocked: true },
      { ...base, maskRequired: true, hasMaskPaint: false, mode: 'remove' as const },
      { ...base, maskRequired: true, hasMaskPaint: false, mode: 'repaint' as const },
      { ...base, promptRequired: true, promptEmpty: true, mode: 'repaint' as const },
      { ...base, promptRequired: true, promptEmpty: true },
      { ...base, insufficientCredits: true },
    ]) {
      const reason = workstationGenerateBlockReason(input)
      expect(reason).toBeTruthy()
      expect(reason!).not.toMatch(CJK_RE)
    }
  })

  it('renders full ImageWorkstation page in English across tools without CJK', () => {
    for (const tool of WORKSTATION_TOOLS) {
      mocks.tool = tool.slug
      const { container, unmount } = renderWithProviders(<ImageWorkstation />)
      expect(screen.getByRole('heading', { level: 1 }).textContent).not.toMatch(CJK_RE)
      assertNoCjkInDom(container)
      unmount()
    }
  })

  it('renders ParamPanel across all modes and options without CJK', () => {
    const models = IMAGE_MODEL_PROFILES.map((profile) => publicImageModel(profile))
    const selectedModel = defaultImageModel('image_edit')?.id
    const commonProps = {
      smartEditPrompt: '',
      onSmartEditPromptChange: vi.fn(),
      count: 2,
      onCountChange: vi.fn(),
      resolution: '2k' as const,
      onResolutionChange: vi.fn(),
      models,
      modelProfileId: selectedModel,
      onModelProfileIdChange: vi.fn(),
      sourceSize: { width: 1200, height: 1200 },
      erasePrompt: '',
      onErasePromptChange: vi.fn(),
      repaintPrompt: '',
      onRepaintPromptChange: vi.fn(),
      outpaintMode: 'free' as const,
      outpaintOutputMode: 'original' as const,
      onOutpaintTargetModeChange: vi.fn(),
      outpaintTargetSize: { width: 1600, height: 1600 },
      onOutpaintTargetSizeChange: vi.fn(),
      presetPlatform: 'amazon',
      onPresetPlatformChange: vi.fn(),
      retouchDirections: ['blemish' as const],
      onRetouchDirectionsChange: vi.fn(),
      relight: RELIGHT_DEFAULT,
      onRelightChange: vi.fn(),
      inpaintCreditLabel: '2 credits',
      variationLastPrompt: 'outdoor studio',
      onRestoreVariationPrompt: vi.fn(),
    }

    const variants = [
      <ParamPanel key="edit" {...commonProps} capability={Capability.ImageEdit} />,
      <ParamPanel key="var" {...commonProps} capability={Capability.Variation} />,
      <ParamPanel key="retouch" {...commonProps} capability={Capability.Retouch} keepSourceSize />,
      <ParamPanel key="fusion" {...commonProps} capability={Capability.Fusion} />,
      <ParamPanel key="relight" {...commonProps} capability={Capability.Relight} />,
      <ParamPanel key="remove" {...commonProps} capability={Capability.Inpaint} mode="remove" />,
      <ParamPanel key="repaint" {...commonProps} capability={Capability.Inpaint} mode="repaint" hasMaskPaint />,
      <ParamPanel key="outpaint-free" {...commonProps} capability={Capability.Outpaint} outpaintMode="free" />,
      <ParamPanel key="outpaint-ratio" {...commonProps} capability={Capability.Outpaint} outpaintMode="preset" outpaintOutputMode="original" />,
      <ParamPanel key="outpaint-size" {...commonProps} capability={Capability.Outpaint} outpaintMode="preset" outpaintOutputMode="platform" />,
    ]

    for (const element of variants) {
      const { container, unmount } = renderWithProviders(element)
      assertNoCjkInDom(container)
      unmount()
    }
  })

  it('renders subcomponents and examples in English without CJK', () => {
    const components = [
      <CompareSlider key="cmp" beforeSrc={sampleAsset.url} afterSrc={resultAsset.url} beforeSize={{ width: 800, height: 800 }} afterSize={{ width: 800, height: 800 }} />,
      <FusionInputStatus key="fis" state={{ phase: 'preparing', product: { stage: 'ready' }, reference: { stage: 'failed', error: 'Upload failed' } }} onRetry={vi.fn()} onCancel={vi.fn()} onModify={vi.fn()} />,
      <ImageAssetStrip key="ias" assets={[resultAsset, sampleAsset]} selectedAssetId={resultAsset.id} variant="inpaint-result" layout="grid" onSelect={vi.fn()} onDownload={vi.fn()} onPreview={vi.fn()} onDownloadAll={vi.fn()} onContinue={vi.fn()} />,
      <InpaintGuide key="ig1" mode="remove" step={2} />,
      <InpaintGuide key="ig2" mode="repaint" step={3} />,
      <RelightCompass key="rc" value={RELIGHT_DEFAULT} onChange={vi.fn()} />,
      <RelightDirectionOverlay key="rdo" direction="front" onDirectionChange={vi.fn()} />,
      <VariationResultGrid key="vrg" assets={[resultAsset, sampleAsset]} selectedAssetId={resultAsset.id} onSelect={vi.fn()} onDownload={vi.fn()} onPreview={vi.fn()} onDownloadAll={vi.fn()} />,
      <BrushToolbar key="bt" brushSize={24} tool="brush" smartSelectEnabled={false} smartSelectReady canUndo canRedo onBrushSizeChange={vi.fn()} onToolChange={vi.fn()} onSmartSelectToggle={vi.fn()} onInvert={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} onClear={vi.fn()} />,
      <CanvasArea key="ca-fusion" interactionMode="multi-source" imageUrl={sampleAsset.url} referenceImageUrl={resultAsset.url} resultImageUrl={resultAsset.url} imageNaturalSize={{ width: 800, height: 800 }} compareMode="effect" onCompareModeChange={vi.fn()} onImageUpload={vi.fn()} onSwapImages={vi.fn()} onRemoveImage={vi.fn()} onReady={vi.fn()} />,
      <CanvasArea key="ca-mask" interactionMode="mask-paint" imageUrl={sampleAsset.url} resultImageUrl={resultAsset.url} imageNaturalSize={{ width: 800, height: 800 }} compareMode="original" onCompareModeChange={vi.fn()} onImageUpload={vi.fn()} onReady={vi.fn()} />,
      <CanvasArea key="ca-out" interactionMode="drag-resize" imageUrl={sampleAsset.url} originalImageUrl={sampleAsset.url} imageNaturalSize={{ width: 800, height: 800 }} outpaintTargetSize={{ width: 1600, height: 800 }} compareMode="effect" onCompareModeChange={vi.fn()} onImageUpload={vi.fn()} onReady={vi.fn()} />,
      <FusionExample key="ex-f" />,
      <InpaintExample key="ex-ir" mode="remove" />,
      <InpaintExample key="ex-ip" mode="repaint" />,
      <OutpaintExample key="ex-o" />,
      <RelightExample key="ex-rl" />,
      <RetouchExample key="ex-rt" />,
      <SmartEditExample key="ex-se" />,
      <VariationExample key="ex-v" />,
    ]

    for (const element of components) {
      const { container, unmount } = renderWithProviders(element)
      assertNoCjkInDom(container)
      unmount()
    }
  })
})
