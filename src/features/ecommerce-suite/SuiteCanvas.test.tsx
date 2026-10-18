// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SuiteAssetRef, SuiteComposition } from '@shared/ecommerce-suite'
import type { SuiteClient } from './api'
import SuiteCanvas from './SuiteCanvas'

const backupAssetBlob = vi.hoisted(() => vi.fn())
const paintSuite = vi.hoisted(() => vi.fn())
vi.mock('./recoveryPackage', () => ({ backupAssetBlob }))
vi.mock('./render', () => ({ paintSuite }))

const fixture = JSON.parse(readFileSync('docs/verification/ecommerce-suite/phase-one/contract-fixtures.json', 'utf8'))
const asset = fixture.asset as SuiteAssetRef
const composition = fixture.version.composition as SuiteComposition
const otherAsset: SuiteAssetRef = { ...asset, assetId: '00000000-0000-4000-8000-000000000099', checksum: 'c'.repeat(64) }

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const draws: HTMLCanvasElement[] = []
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext

beforeEach(() => {
  draws.length = 0
  originalGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    return { drawImage: () => { if (this.getAttribute('aria-label')) draws.push(this) } }
  } as unknown as typeof HTMLCanvasElement.prototype.getContext
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 8, height: 8, close: vi.fn() })))
  backupAssetBlob.mockReset()
  paintSuite.mockReset()
  backupAssetBlob.mockImplementation(async () => new Blob(['preview'], { type: 'image/png' }))
  paintSuite.mockImplementation(async (buffer: HTMLCanvasElement) => { buffer.width = 16; buffer.height = 16; return [] })
})

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext
  vi.unstubAllGlobals()
})

function harness(current = asset, layers = composition) {
  const client = { assertCurrent: () => undefined } as unknown as SuiteClient
  const signal = new AbortController().signal
  const props = { asset: current, composition: layers, client, signal, onSelect: () => undefined, onChange: () => undefined, editable: false }
  return props
}

function preview(container: HTMLElement) {
  const canvas = container.querySelector('canvas')
  if (!canvas) throw new Error('缺少预览画布')
  return canvas
}

async function shown(container: HTMLElement) {
  await waitFor(() => expect(preview(container).hidden).toBe(false))
  return preview(container)
}

