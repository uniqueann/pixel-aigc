// @vitest-environment jsdom

import 'fake-indexeddb/auto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: { bgRemove: true, outpaint: true },
    error: null,
    refetch: vi.fn(),
  }),
}))
vi.mock('@/features/task-center/TaskRecoveryPanel', () => ({
  default: () => null,
}))
vi.mock('@/features/credits/useBillingCatalog', () => ({
  useBillingCatalog: () => ({
    data: { freeBgRemoveRemaining: 20 },
    isPending: false,
    fetchStatus: 'idle',
    refetch: vi.fn(),
  }),
}))
vi.mock('@/features/credits/useKnownCreditBalance', () => ({
  useKnownCreditBalance: () => 100,
}))

import { useLocaleStore } from '@/i18n/store'
import { pipelineProgressLabel, pipelineQueueNote } from '@/features/toolbox-pipeline/notices'
import type { PipelineItem } from '@/features/toolbox-pipeline/types'
import Toolbox from './index'
import BgRemoveTool from './BgRemoveTool'
import WatermarkTool from './WatermarkTool'
import AspectRatioTool from './AspectRatioTool'
import PipelineTool from './PipelineTool'
import ToolboxImageCard from './ToolboxImageCard'
import AspectRatioSettingsPanel from './shared/AspectRatioSettingsPanel'
import WatermarkSettingsPanel from './shared/WatermarkSettingsPanel'
import ColorDialog from './shared/ColorDialog'
import ResultGallery from './shared/ResultGallery'
import ResultGrid from './shared/ResultGrid'
import { DEFAULT_ASPECT_RATIO_SETTINGS } from './aspect-ratio/types'
import { DEFAULT_WATERMARK_SETTINGS } from './watermark/types'
import { getFitStrategyLabel } from './aspect-ratio/strategies'
import { getSubjectDetectionLabel } from './aspect-ratio/subjectLabels'
import { getCenterCropUnavailableNote, gridCropNote, unavailableCropSummary } from './aspect-ratio/subjectFocus'
import { getLocalTemplateLabel } from './shared/presetLabels'
import { queueLimitMessage } from './shared/inspect'
import { getToolboxToolLabel } from './tools'

const CJK_RE = /[\u4e00-\u9fff]/

function assertNoCjk(container: HTMLElement) {
  expect(container.textContent ?? '').not.toMatch(CJK_RE)
}

function renderWithProviders(ui: React.ReactElement, initialEntry = '/toolbox/bg-remove') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <App>
        <MemoryRouter initialEntries={[initialEntry]}>
          {ui}
        </MemoryRouter>
      </App>
    </QueryClientProvider>,
  )
}

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
  await useLocaleStore.getState().setLocale('en-US')
})

afterEach(() => {
  cleanup()
})

afterAll(async () => {
  await useLocaleStore.getState().setLocale('zh-CN')
})

