// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearChunkReloadMark,
  consumeChunkReload,
  isChunkLoadError,
  markChunkReload,
  reloadOnceForChunkError,
} from './chunkLoadError'
import { importWithChunkRecovery } from './lazyWithRetry'

afterEach(() => {
  clearChunkReloadMark()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('分包加载失败识别', () => {
  it('识别 Vite 动态 import 失败文案', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://aigc.contentup.cc/assets/MaskPaintCanvas-abc.js'))).toBe(true)
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(Object.assign(new Error('Loading chunk 7 failed'), { name: 'ChunkLoadError' }))).toBe(true)
    expect(isChunkLoadError(new Error('蒙版画布尚未准备好'))).toBe(false)
  })

  it('同一次会话只自动刷新一次', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    expect(consumeChunkReload()).toBe(false)
    expect(reloadOnceForChunkError()).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
    expect(consumeChunkReload()).toBe(true)
    expect(reloadOnceForChunkError()).toBe(false)
    expect(reload).toHaveBeenCalledOnce()
    expect(markChunkReload()).toBe(false)
  })

  it('动态 import 失败时先重试，再触发一次刷新', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const importer = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce({ default: 'ok' })
    await expect(importWithChunkRecovery(importer)).resolves.toEqual({ default: 'ok' })
    expect(importer).toHaveBeenCalledTimes(2)
    expect(reload).not.toHaveBeenCalled()

    importer.mockRejectedValue(new TypeError('Failed to fetch dynamically imported module'))
    void importWithChunkRecovery(importer)
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(reload).toHaveBeenCalledOnce()
  })
})
