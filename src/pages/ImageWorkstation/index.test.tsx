// @vitest-environment jsdom

import { App } from 'antd'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IMAGE_MODEL_PROFILES, defaultImageModel, publicImageModel } from '@shared/image-models'
import { defaultPreferences } from '@shared/preferences'
import { usePreferencesStore } from '@/features/preferences/store'
import { useUserStore } from '@/store/useUserStore'

const mocks = vi.hoisted(() => ({
  tool: 'variation',
  status: {
    capabilities: { imageEdit: undefined, variation: undefined, repaint: undefined, smartSelect: undefined } as Record<string, boolean | undefined>,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  controller: { outputAssets: [] as unknown[], formLocked: false, replaceSourceAsset: vi.fn(), inputAsset: undefined as { id: string; name: string; width: number; height: number; url: string } | undefined },
  controllerArgs: undefined as { modelProfileId?: string } | undefined,
  models: [] as unknown[],
  modelsLoading: false,
  fusion: {
    product: undefined as { id: string; name: string; width: number; height: number; url: string } | undefined,
    reference: undefined as { id: string; name: string; width: number; height: number; url: string } | undefined,
    loading: { product: false, reference: false },
    load: vi.fn(),
  },
}))
vi.mock('react-router-dom', () => ({ useParams: () => ({ tool: mocks.tool }), useNavigate: () => vi.fn() }))
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

import ImageWorkstation from './index'

/** 按按钮文字定位，避免 jsdom 为可访问名称计算整页样式。 */
function buttonByText(name: RegExp) {
  const button = screen.getByText(name).closest('button')
  if (!button) throw new Error('未找到对应按钮')
  return button
}

describe('图片工作站配置提示', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })))
    mocks.status.capabilities = { imageEdit: undefined, variation: undefined, repaint: undefined, smartSelect: undefined }
    mocks.status.error = null
    mocks.status.refetch.mockReset()
    mocks.models = []
    mocks.modelsLoading = false
    mocks.controller.inputAsset = undefined
    mocks.controller.outputAssets = []
    mocks.controller.formLocked = false
    mocks.fusion.product = undefined
    mocks.fusion.reference = undefined
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

  it('示例位于左栏独立卡片，折叠不重建右侧配置和图片区域', () => {
    mocks.tool = 'variation'
    const { container } = render(<App><ImageWorkstation /></App>)
    const example = screen.getByText('示例').closest('details')!
    const settings = screen.getByRole('complementary', { name: '裂变' })
    const preview = screen.getByRole('region', { name: '图片与预览' })
    expect(example.parentElement).toBe(container.querySelector('.image-workstation-canvas-column'))
    expect(preview.contains(example)).toBe(false)
    expect(example.open).toBe(true)
    example.open = false
    fireEvent(example, new Event('toggle'))
    expect(screen.getByRole('complementary', { name: '裂变' })).toBe(settings)
    expect(screen.getByRole('region', { name: '图片与预览' })).toBe(preview)
    expect(container.querySelector('.is-sticky')).toBeNull()
  })

  it.each(['product', 'reference', 'both'])('融合上传 %s 后隐藏示例，图片仍在对应槽位', (input) => {
    mocks.tool = 'fusion'
    const asset = { id: 'fusion-input', name: '商品.png', width: 800, height: 800, url: 'blob:fusion' }
    if (input !== 'reference') mocks.fusion.product = asset
    if (input !== 'product') mocks.fusion.reference = asset
    render(<App><ImageWorkstation /></App>)
    expect(screen.queryByText('示例')).toBeNull()
    if (mocks.fusion.product) expect(screen.getByAltText('商品')).toBeTruthy()
    if (mocks.fusion.reference) expect(screen.getByAltText('场景或参考')).toBeTruthy()
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
    expect(screen.getByRole('status', { hidden: true }).textContent).toBe('正在加载功能配置…')
    expect(container.textContent).not.toContain('即将上线')
    expect(container.textContent).not.toContain('还不能用')
    expect(buttonByText(/生成(?: \d+ 张)? ·/).disabled).toBe(true)

    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, smartSelect: true }
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
    expect(screen.getByText('补充要求（可选）')).toBeTruthy()
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
    expect(screen.getByAltText('裂变前的白底马克杯')).toBeTruthy()
    expect(screen.getByText('该能力即将上线，目前还不能提交生成任务。')).toBeTruthy()
    expect(screen.queryByText('补充要求（可选）')).toBeNull()
  })

  it('未上传时展示裂变和融合示例，上传后收起', () => {
    mocks.tool = 'variation'
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, smartSelect: true }
    const view = render(<App><ImageWorkstation /></App>)
    expect(screen.queryByText('基于原图再生成一版变体。')).toBeNull()
    expect(screen.getByRole('heading', { name: '裂变' })).toBeTruthy()
    expect(screen.getByAltText('裂变后的马克杯变体')).toBeTruthy()
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
    expect(screen.getByAltText('待融合的木桌场景')).toBeTruthy()
    expect(screen.getByAltText('滴管瓶放入木桌场景后的效果')).toBeTruthy()
  })

  it('未上传时按所选张数和分辨率显示报价，按钮保持禁用', () => {
    const preferences = defaultPreferences()
    preferences.image.resolution = '1k'
    preferences.image.counts = { 'smart-edit': 1, relight: 1, variation: 2, fusion: 1, retouch: 1 }
    usePreferencesStore.setState({ preferences, memoryEpoch: 1 })
    mocks.models = [publicImageModel(defaultImageModel('image_edit')!)]
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, smartSelect: true }
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
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, smartSelect: true }
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
    expect(buttonByText(/生成 1 张 · 6 积分/).disabled).toBe(false)

    cleanup()
    preferences.image.resolution = '4k'
    usePreferencesStore.setState({ preferences, memoryEpoch: 4 })
    render(<App><ImageWorkstation /></App>)
    expect(buttonByText(/生成 1 张 · 6 积分/)).toBeTruthy()
    expect(screen.queryByText(/生成 1 张 · 14 积分/)).toBeNull()
  })

  it('确认重绘未配置后才显示不能用的提示', () => {
    mocks.tool = 'repaint'
    mocks.status.capabilities.repaint = false
    render(<App><ImageWorkstation /></App>)
    expect(screen.getByText('重绘还不能用。请确认已开通万相 wanx2.1-imageedit，并配置 DASHSCOPE_API_KEY。')).toBeTruthy()
    expect(screen.getByText('重绘描述')).toBeTruthy()
    expect(screen.queryByText(/智能选区免费/)).toBeNull()
    expect(screen.queryByText('上传后用画笔或智能选区涂抹要消除的区域')).toBeNull()
  })

  it('消除在上传前说明画笔和免费的智能选区，扩图不再展示无效选择', () => {
    mocks.tool = 'remove'
    const remove = render(<App><ImageWorkstation /></App>)
    expect(screen.getByText('上传后用画笔或智能选区涂抹要消除的区域')).toBeTruthy()
    expect(screen.getByText('上传后用画笔或智能选区涂抹要消除的区域。智能选区免费。')).toBeTruthy()
    remove.unmount()
    mocks.tool = 'outpaint'
    render(<App><ImageWorkstation /></App>)
    expect(screen.queryByText('默认模型')).toBeNull()
    expect(screen.queryByText('生成数量')).toBeNull()
    expect(screen.queryByText('生成尺寸')).toBeNull()
    expect(screen.getByText('输出模式')).toBeTruthy()
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
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, smartSelect: true }
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
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 1000, height: 1000, url: 'blob:uploaded' }
    useUserStore.setState({ userId: '11111111-1111-4111-8111-111111111111', credits: 0, creditsLoaded: false })
    const unknown = render(<App><ImageWorkstation /></App>)
    expect(buttonByText(/生成 1 张 · 6 积分/).disabled).toBe(false)
    expect(unknown.container.textContent).not.toContain('积分不足')
    unknown.unmount()

    useUserStore.setState({ userId: '11111111-1111-4111-8111-111111111111', credits: 5, creditsLoaded: true })
    const short = render(<App><ImageWorkstation /></App>)
    expect(buttonByText(/生成 1 张 · 6 积分/).disabled).toBe(true)
    expect(short.container.textContent).toContain('积分不足，本次需要 6 积分，当前 5')
    expect(screen.getByRole('button', { name: '去充值' })).toBeTruthy()
    short.unmount()

    useUserStore.setState({ credits: 6, creditsLoaded: true })
    render(<App><ImageWorkstation /></App>)
    expect(buttonByText(/生成 1 张 · 6 积分/).disabled).toBe(false)
    expect(screen.queryByText(/积分不足/)).toBeNull()
  })

  it('消除和扩图在已知余额不足时显示积分不足，未知余额不拦截', () => {
    mocks.models = [publicImageModel(defaultImageModel('image_edit')!)]
    mocks.status.capabilities = { imageEdit: true, variation: true, repaint: true, smartSelect: true }
    mocks.controller.inputAsset = { id: 'uploaded', name: '商品.png', width: 800, height: 800, url: 'blob:uploaded' }
    useUserStore.setState({ userId: '11111111-1111-4111-8111-111111111111', credits: 1, creditsLoaded: true })
    mocks.tool = 'remove'
    const remove = render(<App><ImageWorkstation /></App>)
    expect(buttonByText(/生成 · 5 积分/).disabled).toBe(true)
    expect(remove.container.textContent).toContain('积分不足，本次需要 5 积分，当前 1')
    expect(screen.getByRole('button', { name: '去充值' })).toBeTruthy()
    remove.unmount()

    mocks.tool = 'outpaint'
    mocks.controller.inputAsset = undefined
    const outpaint = render(<App><ImageWorkstation /></App>)
    expect(buttonByText(/生成 · 最多 10 积分/).disabled).toBe(true)
    expect(outpaint.container.textContent).toContain('积分不足，本次最多需要 10 积分，当前 1')
  })
})
