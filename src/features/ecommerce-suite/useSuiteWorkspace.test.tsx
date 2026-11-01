// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import type { SuiteClient } from './api'
import { refreshBillingBalance } from '@/services/api/billing'
import { readSuiteBackup, readPendingSuite, saveSuiteBackup, clearPendingSuite } from './backup'
import { suiteWorkspacePoll, useSuiteWorkspace } from './useSuiteWorkspace'

vi.mock('./backup', () => ({
  readSuiteBackup: vi.fn(async () => undefined), readPendingSuite: vi.fn(async () => undefined),
  saveSuiteBackup: vi.fn(async () => undefined), saveSuiteBlob: vi.fn(), clearPendingSuite: vi.fn(),
}))
vi.mock('./recovery', () => ({ submitSuiteOnce: vi.fn() }))
vi.mock('./recoveryPackage', () => ({ backupAssetBlob: vi.fn(), loadFullSuite: vi.fn() }))
vi.mock('@/features/task-center/receipts', () => ({ emitTaskCenter: vi.fn() }))
vi.mock('@/services/api/billing', () => ({ refreshBillingBalance: vi.fn(async () => undefined) }))

const project = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json', 'utf8')).project
const signal = new AbortController().signal
function detail(state: string): SuiteProjectDetail {
  return { project, assets: [], versions: [], batches: [{ id: '00000000-0000-4000-8000-000000000034', state }], operations: [], drafts: [], tasks: [] } as unknown as SuiteProjectDetail
}

