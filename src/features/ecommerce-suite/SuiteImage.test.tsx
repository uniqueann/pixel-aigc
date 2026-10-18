// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SuiteAssetRef } from '@shared/ecommerce-suite'
import type { SuiteClient } from './api'
import { clearSuiteImageAccess, assignSuiteImageSource } from './imageAccess'
import SuiteImage from './SuiteImage'

vi.mock('./backup', () => ({ readSuiteBlob: vi.fn(async () => new Blob(['local'], { type: 'image/png' })) }))

const asset = {
  assetId: '00000000-0000-4000-8000-000000000003',
  projectId: '00000000-0000-4000-8000-000000000002',
  actor: { userId: '00000000-0000-4000-8000-000000000001', runtimeScope: 'local' },
  objectKey: 'suite-assets/local/asset.png', mimeType: 'image/png', size: { width: 10, height: 10 }, bytes: 4,
  checksum: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
} satisfies SuiteAssetRef

function clientFor(access = vi.fn(async (_id: string, ids: string[]) => ({
  items: ids.map(assetId => ({ assetId, url: `https://cdn.test/${assetId}`, expiresAt: Date.now() + 900_000, served: 'original' as const })),
}))) {
  return { client: { assertCurrent: () => undefined, access } as unknown as SuiteClient, access }
}

describe('套图图片节点', () => {
  beforeEach(() => { clearSuiteImageAccess(); vi.unstubAllGlobals() })

  it('同一资产的新对象不会取消已有请求，也不会再次授权', async () => {
    const { client, access } = clientFor()
    const view = render(<SuiteImage asset={asset} client={client} alt="主图" />)
    const img = view.container.querySelector('img')!
    await waitFor(() => expect(img.getAttribute('src')).toBe(`https://cdn.test/${asset.assetId}`))
    const remove = vi.spyOn(img, 'removeAttribute')
    view.rerender(<SuiteImage asset={{ ...asset }} client={client} alt="主图" />)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
    expect(access).toHaveBeenCalledTimes(1)
    expect(remove).not.toHaveBeenCalled()
    expect(img.getAttribute('src')).toBe(`https://cdn.test/${asset.assetId}`)
    view.rerender(<SuiteImage asset={{ ...asset, assetId: '00000000-0000-4000-8000-000000000009' }} client={client} alt="主图" />)
    await waitFor(() => expect(access).toHaveBeenCalledTimes(2))
    view.unmount()
  })

  it('槽位缩略图只请求缩略图，StrictMode 重放也不会打两次授权', async () => {
    const { client, access } = clientFor()
    const other = { ...asset, assetId: '00000000-0000-4000-8000-000000000004' }
    const view = render(<StrictMode><>
      <SuiteImage asset={asset} client={client} variant="thumbnail" alt="主图" />
      <SuiteImage asset={other} client={client} variant="thumbnail" alt="场景" />
    </></StrictMode>)
    await waitFor(() => expect(view.container.querySelectorAll('img[src]') ).toHaveLength(2))
    expect(access).toHaveBeenCalledTimes(1)
    const [projectId, assetIds, variant] = access.mock.calls[0] as unknown as [string, string[], string]
    expect(projectId).toBe(asset.projectId)
    expect(variant).toBe('thumbnail')
    expect(assetIds).toEqual([asset.assetId, other.assetId])
    view.unmount()
  })

  it('替换签名前保留当前画面', async () => {
    const img = document.createElement('img')
    img.src = 'https://cdn.test/old'
    const Original = globalThis.Image
    class Preload {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) { queueMicrotask(() => this.onload?.()) }
    }
    vi.stubGlobal('Image', Preload)
    let failed = false
    assignSuiteImageSource(img, 'https://cdn.test/new', () => { failed = true })
    expect(img.getAttribute('src')).toBe('https://cdn.test/old')
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(img.getAttribute('src')).toBe('https://cdn.test/new')
    expect(failed).toBe(false)
    globalThis.Image = Original
  })
})
