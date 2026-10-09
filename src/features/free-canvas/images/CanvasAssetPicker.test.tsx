// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CanvasAssetPicker from '@/features/free-canvas/images/CanvasAssetPicker'

const flags = vi.hoisted(() => ({ authEnabled: true }))
vi.mock('@/cloud/client', () => ({ get authEnabled() { return flags.authEnabled } }))
vi.mock('@/features/assets/historyOwner', () => ({ isCurrentWorkstationHistoryOwner: () => true }))
vi.mock('@/features/assets/labels', () => ({ workstationToolLabel: (slug: string) => slug }))

const localItem = { id: 'local-1', toolSlug: 'repaint', width: 100, height: 100, createdAt: '2026-10-10T00:00:00Z' }
const cloudItem = { id: 'cloud-1', toolSlug: 'remove', width: 200, height: 200, createdAt: '2026-10-09T00:00:00Z' }

const listHistoryPreviews = vi.fn()
const hydrateWorkstationHistoryFromImageJobs = vi.fn()

vi.mock('@/features/assets/workstationHistory', () => ({
  HISTORY_CHANGED: 'pixel-history-changed',
  listHistoryPreviews: (...args: unknown[]) => listHistoryPreviews(...args),
}))
vi.mock('@/features/assets/hydrateImageJobs', () => ({
  hydrateWorkstationHistoryFromImageJobs: (...args: unknown[]) => hydrateWorkstationHistoryFromImageJobs(...args),
}))

describe('CanvasAssetPicker', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('先展示本地列表，不等云同步完成', async () => {
    let resolveHydrate!: (value: { failed: number }) => void
    listHistoryPreviews.mockResolvedValueOnce([localItem]).mockResolvedValueOnce([localItem, cloudItem])
    hydrateWorkstationHistoryFromImageJobs.mockImplementation(() => new Promise(resolve => { resolveHydrate = resolve }))

    render(<CanvasAssetPicker ownerId="u1" busy={false} onSelect={vi.fn()} onClose={vi.fn()} />)

    // 本地列表立即出现，此时云同步尚未完成
    await waitFor(() => expect(screen.getByRole('button', { name: /repaint/ })).toBeTruthy())
    expect(hydrateWorkstationHistoryFromImageJobs).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /remove/ })).toBeNull()
    // 骨架屏已消失（loading 结束），显示"云端同步中"
    expect(screen.getByText('云端同步中…')).toBeTruthy()

    // 云同步完成后列表刷新，补上云端项
    resolveHydrate({ failed: 0 })
    await waitFor(() => expect(screen.getByRole('button', { name: /remove/ })).toBeTruthy())
    expect(listHistoryPreviews).toHaveBeenCalledTimes(2)
  })

  it('无云同步时（auth 关闭）只读本地、不做 hydrate', async () => {
    flags.authEnabled = false
    listHistoryPreviews.mockResolvedValue([localItem])
    render(<CanvasAssetPicker ownerId="u1" busy={false} onSelect={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /repaint/ })).toBeTruthy())
    await waitFor(() => expect(listHistoryPreviews).toHaveBeenCalledTimes(1))
    expect(hydrateWorkstationHistoryFromImageJobs).not.toHaveBeenCalled()
    flags.authEnabled = true
  })

  it('空列表时显示空状态', async () => {
    listHistoryPreviews.mockResolvedValue([])
    hydrateWorkstationHistoryFromImageJobs.mockResolvedValue({ failed: 0 })
    render(<CanvasAssetPicker ownerId="u1" busy={false} onSelect={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('暂无图片资产，可以先上传本地图片')).toBeTruthy())
  })
})
