// @vitest-environment jsdom

import { App } from 'antd'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Capability } from '@/types'

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

vi.mock('@/cloud/client', () => ({ authEnabled: false }))
vi.mock('@/features/assets/hydrateImageJobs', () => ({
  hydrateWorkstationHistoryFromImageJobs: () => Promise.resolve({ failed: 0 }),
}))
vi.mock('@/services/api/task', () => ({ listTasks: () => Promise.resolve({ items: [] }) }))
vi.mock('@/components/PreviewGallery', () => ({ default: () => null }))
vi.mock('@/components/usePreviewGallery', () => ({
  usePreviewGallery: () => ({ openAt, galleryProps: {} }),
}))
vi.mock('@/features/assets/workstationHistory', () => ({
  HISTORY_CHANGED: 'pixel-history-changed',
  deleteWorkstationHistory: vi.fn(),
  listHistoryPreviews: vi.fn(async () => [historyItem]),
}))

import Assets from './index'
import { usePreferencesStore } from '@/features/preferences/store'

function renderAssets() {
  return render(
    <MemoryRouter>
      <App>
        <Assets />
      </App>
    </MemoryRouter>,
  )
}

async function waitForCover() {
  return waitFor(() => screen.getByRole('button', { name: '查看融合大图' }))
}

/** 按按钮文字定位，避免 jsdom 把图标 aria-label 算进可访问名称。 */
function buttonByText(name: string) {
  const button = screen.getByText(name).closest('button')
  if (!button) throw new Error(`未找到「${name}」按钮`)
  return button
}

function expectThumbnailKeepsPreviewAccess(cover: HTMLElement) {
  expect(cover.classList.contains('assets-cover')).toBe(true)
  expect(cover.getAttribute('aria-label')).toBe('查看融合大图')
  expect(cover.querySelector('.assets-preview-hint')).toBeNull()
  expect(cover.querySelector('.anticon-zoom-in')).toBeNull()
  expect(buttonByText('查看大图')).toBeTruthy()
}

describe('我的资产缩略图预览入口', () => {
  beforeEach(() => {
    openAt.mockReset()
    localStorage.clear()
    usePreferencesStore.getState().reset()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })))
    URL.createObjectURL = vi.fn(() => 'blob:assets-thumb')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    cleanup()
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

  it('列表视图同样不叠加放大镜，并保留查看大图按钮', async () => {
    renderAssets()
    await waitForCover()
    fireEvent.click(screen.getByRole('button', { name: '列表视图' }))
    const cover = await waitForCover()
    expectThumbnailKeepsPreviewAccess(cover)
    expect(document.querySelector('.assets-list')).toBeTruthy()

    fireEvent.click(buttonByText('查看大图'))
    expect(openAt).toHaveBeenCalledWith('hist-1')
  })
})
