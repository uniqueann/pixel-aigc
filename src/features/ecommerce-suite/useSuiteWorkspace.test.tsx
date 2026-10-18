// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import type { SuiteClient } from './api'
import { refreshBillingBalance } from '@/services/api/billing'
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
})
