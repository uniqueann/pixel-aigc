// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudError } from '@/cloud/client'
import { useLocaleStore } from '@/i18n/store'
import { SuiteList } from '@/pages/EcommerceSuite'
import {
  SUITE_SUBCATEGORIES,
  suiteExportConfigSchema,
  suiteProjectConfigSchema,
  type SuiteProjectConfig,
  type SuiteSlotDraft,
  type SuiteSlotVersion,
} from '@shared/ecommerce-suite'
import { checkSuiteEncoded, checkSuiteVersion, SUITE_RULE_VERSION, type SuitePrecheck } from '@shared/ecommerce-suite-precheck'
import type { SuiteProjectDetail, SuiteProjectList } from '@shared/ecommerce-suite-runtime'
import { SUITE_CATEGORY_TEMPLATES } from '@shared/ecommerce-suite-templates'
import type { SuiteClient } from './api'
import BatchPanel from './BatchPanel'
import BatchPlanPanel from './BatchPlanPanel'
import { getSlotUnreadyReason } from './batchPlan'
import { newSuiteConfig } from './config'
import ExportPanel from './ExportPanel'
import GenerationPanel from './GenerationPanel'
import {
  formatSuiteError,
  localizeSuiteCheck,
  suiteCategoryLabel,
  suiteOperationErrorText,
  suitePlatformLabel,
  suiteSlotLabel,
  suiteStyleTagOptions,
  suiteWorkstationToolLabel,
} from './i18n'
import LayerPanel from './LayerPanel'
import ProductFields from './ProductFields'
import VersionPanel from './VersionPanel'
import WorkstationBridge from './WorkstationBridge'

vi.mock('@/services/api/imageModels', () => ({
  listImageModels: vi.fn(async () => [
    { id: 'mock-model', label: 'Mock Image Model', provider: 'mock', ui: { resolutions: ['1k', '2k'], maxCount: 4, promptMaxLength: 4000 } },
  ]),
}))
vi.mock('./export', () => ({
  encodeSuiteSelection: vi.fn(),
  zipSuiteExport: vi.fn(),
}))

const CJK_RE = /[\u4e00-\u9fff]/
const contract = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json', 'utf8'))

function assertNoCjk(element: HTMLElement | null) {
  expect(element?.textContent ?? '').not.toMatch(CJK_RE)
}

function makeEnglishConfig(): SuiteProjectConfig {
  return {
    ...contract.project.config,
    title: 'Oak Dining Table',
    sku: 'OAK-001',
    tags: ['现代简约', '自然光'],
    style: {
      ...contract.project.config.style,
      sceneTone: 'Natural light, clean composition',
    },
    facts: [
      {
        id: '00000000-0000-4000-8000-000000000020',
        kind: 'dimension',
        subject: 'Overall',
        axis: 'length',
        name: 'Length',
        value: 210,
        unit: 'cm',
        originalText: 'Length 210cm',
        source: 'user',
        confirmed: true,
      },
    ],
  }
}

beforeEach(async () => {
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn()
  }
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  await useLocaleStore.getState().setLocale('en-US')
})

afterEach(async () => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  await useLocaleStore.getState().setLocale('zh-CN')
})

afterAll(async () => {
  await useLocaleStore.getState().setLocale('zh-CN')
})