describe('套图工作台轮询', () => {
  beforeEach(() => {
    vi.mocked(saveSuiteBackup).mockResolvedValue(undefined)
    vi.mocked(readSuiteBackup).mockResolvedValue(undefined)
    vi.mocked(readPendingSuite).mockResolvedValue(undefined)
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  async function mount(get: ReturnType<typeof vi.fn>) {
    const client = { assertCurrent: () => undefined, get } as unknown as SuiteClient
    const view = renderHook(() => useSuiteWorkspace(project.id, project.actor, client, signal))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    return view
  }

  it('运行中按固定间隔轮询，不会在每次响应后拆掉计时器', async () => {
    vi.useFakeTimers()
    const get = vi.fn(async () => detail('running'))
    const view = await mount(get)
    expect(get).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(suiteWorkspacePoll.initialMs) })
    expect(get).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(suiteWorkspacePoll.initialMs) })
    expect(get).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(suiteWorkspacePoll.fastMs - suiteWorkspacePoll.initialMs) })
    expect(get).toHaveBeenCalledTimes(3)
    expect(refreshBillingBalance).not.toHaveBeenCalled()
    view.unmount()
  })

  it('仅剩待用户处理的批次时大幅退避，批次结束后刷新积分并停止', async () => {
    vi.useFakeTimers()
    let state = 'blocked'
    const get = vi.fn(async () => detail(state))
    const view = await mount(get)
    expect(get).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(suiteWorkspacePoll.fastMs) })
    expect(get).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(suiteWorkspacePoll.slowMs - suiteWorkspacePoll.fastMs) })
    expect(get).toHaveBeenCalledTimes(2)
    expect(refreshBillingBalance).not.toHaveBeenCalled()
    state = 'succeeded'
    await act(async () => { await vi.advanceTimersByTimeAsync(suiteWorkspacePoll.slowMs) })
    expect(get).toHaveBeenCalledTimes(3)
    expect(refreshBillingBalance).toHaveBeenCalledWith(project.actor.userId)
    await act(async () => { await vi.advanceTimersByTimeAsync(suiteWorkspacePoll.slowMs) })
    expect(get).toHaveBeenCalledTimes(3)
    view.unmount()
  })

  it('被更新的读取覆盖后，仍按运行中间隔继续轮询', async () => {
    vi.useFakeTimers()
    let releaseStale: (value: SuiteProjectDetail) => void = () => undefined
    const get = vi.fn()
      .mockImplementationOnce(async () => detail('running'))
      .mockImplementationOnce(() => new Promise<SuiteProjectDetail>(resolve => { releaseStale = resolve }))
      .mockImplementation(async () => detail('running'))
    const view = await mount(get)
    await act(async () => { await vi.advanceTimersByTimeAsync(suiteWorkspacePoll.initialMs) })
    expect(get).toHaveBeenCalledTimes(2)
    await act(async () => { await view.result.current.load() })
    await act(async () => { releaseStale(detail('succeeded')) })
    const calls = get.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(suiteWorkspacePoll.fastMs) })
    expect(get).toHaveBeenCalledTimes(calls + 1)
    expect(refreshBillingBalance).not.toHaveBeenCalled()
    view.unmount()
  })

  it('保存返回的新修订不会被在途的过期读取回退，也不会制造假冲突', async () => {
    vi.useFakeTimers()
    let releaseStale: (value: SuiteProjectDetail) => void = () => undefined
    const get = vi.fn()
      .mockResolvedValueOnce(detail('succeeded'))
      .mockImplementationOnce(() => new Promise<SuiteProjectDetail>(resolve => { releaseStale = resolve }))
    const update = vi.fn(async (_id: string, revision: number, config: typeof project.config) => ({ ...project, revision: revision + 1, config }))
    const client = { assertCurrent: () => undefined, get, update } as unknown as SuiteClient
    const view = renderHook(() => useSuiteWorkspace(project.id, project.actor, client, signal))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    // 旧读取在保存之前发出、保存之后才返回。
    let pendingLoad: Promise<SuiteProjectDetail | undefined> = Promise.resolve(undefined)
    await act(async () => { pendingLoad = view.result.current.load() })

    act(() => { view.result.current.edit({ ...project.config, title: '本机编辑' }) })
    await act(async () => { await view.result.current.flush() })
    expect(view.result.current.detail?.project.revision).toBe(project.revision + 1)
    const backups = vi.mocked(saveSuiteBackup).mock.calls.length

    await act(async () => { releaseStale(detail('succeeded')); await pendingLoad })

    expect(view.result.current.detail?.project.revision).toBe(project.revision + 1)
    expect(view.result.current.editor.config?.title).toBe('本机编辑')
    expect(view.result.current.conflict).toBe(false)
    // 过期快照不能回写本机备份，否则下次打开会把旧修订当成最新副本。
    expect(vi.mocked(saveSuiteBackup).mock.calls.length).toBe(backups)
    view.unmount()
  })

  it('运行中的批次完成时刷新积分，不再继续快轮询', async () => {
    vi.useFakeTimers()
    let state = 'running'
    const get = vi.fn(async () => detail(state))
    const view = await mount(get)
    await act(async () => { await vi.advanceTimersByTimeAsync(suiteWorkspacePoll.initialMs) })
    expect(refreshBillingBalance).not.toHaveBeenCalled()
    state = 'succeeded'
    await act(async () => { await vi.advanceTimersByTimeAsync(suiteWorkspacePoll.fastMs) })
    expect(refreshBillingBalance).toHaveBeenCalledTimes(1)
    const calls = get.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(suiteWorkspacePoll.fastMs * 3) })
    expect(get).toHaveBeenCalledTimes(calls)
    view.unmount()
  })

  it('原批次始终查不到时可放弃本机编号，解除生成锁定', async () => {
    vi.useFakeTimers()
    vi.mocked(readPendingSuite).mockResolvedValue({ projectId: project.id, requestId: '00000000-0000-4000-8000-000000000099', quote: {} as never, createdAt: Date.now() })
    const findBatch = vi.fn(async () => null)
    const client = { assertCurrent: () => undefined, get: vi.fn(async () => detail('succeeded')), findBatch } as unknown as SuiteClient
    const view = renderHook(() => useSuiteWorkspace(project.id, project.actor, client, signal))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(view.result.current.pending?.requestId).toBe('00000000-0000-4000-8000-000000000099')

    let result: string | undefined
    await act(async () => { result = await view.result.current.abandonPending() })

    expect(result).toBe('abandoned')
    expect(findBatch).toHaveBeenCalledWith(project.id, '00000000-0000-4000-8000-000000000099')
    expect(clearPendingSuite).toHaveBeenCalledWith(project.actor, project.id)
    expect(view.result.current.pending).toBeUndefined()
    expect(view.result.current.saveState).toBe('已放弃原编号，可重新提交')
    view.unmount()
  })

  it('放弃前发现原批次已受理时转为找回，不丢失已提交的请求', async () => {
    vi.useFakeTimers()
    vi.mocked(readPendingSuite).mockResolvedValue({ projectId: project.id, requestId: '00000000-0000-4000-8000-000000000098', quote: {} as never, createdAt: Date.now() })
    const batch = detail('queued').batches[0]
    const findBatch = vi.fn(async () => batch)
    const get = vi.fn(async () => detail('queued'))
    const client = { assertCurrent: () => undefined, get, findBatch } as unknown as SuiteClient
    const view = renderHook(() => useSuiteWorkspace(project.id, project.actor, client, signal))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const reads = get.mock.calls.length

    let result: string | undefined
    await act(async () => { result = await view.result.current.abandonPending() })

    expect(result).toBe('recovered')
    expect(clearPendingSuite).toHaveBeenCalledWith(project.actor, project.id)
    expect(view.result.current.pending).toBeUndefined()
    expect(get.mock.calls.length).toBeGreaterThan(reads)
    view.unmount()
  })

  it('本机备份写入失败时不阻断云端保存', async () => {
    vi.useFakeTimers()
    vi.mocked(saveSuiteBackup).mockRejectedValue(new Error('本地存储空间不足'))
    const update = vi.fn(async (_id: string, revision: number, config: typeof project.config) => ({ ...project, revision: revision + 1, config }))
    const client = { assertCurrent: () => undefined, get: vi.fn(async () => detail('succeeded')), update } as unknown as SuiteClient
    const view = renderHook(() => useSuiteWorkspace(project.id, project.actor, client, signal))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    act(() => { view.result.current.edit({ ...project.config, title: '本机编辑' }) })
    await act(async () => { await view.result.current.flush() })

    expect(update).toHaveBeenCalledWith(project.id, project.revision, expect.objectContaining({ title: '本机编辑' }))
    expect(view.result.current.saveState).toBe('已保存到云端')
    view.unmount()
  })

  it('离线重连时保留并同步本机编辑，而不是直接丢弃', async () => {
    vi.useFakeTimers()
    const cloud = { ...detail('succeeded'), project: { ...project, revision: project.revision + 5, config: { ...project.config, title: '云端标题' } } }
    vi.mocked(readSuiteBackup).mockResolvedValue({ detail: detail('succeeded'), savedAt: Date.now(), complete: false })
    const get = vi.fn().mockRejectedValueOnce(new Error('网络不可用')).mockResolvedValue(cloud)
    const update = vi.fn(async (_id: string, revision: number, config: typeof project.config) => ({ ...project, revision: revision + 1, config }))
    const client = { assertCurrent: () => undefined, get, update } as unknown as SuiteClient
    const view = renderHook(() => useSuiteWorkspace(project.id, project.actor, client, signal))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(view.result.current.offline).toBe(true)

    act(() => { view.result.current.edit({ ...project.config, title: '本机编辑' }) })
    await act(async () => { await view.result.current.reloadCloud() })

    // 重连使用刚读取的云端修订保存本机配置，不能先替换成本机丢失的云端版本。
    expect(update).toHaveBeenCalledWith(project.id, project.revision + 5, expect.objectContaining({ title: '本机编辑' }))
    expect(view.result.current.editor.config?.title).toBe('本机编辑')
    expect(view.result.current.offline).toBe(false)
    view.unmount()
  })
})
