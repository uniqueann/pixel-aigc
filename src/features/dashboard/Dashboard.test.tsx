// @vitest-environment jsdom
import { StrictMode } from 'react'
import { App } from 'antd'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dashboard from '@/pages/Dashboard'
import { useUserStore, type AccountContext } from '@/store/useUserStore'
import { useEditorStore } from '@/editor/store'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { setPersistenceUser } from '@/editor/persistence/database'
import { Capability } from '@/types'
import type { PreviewGalleryProps } from '@/components/PreviewGallery'
import type { WorkstationHistoryListItem } from '@/features/assets/workstationHistory'
import type { CapabilityFlags } from '@/services/api/capabilities'
import { rememberTool } from './recentWork'

const mocks = vi.hoisted(() => ({ request: vi.fn(), history: vi.fn(), retry: vi.fn(), createUrl: vi.fn(), revokeUrl: vi.fn(),
  hydrateImages: vi.fn(), hydrateVideos: vi.fn(),
  capabilities: {} as CapabilityFlags, error: null as Error | null,
}))
vi.mock('@/cloud/client', () => ({ authEnabled: true, cloudEnabled: true, cloudRequest: mocks.request }))
vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => ({ capabilities: mocks.capabilities, error: mocks.error, refetch: mocks.retry }) }))
vi.mock('@/features/assets/workstationHistory', () => ({ HISTORY_CHANGED: 'pixel-history-changed', listHistoryPreviews: mocks.history }))
vi.mock('@/features/assets/hydrateImageJobs', () => ({ hydrateWorkstationHistoryFromImageJobs: mocks.hydrateImages }))
vi.mock('@/features/assets/hydrateVideoJobs', () => ({ hydrateVideoJobs: mocks.hydrateVideos }))
vi.mock('@/components/PreviewGallery', () => ({ default: ({ open, items, current, onClose }: PreviewGalleryProps) => open
  ? <div role="dialog">{items[current]?.id}<button onClick={onClose}>关闭预览</button></div> : null }))

const OWNER_A = '11111111-1111-4111-8111-111111111111'
const OWNER_B = '22222222-2222-4222-8222-222222222222'
let client: QueryClient
function image(id: string): WorkstationHistoryListItem {
  return { id, toolSlug: 'repaint', capability: Capability.Inpaint, width: 512, height: 512, mimeType: 'image/png',
    createdAt: '2026-10-05T01:00:00Z', updatedAt: '2026-10-05T01:00:00Z', thumbnail: new Blob(['缩略图'], { type: 'image/png' }) }
}
function mount() {
  return render(<StrictMode><MemoryRouter><QueryClientProvider client={client}><App><Dashboard /></App></QueryClientProvider></MemoryRouter></StrictMode>)
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear()
  mocks.request.mockResolvedValue({ items: [] }); mocks.history.mockResolvedValue([])
  mocks.hydrateImages.mockResolvedValue({ failed: 0 }); mocks.hydrateVideos.mockResolvedValue(undefined)
  mocks.capabilities = {}; mocks.error = null
  mocks.createUrl.mockImplementation(() => `blob:首页-${mocks.createUrl.mock.calls.length}`)
  vi.stubGlobal('URL', class extends URL { static createObjectURL = mocks.createUrl; static revokeObjectURL = mocks.revokeUrl })
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })))
  vi.stubGlobal('BroadcastChannel', undefined)
  setPersistenceUser(OWNER_A); useUserStore.setState({ userId: OWNER_A, account: null })
  usePersistenceStore.setState({ ownerId: OWNER_A }); useEditorStore.setState({ project: null })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })

describe('首页新用户卡片', () => {
  const welcome = { initialCredits: 30, creditNoticeSeen: true, starterCardDismissed: false, analyticsEnabled: true, hasCreatedWork: false }
  function account(owner = OWNER_A, hasCreatedWork = false) {
    useUserStore.setState({ userId: owner, account: { userId: owner, welcome: { ...welcome, hasCreatedWork } } as AccountContext })
    mocks.request.mockImplementation((path: string) => Promise.resolve(path === '/activation' ? welcome : { items: [] }))
  }
  it('确认空作品后显示 30 分与每月 20 张免费，按钮直达智能抠图', async () => {
    account(); mount()
    const card = await screen.findByRole('region', { name: '开始创作第一张作品' })
    expect(within(card).getByText('新账号赠送的 30 积分已到账。推荐先试试智能抠图，每月 20 张免费。')).toBeTruthy()
    expect(within(card).getByRole('link', { name: '开始智能抠图' }).getAttribute('href')).toBe('/toolbox/bg-remove')
  })
  it('读取与云端同步期间不闪现卡片，历史作品加载后不显示', async () => {
    account()
    let finish!: (value: { failed: number }) => void
    mocks.hydrateImages.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    mount()
    await waitFor(() => expect(mocks.hydrateImages).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: '开始创作第一张作品' })).toBeNull()
    mocks.history.mockResolvedValue([image('已有作品')])
    await act(async () => { finish({ failed: 0 }) })
    await screen.findByRole('button', { name: /预览重绘/ })
    expect(screen.queryByRole('region', { name: '开始创作第一张作品' })).toBeNull()
  })
  it('关闭后刷新也不出现，换账号不继承关闭状态', async () => {
    account()
    const view = mount()
    fireEvent.click(await screen.findByRole('button', { name: '关闭新用户卡片' }))
    expect(screen.queryByRole('region', { name: '开始创作第一张作品' })).toBeNull()
    view.unmount(); account(); const next = mount()
    await screen.findByText('还没有最近作品')
    expect(screen.queryByRole('region', { name: '开始创作第一张作品' })).toBeNull()
    next.unmount(); account(OWNER_B); setPersistenceUser(OWNER_B); mount()
    expect(await screen.findByRole('region', { name: '开始创作第一张作品' })).toBeTruthy()
  })
  it('曾成功生成的账号即使最近作品已过期也不出现，读取失败不当成空作品', async () => {
    account(OWNER_A, true)
    const view = mount()
    await screen.findByText('还没有最近作品')
    expect(screen.queryByRole('region', { name: '开始创作第一张作品' })).toBeNull()
    view.unmount(); account(); mocks.history.mockRejectedValue(new Error('作品读取失败')); mount()
    await screen.findByRole('alert')
    expect(screen.queryByRole('region', { name: '开始创作第一张作品' })).toBeNull()
  })
})

describe('最近作品横向渐隐', () => {
  function metricsOf(el: HTMLElement) {
    const box = { scrollLeft: 0, clientWidth: 400, scrollWidth: 900 }
    Object.defineProperty(el, 'scrollLeft', { configurable: true, get: () => box.scrollLeft, set: (value: number) => { box.scrollLeft = value } })
    Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => box.clientWidth })
    Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => box.scrollWidth })
    return box
  }

  it('scrollLeft 为 0 时没有左侧渐隐，滚走后出现，贴右端时右侧消失', async () => {
    mocks.history.mockResolvedValue([image('左'), image('右')])
    mount()
    const strip = await screen.findByLabelText('最近作品列表')
    const box = metricsOf(strip)
    const scroller = strip.parentElement!
    fireEvent.scroll(strip)
    expect(scroller.className).not.toContain('has-left-fade')
    expect(scroller.className).toContain('has-right-fade')

    box.scrollLeft = 80
    fireEvent.scroll(strip)
    expect(scroller.className).toContain('has-left-fade')
    expect(scroller.className).toContain('has-right-fade')

    box.scrollLeft = 0
    fireEvent(strip, new Event('scrollend'))
    expect(scroller.className).not.toContain('has-left-fade')
    expect(scroller.className).toContain('has-right-fade')

    box.scrollLeft = 500
    fireEvent.scroll(strip)
    expect(scroller.className).toContain('has-left-fade')
    expect(scroller.className).not.toContain('has-right-fade')

    box.scrollLeft = 0
    fireEvent.load(strip)
    window.dispatchEvent(new Event('resize'))
    expect(scroller.className).not.toContain('has-left-fade')
    expect(scroller.className).toContain('has-right-fade')
  })

  it('刷新后 scrollLeft 停在 3 时没有左渐隐，离开起点才出现', async () => {
    const box = { scrollLeft: 3, clientWidth: 723, scrollWidth: 1368 }
    const keys = ['scrollLeft', 'clientWidth', 'scrollWidth'] as const
    const originals = keys.map(key => ({ key, descriptor: Object.getOwnPropertyDescriptor(Element.prototype, key)! }))
    for (const key of keys) {
      const original = originals.find(item => item.key === key)!.descriptor
      Object.defineProperty(Element.prototype, key, {
        configurable: true,
        enumerable: true,
        get(this: Element) {
          return this.classList?.contains('dashboard-works-strip') ? box[key] : original.get!.call(this)
        },
        set(this: Element, value: number) {
          if (this.classList?.contains('dashboard-works-strip') && key === 'scrollLeft') box.scrollLeft = value
          else original.set?.call(this, value)
        },
      })
    }
    try {
      mocks.history.mockResolvedValue(Array.from({ length: 8 }, (_, index) => image(`作品${index}`)))
      mount()
      const strip = await screen.findByLabelText('最近作品列表')
      const scroller = strip.parentElement!
      expect(strip.scrollLeft).toBe(3)
      expect(scroller.className).not.toContain('has-left-fade')
      expect(scroller.className).toContain('has-right-fade')

      box.scrollLeft = 80
      fireEvent.scroll(strip)
      expect(scroller.className).toContain('has-left-fade')
      expect(scroller.className).toContain('has-right-fade')

      box.scrollLeft = 3
      fireEvent(strip, new Event('scrollend'))
      expect(scroller.className).not.toContain('has-left-fade')
      expect(scroller.className).toContain('has-right-fade')

      box.scrollLeft = 1368 - 723
      fireEvent.scroll(strip)
      expect(scroller.className).toContain('has-left-fade')
      expect(scroller.className).not.toContain('has-right-fade')
    } finally {
      for (const item of originals) Object.defineProperty(Element.prototype, item.key, item.descriptor)
    }
  })
})