describe('套图主预览', () => {
  it('轮询替换资产对象时不重新下载原图，切换版本才重新读取', async () => {
    const props = harness()
    const view = render(<SuiteCanvas {...props} />)
    await waitFor(() => expect(backupAssetBlob).toHaveBeenCalledTimes(1))
    await shown(view.container)
    expect(paintSuite).toHaveBeenCalledTimes(1)
    view.rerender(<SuiteCanvas {...props} asset={{ ...asset }} composition={{ ...composition }} />)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(backupAssetBlob).toHaveBeenCalledTimes(1)
    expect(paintSuite).toHaveBeenCalledTimes(1)
    expect(preview(view.container).hidden).toBe(false)
    view.rerender(<SuiteCanvas {...props} asset={otherAsset} />)
    await waitFor(() => expect(backupAssetBlob).toHaveBeenCalledTimes(2))
    await shown(view.container)
    expect(paintSuite).toHaveBeenCalledTimes(2)
    view.unmount()
  })

  it('新槽位的原图已经读到、绘制尚未完成时，不显示上一张图', async () => {
    const loads = [deferred<Blob>(), deferred<Blob>()]
    const paints = [deferred<never[]>(), deferred<never[]>()]
    let loadIndex = 0
    let paintIndex = 0
    backupAssetBlob.mockImplementation(() => loads[loadIndex++].promise)
    paintSuite.mockImplementation((buffer: HTMLCanvasElement) => { buffer.width = 16; buffer.height = 16; return paints[paintIndex++].promise })
    const props = harness()
    const view = render(<SuiteCanvas {...props} />)
    await act(async () => { loads[0].resolve(new Blob(['a'], { type: 'image/png' })) })
    await waitFor(() => expect(paintSuite).toHaveBeenCalledTimes(1))
    expect(preview(view.container).hidden).toBe(true)
    await act(async () => { paints[0].resolve([]) })
    await shown(view.container)
    const drawn = draws.length
    view.rerender(<SuiteCanvas {...props} asset={otherAsset} composition={{ ...composition, layersSnapshot: [] }} />)
    await act(async () => { loads[1].resolve(new Blob(['b'], { type: 'image/png' })) })
    await waitFor(() => expect(paintSuite).toHaveBeenCalledTimes(2))
    expect(preview(view.container).hidden).toBe(true)
    expect(draws.length).toBe(drawn)
    await act(async () => { paints[1].resolve([]) })
    await shown(view.container)
    expect(draws.length).toBeGreaterThan(drawn)
    view.unmount()
  })

  it('较早槽位的加载或绘制晚到时，不会盖住当前槽位', async () => {
    const loads = [deferred<Blob>(), deferred<Blob>()]
    const paints = [deferred<never[]>(), deferred<never[]>()]
    let loadIndex = 0
    let paintIndex = 0
    backupAssetBlob.mockImplementation(() => loads[loadIndex++].promise)
    paintSuite.mockImplementation((buffer: HTMLCanvasElement) => { buffer.width = 16; buffer.height = 16; return paints[paintIndex++].promise })
    const props = harness()
    const view = render(<SuiteCanvas {...props} />)
    await act(async () => { loads[0].resolve(new Blob(['a'], { type: 'image/png' })) })
    await waitFor(() => expect(paintSuite).toHaveBeenCalledTimes(1))
    view.rerender(<SuiteCanvas {...props} asset={otherAsset} composition={{ ...composition, layersSnapshot: [] }} />)
    await act(async () => { loads[1].resolve(new Blob(['b'], { type: 'image/png' })) })
    await waitFor(() => expect(paintSuite).toHaveBeenCalledTimes(2))
    await act(async () => { paints[1].resolve([]) })
    const canvas = await shown(view.container)
    const drawn = draws.length
    await act(async () => { paints[0].resolve([]) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(canvas.hidden).toBe(false)
    expect(draws.length).toBe(drawn)
    expect(paintSuite).toHaveBeenCalledTimes(2)
    view.unmount()
  })

  it('较早槽位的原图晚到时只进入缓存，不改当前画面', async () => {
    const loads = [deferred<Blob>(), deferred<Blob>()]
    let loadIndex = 0
    backupAssetBlob.mockImplementation(() => loads[loadIndex++].promise)
    const props = harness()
    const view = render(<SuiteCanvas {...props} />)
    await waitFor(() => expect(backupAssetBlob).toHaveBeenCalledTimes(1))
    view.rerender(<SuiteCanvas {...props} asset={otherAsset} composition={{ ...composition, layersSnapshot: [] }} />)
    await waitFor(() => expect(backupAssetBlob).toHaveBeenCalledTimes(2))
    await act(async () => { loads[1].resolve(new Blob(['b'], { type: 'image/png' })) })
    const canvas = await shown(view.container)
    const drawn = draws.length
    const paints = paintSuite.mock.calls.length
    await act(async () => { loads[0].resolve(new Blob(['a'], { type: 'image/png' })) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(canvas.hidden).toBe(false)
    expect(draws.length).toBe(drawn)
    expect(paintSuite.mock.calls.length).toBe(paints)
    view.unmount()
  })

  it('已绘制过的槽位再次切回时立即显示，不等待新的异步绘制', async () => {
    const props = harness()
    const view = render(<SuiteCanvas {...props} />)
    await shown(view.container)
    view.rerender(<SuiteCanvas {...props} asset={otherAsset} composition={{ ...composition, layersSnapshot: [] }} />)
    await shown(view.container)
    const paints = paintSuite.mock.calls.length
    const loads = backupAssetBlob.mock.calls.length
    const drawn = draws.length
    let resumed = false
    paintSuite.mockImplementation(() => new Promise(() => { resumed = true }))
    view.rerender(<SuiteCanvas {...props} />)
    expect(preview(view.container).hidden).toBe(false)
    expect(paintSuite.mock.calls.length).toBe(paints)
    expect(backupAssetBlob.mock.calls.length).toBe(loads)
    expect(draws.length).toBeGreaterThan(drawn)
    expect(resumed).toBe(false)
    view.unmount()
  })

  it('同一张图修改文字图层时会重绘，重绘完成前仍显示这张图', async () => {
    const props = harness()
    const view = render(<SuiteCanvas {...props} />)
    await shown(view.container)
    const pending = deferred<never[]>()
    paintSuite.mockImplementation((buffer: HTMLCanvasElement) => { buffer.width = 16; buffer.height = 16; return pending.promise })
    view.rerender(<SuiteCanvas {...props} composition={{ ...composition, layersSnapshot: [] }} />)
    await waitFor(() => expect(paintSuite).toHaveBeenCalledTimes(2))
    expect(preview(view.container).hidden).toBe(false)
    expect(createImageBitmap).toHaveBeenCalledTimes(1)
    const firstBitmap = paintSuite.mock.calls[0][5]
    expect(firstBitmap).toBeTruthy()
    expect(paintSuite.mock.calls[1][5]).toBe(firstBitmap)
    await act(async () => { pending.resolve([]) })
    expect(preview(view.container).hidden).toBe(false)
    view.unmount()
  })
})
