// @vitest-environment jsdom

import { App } from 'antd'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Capability } from '@/types'

const flags = vi.hoisted(() => ({ textToVideo: false as boolean | undefined, imageToVideo: false as boolean | undefined, error: null as Error | null, refetch: vi.fn() }))
vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => ({ capabilities: flags, error: flags.error, refetch: flags.refetch }) }))
const cloud = vi.hoisted(() => ({ authEnabled: false }))
const taskApi = vi.hoisted(() => ({ listTasks: vi.fn() }))
const OWNER = '11111111-1111-4111-8111-111111111111'
const openAt = vi.fn()
const historyItem = {
  id: 'hist-1',
  toolSlug: 'fusion',
  capability: Capability.Fusion,
  prompt: '将耳机放在咖啡桌中央，保持细节',
  width: 1302,
  height: 2048,
  mimeType: 'image/jpeg',
  createdAt: '2026-10-02T10:42:18.000Z',
  updatedAt: '2026-10-02T10:42:18.000Z',
  thumbnail: new Blob(['thumb'], { type: 'image/jpeg' }),
}

vi.mock('@/cloud/client', () => cloud)
vi.mock('@/features/assets/hydrateImageJobs', () => ({
  hydrateWorkstationHistoryFromImageJobs: () => Promise.resolve({ failed: 0 }),
}))
vi.mock('@/features/assets/hydrateVideoJobs', () => ({
  hydrateVideoJobs: () => Promise.resolve(),
}))
vi.mock('@/services/api/task', () => taskApi)
vi.mock('@/components/PreviewGallery', () => ({ default: () => null }))
vi.mock('@/components/VideoPoster', () => ({ default: () => <span>视频封面</span> }))
vi.mock('@/services/api/ownedVideos', () => ({ downloadOwnedVideo: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/components/usePreviewGallery', () => ({
  usePreviewGallery: () => ({ openAt, galleryProps: {} }),
}))
vi.mock('@/features/assets/workstationHistory', () => ({
  HISTORY_CHANGED: 'pixel-history-changed',
  deleteWorkstationHistory: vi.fn(),
  restoreWorkstationHistory: vi.fn(async () => true),
  listHistoryPreviews: vi.fn(async () => [historyItem]),
}))

import Assets from './index'
import { usePreferencesStore } from '@/features/preferences/store'
import { useUserStore } from '@/store/useUserStore'
import { deleteWorkstationHistory, listHistoryPreviews, restoreWorkstationHistory } from '@/features/assets/workstationHistory'
import { downloadOwnedVideo } from '@/services/api/ownedVideos'

/** 记录卡片跳转后的地址，用于验证邮件深链参数。 */
function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

function renderAssets() {
  return render(
    <MemoryRouter>
      <App>
        <Assets />
        <LocationProbe />
      </App>
    </MemoryRouter>,
  )
}

const coverName = '查看将耳机放在咖啡桌中央，保持细节大图'

async function waitForCover() {
  return waitFor(() => screen.getByRole('button', { name: coverName }))
}

/** 按 DOM 顺序取卡片标题，用来断言排序结果。 */
function cardTitles() {
  return Array.from(document.querySelectorAll('.assets-card-title')).map(node => node.textContent)
}

function expectThumbnailKeepsPreviewAccess(cover: HTMLElement) {
  expect(cover.classList.contains('assets-cover')).toBe(true)
  expect(cover.getAttribute('aria-label')).toMatch(/^查看.+大图$/)
  expect(cover.querySelector('.assets-preview-hint')).toBeNull()
  expect(cover.querySelector('.anticon-zoom-in')).toBeNull()
}