describe('E-commerce Suite en-US i18n helpers', () => {
  it('translates platforms, categories, template slots, style tags, tools, and operation errors without CJK', () => {
    expect(suitePlatformLabel('amazon')).toBe('Amazon US')
    expect(suitePlatformLabel('general')).toBe('General Template')

    for (const subcategory of SUITE_SUBCATEGORIES) {
      const catLabel = suiteCategoryLabel(subcategory)
      expect(catLabel).not.toMatch(CJK_RE)
      for (const slot of SUITE_CATEGORY_TEMPLATES[subcategory].slots) {
        const label = suiteSlotLabel(slot)
        expect(label).not.toMatch(CJK_RE)
        expect(label.length).toBeGreaterThan(0)
      }
      const tagOptions = suiteStyleTagOptions(subcategory)
      expect(tagOptions.length).toBe(SUITE_CATEGORY_TEMPLATES[subcategory].styleTags.length)
      for (const option of tagOptions) {
        // Canonical value stays matched to shared template for server prompt filtering; label is English.
        expect(SUITE_CATEGORY_TEMPLATES[subcategory].styleTags).toContain(option.value)
        expect(option.label).not.toMatch(CJK_RE)
      }
    }

    for (const tool of ['repaint', 'smart-edit', 'retouch', 'relight'] as const) {
      expect(suiteWorkstationToolLabel(tool)).not.toMatch(CJK_RE)
    }

    const opCodes = [
      'USER_STOPPED', 'PROJECT_DELETED', 'RECONFIRMED', 'DISPATCH_DEADLINE',
      'INSUFFICIENT_CREDITS', 'SUITE_QUOTE_CHANGED', 'SUITE_BUDGET_EXCEEDED',
      'RATE_LIMIT', 'USER_CONCURRENCY', 'GLOBAL_CONCURRENCY', 'MODEL_CONCURRENCY',
      'PROVIDER_CONCURRENCY', 'SUITE_ASSET_UNAVAILABLE', 'IMAGE_EDIT_UNAVAILABLE',
      'BACKGROUND_SUBMIT_DISABLED', 'UNKNOWN_CODE',
    ]
    for (const code of opCodes) {
      const text = suiteOperationErrorText(code)
      expect(text).not.toMatch(CJK_RE)
      expect(text.length).toBeGreaterThan(0)
    }
  })

  it('produces English defaults for newSuiteConfig and getSlotUnreadyReason', () => {
    const config = newSuiteConfig('furniture')
    expect(config.title).toBe('Untitled Product')
    expect(config.style.sceneTone).not.toMatch(CJK_RE)
    for (const slot of config.slots) {
      expect(slot.name).not.toMatch(CJK_RE)
    }

    expect(getSlotUnreadyReason({ ...config.slots[0], enabled: false }, 'furniture', [])).toBe('Skipped')
    expect(getSlotUnreadyReason(config.slots.find(s => s.kind === 'detail')!, 'furniture', [])).toBe('Detail photo required')
    expect(getSlotUnreadyReason(config.slots.find(s => s.kind === 'size')!, 'furniture', [])).toBe('Dimension spec required')
    expect(getSlotUnreadyReason(config.slots.find(s => s.kind === 'feature')!, 'furniture', [])).toBe('Product highlight required')
  })

  it('localizes Zod validation errors, CloudError codes, shared errors, and compliance checks without CJK', () => {
    const badExport = suiteExportConfigSchema.safeParse({
      platform: 'amazon', width: 2000, height: 2000, format: 'webp', background: '#ffffff',
    })
    expect(badExport.success).toBe(false)
    if (!badExport.success) {
      const msg = formatSuiteError(badExport.error)
      expect(msg).toBe('Amazon preset does not support WebP')
      expect(msg).not.toMatch(CJK_RE)
    }

    const badConfig = suiteProjectConfigSchema.safeParse({ ...newSuiteConfig(), title: '' })
    expect(badConfig.success).toBe(false)
    if (!badConfig.success) {
      const msg = formatSuiteError(badConfig.error)
      expect(msg).toBe('Please enter a product name')
      expect(msg).not.toMatch(CJK_RE)
    }

    const cloudMsg = formatSuiteError(new CloudError(409, '缺少商品规格', 'SUITE_FACTS_REQUIRED'))
    expect(cloudMsg).not.toMatch(CJK_RE)
    expect(cloudMsg).toMatch(/specs|selling points/i)

    const versionChecks = checkSuiteVersion(
      contract.project,
      contract.project.config.slots[0],
      contract.version,
      contract.asset,
      { platform: 'amazon', width: 2000, height: 2000, format: 'jpeg', background: '#ffffff', jpegQuality: 0.94 },
    )
    const encodedChecks = checkSuiteEncoded(
      { platform: 'amazon', width: 2000, height: 2000, format: 'jpeg', background: '#ffffff', jpegQuality: 0.94 },
      { mimeType: 'image/jpeg', width: 2000, height: 2000, bytes: 123456, checksum: 'a'.repeat(64) },
    )
    for (const check of [...versionChecks, ...encodedChecks]) {
      const localized = localizeSuiteCheck(check, 'furniture')
      expect(localized.title).not.toMatch(CJK_RE)
      expect(localized.evidence).not.toMatch(CJK_RE)
      expect(localized.advice).not.toMatch(CJK_RE)
    }
  })
})

