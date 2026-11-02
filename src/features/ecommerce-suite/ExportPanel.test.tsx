// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import { suiteCheck, SUITE_RULE_VERSION, type SuitePrecheck } from '@shared/ecommerce-suite-precheck'
import type { SuiteClient } from './api'
import ExportPanel from './ExportPanel'

const mocks = vi.hoisted(() => ({ encode: vi.fn() }))
vi.mock('./export', () => ({ encodeSuiteSelection: mocks.encode, zipSuiteExport: vi.fn() }))

const projectId = '44444444-4444-4444-8444-444444444444'
const mainSlot = { id: '11111111-1111-4111-8111-111111111111', key: 'main' as const, kind: 'main' as const, name: '主图 1 · 白底', order: 0, enabled: true, referenceAssetIds: [] }
const sceneSlot = { id: '22222222-2222-4222-8222-222222222222', key: 'scene' as const, kind: 'scene' as const, name: '主图 2 · 场景', order: 1, enabled: true, referenceAssetIds: [] }
const versionId = '33333333-3333-4333-8333-333333333333'

function detail(): SuiteProjectDetail {
  return {
    project: {
      id: projectId,
      config: { platform: 'amazon', slots: [mainSlot, sceneSlot] },
      slotHeads: [
        { slotId: mainSlot.id, activeVersionId: versionId, headRevision: 1 },
        { slotId: sceneSlot.id, activeVersionId: null, headRevision: 0 },
      ],
    },
  } as unknown as SuiteProjectDetail
}

function precheck(): SuitePrecheck {
  return {
    projectId, projectRevision: 1, title: '测试商品', platform: 'amazon',
    ruleProfile: { id: 'amazon-us-home-kitchen', version: SUITE_RULE_VERSION },
    ruleVersion: SUITE_RULE_VERSION, ruleReviewedAt: '2026-10-17', checkedAt: new Date().toISOString(),
    fingerprint: 'a'.repeat(64), checkedVersionIds: [versionId],
    output: { platform: 'amazon', width: 2000, height: 2000, format: 'jpeg', background: '#ffffff', jpegQuality: .94 },
    items: [{ slot: mainSlot, version: { id: versionId, slotId: mainSlot.id } as never, asset: {} as never, checks: [] }],
    checks: [suiteCheck('amazon.category', 'unknown', '美国站具体类目规则', '需在卖家账号内复核', '人工核对', 'manual')],
  }
}

function exportedFile() {
  return {
    slotId: mainSlot.id, versionId, name: '测试商品_01_主图.jpg', checks: [],
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    metadata: { mimeType: 'image/jpeg', width: 2000, height: 2000, bytes: 1, checksum: 'a'.repeat(64) },
  }
}

describe('导出确认门禁 (ExportPanel)', () => {
  beforeEach(() => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2000, height: 2000, close: vi.fn() })))
    // jsdom 未安装 canvas 包；缩略图预览会走“不可用”降级路径，不影响门禁断言。
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null as never)
    // jsdom 默认不驱动动画帧；预检在保存修订后用它等待一次渲染。
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(performance.now()); return 0 })
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:mock') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() })
    // jsdom 的 AbortSignal 未实现较新的 throwIfAborted；生产代码依赖它做取消检查。
    if (typeof AbortSignal.prototype.throwIfAborted !== 'function') {
      Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', {
        configurable: true, writable: true,
        value: function (this: AbortSignal) { if (this.aborted) throw this.reason },
      })
    }
    if (typeof AbortSignal.any !== 'function') {
      Object.defineProperty(AbortSignal, 'any', { configurable: true, writable: true, value: (signals: AbortSignal[]) => {
        const controller = new AbortController()
        for (const signal of signals) {
          if (signal.aborted) { controller.abort(signal.reason); break }
          signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
        }
        return controller.signal
      } })
    }
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('预检完成不会自动确认警告与部分导出，必须由用户逐项勾选', async () => {
    const data = detail()
    const report = precheck()
    mocks.encode.mockResolvedValue([exportedFile()])
    const client = { assertCurrent: vi.fn(), precheck: vi.fn(async () => report) } as unknown as SuiteClient
    const prepare = vi.fn(async () => data)

    render(<ExportPanel actor={{ userId: crypto.randomUUID(), runtimeScope: 'local' }} data={data} client={client}
      signal={new AbortController().signal} liveKey="live-1" prepare={prepare} onClose={() => undefined} />)

    fireEvent.click(screen.getByRole('button', { name: '开始合规检查' }))

    const download = await screen.findByRole('button', { name: /下载 1 张成品 ZIP/ }) as HTMLButtonElement
    const review = screen.getByLabelText('已知晓上述提示项并继续导出') as HTMLInputElement
    const partial = screen.getByLabelText('仅导出已就绪的图片') as HTMLInputElement

    // 预检完成后两个确认框都必须保持未勾选，下载保持禁用。
    expect(review.checked).toBe(false)
    expect(partial.checked).toBe(false)
    expect(download.disabled).toBe(true)

    fireEvent.click(review)
    expect(download.disabled).toBe(true)

    fireEvent.click(partial)
    await waitFor(() => expect(download.disabled).toBe(false))
  })
})