describe('我的资产缩略图预览入口', () => {
  beforeEach(() => {
    openAt.mockReset()
    flags.textToVideo = false; flags.imageToVideo = false; flags.error = null; flags.refetch.mockReset()
    cloud.authEnabled = false
    taskApi.listTasks.mockReset().mockResolvedValue({ items: [], total: 0 })
    vi.mocked(listHistoryPreviews).mockReset().mockResolvedValue([historyItem])
    vi.mocked(deleteWorkstationHistory).mockReset()
    vi.mocked(restoreWorkstationHistory).mockReset().mockResolvedValue(true)
    localStorage.clear()
    usePreferencesStore.getState().reset()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })))
    URL.createObjectURL = vi.fn(() => 'blob:assets-thumb')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    cleanup()
    cloud.authEnabled = false
    useUserStore.getState().setAccount(null)
    vi.unstubAllGlobals()
  })

  it('网格视图去掉缩略图放大镜，仍可点击整张缩略图打开预览', async () => {
    const { container } = renderAssets()
    const cover = await waitForCover()
    expectThumbnailKeepsPreviewAccess(cover)
    expect(cover.tagName).toBe('BUTTON')
    expect(cover.getAttribute('type')).toBe('button')
    expect(container.querySelector('.assets-preview-hint')).toBeNull()

    fireEvent.click(cover)
    expect(openAt).toHaveBeenCalledWith('hist-1')
  })

  it('列表视图同样不叠加放大镜，点击封面即可预览', async () => {
    renderAssets()
    await waitForCover()
    fireEvent.click(screen.getByRole('button', { name: '列表视图' }))
    const cover = await waitForCover()
    expectThumbnailKeepsPreviewAccess(cover)
    expect(document.querySelector('.assets-list')).toBeTruthy()

    fireEvent.click(cover)
    expect(openAt).toHaveBeenCalledWith('hist-1')
  })

  it('图片筛选同时显示文生图和工作站结果，文生图使用独立中文名称', async () => {
    vi.mocked(listHistoryPreviews).mockResolvedValueOnce([historyItem, {
      ...historyItem, id: 'text-image-1', toolSlug: 'text-to-image', capability: Capability.TextToImage, prompt: '夜晚的城市',
    }])
    renderAssets()
    await waitForCover()
    fireEvent.click(screen.getByText('图片'))
    expect(screen.queryByText('图片工作站')).toBeNull()
    const cover = screen.getByRole('button', { name: '查看夜晚的城市大图' })
    expect(screen.getByRole('button', { name: coverName })).toBeTruthy()
    fireEvent.click(cover)
    expect(openAt).toHaveBeenCalledWith('text-image-1')
  })

  it('视频未开放的空状态没有去生成入口，也不暴露内部术语', async () => {
    vi.mocked(listHistoryPreviews).mockResolvedValue([])
    const { container } = renderAssets()
    await waitFor(() => screen.getByText('暂无作品，完成的图片和视频会显示在这里。'))
    fireEvent.click(screen.getByText('视频'))
    expect(screen.getByText('视频生成即将上线。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '去生成' })).toBeNull()
    expect(container.textContent).not.toMatch(/补记|未标记账号|旧版记录|已隔离/)
  })

  it('视频能力加载失败可重试，不能误认为即将上线', async () => {
    flags.textToVideo = undefined; flags.error = new Error('网络错误')
    vi.mocked(listHistoryPreviews).mockResolvedValue([])
    renderAssets()
    await waitFor(() => screen.getByText('暂无作品，完成的图片和视频会显示在这里。'))
    fireEvent.click(screen.getByText('视频'))
    expect(screen.queryByText('视频生成即将上线。')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重试加载视频功能' }))
    expect(flags.refetch).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: '去生成' })).toBeNull()
  })

  it('视频关闭时已有作品仍可播放和下载', async () => {
    const video = { url: '', objectKey: 'videos/history.mp4', ordinal: 0, width: 1280, height: 720, mimeType: 'video/mp4' as const, durationSeconds: 5, sizeBytes: 1024, hasAudio: false, retentionExpiresAt: '2099-11-01T00:00:00Z' }
    vi.mocked(listHistoryPreviews).mockResolvedValue([{ ...historyItem, id: 'video-1', toolSlug: 'text-to-video', capability: Capability.TextToVideo, mediaType: 'video', video }])
    renderAssets()
    const play = '播放将耳机放在咖啡桌中央，保持细节'
    await waitFor(() => screen.getByRole('button', { name: play }))
    fireEvent.click(screen.getByText('视频'))
    expect(screen.getByText('视频生成即将上线。')).toBeTruthy()
    expect(screen.getByText('5 秒')).toBeTruthy()
    expect(document.querySelector('.assets-card-expiry')?.textContent).toContain('到期')
    fireEvent.click(screen.getByRole('button', { name: play }))
    expect(openAt).toHaveBeenCalledWith('video-1')
    fireEvent.click(screen.getByRole('button', { name: /更多操作/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /下\s*载/ }))
    await waitFor(() => expect(downloadOwnedVideo).toHaveBeenCalledWith(video, 'Seedance_5.0秒.mp4', 'anonymous'))
  })

  it('仅开放图生视频时保留画布入口，不能误显示视频即将上线', async () => {
    flags.imageToVideo = true
    vi.mocked(listHistoryPreviews).mockResolvedValue([])
    renderAssets()
    await waitFor(() => screen.getByText('暂无作品，完成的图片和视频会显示在这里。'))
    fireEvent.click(screen.getByText('视频'))
    expect(screen.queryByText('视频生成即将上线。')).toBeNull()
    expect(screen.getByRole('button', { name: '打开画布' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '去生成' })).toBeNull()
  })

  it('卡片用提示词作标题，工具名与时间降为次级信息', async () => {
    renderAssets()
    await waitForCover()
    expect(screen.getByText('将耳机放在咖啡桌中央，保持细节')).toBeTruthy()
    const meta = document.querySelector('.assets-card-meta')?.textContent ?? ''
    expect(meta).toContain('融合')
    expect(meta).not.toContain('已完成')
  })

  it('搜索覆盖整段提示词，标题被截断也能命中', async () => {
    const cat = {
      ...historyItem,
      id: 'hist-cat',
      prompt: '一只橘猫趴在窗台上晒太阳，窗外是秋天的梧桐树',
      createdAt: '2026-10-01T09:00:00.000Z',
    }
    vi.mocked(listHistoryPreviews).mockResolvedValue([historyItem, cat])
    renderAssets()
    await waitForCover()
    expect(document.querySelectorAll('.assets-card')).toHaveLength(2)
    expect(document.querySelectorAll('.assets-group')).toHaveLength(2)

    fireEvent.change(screen.getByRole('textbox', { name: '搜索作品' }), { target: { value: '梧桐树' } })
    await waitFor(() => expect(document.querySelectorAll('.assets-card')).toHaveLength(1))
    expect(document.querySelectorAll('.assets-group')).toHaveLength(1)
    expect(cardTitles()[0]).toContain('橘猫')
    const count = document.querySelector('.assets-search-count')
    expect(count?.getAttribute('role')).toBe('status')
    expect(count?.textContent).toBe('找到 1 个作品')
  })

  it('搜索无结果时给出空状态，清除后恢复并聚焦输入框', async () => {
    renderAssets()
    await waitForCover()
    const input = screen.getByRole('textbox', { name: '搜索作品' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: '不存在的关键词' } })
    await waitFor(() => screen.getByText('没有找到匹配「不存在的关键词」的作品'))

    fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
    await waitFor(() => expect(screen.getByRole('button', { name: coverName })).toBeTruthy())
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(input)
  })

  it('切换到最早优先后按时间正序，并写回偏好', async () => {
    const older = { ...historyItem, id: 'hist-older', prompt: '更早的作品', createdAt: '2026-09-01T09:00:00.000Z' }
    vi.mocked(listHistoryPreviews).mockResolvedValue([older, historyItem])
    renderAssets()
    await waitForCover()
    expect(cardTitles()).toEqual(['将耳机放在咖啡桌中央，保持细节', '更早的作品'])

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '排序方式' }))
    fireEvent.click(await screen.findByText('最早优先', { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(cardTitles()).toEqual(['更早的作品', '将耳机放在咖啡桌中央，保持细节']))
    expect(usePreferencesStore.getState().preferences.recent.assetsSort).toBe('oldest')
  })

  it('首屏排序读取偏好', async () => {
    const older = { ...historyItem, id: 'hist-older', prompt: '更早的作品', createdAt: '2026-09-01T09:00:00.000Z' }
    vi.mocked(listHistoryPreviews).mockResolvedValue([older, historyItem])
    const current = usePreferencesStore.getState().preferences
    usePreferencesStore.setState({
      preferences: { ...current, recent: { ...current.recent, assetsSort: 'oldest' } },
    })
    renderAssets()
    await waitForCover()
    await waitFor(() => expect(cardTitles()).toEqual(['更早的作品', '将耳机放在咖啡桌中央，保持细节']))
    expect(document.querySelector('.ant-select-selection-item')?.textContent).toBe('最早优先')
  })

  it('邮件任务与图片作品使用同一套卡片结构', async () => {
    cloud.authEnabled = true
    useUserStore.getState().setUser(OWNER, 'free')
    taskApi.listTasks.mockImplementation(({ capability }: { capability?: Capability }) => Promise.resolve(
      capability === Capability.EmailAssist
        ? { items: [{ id: 'mail-1', operation: 'reply', preview: '关于下周的排期', status: 'succeeded', createdAt: '2026-10-03T09:00:00.000Z' }], total: 1 }
        : { items: [], total: 0 },
    ))
    vi.mocked(listHistoryPreviews).mockResolvedValue([])
    renderAssets()
    const cover = await waitFor(() => screen.getByRole('button', { name: '查看邮件任务：关于下周的排期' }))
    expect(cover.classList.contains('assets-cover-email')).toBe(true)
    expect(screen.getByText(/邮件助手 · 回复/)).toBeTruthy()

    fireEvent.click(cover)
    expect(screen.getByTestId('location').textContent).toBe('/email?mode=single&taskId=mail-1')
  })

  it('作品按日期分组，最早优先时组顺序反转', async () => {
    // 用本地时间构造，避免断言依赖测试机器的时区。
    const at = (month: number, day: number) => new Date(2026, month - 1, day, 10).toISOString()
    const newer = { ...historyItem, id: 'hist-newer', prompt: '较新的作品', createdAt: at(10, 2) }
    const older = { ...historyItem, id: 'hist-older', prompt: '更早的作品', createdAt: at(9, 1) }
    vi.mocked(listHistoryPreviews).mockResolvedValue([older, newer])
    renderAssets()
    await waitFor(() => screen.getByRole('button', { name: '查看较新的作品大图' }))

    const groupLabels = () => Array.from(document.querySelectorAll('.assets-group-title')).map(node => node.textContent)
    expect(groupLabels()).toHaveLength(2)
    expect(groupLabels()[0]).toContain('10月2日')
    expect(groupLabels()[1]).toContain('9月1日')

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '排序方式' }))
    fireEvent.click(await screen.findByText('最早优先', { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(groupLabels()[0]).toContain('9月1日'))
    expect(groupLabels()[1]).toContain('10月2日')
  })

  it('进入选择模式后点击封面只切换选中，不打开预览', async () => {
    renderAssets()
    await waitForCover()
    fireEvent.click(screen.getByRole('button', { name: /^选\s*择$/ }))
    const cover = screen.getByRole('button', { name: '选择将耳机放在咖啡桌中央，保持细节' })
    expect(cover.getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelector('.assets-selection-bar')?.getAttribute('role')).toBe('group')

    fireEvent.click(cover)
    expect(openAt).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '取消选择将耳机放在咖啡桌中央，保持细节' }).getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.assets-card.is-selected')).toBeTruthy()
    expect(document.querySelector('.assets-selection-count')?.textContent).toBe('已选 1 项')

    fireEvent.click(screen.getByRole('button', { name: '取消选择将耳机放在咖啡桌中央，保持细节' }))
    expect(document.querySelector('.assets-selection-count')?.textContent).toBe('已选 0 项')
  })

  it('全选后批量删除，撤销可恢复全部作品', async () => {
    const second = { ...historyItem, id: 'hist-2', prompt: '第二张作品', createdAt: '2026-10-01T09:00:00.000Z' }
    vi.mocked(listHistoryPreviews).mockResolvedValue([historyItem, second])
    renderAssets()
    await waitForCover()
    fireEvent.click(screen.getByRole('button', { name: /^选\s*择$/ }))
    fireEvent.click(screen.getByRole('button', { name: /^全\s*选$/ }))
    expect(document.querySelector('.assets-selection-count')?.textContent).toBe('已选 2 项')
    expect(screen.getByRole('button', { name: '取消全选' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^删\s*除$/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('删除选中的 2 条作品？', { selector: '.ant-modal-confirm-title' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /删\s*除/ }))
    await waitFor(() => expect(deleteWorkstationHistory).toHaveBeenCalledTimes(2))
    expect(deleteWorkstationHistory).toHaveBeenCalledWith('anonymous', 'hist-1')
    expect(deleteWorkstationHistory).toHaveBeenCalledWith('anonymous', 'hist-2')
    await waitFor(() => expect(document.querySelectorAll('.assets-card')).toHaveLength(0))
    expect(document.querySelector('.assets-selection-bar')).toBeNull()
    expect(document.querySelector('.sr-only')?.textContent).toContain('已删除 2 条作品')

    fireEvent.click(await screen.findByRole('button', { name: '撤销' }))
    await waitFor(() => expect(restoreWorkstationHistory).toHaveBeenCalledTimes(2))
    expect(restoreWorkstationHistory).toHaveBeenCalledWith('anonymous', 'hist-1')
    expect(restoreWorkstationHistory).toHaveBeenCalledWith('anonymous', 'hist-2')
    await waitFor(() => expect(document.querySelector('.sr-only')?.textContent).toContain('已恢复 2 条作品'))
  })

  it('退出选择模式后恢复预览入口并清空选中', async () => {
    renderAssets()
    await waitForCover()
    fireEvent.click(screen.getByRole('button', { name: /^选\s*择$/ }))
    fireEvent.click(screen.getByRole('button', { name: '选择将耳机放在咖啡桌中央，保持细节' }))
    fireEvent.click(screen.getByRole('button', { name: /^取\s*消$/ }))

    await waitFor(() => expect(document.querySelector('.assets-selection-bar')).toBeNull())
    const cover = screen.getByRole('button', { name: coverName })
    expect(cover.getAttribute('aria-pressed')).toBeNull()
    fireEvent.click(cover)
    expect(openAt).toHaveBeenCalledWith('hist-1')

    fireEvent.click(screen.getByRole('button', { name: /^选\s*择$/ }))
    expect(document.querySelector('.assets-selection-count')?.textContent).toBe('已选 0 项')
  })

  it('选择模式下邮件任务不可批量选择', async () => {
    cloud.authEnabled = true
    useUserStore.getState().setUser(OWNER, 'free')
    taskApi.listTasks.mockImplementation(({ capability }: { capability?: Capability }) => Promise.resolve(
      capability === Capability.EmailAssist
        ? { items: [{ id: 'mail-1', operation: 'reply', preview: '关于下周的排期', status: 'succeeded', createdAt: '2026-10-03T09:00:00.000Z' }], total: 1 }
        : { items: [], total: 0 },
    ))
    vi.mocked(listHistoryPreviews).mockResolvedValue([historyItem])
    renderAssets()
    const mailCover = await waitFor(() => screen.getByRole('button', { name: '查看邮件任务：关于下周的排期' }))
    fireEvent.click(screen.getByRole('button', { name: /^选\s*择$/ }))

    const cover = screen.getByRole('button', { name: '查看邮件任务：关于下周的排期' }) as HTMLButtonElement
    expect(cover.disabled).toBe(true)
    expect(cover.classList.contains('assets-cover-unselectable')).toBe(true)
    fireEvent.click(cover)
    expect(screen.getByTestId('location').textContent).toBe('/')
    expect(mailCover).toBeTruthy()
    expect(screen.getByRole('button', { name: '选择将耳机放在咖啡桌中央，保持细节' })).toBeTruthy()
  })

  it('删除前必须确认，取消不会删除作品', async () => {
    renderAssets()
    await waitForCover()
    fireEvent.click(screen.getByRole('button', { name: /更多操作/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /删\s*除/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('删除这条作品？', { selector: '.ant-modal-confirm-title' })).toBeTruthy()
    expect(deleteWorkstationHistory).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: /取\s*消/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deleteWorkstationHistory).not.toHaveBeenCalled()
  })

  it('确认后删除并播报，撤销可恢复作品', async () => {
    renderAssets()
    await waitForCover()
    fireEvent.click(screen.getByRole('button', { name: /更多操作/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /删\s*除/ }))

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /删\s*除/ }))
    await waitFor(() => expect(deleteWorkstationHistory).toHaveBeenCalledWith('anonymous', 'hist-1'))
    expect(document.querySelector('.sr-only')?.textContent).toContain('已删除')

    fireEvent.click(await screen.findByRole('button', { name: '撤销' }))
    await waitFor(() => expect(restoreWorkstationHistory).toHaveBeenCalledWith('anonymous', 'hist-1'))
    await waitFor(() => expect(document.querySelector('.sr-only')?.textContent).toContain('已恢复'))
  })
})
