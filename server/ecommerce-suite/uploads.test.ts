import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MOCK_PNG_1X1 } from '../image-providers/mock.js'
import type { SuiteUser } from './repository.js'

const state = vi.hoisted(() => ({
  asset: null as Record<string, unknown> | null,
  inserts: 0,
  dropReset: false,
  calls: [] as string[],
  beginWrite: vi.fn(async () => undefined),
}))

vi.mock('./repository.js', () => ({
  suiteTransaction: (_user: unknown, action: (sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown[]) => Promise<unknown>) =>
    action((strings, ...values) => {
      const text = Array.from(strings).join(' ')
      if (text.startsWith('select pg_advisory_xact_lock')) { state.calls.push('lock'); return [] }
      if (text.includes('information_schema.columns')) return [{ ready: false }]
      if (text.startsWith('insert into aigc.suite_assets')) {
        state.inserts++
        state.calls.push('insert')
        state.asset = {
          id: values[0], user_id: values[1], scope: values[2], project_id: values[3],
          request_fingerprint: values[4], upload_id: values[5], temp_key: values[6],
          object_key: values[7], mime_type: values[8], bytes: values[9], status: 'pending',
          width: null, height: null, checksum: null, thumbnail_object_key: null,
        }
        return [state.asset]
      }
      if (text.includes('set request_fingerprint=')) {
        state.calls.push('reset')
        if (state.dropReset) { state.asset = null; return [] }
        if (!state.asset || state.asset.status !== 'pending') return []
        state.asset = { ...state.asset, request_fingerprint: values[0], upload_id: values[1], temp_key: values[2], mime_type: values[3], bytes: values[4] }
        return [state.asset]
      }
      if (text.startsWith('update aigc.suite_assets')) {
        state.calls.push('update')
        if (!state.asset) return []
        state.asset = { ...state.asset, object_key: values[0], width: values[1], height: values[2], checksum: values[3], status: 'ready' }
        return [state.asset]
      }
      if (text.startsWith('select * from aigc.suite_assets')) {
        state.calls.push(text.includes('upload_id=') ? 'complete-select' : 'begin-select')
        return state.asset ? [state.asset] : []
      }
      return []
    }),
  requireSuite: async () => ({}),
  readyAsset: async () => null,
  actor: (user: { id: string }) => ({ userId: user.id, runtimeScope: 'local' as const }),
  fingerprint: () => 'fp',
  toSuiteAsset: (row: Record<string, unknown>) => ({
    assetId: String(row.id), projectId: String(row.project_id),
    actor: { userId: String(row.user_id), runtimeScope: 'local' },
    mimeType: row.mime_type, size: { width: row.width, height: row.height },
    bytes: Number(row.bytes), checksum: row.checksum, objectKey: String(row.object_key),
  }),
}))
vi.mock('./object-writes.js', () => ({ beginSuiteObjectWrite: () => state.beginWrite() }))

import { beginSuiteUpload, completeSuiteUpload, type SuiteStorage } from './assets.js'

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'fixture@example.invalid',
  suggestedName: '测试',
  avatarUrl: null,
  providers: [],
} as SuiteUser
const projectId = '00000000-0000-4000-8000-000000000002'
const requestId = '00000000-0000-4000-8000-000000000003'
const uploadId = '00000000-0000-4000-8000-000000000004'
const tempKey = `temporary/suite-uploads/local/${user.id}/${projectId}/${uploadId}`
const pendingKey = `suite-assets/local/${user.id}/${projectId}/${requestId}.pending`
const request = { requestId, name: '商品图', mimeType: 'image/png' as const, bytes: MOCK_PNG_1X1.length }

function pendingAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: requestId, user_id: user.id, scope: 'local', project_id: projectId,
    request_fingerprint: 'fp', upload_id: uploadId, temp_key: tempKey,
    object_key: pendingKey, mime_type: 'image/png', bytes: MOCK_PNG_1X1.length,
    status: 'pending', width: null, height: null, checksum: null, thumbnail_object_key: null,
    ...overrides,
  }
}

