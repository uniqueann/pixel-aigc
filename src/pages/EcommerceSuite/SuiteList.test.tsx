// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from 'antd'
import { MemoryRouter } from 'react-router-dom'
import type { SuiteProjectList } from '@shared/ecommerce-suite-runtime'
import type { SuiteClient } from '@/features/ecommerce-suite/api'
import { SuiteList } from './index'

vi.mock('./SuiteWorkspace', () => ({ default: () => null }))
vi.mock('./CreateSuite', () => ({ default: () => null }))
vi.mock('./RecoveryImport', () => ({ default: () => null }))
vi.mock('./copy', () => ({ copySuite: vi.fn() }))

const actor = { userId: '11111111-1111-4111-8111-111111111111', runtimeScope: 'preview' as const }
const signal = new AbortController().signal

function item(id: string, overrides: Record<string, unknown> = {}) {
  return {
    project: {
      id,
      config: { title: `项目 ${id}`, platform: 'amazon', subcategory: 'furniture' },
      updatedAt: '2026-11-08T08:00:00.000Z',
      deletedAt: null,
    },
    readySlots: 5,
    enabledSlots: 7,
    baseReady: true,
    ...overrides,
  } as unknown as SuiteProjectList['items'][number]
}

function createClient(result: SuiteProjectList | Error) {
  const list = vi.fn(() => result instanceof Error ? Promise.reject(result) : Promise.resolve(result))
  return {
    list,
    get: vi.fn(),
    restore: vi.fn(async () => undefined),
    recycle: vi.fn(async () => undefined),
    assertCurrent: vi.fn(),
  } as unknown as SuiteClient & { list: ReturnType<typeof vi.fn>; restore: ReturnType<typeof vi.fn> }
}

function renderList(client: SuiteClient) {
  return render(<App><MemoryRouter><SuiteList actor={actor} client={client} signal={signal} /></MemoryRouter></App>)
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('套图项目列表', () => {
  it('展示项目进度、主体图状态，并支持分页', async () => {
    const client = createClient({
      items: [
        item('a', { project: { id: 'a', config: { title: '北欧胡桃木餐桌', platform: 'amazon', subcategory: 'furniture' }, updatedAt: '2026-11-08T08:00:00.000Z', deletedAt: null } }),
        item('b', { baseReady: false, project: { id: 'b', config: { title: '日式陶瓷餐具', platform: 'general', subcategory: 'kitchen-dining' }, updatedAt: '2026-11-07T08:00:00.000Z', deletedAt: null } }),
      ],
      nextCursor: '2',
    })
    renderList(client)

    expect(await screen.findByRole('heading', { level: 1, name: '电商套图' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: '北欧胡桃木餐桌' })).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: /北欧胡桃木餐桌 的图片槽位就绪进度/ }).getAttribute('aria-valuenow')).toBe('5')
    expect(screen.getByText('待上传主体图')).toBeTruthy()
    expect(screen.getByRole('button', { name: '上传主体图' })).toBeTruthy()
    expect((screen.getByRole('button', { name: '上一页' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(client.list).toHaveBeenLastCalledWith('2', false))
    expect(await screen.findByText('第 2 页')).toBeTruthy()
  })

  it('首次读取失败时给出重试入口，不再停留在加载态', async () => {
    const client = createClient(new Error('网络错误'))
    renderList(client)

    expect(await screen.findByText('项目列表读取失败')).toBeTruthy()
    expect(screen.getAllByText('网络错误').length).toBeGreaterThan(0)
    expect(screen.queryByText('正在加载套图项目…')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '重试读取' }))
    await waitFor(() => expect(client.list).toHaveBeenCalledTimes(2))
  })

  it('空列表给出创建入口，回收站空态可以返回项目列表', async () => {
    const client = createClient({ items: [], nextCursor: null })
    renderList(client)

    expect(await screen.findByRole('heading', { name: '还没有套图项目' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '新建第一个套图项目' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '回收站' }))
    expect(await screen.findByRole('heading', { name: '回收站为空' })).toBeTruthy()
    expect(client.list).toHaveBeenLastCalledWith('1', true)

    fireEvent.click(screen.getByRole('button', { name: '返回项目列表' }))
    await waitFor(() => expect(client.list).toHaveBeenLastCalledWith('1', false))
  })

  it('回收站展示保留期并恢复项目，不再显示新建入口', async () => {
    const deletedAt = new Date(Date.now() - 3 * 86400000).toISOString()
    const client = createClient({
      items: [item('c', { project: { id: 'c', config: { title: '待恢复的套图', platform: 'amazon', subcategory: 'furniture' }, updatedAt: deletedAt, deletedAt } })],
      nextCursor: null,
    })
    renderList(client)

    fireEvent.click(screen.getByRole('button', { name: '回收站' }))
    expect(await screen.findByRole('heading', { name: '待恢复的套图' })).toBeTruthy()
    expect(screen.getByText(/保留至/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /新建套图项目/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '恢复项目' }))
    await waitFor(() => expect(client.restore).toHaveBeenCalledWith('c'))
  })
})
