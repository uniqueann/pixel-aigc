// @vitest-environment jsdom

import { App } from 'antd'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_MODEL_PROFILES, defaultImageModel, publicImageModel } from '@shared/image-models'
import { defaultPreferences } from '@shared/preferences'
import { usePreferencesStore } from '@/features/preferences/store'
import { useUserStore } from '@/store/useUserStore'
import { downloadBlob } from '@/pages/Toolbox/shared/zip'
import { apiClient } from '@/services/api/client'
import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { downloadImageAsset } from '@/features/image-workstation/download'

const mocks = vi.hoisted(() => ({
  tool: 'variation',
  status: {
    capabilities: { imageEdit: undefined, variation: undefined, repaint: undefined, smartSelect: undefined } as Record<string, boolean | undefined>,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  controller: {
    outputAssets: [] as unknown[], formLocked: false, replaceSourceAsset: vi.fn(),
    inputAsset: undefined as { id: string; name: string; width: number; height: number; url: string } | undefined,
    resultReadError: undefined as string | undefined, readingResults: false, retryRead: vi.fn(), generate: vi.fn(), selectOutput: vi.fn(),
    active: false, submitting: false, cancelling: false, cancel: vi.fn(), activeTask: undefined as unknown,
  },
  controllerArgs: undefined as { modelProfileId?: string; keepInputOnSuccess?: boolean } | undefined,
  models: [] as unknown[],
  modelsLoading: false,
  fusion: {
    product: undefined as { id: string; name: string; width: number; height: number; url: string } | undefined,
    reference: undefined as { id: string; name: string; width: number; height: number; url: string } | undefined,
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
vi.mock('react-router-dom', async importOriginal => ({ ...await importOriginal<typeof import('react-router-dom')>(), useParams: () => ({ tool: mocks.tool }), useNavigate: () => vi.fn() }))
vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => mocks.status }))
vi.mock('@/features/image-workstation/hooks/useImageWorkstationController', () => ({
  useImageWorkstationController: (args: { modelProfileId?: string }) => {
    mocks.controllerArgs = args
    return mocks.controller
  },
}))
vi.mock('@/features/credits/useImageModels', () => ({ useImageModels: () => ({ models: mocks.models, loading: mocks.modelsLoading, refetch: vi.fn() }) }))
vi.mock('@/services/api/task', () => ({ liveCapabilityReady: () => false }))
vi.mock('@/components/GenerationTaskStatus', () => ({ default: () => null }))
vi.mock('@/features/image-workstation/hooks/useFusionImageSelection', () => ({ useFusionImageSelection: () => mocks.fusion }))
// 涂抹/扩图画布依赖 Fabric 与真实 canvas；页面测试只验证流程，不挂载画布实现。
vi.mock('./components/canvas/MaskPaintCanvas', async () => {
  const React = await import('react')
  return { default: React.forwardRef(() => null) }
})
vi.mock('./components/canvas/OutpaintCanvas', async () => {
  const React = await import('react')
  return { default: React.forwardRef(() => null) }
})
vi.mock('@/features/image-workstation/download', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/image-workstation/download')>()
  return { ...actual, blobFromImageSource: vi.fn(async () => new Blob(['variant'], { type: 'image/png' })), downloadImageAsset: vi.fn(async () => {}) }
})
vi.mock('@/pages/Toolbox/shared/zip', () => ({
  createResultZip: vi.fn(async () => new Blob(['zip'], { type: 'application/zip' })),
  downloadBlob: vi.fn(),
}))

import ImageWorkstation from './index'
import { OUTPAINT_IDLE_REASONS } from './utils/generateGate'

/** 按按钮文字定位，避免 jsdom 为可访问名称计算整页样式。 */
function buttonByText(name: RegExp) {
  const button = screen.getByText(name).closest('button')
  if (!button) throw new Error('未找到对应按钮')
  return button
}

describe('图片工作站配置提示', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })))
    // 涂抹/扩图画布是懒加载的真实组件，jsdom 没有 ResizeObserver。
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    mocks.status.capabilities = { imageEdit: undefined, variation: undefined, repaint: undefined, erase: undefined, smartSelect: undefined }
    mocks.status.error = null
    mocks.status.refetch.mockReset()
    mocks.models = []
    mocks.modelsLoading = false
    mocks.controller.inputAsset = undefined
    mocks.controller.outputAssets = []
    mocks.controller.formLocked = false
    mocks.controller.resultReadError = undefined
    mocks.controller.readingResults = false
    mocks.controller.retryRead.mockReset()
    mocks.controller.retryRead.mockResolvedValue(true)
    mocks.controller.generate.mockReset()
    mocks.controller.generate.mockResolvedValue({ status: 'succeeded' })
    mocks.controller.selectOutput.mockReset()
    mocks.controller.active = false
    mocks.controller.submitting = false
    mocks.controller.cancelling = false
    mocks.controller.activeTask = undefined
    mocks.controller.cancel.mockReset()
    mocks.controller.cancel.mockResolvedValue(undefined)
    vi.mocked(downloadBlob).mockReset()
    vi.mocked(downloadImageAsset).mockClear()
    mocks.fusion.product = undefined
    mocks.fusion.reference = undefined
    mocks.fusion.lastScene = undefined
    mocks.fusion.errors = {}
    mocks.fusion.reusingLastScene = false
    mocks.fusion.reuseLastScene.mockReset()
    mocks.fusion.reuseLastScene.mockResolvedValue({ id: 'last-scene' })
    usePreferencesStore.setState({ preferences: defaultPreferences(), memoryEpoch: 0 })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    useUserStore.setState({ userId: null, credits: 0, creditsLoaded: false })
  })

  it.each([
    ['smart-edit', '智能编辑'], ['relight', '重新打光'], ['remove', '消除'], ['repaint', '重绘'],
    ['variation', '裂变'], ['fusion', '融合'], ['outpaint', '扩图'], ['retouch', '精修'],
  ])('%s 共用左右卡片，标题在配置不可用时仍保留', (tool, label) => {
    mocks.tool = tool
    const { container } = render(<App><ImageWorkstation /></App>)
    expect(screen.getByRole('region', { name: '图片与预览' }).contains(container.querySelector('.workstation-canvas-shell'))).toBe(true)
    expect(screen.getByRole('complementary', { name: label })).toBeTruthy()
    expect(screen.getAllByRole('heading', { name: label })).toHaveLength(1)
    expect(container.querySelector('.image-workstation-footer')?.contains(buttonByText(/生成(?: \d+ 张)? ·/))).toBe(true)
  })

  it('示例位于上传区上方，折叠不重建右侧配置和图片区域', () => {
    mocks.tool = 'variation'
    const { container } = render(<App><ImageWorkstation /></App>)
    const example = screen.getByText('示例').closest('details')!
    const settings = screen.getByRole('complementary', { name: '裂变' })
    const preview = screen.getByRole('region', { name: '图片与预览' })
    expect(preview.contains(example)).toBe(true)
    expect(container.querySelector('.workstation-empty-extra .variation-example')).toBe(example)
    expect(example.open).toBe(true)
    example.open = false
    fireEvent(example, new Event('toggle'))
    expect(screen.getByRole('complementary', { name: '裂变' })).toBe(settings)
    expect(screen.getByRole('region', { name: '图片与预览' })).toBe(preview)
    expect(container.querySelector('.is-sticky')).toBeNull()
  })

  it('精修空状态展示承诺副标题与教学示例', () => {
    mocks.tool = 'retouch'
    const { container } = render(<App><ImageWorkstation /></App>)
    expect(screen.getByText('轻微修图，保留颜色、文字和构图。')).toBeTruthy()
    const example = screen.getByText('示例').closest('details')!
    expect(container.querySelector('.workstation-empty-extra .retouch-example')).toBe(example)
    expect(screen.getByText('文字与颜色不变')).toBeTruthy()
    expect(screen.getAllByText('已选：去瑕疵、提亮').length).toBeGreaterThan(0)
  })

  it.each(['product', 'reference', 'both'])('融合上传 %s 后隐藏示例，图片仍在对应槽位', (input) => {
    mocks.tool = 'fusion'
    const asset = { id: 'fusion-input', name: '商品.png', width: 800, height: 800, url: 'blob:fusion' }
    if (input !== 'reference') mocks.fusion.product = asset
    if (input !== 'product') mocks.fusion.reference = asset
    render(<App><ImageWorkstation /></App>)
    expect(screen.queryByText('示例')).toBeNull()
    if (mocks.fusion.product) expect(screen.getByAltText('商品')).toBeTruthy()
    if (mocks.fusion.reference) expect(screen.getByAltText('场景图')).toBeTruthy()
  })

  it('点击融合槽位图片在大图中查看并下载输入图', async () => {
    mocks.tool = 'fusion'
    mocks.fusion.product = { id: 'product', name: '商品.png', width: 1200, height: 800, url: 'data:image/png;base64,product' }
    mocks.fusion.reference = { id: 'reference', name: '客厅.png', width: 1200, height: 800, url: 'data:image/png;base64,reference' }
    render(<App><ImageWorkstation /></App>)
    fireEvent.click(screen.getByRole('button', { name: '查看商品大图' }))
    expect(await screen.findByText('图片预览：商品.png')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下载图片' }))
    await act(async () => {})
    expect(downloadImageAsset).toHaveBeenCalledWith(expect.objectContaining({ id: 'product' }), '商品.png')
  })

  it('融合单张载入失败在对应槽位内联提示', () => {
    mocks.tool = 'fusion'
    mocks.fusion.product = { id: 'product', name: '商品.png', width: 1200, height: 800, url: 'blob:product' }
    mocks.fusion.errors = { reference: '仅支持 PNG、JPEG 和 WebP 图片' }
    render(<App><ImageWorkstation /></App>)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('仅支持 PNG、JPEG 和 WebP 图片')
    expect(alert.closest('.workstation-fusion-slot')?.textContent).toContain('场景图')
  })

  it('融合空场景槽位可一键使用上次场景', async () => {
    mocks.tool = 'fusion'
    mocks.fusion.product = { id: 'product', name: '商品.png', width: 1200, height: 800, url: 'blob:product' }
    mocks.fusion.lastScene = { name: '客厅.png', width: 1200, height: 800, savedAt: '2026-11-09T00:00:00.000Z' }
    render(<App><ImageWorkstation /></App>)
    fireEvent.click(screen.getByRole('button', { name: '使用上次场景 1200×800' }))
    await act(async () => {})
    expect(mocks.fusion.reuseLastScene).toHaveBeenCalledOnce()
  })

  it('生成中提供取消入口，取消后提示已取消', async () => {
    mocks.tool = 'smart-edit'
    mocks.controller.active = true
    mocks.controller.activeTask = {
      id: 'task-1', capability: 'image_edit', status: 'processing', params: {},
      creditsCost: 2, createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z',
    }
    render(<App><ImageWorkstation /></App>)
    fireEvent.click(screen.getByRole('button', { name: '取消生成' }))
    await act(async () => {})
    expect(mocks.controller.cancel).toHaveBeenCalledOnce()
  })

  it('没有进行中的任务时不显示取消入口', () => {
    mocks.tool = 'smart-edit'
    render(<App><ImageWorkstation /></App>)
    expect(screen.queryByRole('button', { name: '取消生成' })).toBeNull()
  })

  it('融合多结果改用网格并排对比，单张保持结果条', () => {
    mocks.tool = 'fusion'
    const results = [1, 2].map(index => ({
      id: `result-${index}`, type: 'image', name: `结果 ${index}`, url: `blob:result-${index}`,
      width: 1200, height: 800, mimeType: 'image/png', createdAt: new Date().toISOString(), source: 'generation',
    }))
    mocks.controller.outputAssets = [results[0]]
    const view = render(<App><ImageWorkstation /></App>)
    expect(view.container.querySelector('.workstation-result-list.is-grid')).toBeNull()
    mocks.controller.outputAssets = results
    view.rerender(<App><ImageWorkstation /></App>)
    expect(view.container.querySelector('.workstation-result-list.is-grid')).toBeTruthy()
    expect(screen.getByText('2 张')).toBeTruthy()
    expect(screen.getByRole('button', { name: '下载全部' })).toBeTruthy()
  })

  it('融合预览面板带 is-fusion 标记，移动端不沿用单图吸顶压缩', () => {
    mocks.tool = 'fusion'
    const { container } = render(<App><ImageWorkstation /></App>)
    expect(container.querySelector('.image-workstation-preview-panel.is-fusion')).toBeTruthy()
  })

  it('融合右栏给出商品换场景定位与固定契约', () => {
    mocks.tool = 'fusion'
    render(<App><ImageWorkstation /></App>)
    expect(screen.getByText('保留商品，把背景换成第二张图的场景。')).toBeTruthy()
    expect(screen.getByText('商品形状、颜色、表面纹理、印刷文字和 Logo')).toBeTruthy()
    expect(screen.getByText('只提供背景与氛围，不会把场景物体画进商品')).toBeTruthy()
  })

  it('融合缺图时页脚按槽位提示，不再重复整句原因', () => {
    mocks.tool = 'fusion'
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    render(<App><ImageWorkstation /></App>)
    expect(screen.getByText('请上传商品图 · 请上传场景图')).toBeTruthy()
    expect(screen.queryByText('请先上传商品图和场景图')).toBeNull()
  })

  it.each([
    ['none', '请上传商品图'],
    ['product', '请上传场景图'],
    ['reference', '请上传商品图'],
  ])('融合预览状态按缺失的槽位提示（%s）', (input, expected) => {
    mocks.tool = 'fusion'
    const product = { id: 'product', name: '商品.png', width: 1200, height: 800, url: 'blob:product' }
    const reference = { id: 'reference', name: '场景.png', width: 640, height: 480, url: 'blob:reference' }
    if (input === 'product') mocks.fusion.product = product
    if (input === 'reference') mocks.fusion.reference = reference
    const { container } = render(<App><ImageWorkstation /></App>)
    expect(container.querySelector('.workstation-preview-meta')?.textContent).toBe(expected)
  })

  it('融合双图齐备后按商品图显示尺寸并估算输出，不再显示等待上传', () => {
    mocks.tool = 'fusion'
    mocks.fusion.product = { id: 'product', name: '商品.png', width: 1200, height: 800, url: 'blob:product' }
    mocks.fusion.reference = { id: 'reference', name: '场景.png', width: 640, height: 480, url: 'blob:reference' }
    const { container } = render(<App><ImageWorkstation /></App>)
    expect(container.querySelector('.workstation-preview-meta')?.textContent).toBe('1200×800')
    expect(screen.queryByText('等待上传')).toBeNull()
    expect(screen.getByText(/预计输出/)).toBeTruthy()
  })

  it('融合结果回到主舞台，结果条使用本次结果语义', () => {
    mocks.tool = 'fusion'
    mocks.fusion.product = { id: 'product', name: '商品.png', width: 1200, height: 800, url: 'blob:product' }
    mocks.fusion.reference = { id: 'reference', name: '场景.png', width: 640, height: 480, url: 'blob:reference' }
    const result = { id: 'fusion-result', type: 'image', name: '融合结果.png', width: 1200, height: 800, url: 'blob:result' }
    mocks.controller.outputAssets = [result]
    mocks.controller.inputAsset = result
    render(<App><ImageWorkstation /></App>)
    expect(screen.getByAltText('融合结果').getAttribute('src')).toBe('blob:result')
    expect(screen.getByText('本次结果')).toBeTruthy()
    expect(screen.queryByText('下一轮输入')).toBeNull()
    expect(screen.getByText('第 1 张已在预览区显示')).toBeTruthy()
  })

  it('未上线的单图工具不展示上一工具的图片', () => {
    mocks.tool = 'variation'
    mocks.status.capabilities.variation = false
    mocks.controller.inputAsset = { id: 'previous', name: '上一工具.png', width: 800, height: 800, url: 'blob:previous' }
    const { container } = render(<App><ImageWorkstation /></App>)
    expect(screen.getByText('上传需要处理的商品图片')).toBeTruthy()
    expect(screen.queryByAltText('当前编辑效果')).toBeNull()
    expect(container.querySelector('.is-sticky')).toBeNull()
  })

  it.each(['smart-edit', 'relight', 'variation', 'fusion', 'retouch', 'repaint'])('%s 等待配置时不闪现未上线提示', async (tool) => {
    mocks.tool = tool
    const { container, rerender } = render(<App><ImageWorkstation /></App>)
    expect(screen.getByText('正在加载功能配置…').getAttribute('role')).toBe('status')
    expect(container.textContent).not.toContain('即将上线')
    expect(container.textContent).not.toContain('还不能用')
    expect(buttonByText(/生成(?: \d+ 张)? ·/).disabled).toBe(true)

    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    rerender(<App><ImageWorkstation /></App>)
    expect(screen.queryByText('正在加载功能配置…')).toBeNull()
    expect(container.textContent).not.toContain('即将上线')
    expect(container.textContent).not.toContain('还不能用')
  })

  it('加载失败只显示重试，保留参数面板', () => {
    mocks.tool = 'variation'
    mocks.status.error = new Error('网络错误')
    const { container } = render(<App><ImageWorkstation /></App>)
    expect(screen.getByRole('alert', { hidden: true }).textContent).toContain('功能配置加载失败，请重试')
    expect(screen.getByRole('button', { name: /添加补充要求/ })).toBeTruthy()
    expect(container.textContent).not.toContain('即将上线')
    fireEvent.click(buttonByText(/^重\s*试$/))
    expect(mocks.status.refetch).toHaveBeenCalledOnce()
  })

  it('确认裂变未配置后才显示未上线标签和能力提示', () => {
    mocks.tool = 'variation'
    mocks.status.capabilities.variation = false
    render(<App><ImageWorkstation /></App>)
    expect(screen.getByText('裂变 · 即将上线')).toBeTruthy()
    expect(screen.queryByText('基于原图再生成一版变体。')).toBeNull()
    expect(screen.getByText('示例')).toBeTruthy()
    expect(screen.getByRole('img', { name: '原图示意：白底商品图' })).toBeTruthy()
    expect(screen.getByText('该功能即将上线，敬请期待。')).toBeTruthy()
    expect(screen.queryByText('补充要求（可选）')).toBeNull()
  })

  it('未上传时展示裂变和融合示例，上传后收起', () => {
    mocks.tool = 'variation'
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    const view = render(<App><ImageWorkstation /></App>)
    expect(screen.queryByText('基于原图再生成一版变体。')).toBeNull()
    expect(screen.getByRole('heading', { name: '裂变' })).toBeTruthy()
    expect(screen.getByRole('img', { name: '变体示意：保留商品，背景换成户外木桌' })).toBeTruthy()
    view.unmount()

    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 800, height: 800, url: 'blob:uploaded' }
    render(<App><ImageWorkstation /></App>)
    expect(screen.queryByText('示例')).toBeNull()
    cleanup()

    mocks.tool = 'fusion'
    mocks.controller.inputAsset = undefined
    render(<App><ImageWorkstation /></App>)
    expect(screen.queryByText('把多张图合成一个场景。')).toBeNull()
    expect(screen.getByRole('heading', { name: '融合' })).toBeTruthy()
    expect(screen.getByAltText('提供新背景的木桌场景图')).toBeTruthy()
    expect(screen.getByAltText('滴管瓶放入木桌场景后的合成结果')).toBeTruthy()
  })

  it('智能编辑未上传时在上传区展示示意教学，上传后隐藏', () => {
    mocks.tool = 'smart-edit'
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    const { container } = render(<App><ImageWorkstation /></App>)
    expect(screen.getByText('示例')).toBeTruthy()
    expect(container.querySelector('.workstation-empty-extra .smart-edit-example')).toBeTruthy()
    for (const label of ['换背景', '换颜色', '加元素']) expect(screen.getByText(label)).toBeTruthy()
    expect(screen.getByRole('img', { name: '换背景示意：保留商品，把背景换成新场景' })).toBeTruthy()
    cleanup()

    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 800, height: 800, url: 'blob:uploaded' }
    render(<App><ImageWorkstation /></App>)
    expect(screen.queryByText('示例')).toBeNull()
  })

  it('未上传时按所选张数和分辨率显示报价，按钮保持禁用', () => {
    const preferences = defaultPreferences()
    preferences.image.resolution = '1k'
    preferences.image.counts = { 'smart-edit': 1, relight: 1, variation: 2, fusion: 1, retouch: 1 }
    usePreferencesStore.setState({ preferences, memoryEpoch: 1 })
    mocks.models = [publicImageModel(defaultImageModel('image_edit')!)]
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    const cases = [
      ['smart-edit', '生成 1 张 · 4 积分'],
      ['relight', '生成 1 张 · 4 积分'],
      ['variation', '生成 2 张 · 8 积分'],
      ['fusion', '生成 1 张 · 4 积分'],
      ['retouch', '生成 1 张 · 4 积分'],
      ['remove', '生成 · 5 积分'],
      ['repaint', '生成 · 5 积分'],
      ['outpaint', '生成 · 最多 10 积分'],
    ] as const
    for (const [tool, label] of cases) {
      mocks.tool = tool
      const view = render(<App><ImageWorkstation /></App>)
      const button = buttonByText(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      expect(button.textContent?.replace(/\s+/g, '')).toContain(label.replace(/\s+/g, ''))
      expect(button.disabled).toBe(true)
      expect(view.container.textContent).toContain(tool === 'fusion' ? '请上传商品图' : '请先上传需要处理的图片')
      view.unmount()
    }
  })

  it('未上传时改张数会更新报价，上传后仍按有效分辨率报价', () => {
    const preferences = defaultPreferences()
    preferences.image.resolution = '1k'
    preferences.image.counts['smart-edit'] = 1
    usePreferencesStore.setState({ preferences, memoryEpoch: 2 })
    mocks.tool = 'smart-edit'
    mocks.models = [publicImageModel(defaultImageModel('image_edit')!)]
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    const view = render(<App><ImageWorkstation /></App>)
    expect(buttonByText(/生成 1 张 · 4 积分/).disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: '2' }))
    expect(buttonByText(/生成 2 张 · 8 积分/).disabled).toBe(true)

    view.unmount()
    preferences.image.resolution = '2k'
    preferences.image.counts['smart-edit'] = 1
    usePreferencesStore.setState({ preferences, memoryEpoch: 3 })
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 1000, height: 1000, url: 'blob:uploaded' }
    render(<App><ImageWorkstation /></App>)
    fireEvent.change(screen.getByPlaceholderText('例如：换成纯白电商背景，保留商品细节'), { target: { value: '换成纯白背景' } })
    expect(buttonByText(/生成 1 张 · 6 积分/).disabled).toBe(false)

    cleanup()
    preferences.image.resolution = '4k'
    usePreferencesStore.setState({ preferences, memoryEpoch: 4 })
    render(<App><ImageWorkstation /></App>)
    expect(buttonByText(/生成 1 张 · 6 积分/)).toBeTruthy()
    expect(screen.queryByText(/生成 1 张 · 14 积分/)).toBeNull()
  })

  it('智能编辑未填写编辑要求时禁用生成，填写后恢复', () => {
    const preferences = defaultPreferences()
    preferences.image.resolution = '1k'
    preferences.image.counts['smart-edit'] = 1
    usePreferencesStore.setState({ preferences, memoryEpoch: 2 })
    mocks.tool = 'smart-edit'
    mocks.models = [publicImageModel(defaultImageModel('image_edit')!)]
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 1000, height: 1000, url: 'blob:uploaded' }
    render(<App><ImageWorkstation /></App>)
    expect(buttonByText(/生成 1 张 · 4 积分/).disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('例如：换成纯白电商背景，保留商品细节'), { target: { value: '换成纯白背景' } })
    expect(buttonByText(/生成 1 张 · 4 积分/).disabled).toBe(false)
  })

  it('结果读取失败时页脚以重试读取为主操作，生成按钮降级', () => {
    const preferences = defaultPreferences()
    preferences.image.resolution = '1k'
    preferences.image.counts['smart-edit'] = 1
    usePreferencesStore.setState({ preferences, memoryEpoch: 2 })
    mocks.tool = 'smart-edit'
    mocks.models = [publicImageModel(defaultImageModel('image_edit')!)]
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 1000, height: 1000, url: 'blob:uploaded' }
    mocks.controller.resultReadError = '仅支持 PNG、JPEG 和 WebP 图片'
    render(<App><ImageWorkstation /></App>)
    fireEvent.change(screen.getByPlaceholderText('例如：换成纯白电商背景，保留商品细节'), { target: { value: '换成纯白背景' } })
    const retryRead = screen.getByRole('button', { name: '重试读取' })
    expect(retryRead.className).toContain('ant-btn-primary')
    expect(buttonByText(/生成 1 张 · 4 积分/).className).toContain('ant-btn-default')
    expect(screen.getByText('结果暂时无法读取 · 可免费重试')).toBeTruthy()
    fireEvent.click(retryRead)
    expect(mocks.controller.retryRead).toHaveBeenCalledTimes(1)
  })

  it('重新打光结果读取失败时只在页脚保留结论，画布不再叠加警告', () => {
    const preferences = defaultPreferences()
    preferences.image.resolution = '1k'
    preferences.image.counts.relight = 1
    usePreferencesStore.setState({ preferences, memoryEpoch: 2 })
    mocks.tool = 'relight'
    mocks.models = [publicImageModel(defaultImageModel('image_edit')!)]
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.resultReadError = '仅支持 PNG、JPEG 和 WebP 图片'
    render(<App><ImageWorkstation /></App>)
    expect(screen.getByText('结果暂时无法读取 · 可免费重试')).toBeTruthy()
    expect(screen.queryByText('结果暂时无法读取，可重试')).toBeNull()
    expect(screen.getByRole('button', { name: '重试读取' }).getAttribute('title')).toBe('任务已完成，但结果读取失败。可免费重试，不会重复扣费。')
  })

  it('裂变结果读取失败时只在页脚保留结论，画布不再叠加警告', () => {
    const preferences = defaultPreferences()
    preferences.image.resolution = '1k'
    preferences.image.counts.variation = 2
    usePreferencesStore.setState({ preferences, memoryEpoch: 2 })
    mocks.tool = 'variation'
    mocks.models = [publicImageModel(defaultImageModel('image_edit')!)]
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 1000, height: 1000, url: 'blob:uploaded' }
    mocks.controller.resultReadError = '仅支持 PNG、JPEG 和 WebP 图片'
    render(<App><ImageWorkstation /></App>)
    expect(screen.getByText('结果暂时无法读取 · 可免费重试')).toBeTruthy()
    expect(screen.queryByText('结果暂时无法读取，可重试')).toBeNull()
    expect(screen.queryByText('结果暂时无法读取', { selector: '.workstation-preview-meta' })).toBeNull()
    expect(screen.getByRole('button', { name: '重试读取' })).toBeTruthy()
  })

  it('裂变结果以网格并排展示，并提供下载全部', () => {
    mocks.tool = 'variation'
    mocks.models = [publicImageModel(defaultImageModel('image_edit')!)]
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 1000, height: 1000, url: 'blob:uploaded' }
    mocks.controller.outputAssets = [
      { id: 'variant-1', type: 'image', name: '变体 1.png', width: 1024, height: 1024, url: 'blob:variant-1', mimeType: 'image/png' },
      { id: 'variant-2', type: 'image', name: '变体 2.png', width: 1024, height: 1024, url: 'blob:variant-2', mimeType: 'image/png' },
    ]
    render(<App><ImageWorkstation /></App>)
    expect(screen.getByRole('region', { name: '本次变体' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '下载全部' })).toBeTruthy()
    expect(screen.getAllByText('1024×1024')).toHaveLength(2)
    expect(screen.queryByText('候选结果')).toBeNull()
  })

  it('下载全部把多张变体打包成一个 ZIP', async () => {
    mocks.tool = 'variation'
    mocks.models = [publicImageModel(defaultImageModel('image_edit')!)]
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 1000, height: 1000, url: 'blob:uploaded' }
    mocks.controller.outputAssets = [
      { id: 'variant-1', type: 'image', name: '变体 1.png', width: 1024, height: 1024, url: 'blob:variant-1', mimeType: 'image/png' },
      { id: 'variant-2', type: 'image', name: '变体 2.png', width: 1024, height: 1024, url: 'blob:variant-2', mimeType: 'image/png' },
    ]
    render(<App><ImageWorkstation /></App>)
    fireEvent.click(screen.getByRole('button', { name: '下载全部' }))
    await vi.waitFor(() => expect(vi.mocked(downloadBlob)).toHaveBeenCalledTimes(1))
    const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(filename).toBe('裂变_2张变体.zip')
  })

  it('⌘/Ctrl + Enter 在可提交时触发生成', async () => {
    mocks.tool = 'variation'
    mocks.models = [publicImageModel(defaultImageModel('image_edit')!)]
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 1000, height: 1000, url: 'blob:uploaded' }
    render(<App><ImageWorkstation /></App>)
    expect(screen.getByRole('button', { name: /生成 2 张/ }).getAttribute('aria-keyshortcuts')).toBe('Meta+Enter Control+Enter')
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
    await vi.waitFor(() => expect(mocks.controller.generate).toHaveBeenCalledTimes(1))
  })

  it('裂变提交失败 toast 展示接口句子，而不是对象', async () => {
    mocks.tool = 'variation'
    mocks.models = [publicImageModel(defaultImageModel('image_edit')!)]
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 1000, height: 1000, url: 'blob:uploaded' }
    const failure = await apiClient.post('/tasks', {}, {
      adapter: (config: InternalAxiosRequestConfig) => Promise.reject(new AxiosError(
        'Request failed with status code 400',
        AxiosError.ERR_BAD_REQUEST,
        config,
        undefined,
        { data: { error: { message: '原图对象无效', token: 'secret-token' }, code: 'INVALID_SOURCE' }, status: 400, statusText: 'Bad Request', headers: {}, config },
      )),
    }).catch(error => error)
    mocks.controller.generate.mockRejectedValue(failure)
    render(<App><ImageWorkstation /></App>)
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
    expect(await screen.findByText('任务提交失败：原图对象无效')).toBeTruthy()
    expect(screen.queryByText(/object Object|secret-token/)).toBeNull()
  })

  it('裂变提交遇到空的 413 时 toast 保留状态句', async () => {
    mocks.tool = 'variation'
    mocks.models = [publicImageModel(defaultImageModel('image_edit')!)]
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 1000, height: 1000, url: 'blob:uploaded' }
    const failure = await apiClient.post('/tasks', {}, {
      adapter: (config: InternalAxiosRequestConfig) => Promise.reject(new AxiosError(
        'Request failed with status code 413',
        AxiosError.ERR_BAD_REQUEST,
        config,
        undefined,
        { data: '', status: 413, statusText: 'Payload Too Large', headers: {}, config },
      )),
    }).catch(error => error)
    mocks.controller.generate.mockRejectedValue(failure)
    render(<App><ImageWorkstation /></App>)
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
    expect(await screen.findByText('任务提交失败：Request failed with status code 413')).toBeTruthy()
    expect(screen.queryByText(/object Object/)).toBeNull()
  })

  it('重试读取期间按钮与页脚持续给出反馈', () => {
    const preferences = defaultPreferences()
    preferences.image.resolution = '1k'
    preferences.image.counts['smart-edit'] = 1
    usePreferencesStore.setState({ preferences, memoryEpoch: 2 })
    mocks.tool = 'smart-edit'
    mocks.models = [publicImageModel(defaultImageModel('image_edit')!)]
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 1000, height: 1000, url: 'blob:uploaded' }
    mocks.controller.resultReadError = '仅支持 PNG、JPEG 和 WebP 图片'
    const view = render(<App><ImageWorkstation /></App>)
    fireEvent.click(screen.getByRole('button', { name: '重试读取' }))
    expect(mocks.controller.retryRead).toHaveBeenCalledTimes(1)

    mocks.controller.readingResults = true
    mocks.controller.resultReadError = undefined
    view.rerender(<App><ImageWorkstation /></App>)
    expect(screen.getByText('正在读取结果 · 请稍候')).toBeTruthy()
    expect(screen.getByText('正在读取结果', { selector: '.workstation-preview-meta' })).toBeTruthy()
    const readingButton = screen.getByRole('button', { name: /正在读取/ })
    expect(readingButton.className).toContain('ant-btn-loading')
    expect(readingButton.className).toContain('ant-btn-primary')
  })

  it('重试读取再次失败时给出「仍无法读取」的结论', async () => {
    const preferences = defaultPreferences()
    preferences.image.resolution = '1k'
    preferences.image.counts['smart-edit'] = 1
    usePreferencesStore.setState({ preferences, memoryEpoch: 2 })
    mocks.tool = 'smart-edit'
    mocks.models = [publicImageModel(defaultImageModel('image_edit')!)]
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 1000, height: 1000, url: 'blob:uploaded' }
    mocks.controller.resultReadError = '仅支持 PNG、JPEG 和 WebP 图片'
    mocks.controller.retryRead.mockResolvedValue(false)
    const view = render(<App><ImageWorkstation /></App>)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重试读取' }))
    })

    mocks.controller.readingResults = true
    mocks.controller.resultReadError = undefined
    view.rerender(<App><ImageWorkstation /></App>)
    expect(screen.getByText('正在读取结果 · 请稍候')).toBeTruthy()

    mocks.controller.readingResults = false
    mocks.controller.resultReadError = '仅支持 PNG、JPEG 和 WebP 图片'
    view.rerender(<App><ImageWorkstation /></App>)
    expect(screen.getByText('仍无法读取 · 可免费重试或重新生成')).toBeTruthy()
  })

  it('确认重绘未配置后才显示不能用的提示', () => {
    mocks.tool = 'repaint'
    mocks.status.capabilities.repaint = false
    render(<App><ImageWorkstation /></App>)
    expect(screen.getByText('重绘服务暂不可用，请稍后重试或联系客服。')).toBeTruthy()
    const repaintPrompt = screen.getByLabelText(/重绘描述/)
    expect(repaintPrompt).toBeTruthy()
    expect(repaintPrompt.getAttribute('aria-required')).toBe('true')
    expect(screen.queryByText(/智能选区不消耗积分/)).toBeNull()
    expect(screen.queryByText('上传图片后，涂抹需要消除的区域')).toBeNull()
  })

  it('消除在上传前说明画笔和免费的智能选区，扩图不再展示无效选择', () => {
    mocks.tool = 'remove'
    const remove = render(<App><ImageWorkstation /></App>)
    expect(screen.getByText('上传图片后，涂抹需要消除的区域')).toBeTruthy()
    expect(screen.getByText('智能选区不消耗积分；也可以直接用画笔涂抹。')).toBeTruthy()
    remove.unmount()
    mocks.tool = 'outpaint'
    render(<App><ImageWorkstation /></App>)
    expect(screen.queryByText('默认模型')).toBeNull()
    expect(screen.queryByText('生成数量')).toBeNull()
    expect(screen.queryByText('生成尺寸')).toBeNull()
    expect(screen.getByText('输出目标')).toBeTruthy()
    expect(screen.getByText('上传后拖拽绿色边框向外扩展，商品主体保持不变')).toBeTruthy()
  })

  it('扩图零扩展时禁用生成，选择平台尺寸后恢复', () => {
    mocks.tool = 'outpaint'
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 256, height: 256, url: 'blob:uploaded' }
    render(<App><ImageWorkstation /></App>)
    const generate = () => buttonByText(/^生成/)
    const reason = document.getElementById('workstation-block-reason')
    expect(generate().disabled).toBe(true)
    expect(reason?.getAttribute('role')).toBe('status')
    expect(reason?.textContent).toBe(OUTPAINT_IDLE_REASONS.free)
    expect(reason?.getAttribute('title')).toBeNull()
    expect(generate().getAttribute('aria-describedby')).toBe('workstation-block-reason')
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(mocks.controller.generate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('radio', { name: '平台尺寸' }))
    expect(generate().disabled).toBe(false)
    expect(document.getElementById('workstation-block-reason')).toBeNull()
    expect(generate().getAttribute('aria-describedby')).toBeNull()
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(mocks.controller.generate).toHaveBeenCalledTimes(1)
  })

  it('扩图提交中隐藏禁用原因，页脚改为正在生成且不能再次提交', () => {
    mocks.tool = 'outpaint'
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 256, height: 256, url: 'blob:uploaded' }
    mocks.controller.submitting = true
    render(<App><ImageWorkstation /></App>)
    const generate = buttonByText(/^生成/)
    expect(generate.disabled).toBe(true)
    expect(document.getElementById('workstation-block-reason')).toBeNull()
    expect(screen.getByText('正在生成 · 请稍候')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(mocks.controller.generate).not.toHaveBeenCalled()
  })

  it('重新打光单独选择模型，报价和提交跟着当前下拉', () => {
    const preferences = defaultPreferences()
    preferences.image.resolution = '1k'
    preferences.image.counts = { 'smart-edit': 1, relight: 1, variation: 2, fusion: 1, retouch: 1 }
    usePreferencesStore.setState({ preferences, memoryEpoch: 5 })
    const gpt = publicImageModel(defaultImageModel('image_edit')!)
    const qwen = publicImageModel(IMAGE_MODEL_PROFILES.find(item => item.id === 'bailian:qwen-image-3.0')!)
    mocks.models = [gpt, qwen]
    mocks.tool = 'smart-edit'
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    const view = render(<App><ImageWorkstation /></App>)
    expect(buttonByText(/生成 1 张 · 4 积分/)).toBeTruthy()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '模型' }))
    fireEvent.click(screen.getByTitle('Qwen Image 3.0'))
    expect(buttonByText(/生成 1 张 · 3 积分/)).toBeTruthy()
    expect(mocks.controllerArgs?.modelProfileId).toBe(qwen.id)

    mocks.tool = 'relight'
    view.rerender(<App><ImageWorkstation /></App>)
    expect(document.querySelector('.ant-select-selection-item')?.textContent).toContain('GPT Image 2')
    expect(buttonByText(/生成 1 张 · 4 积分/)).toBeTruthy()
    expect(mocks.controllerArgs?.modelProfileId).toBe(gpt.id)

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '模型' }))
    fireEvent.click(screen.getByTitle('Qwen Image 3.0'))
    expect(buttonByText(/生成 1 张 · 3 积分/)).toBeTruthy()
    expect(mocks.controllerArgs?.modelProfileId).toBe(qwen.id)

    mocks.tool = 'smart-edit'
    view.rerender(<App><ImageWorkstation /></App>)
    expect(buttonByText(/生成 1 张 · 3 积分/)).toBeTruthy()
    expect(mocks.controllerArgs?.modelProfileId).toBe(qwen.id)
  })

  it('已知余额低于报价时禁用生成，并保留去充值提示', () => {
    const preferences = defaultPreferences()
    preferences.image.resolution = '2k'
    preferences.image.counts['smart-edit'] = 1
    usePreferencesStore.setState({ preferences, memoryEpoch: 6 })
    mocks.tool = 'smart-edit'
    mocks.models = [publicImageModel(defaultImageModel('image_edit')!)]
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 1000, height: 1000, url: 'blob:uploaded' }
    useUserStore.setState({ userId: '11111111-1111-4111-8111-111111111111', credits: 0, creditsLoaded: false })
    const unknown = render(<App><ImageWorkstation /></App>)
    fireEvent.change(screen.getByPlaceholderText('例如：换成纯白电商背景，保留商品细节'), { target: { value: '换成纯白背景' } })
    expect(buttonByText(/生成 1 张 · 6 积分/).disabled).toBe(false)
    expect(unknown.container.textContent).not.toContain('积分不足')
    unknown.unmount()

    useUserStore.setState({ userId: '11111111-1111-4111-8111-111111111111', credits: 5, creditsLoaded: true })
    const short = render(<App><ImageWorkstation /></App>)
    fireEvent.change(screen.getByPlaceholderText('例如：换成纯白电商背景，保留商品细节'), { target: { value: '换成纯白背景' } })
    expect(buttonByText(/生成 1 张 · 6 积分/).disabled).toBe(true)
    expect(short.container.textContent).toContain('积分不足（本次需 6 积分，当前可用 5 积分）')
    expect(screen.getByRole('button', { name: '去充值' })).toBeTruthy()
    short.unmount()

    useUserStore.setState({ credits: 6, creditsLoaded: true })
    render(<App><ImageWorkstation /></App>)
    fireEvent.change(screen.getByPlaceholderText('例如：换成纯白电商背景，保留商品细节'), { target: { value: '换成纯白背景' } })
    expect(buttonByText(/生成 1 张 · 6 积分/).disabled).toBe(false)
    expect(screen.queryByText(/积分不足/)).toBeNull()
  })

  it('消除有图未涂抹时展示步骤、蒙版状态与固定契约', () => {
    mocks.tool = 'remove'
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 800, height: 800, url: 'blob:uploaded' }
    render(<App><ImageWorkstation /></App>)
    expect(screen.getByRole('list', { name: '消除步骤' })).toBeTruthy()
    expect(screen.getByText('先在左侧图片上涂抹要消除的区域')).toBeTruthy()
    expect(screen.getByText('尚未涂抹，在左侧图片上涂抹要消除的区域')).toBeTruthy()
    expect(screen.getByText('请先涂抹要消除的区域')).toBeTruthy()
    expect(screen.getByText('通义万相 2.1 图像编辑')).toBeTruthy()
    expect(buttonByText(/生成 · 5 积分/).disabled).toBe(true)
  })

  it('消除接入涂抹类吸顶态标记，吸顶后由紧凑条接管状态说明', () => {
    mocks.tool = 'remove'
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 800, height: 800, url: 'blob:uploaded' }
    const { container } = render(<App><ImageWorkstation /></App>)
    expect(container.querySelector('.image-workstation-preview-panel.is-inpaint')).toBeTruthy()
    expect(screen.getByText('尚未涂抹，回到画布继续涂抹')).toBeTruthy()
  })

  it('确认消除未配置后显示不可用提示并禁用生成', () => {
    mocks.tool = 'remove'
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: false, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 800, height: 800, url: 'blob:uploaded' }
    render(<App><ImageWorkstation /></App>)
    expect(screen.getAllByText('消除服务暂不可用，请稍后重试或联系客服。').length).toBeGreaterThan(0)
    expect(buttonByText(/生成 · 5 积分/).disabled).toBe(true)
  })

  it('重绘有图未涂抹时展示步骤与页脚可见禁用原因', () => {
    mocks.tool = 'repaint'
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 800, height: 800, url: 'blob:uploaded' }
    render(<App><ImageWorkstation /></App>)
    expect(screen.getByText('先在左侧图片上涂抹要重绘的区域')).toBeTruthy()
    expect(screen.getByText('请先涂抹要重绘的区域')).toBeTruthy()
    expect(buttonByText(/生成 · 5 积分/).disabled).toBe(true)
    expect(screen.getByText('请先涂抹要重绘的区域').closest('#workstation-block-reason')).toBeTruthy()
  })

  it('消除成功后保留原图与蒙版，主推下载并可再生成一版', () => {
    mocks.tool = 'remove'
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 800, height: 800, url: 'blob:uploaded' }
    mocks.controller.outputAssets = [{ id: 'result', name: '结果.png', width: 800, height: 800, url: 'blob:result', mimeType: 'image/png' }]
    render(<App><ImageWorkstation /></App>)
    expect(mocks.controllerArgs?.keepInputOnSuccess).toBe(true)
    expect(screen.getByText('本次结果')).toBeTruthy()
    expect(buttonByText(/再生成一版/)).toBeTruthy()
    expect(buttonByText(/再生成一版/).className).not.toContain('ant-btn-primary')
    expect(buttonByText(/下载结果/).className).toContain('ant-btn-primary')
    expect(screen.getByRole('radiogroup', { name: '对比原图与效果' })).toBeTruthy()
  })

  it('重绘已有结果且输入仍是原图时，主按钮显示再生成一版', () => {
    mocks.tool = 'repaint'
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 800, height: 800, url: 'blob:uploaded' }
    mocks.controller.outputAssets = [{ id: 'result', name: '结果.png', width: 800, height: 800, url: 'blob:result', mimeType: 'image/png' }]
    render(<App><ImageWorkstation /></App>)
    expect(buttonByText(/再生成一版/)).toBeTruthy()
  })

  it('精修成功后保留原图，下载为主操作并可再生成一版', () => {
    mocks.tool = 'retouch'
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 800, height: 800, url: 'blob:uploaded' }
    mocks.controller.outputAssets = [{ id: 'result', name: '结果.png', width: 800, height: 800, url: 'blob:result', mimeType: 'image/png' }]
    render(<App><ImageWorkstation /></App>)
    expect(mocks.controllerArgs?.keepInputOnSuccess).toBe(true)
    expect(screen.getByText('本次结果')).toBeTruthy()
    expect(buttonByText(/再生成一版/).className).not.toContain('ant-btn-primary')
    expect(buttonByText(/下载结果/).className).toContain('ant-btn-primary')
    expect(screen.getByRole('radiogroup', { name: '对比原图与效果' })).toBeTruthy()
  })

  it('精修点击缩略图只切换预览，不替换输入', () => {
    mocks.tool = 'retouch'
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 800, height: 800, url: 'blob:uploaded' }
    mocks.controller.outputAssets = [
      { id: 'result-1', name: '结果 1.png', width: 800, height: 800, url: 'blob:result-1', mimeType: 'image/png' },
      { id: 'result-2', name: '结果 2.png', width: 800, height: 800, url: 'blob:result-2', mimeType: 'image/png' },
    ]
    render(<App><ImageWorkstation /></App>)
    expect(screen.getByAltText('当前编辑效果').getAttribute('src')).toBe('blob:result-1')
    fireEvent.click(screen.getByRole('button', { name: '选择结果 2' }))
    expect(mocks.controller.selectOutput).not.toHaveBeenCalled()
    expect(screen.getByAltText('当前编辑效果').getAttribute('src')).toBe('blob:result-2')
  })

  it('精修多结果以网格展示并可打包下载', async () => {
    mocks.tool = 'retouch'
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 800, height: 800, url: 'blob:uploaded' }
    mocks.controller.outputAssets = [
      { id: 'result-1', name: '结果 1.png', width: 800, height: 800, url: 'blob:result-1', mimeType: 'image/png' },
      { id: 'result-2', name: '结果 2.png', width: 800, height: 800, url: 'blob:result-2', mimeType: 'image/png' },
    ]
    render(<App><ImageWorkstation /></App>)
    expect(screen.getByRole('group', { name: '本次结果' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下载全部' }))
    await vi.waitFor(() => expect(vi.mocked(downloadBlob)).toHaveBeenCalledTimes(1))
    const [, filename] = vi.mocked(downloadBlob).mock.calls[0]
    expect(filename).toBe('精修_2张结果.zip')
  })

  it('继续精修此结果需要确认，确认后才设为新输入', async () => {
    mocks.tool = 'retouch'
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 800, height: 800, url: 'blob:uploaded' }
    mocks.controller.outputAssets = [{ id: 'result', name: '结果.png', width: 800, height: 800, url: 'blob:result', mimeType: 'image/png' }]
    render(<App><ImageWorkstation /></App>)
    fireEvent.click(screen.getByRole('button', { name: '继续精修此结果' }))
    await vi.waitFor(() => expect(document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')).toBeTruthy())
    expect(mocks.controller.selectOutput).not.toHaveBeenCalled()
    fireEvent.click(document.querySelector('.ant-modal-confirm-btns .ant-btn-primary')!)
    await vi.waitFor(() => expect(mocks.controller.selectOutput).toHaveBeenCalledWith('result'))
  })

  it('读取失败时把计费提醒内联到页脚并让重试成为唯一主操作', () => {
    mocks.tool = 'retouch'
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 800, height: 800, url: 'blob:uploaded' }
    mocks.controller.outputAssets = [{ id: 'result', name: '结果.png', width: 800, height: 800, url: 'blob:result', mimeType: 'image/png' }]
    mocks.controller.resultReadError = '结果读取失败'
    render(<App><ImageWorkstation /></App>)
    expect(screen.getByText('重新生成会再次计费，建议先重试读取')).toBeTruthy()
    expect(buttonByText(/再生成一版/).getAttribute('aria-describedby')).toBe('workstation-retry-advice')
    expect(buttonByText(/下载结果/).className).not.toContain('ant-btn-primary')
    expect(screen.getByRole('button', { name: '重试读取' }).className).toContain('ant-btn-primary')
  })

  it('消除和扩图在已知余额不足时显示积分不足，未知余额不拦截', () => {
    mocks.models = [publicImageModel(defaultImageModel('image_edit')!)]
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, erase: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 800, height: 800, url: 'blob:uploaded' }
    useUserStore.setState({ userId: '11111111-1111-4111-8111-111111111111', credits: 1, creditsLoaded: true })
    mocks.tool = 'remove'
    const remove = render(<App><ImageWorkstation /></App>)
    expect(buttonByText(/生成 · 5 积分/).disabled).toBe(true)
    expect(remove.container.textContent).toContain('积分不足（本次需 5 积分，当前可用 1 积分）')
    expect(screen.getByRole('button', { name: '去充值' })).toBeTruthy()
    remove.unmount()

    mocks.tool = 'outpaint'
    mocks.controller.inputAsset = undefined
    const outpaint = render(<App><ImageWorkstation /></App>)
    expect(buttonByText(/生成 · 最多 10 积分/).disabled).toBe(true)
    expect(outpaint.container.textContent).toContain('积分不足（本次最多需 10 积分，当前可用 1 积分）')
  })
})