function fakeStorage() {
  const read = vi.fn(async () => ({ bytes: MOCK_PNG_1X1 }))
  const put = vi.fn(async () => undefined)
  const signRead = vi.fn(async (key: string) => ({ url: `https://r2.test/${encodeURIComponent(key)}`, expiresAt: 0 }))
  const signUpload = vi.fn(async (key: string) => `https://upload.test/${encodeURIComponent(key)}`)
  const remove = vi.fn(async () => undefined)
  return { storage: { read, put, signRead, signUpload, delete: remove } as SuiteStorage, read, put, signRead, signUpload, remove }
}

describe('套图上传许可并发幂等', () => {
  beforeEach(() => {
    state.asset = null
    state.inserts = 0
    state.dropReset = false
    state.calls = []
    state.beginWrite.mockClear()
  })

  it('同一 requestId 先加事务锁再查重，重复调用复用同一上传许可', async () => {
    const store = fakeStorage()
    const first = await beginSuiteUpload(user, projectId, request, store.storage)
    const second = await beginSuiteUpload(user, projectId, request, store.storage)

    // 锁必须排在查重之前，否则并发请求会同时查不到再撞主键。
    expect(state.calls.slice(0, 3)).toEqual(['lock', 'begin-select', 'insert'])
    expect(state.inserts).toBe(1)
    expect(second).toMatchObject({ assetId: requestId, uploadId: (first as { uploadId: string }).uploadId })
    expect(store.signUpload).toHaveBeenCalledTimes(2)
  })

  it('同一编号换图重试时重置未完成的上传，旧尝试不再占住编号', async () => {
    state.asset = pendingAsset({ request_fingerprint: 'other', upload_id: '00000000-0000-4000-8000-000000000099' })
    const store = fakeStorage()
    const result = await beginSuiteUpload(user, projectId, request, store.storage)

    expect(state.calls).toContain('reset')
    expect(result).toMatchObject({ assetId: requestId })
    expect((result as { uploadId: string }).uploadId).not.toBe('00000000-0000-4000-8000-000000000099')
    expect(state.asset).toMatchObject({ request_fingerprint: 'fp', status: 'pending' })
    expect(store.signUpload).toHaveBeenCalledTimes(1)
  })

  it('已完成的资产不允许被同一编号覆盖', async () => {
    state.asset = pendingAsset({ status: 'ready', request_fingerprint: 'other' })
    await expect(beginSuiteUpload(user, projectId, request, fakeStorage().storage)).rejects.toMatchObject({ code: 'SUITE_REQUEST_CONFLICT' })
  })

  it('清理任务在重置前删除旧行时按全新上传插入', async () => {
    state.asset = pendingAsset({ request_fingerprint: 'other' })
    state.dropReset = true
    const result = await beginSuiteUpload(user, projectId, request, fakeStorage().storage)

    expect(state.inserts).toBe(1)
    expect(result).toMatchObject({ assetId: requestId })
  })
})

describe('套图上传完成后的临时对象清理', () => {
  beforeEach(() => {
    state.calls = []
    state.beginWrite.mockClear()
  })

  it('正式对象落库并登记成功后才删除临时对象', async () => {
    state.asset = pendingAsset()
    const store = fakeStorage()
    const result = await completeSuiteUpload(user, projectId, { assetId: requestId, uploadId }, store.storage)

    expect(result.asset).toMatchObject({ assetId: requestId, mimeType: 'image/png', size: { width: 1, height: 1 } })
    expect(state.asset?.status).toBe('ready')
    expect(state.calls).toContain('update')
    expect(store.remove).toHaveBeenCalledWith(tempKey)
  })

  it('图片校验失败时不删除临时对象，保留重试与排查依据', async () => {
    state.asset = pendingAsset({ bytes: 3 })
    const store = fakeStorage()
    store.read.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]) })

    await expect(completeSuiteUpload(user, projectId, { assetId: requestId, uploadId }, store.storage))
      .rejects.toMatchObject({ code: 'INVALID_IMAGE' })
    expect(store.remove).not.toHaveBeenCalled()
  })

  it('重复完成已就绪的上传直接返回资产，不读取也不删除临时对象', async () => {
    state.asset = pendingAsset({ status: 'ready' })
    const store = fakeStorage()
    const result = await completeSuiteUpload(user, projectId, { assetId: requestId, uploadId }, store.storage)

    expect(result.asset).toMatchObject({ assetId: requestId })
    expect(store.read).not.toHaveBeenCalled()
    expect(store.remove).not.toHaveBeenCalled()
  })
})