describe('首页工作台', () => {
  it('空首页隐藏继续工作，十九项入口区分未知、关闭及可用状态', async () => {
    const view = mount()
    await waitFor(() => expect(screen.queryByText('继续工作')).toBeNull())
    const section = screen.getByRole('heading', { name: '快速开始' }).closest('section')!
    expect(section.querySelectorAll('.dashboard-tool-link')).toHaveLength(19)
    expect(within(section).queryByText('即将上线')).toBeNull()
    expect(within(section).getAllByText('加载中…').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: '打开批量邮件' }).getAttribute('href')).toBe('/email?mode=batch')
    expect(within(section).getByText('裂变')).toBeTruthy()
    expect(screen.queryByText('基于原图再生成一版变体。')).toBeNull()
    expect(screen.queryByText('把多张图合成一个场景。')).toBeNull()
    await waitFor(() => expect(screen.getByText('还没有最近作品')).toBeTruthy())
    expect(screen.queryByText(/此浏览器/)).toBeNull()
    expect(screen.getByText('最近的图片和视频作品')).toBeTruthy()
    mocks.capabilities = { textToVideo: false, textToImage: true, imageEdit: true }
    view.rerender(<MemoryRouter><QueryClientProvider client={client}><App><Dashboard /></App></QueryClientProvider></MemoryRouter>)
    expect(screen.queryByRole('link', { name: '打开文生视频' })).toBeNull()
    expect(screen.getByRole('link', { name: '打开文生图' }).getAttribute('href')).toBe('/canvas/text-to-image')
    expect(screen.getByText('即将上线')).toBeTruthy()
    mocks.error = new Error('功能配置加载失败')
    view.rerender(<MemoryRouter><QueryClientProvider client={client}><App><Dashboard /></App></QueryClientProvider></MemoryRouter>)
    fireEvent.click(screen.getByText('重试配置'))
    expect(mocks.retry).toHaveBeenCalledTimes(1)
  })

  it('读取八项只读缩略图，预览复用画廊且卸载释放所有 Blob URL', async () => {
    rememberTool(OWNER_A, '/toolbox/pipeline')
    mocks.history.mockResolvedValue([image('本机图片')])
    const view = mount()
    await waitFor(() => expect(screen.getByRole('button', { name: /预览重绘/ })).toBeTruthy())
    expect(mocks.history).toHaveBeenCalledWith(OWNER_A, true, { limit: 8, readOnly: true })
    expect(screen.getByRole('link', { name: '继续使用流水线' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /预览重绘/ }))
    expect(within(screen.getByRole('dialog')).getByText('本机图片')).toBeTruthy()
    expect(mocks.request.mock.calls.every(call => call[0] === '/projects' && call[1] === 'GET')).toBe(true)
    view.unmount()
    expect(mocks.createUrl).toHaveBeenCalledTimes(1)
    expect(mocks.revokeUrl.mock.calls.map(call => call[0])).toEqual(mocks.createUrl.mock.results.map(result => result.value))
  })

  it('换账号重新挂载本机状态，旧账号迟到作品与云端摘要不会出现', async () => {
    let historyA!: (items: WorkstationHistoryListItem[]) => void
    let projectsA!: (value: unknown) => void
    mocks.history.mockImplementation((owner: string) => owner === OWNER_A ? new Promise(done => { historyA = done }) : Promise.resolve([image('乙账号图片')]))
    mocks.request.mockImplementation((_path: string, _method: string, _body: unknown, options: { expectedUserId: string }) => options.expectedUserId === OWNER_A
      ? new Promise(done => { projectsA = done }) : Promise.resolve({ items: [] }))
    rememberTool(OWNER_A, '/email?mode=batch')
    mount()
    await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(1))
    act(() => { setPersistenceUser(OWNER_B); useUserStore.setState({ userId: OWNER_B }); usePersistenceStore.setState({ ownerId: OWNER_B }) })
    await waitFor(() => expect(mocks.history).toHaveBeenCalledWith(OWNER_B, true, { limit: 8, readOnly: true }))
    await act(async () => {
      historyA([image('甲账号图片')]); projectsA({ items: [{ id: '甲', name: '甲账号画布', revision: 1, updatedAt: '2026-10-05T01:00:00Z' }] })
      await Promise.resolve()
    })
    expect(screen.queryByText('甲账号画布')).toBeNull()
    expect(screen.queryByRole('link', { name: '继续使用批量邮件' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /预览重绘/ }))
    expect(within(screen.getByRole('dialog')).getByText('乙账号图片')).toBeTruthy()
  })

  it('同账号历史事件合并刷新，其他账号事件不触发读取，卸载后停止监听', async () => {
    const view = mount()
    await waitFor(() => expect(screen.getByText('还没有最近作品')).toBeTruthy())
    const baseline = mocks.history.mock.calls.length
    expect(baseline).toBeGreaterThanOrEqual(2)
    act(() => {
      window.dispatchEvent(new CustomEvent('pixel-history-changed', { detail: OWNER_B }))
      for (let index = 0; index < 5; index++) window.dispatchEvent(new CustomEvent('pixel-history-changed', { detail: OWNER_A }))
    })
    await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(baseline + 1))
    view.unmount()
    window.dispatchEvent(new CustomEvent('pixel-history-changed', { detail: OWNER_A }))
    expect(mocks.history).toHaveBeenCalledTimes(baseline + 1)
  })

  it('先读本地，再从云端图片和视频任务补齐最近作品', async () => {
    mocks.history.mockResolvedValueOnce([]).mockResolvedValue([image('云端图片')])
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: /预览重绘/ })).toBeTruthy())
    expect(mocks.hydrateImages).toHaveBeenCalledWith(OWNER_A, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(mocks.hydrateVideos).toHaveBeenCalledWith(OWNER_A, expect.any(AbortSignal))
    expect(mocks.history).toHaveBeenLastCalledWith(OWNER_A, true, { limit: 8, readOnly: true })
    expect(screen.queryByText(/此浏览器/)).toBeNull()
    expect(screen.queryByText('还没有最近作品')).toBeNull()
  })

  it('云端没有作品时显示空状态，失败时可重试同步', async () => {
    mocks.hydrateImages.mockRejectedValueOnce(new Error('网络中断'))
    mount()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('云端作品暂时没有同步'))
    expect(screen.queryByText('还没有最近作品')).toBeNull()
    mocks.hydrateImages.mockResolvedValue({ failed: 0 })
    fireEvent.click(screen.getByText('重试读取'))
    await waitFor(() => expect(screen.getByText('还没有最近作品')).toBeTruthy())
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