describe('E-commerce Suite en-US UI components', () => {
  it('renders SuiteList and RecoveryImport in English with zero CJK', async () => {
    const listData: SuiteProjectList = {
      items: [
        {
          project: {
            ...contract.project,
            id: '11111111-1111-4111-8111-111111111111',
            config: makeEnglishConfig(),
            updatedAt: '2026-11-08T08:00:00.000Z',
            deletedAt: null,
          },
          readySlots: 3,
          enabledSlots: 7,
          baseReady: true,
        },
      ],
      nextCursor: null,
    }
    const client = {
      list: vi.fn(async () => listData),
      assertCurrent: vi.fn(),
    } as unknown as SuiteClient

    const { container } = render(
      <App>
        <MemoryRouter>
          <SuiteList actor={contract.project.actor} client={client} signal={new AbortController().signal} />
        </MemoryRouter>
      </App>,
    )

    expect(await screen.findByRole('heading', { level: 1, name: 'E-commerce Suite' })).toBeTruthy()
    expect(screen.getByText('Amazon US')).toBeTruthy()
    expect(screen.getByText('Furniture & Home')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open Project' })).toBeTruthy()
    expect(screen.getByText('Import Recovery Package')).toBeTruthy()
    assertNoCjk(container)

    cleanup()
    const bridgeView = render(
      <App>
        <MemoryRouter>
          <WorkstationBridge
            id="11111111-1111-4111-8111-111111111111"
            tool="smart-edit"
            disabled={false}
            onInput={vi.fn()}
            onBinding={vi.fn()}
          />
        </MemoryRouter>
      </App>,
    )
    expect(bridgeView.getByText(/E-commerce Suite Studio Session/)).toBeTruthy()
    assertNoCjk(bridgeView.container)
  })

  it('renders ProductFields, GenerationPanel, BatchPlanPanel, BatchPanel, VersionPanel, and ExportPanel in English with zero CJK', async () => {
    const config = makeEnglishConfig()
    const project = { ...contract.project, config }
    const version: SuiteSlotVersion = {
      ...contract.version,
      source: 'workstation_return',
      sourceTool: 'smart-edit',
      slotId: config.slots[0].id,
    }
    const detail: SuiteProjectDetail = {
      project,
      assets: [contract.asset],
      versions: [version],
      drafts: [],
      batches: [{ ...contract.batch, state: 'partial', maxCredits: 30 }],
      operations: [{ ...contract.operation, slotId: config.slots[1].id, errorCode: 'INSUFFICIENT_CREDITS' }],
      tasks: [],
    } as unknown as SuiteProjectDetail

    const client = {
      assertCurrent: vi.fn(),
      get: vi.fn(async () => detail),
      versions: vi.fn(async () => ({ items: [version], nextCursor: null })),
      quote: vi.fn(),
      precheck: vi.fn(async (): Promise<SuitePrecheck> => ({
        projectId: project.id,
        projectRevision: 1,
        title: config.title,
        platform: 'amazon',
        ruleProfile: { id: 'amazon-us-home-kitchen', version: SUITE_RULE_VERSION },
        ruleVersion: SUITE_RULE_VERSION,
        ruleReviewedAt: '2026-10-17',
        checkedAt: '2026-11-08T08:00:00.000Z',
        fingerprint: 'a'.repeat(64),
        checkedVersionIds: [version.id],
        output: { platform: 'amazon', width: 2000, height: 2000, format: 'jpeg', background: '#ffffff', jpegQuality: 0.94 },
        items: [],
        checks: [],
      })),
    } as unknown as SuiteClient

    const fieldsView = render(<ProductFields value={config} onChange={vi.fn()} creating />)
    expect(fieldsView.getByText('Product Name')).toBeTruthy()
    expect(fieldsView.getByText('Modern minimalist')).toBeTruthy()
    expect(fieldsView.getByText('Main 1 · White BG')).toBeTruthy()
    assertNoCjk(fieldsView.container)
    fieldsView.unmount()

    const genView = render(
      <App>
        <GenerationPanel
          project={project}
          slot={config.slots[1]}
          client={client}
          blocked={false}
          flush={async () => undefined}
          flushDraft={async () => undefined}
          onSubmit={async () => undefined}
          onEdit={vi.fn()}
          onError={vi.fn()}
        />
      </App>,
    )
    await waitFor(() => expect(genView.getByRole('button', { name: /Estimate Cost/ })).toBeTruthy())
    assertNoCjk(genView.container)
    genView.unmount()

    const batchView = render(
      <BatchPanel data={detail} disabled={false} onStop={vi.fn()} onRetry={vi.fn()} />,
    )
    expect(batchView.getByText('Batch History')).toBeTruthy()
    expect(batchView.getByText(/Insufficient credits/)).toBeTruthy()
    assertNoCjk(batchView.container)
    batchView.unmount()

    const versionView = render(
      <VersionPanel
        client={client}
        project={project}
        slotId={config.slots[0].id}
        versions={[version]}
        disabled={false}
        onSelect={async () => undefined}
        onError={vi.fn()}
      />,
    )
    expect(await versionView.findByText(/Studio Smart Edit/)).toBeTruthy()
    assertNoCjk(versionView.container)
    versionView.unmount()

    render(
      <App>
        <BatchPlanPanel
          data={detail}
          client={client}
          blocked={false}
          flush={async () => undefined}
          onSubmit={async () => undefined}
          onClose={vi.fn()}
          onError={vi.fn()}
        />
      </App>,
    )
    expect(await screen.findByText('Batch Generate Suite')).toBeTruthy()
    assertNoCjk(document.body)
    cleanup()

    render(
      <ExportPanel
        actor={project.actor}
        data={detail}
        client={client}
        signal={new AbortController().signal}
        liveKey="live-1"
        prepare={async () => detail}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('Precheck & Batch Export')).toBeTruthy()
    assertNoCjk(document.body)
  })

  it('preserves LayerPanel artwork copyLanguage independent of en-US UI locale', () => {
    const baseDraft: SuiteSlotDraft = {
      expectedDraftRevision: 0,
      baseVersionId: contract.version.id,
      promptNote: '',
      count: 1,
      resolution: '1k',
      modelProfileId: null,
      layers: [],
    }
    const baseComposition = { ...contract.version.composition, layersSnapshot: [] }

    // 1. UI is en-US, artwork copyLanguage is zh-CN -> panel UI is English, added text layer uses Chinese artwork defaults.
    const onEditZh = vi.fn()
    const zhArtworkView = render(
      <LayerPanel
        draft={baseDraft}
        composition={baseComposition}
        config={{ ...makeEnglishConfig(), copyLanguage: 'zh-CN' }}
        locked={false}
        disabled={false}
        stale={false}
        onSelect={vi.fn()}
        onEdit={onEditZh}
        onSave={vi.fn()}
        onReset={vi.fn()}
        onReadCloud={vi.fn()}
      />,
    )
    expect(zhArtworkView.getByRole('button', { name: '+ Add Text' })).toBeTruthy()
    assertNoCjk(zhArtworkView.container)
    fireEvent.click(zhArtworkView.getByRole('button', { name: '+ Add Text' }))
    expect(onEditZh).toHaveBeenCalledTimes(1)
    expect(onEditZh.mock.calls[0][0].layers[0]).toMatchObject({
      type: 'text',
      text: '编辑文字',
      fontFamily: 'Noto Sans SC',
    })
    zhArtworkView.unmount()

    // 2. UI is en-US, artwork copyLanguage is en-US -> added text layer uses English artwork defaults.
    const onEditEn = vi.fn()
    const enArtworkView = render(
      <LayerPanel
        draft={baseDraft}
        composition={baseComposition}
        config={{ ...makeEnglishConfig(), copyLanguage: 'en-US' }}
        locked={false}
        disabled={false}
        stale={false}
        onSelect={vi.fn()}
        onEdit={onEditEn}
        onSave={vi.fn()}
        onReset={vi.fn()}
        onReadCloud={vi.fn()}
      />,
    )
    fireEvent.click(enArtworkView.getByRole('button', { name: '+ Add Text' }))
    expect(onEditEn).toHaveBeenCalledTimes(1)
    expect(onEditEn.mock.calls[0][0].layers[0]).toMatchObject({
      type: 'text',
      text: 'Edit text',
      fontFamily: 'Noto Sans',
    })
  })
})
