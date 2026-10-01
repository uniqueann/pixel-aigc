// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest'
import { expansionPlan } from './expansion'
import { expandRemoteImage } from './outpaintClient'
import type { BatchImage } from './types'

const mocks = vi.hoisted(() => ({ uploadTaskInput: vi.fn() }))
vi.mock('@/services/api/upload', () => ({ uploadTaskInput: mocks.uploadTaskInput }))
vi.mock('@/services/api/task', () => ({ liveCapabilityReady: () => false }))

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('5.1 MB 原图保留分辨率时不经缩放画布，原文件直传 R2 后只提交对象键', async () => {
  Object.defineProperty(AbortSignal, 'timeout', { configurable: true, value: () => new AbortController().signal })
  const file = new File([new Uint8Array([255, 216, 255]), new Uint8Array(Math.ceil(5.1 * 1024 * 1024) - 3)], '大图.jpg', { type: 'image/jpeg' })
  const image: BatchImage = { id: 'large', file, sourceMime: 'image/jpeg', sourceUrl: '', width: 3200, height: 5035, status: 'pending' }
  const plan = expansionPlan(3200, 5035, 1600, 1600, 'original')
  mocks.uploadTaskInput.mockResolvedValue('temporary/task-inputs/user/original')
  const fetchMock = vi.fn(async () => new Response(new Blob(['result'], { type: 'image/jpeg' }), {
    headers: { 'Content-Type': 'image/jpeg' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 5035, height: 5035, close: vi.fn() })))
  const createElement = vi.spyOn(document, 'createElement')
  const result = await expandRemoteImage(image, plan, () => false)
  expect(mocks.uploadTaskInput).toHaveBeenCalledWith(file, 'image/jpeg', expect.any(AbortSignal))
  expect(createElement).not.toHaveBeenCalled()
  const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
  expect(body).toMatchObject({ sourceImageKey: 'temporary/task-inputs/user/original', padding: { left: 917, right: 918, top: 0, bottom: 0 } })
  expect(body.dataBase64).toBeUndefined()
  expect(result).toMatchObject({ width: 5035, height: 5035 })
})
