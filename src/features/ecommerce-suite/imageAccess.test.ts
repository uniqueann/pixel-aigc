import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudError } from '@/cloud/client'
import type { SuiteClient } from './api'
import { clearSuiteImageAccess, loadSuiteImageAccess, SUITE_IMAGE_REFRESH_MARGIN_MS } from './imageAccess'

const projectId = '00000000-0000-4000-8000-000000000002'
const first = '00000000-0000-4000-8000-000000000003'
const second = '00000000-0000-4000-8000-000000000004'

function clientFor(access: SuiteClient['access']) {
  return { access } as SuiteClient
}

describe('套图图片授权缓存', () => {
  beforeEach(() => clearSuiteImageAccess())
  afterEach(() => vi.restoreAllMocks())

  it('同一帧的多张缩略图合并成一次授权，并复用未过期地址', async () => {
    const access = vi.fn(async (_id: string, ids: string[], variant: 'original' | 'thumbnail' = 'original') => ({
      items: ids.map(assetId => ({ assetId, url: `https://cdn.test/${variant}/${assetId}`, expiresAt: Date.now() + 900_000, served: variant })),
    }))
    const client = clientFor(access)
    const [left, right, again] = await Promise.all([
      loadSuiteImageAccess(client, projectId, first, 'thumbnail'),
      loadSuiteImageAccess(client, projectId, second, 'thumbnail'),
      loadSuiteImageAccess(client, projectId, first, 'thumbnail'),
    ])
    expect(access).toHaveBeenCalledTimes(1)
    expect(access.mock.calls[0][1]).toEqual([first, second])
    expect(access.mock.calls[0][2]).toBe('thumbnail')
    expect(left.url).toContain(first)
    expect(right.url).toContain(second)
    expect(again).toEqual(left)
    await loadSuiteImageAccess(client, projectId, first, 'thumbnail')
    expect(access).toHaveBeenCalledTimes(1)
  })

  it('临近过期才重新授权；缩略图退回原图时缩短缓存', async () => {
    const now = 1_700_000_000_000
    let clock = now
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const access = vi.fn(async () => ({ items: [{ assetId: first, url: 'https://cdn.test/original', expiresAt: now + 900_000, served: 'original' as const }] }))
    const client = clientFor(access)
    await loadSuiteImageAccess(client, projectId, first, 'thumbnail')
    clock = now + SUITE_IMAGE_REFRESH_MARGIN_MS - 1
    await loadSuiteImageAccess(client, projectId, first, 'thumbnail')
    expect(access).toHaveBeenCalledTimes(1)
    clock = now + 60_000
    await loadSuiteImageAccess(client, projectId, first, 'thumbnail')
    expect(access).toHaveBeenCalledTimes(2)
    vi.restoreAllMocks()
  })

  it('旧服务不认识缩略图参数时退回原图授权', async () => {
    const access = vi.fn()
      .mockRejectedValueOnce(new CloudError(400, '请求参数无效', 'INVALID_REQUEST'))
      .mockResolvedValueOnce({ items: [{ assetId: first, url: 'https://cdn.test/original', expiresAt: Date.now() + 900_000 }] })
    await loadSuiteImageAccess(clientFor(access), projectId, first, 'thumbnail')
    expect(access).toHaveBeenCalledTimes(2)
    expect(access.mock.calls[1][2]).toBe('original')
    expect(access.mock.calls[0][2]).toBe('thumbnail')
  })
})