describe('Toolbox en-US i18n', () => {
  it('renders Toolbox switcher tabs in English without CJK', async () => {
    const { container } = renderWithProviders(
      <Routes>
        <Route path="/toolbox/:tool" element={<Toolbox />} />
      </Routes>,
      '/toolbox/watermark',
    )
    expect(screen.getByText('Background Removal')).toBeTruthy()
    expect(screen.getByText('Watermark')).toBeTruthy()
    expect(screen.getByText('Aspect Ratio')).toBeTruthy()
    expect(screen.getByText('Pipeline')).toBeTruthy()
    assertNoCjk(container)
  })

  it('renders all four main Toolbox tools in English without CJK', () => {
    for (const element of [<BgRemoveTool key="bg" />, <WatermarkTool key="wm" />, <AspectRatioTool key="ar" />, <PipelineTool key="pl" />]) {
      const { container, unmount } = renderWithProviders(element)
      assertNoCjk(container)
      unmount()
    }
  })

  it('renders shared panels and dialogs in English without CJK', () => {
    const { container } = render(
      <App>
        <ToolboxImageCard
          items={[]}
          selectedId={null}
          disabled={false}
          onAdd={vi.fn()}
          onSelect={vi.fn()}
          onRemove={vi.fn()}
          onClear={vi.fn()}
        />
        <AspectRatioSettingsPanel
          settings={{ ...DEFAULT_ASPECT_RATIO_SETTINGS, strategy: 'crop' }}
          disabled={false}
          onChange={vi.fn()}
        />
        <WatermarkSettingsPanel
          settings={DEFAULT_WATERMARK_SETTINGS}
          disabled={false}
          onChange={vi.fn()}
          onLogo={vi.fn()}
        />
        <ResultGrid
          items={[{ id: '1', name: 'item.png', sourceUrl: 'blob:1', status: 'succeeded' }]}
          results={new Map()}
          selectedId="1"
          filter="all"
          onFilterChange={vi.fn()}
          onSelect={vi.fn()}
          ariaLabel="Result Grid"
        />
        <ColorDialog open value="#FFFFFF" onClose={vi.fn()} onApply={vi.fn()} />
        <ResultGallery
          items={[{ id: '1', thumbSrc: 't.png', fullSrc: 'f.png', originalSrc: 'o.png', title: 'item.png' }]}
          open
          current={0}
          onClose={vi.fn()}
          onChange={vi.fn()}
          onDownload={vi.fn()}
        />
      </App>,
    )

    expect(screen.getByText('Select images or drag files here')).toBeTruthy()
    expect(screen.getByText(/Amazon Main Image 1600 × 1600/)).toBeTruthy()
    expect(screen.getByText(/TikTok \/ Douyin Product Image 1080 × 1440/)).toBeTruthy()
    expect(screen.getByText('Padding Fill')).toBeTruthy()
    expect(screen.getByText('Smart Crop')).toBeTruthy()
    expect(screen.getByText('Smart Expand')).toBeTruthy()
    expect(screen.getByText('Watermark Settings')).toBeTruthy()
    expect(screen.getByText('Background Color')).toBeTruthy()
    expect(screen.getByText('Download Full Image')).toBeTruthy()
    assertNoCjk(container)
    expect(document.body.textContent ?? '').not.toMatch(CJK_RE)
  })

  it('translates helper labels and pipeline notices in English without CJK', () => {
    expect(getToolboxToolLabel('bg-remove')).toBe('Background Removal')
    expect(getFitStrategyLabel('outpaint')).toBe('Smart Expand')
    expect(getSubjectDetectionLabel()).toBe('Subject Detection')
    expect(getLocalTemplateLabel()).toBe('Local Template')

    const note = getCenterCropUnavailableNote()
    expect(note).not.toMatch(CJK_RE)
    expect(gridCropNote(0, 1)).not.toMatch(CJK_RE)
    expect(unavailableCropSummary([{ fx: 0.5, fy: 0.5, unavailable: true }])).not.toMatch(CJK_RE)

    const huge = new File([new Uint8Array(1)], 'huge.jpg', { type: 'image/jpeg' })
    Object.defineProperty(huge, 'size', { value: 21 * 1024 * 1024 })
    expect(queueLimitMessage(huge, 0, 0)).toBe('huge.jpg: single image cannot exceed 20 MB')

    const item: PipelineItem = {
      id: 'a',
      file: new File(['x'], 'a.png', { type: 'image/png' }),
      sourceMime: 'image/png',
      width: 100,
      height: 100,
      ratioStatus: 'succeeded',
      watermarkStatus: 'succeeded',
      output: { blob: new Blob(['x']), mimeType: 'image/png', width: 100, height: 100 },
    }
    expect(pipelineQueueNote(item, 'idle')).toBe('Resized · watermarked')
    expect(pipelineProgressLabel([item])).toBe('1 / 1 completed')
  })
})
