import { beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import type { SuiteAssetRef } from '../../shared/ecommerce-suite.js'
import { MOCK_PNG_1X1 } from '../image-providers/mock.js'

const mocks = vi.hoisted(() => ({
  column: true,
  thumbnail: null as string | null,
  asset: null as SuiteAssetRef | null,
  beginWrite: vi.fn(async (...args: unknown[]) => { void args }),
}))
vi.mock('./repository.js', () => ({
  suiteTransaction: (_user: unknown, action: (sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown[]) => Promise<unknown>) => action((strings, ...values) => {
    const text = Array.from(strings).join(' ')
    if (text.includes('information_schema.columns')) return [{ ready: mocks.column }]
    if (text.includes('set thumbnail_object_key')) { mocks.thumbnail = String(values[0]); return [{ thumbnail_object_key: values[0] }] }
    if (text.includes('thumbnail_object_key')) return [{ thumbnail_object_key: mocks.thumbnail }]
    return []
  }),
  requireSuite: async () => ({}),
  readyAsset: async () => mocks.asset,
  actor: (user: { id: string }) => ({ userId: user.id, runtimeScope: 'local' as const }),
  fingerprint: () => 'fp',
  toSuiteAsset: (row: unknown) => row,
}))
vi.mock('./object-writes.js', () => ({ beginSuiteObjectWrite: (user: unknown, projectId: unknown, key: unknown) => mocks.beginWrite(user, projectId, key) }))

import { accessSuiteAssets, inspectSuiteImage, renderSuiteThumbnail, resetSuiteThumbnailState, SUITE_THUMBNAIL_EDGE, type SuiteStorage } from './assets.js'
import type { SuiteUser } from './repository.js'
describe('套图图片实体验证', () => {
  it('校验实际内容、尺寸和哈希，不接受声明为其他格式', async () => {
    expect(await inspectSuiteImage(MOCK_PNG_1X1, 'image/png')).toMatchObject({ size: { width: 1, height: 1 }, mimeType: 'image/png', bytes: MOCK_PNG_1X1.length })
    await expect(inspectSuiteImage(MOCK_PNG_1X1, 'image/jpeg')).rejects.toMatchObject({ code: 'INVALID_IMAGE' })
    await expect(inspectSuiteImage(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({ code: 'INVALID_IMAGE' })
    await expect(inspectSuiteImage(new Uint8Array(20 * 1024 * 1024 + 1))).rejects.toMatchObject({ status: 413 })
  })
  it('按 EXIF 校正后的显示方向登记尺寸，避免手机照片比例颠倒', async () => {
    const jpeg = await sharp({ create: { width: 80, height: 50, channels: 3, background: '#fff' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer()
    expect((await inspectSuiteImage(jpeg, 'image/jpeg')).size).toEqual({ width: 50, height: 80 })
  })
})

describe('套图缩略图', () => {
  const user = { id: '00000000-0000-4000-8000-000000000001', email: 'fixture@example.invalid', suggestedName: '测试', avatarUrl: null, providers: [] } as SuiteUser
  const projectId = '00000000-0000-4000-8000-000000000002'
  const assetId = '00000000-0000-4000-8000-000000000003'
  const checksum = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const objectKey = `suite-assets/local/${user.id}/${projectId}/${assetId}-${checksum}.png`
  const thumbKey = `suite-assets/local/${user.id}/${projectId}/${assetId}-${checksum}.thumb.webp`

  beforeEach(() => {
    resetSuiteThumbnailState()
    mocks.column = true
    mocks.thumbnail = null
    mocks.beginWrite.mockClear()
    mocks.asset = { assetId, objectKey, checksum, projectId, actor: { userId: user.id, runtimeScope: 'local' }, mimeType: 'image/png', size: { width: 640, height: 480 }, bytes: 1 }
  })

  it('把大图压到最长边以内，体积远小于原图', async () => {
    const width = 640, height = 480, raw = Buffer.alloc(width * height * 3)
    for (let index = 0; index < raw.length; index += 3) { raw[index] = index % 251; raw[index + 1] = (index * 3) % 251; raw[index + 2] = (index * 7) % 251 }
    const png = new Uint8Array(await sharp(raw, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer())
    const thumb = await renderSuiteThumbnail(png)
    const meta = await sharp(thumb.bytes).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBeLessThanOrEqual(SUITE_THUMBNAIL_EDGE)
    expect(meta.height).toBeLessThanOrEqual(SUITE_THUMBNAIL_EDGE)
    expect(thumb.bytes.byteLength * 4).toBeLessThan(png.byteLength)
  })

  it('已有缩略图时直接签名小图，原图请求不读取缩略图', async () => {
    mocks.thumbnail = thumbKey
    const { storage, read, signRead } = fakeStorage(new Uint8Array())
    const thumbs = await accessSuiteAssets(user, projectId, { assetIds: [assetId], variant: 'thumbnail' }, storage)
    expect(thumbs.items[0]).toMatchObject({ assetId, served: 'thumbnail', url: `https://r2.test/${encodeURIComponent(thumbKey)}` })
    expect(read).not.toHaveBeenCalled()
    signRead.mockClear()
    const original = await accessSuiteAssets(user, projectId, { assetIds: [assetId] }, storage)
    expect(original.items[0]).toMatchObject({ served: 'original' })
    expect(signRead).toHaveBeenCalledWith(objectKey)
  })

  it('缺少缩略图时生成并保存，列未迁移或原图已经很小时退回原图', async () => {
    const width = 640, height = 480, raw = Buffer.alloc(width * height * 3)
    for (let index = 0; index < raw.length; index++) raw[index] = (index * 17) % 256
    const png = new Uint8Array(await sharp(raw, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer())
    const read = vi.fn(async () => ({ bytes: png }))
    const put = vi.fn(async (_key: string, bytes: Uint8Array) => { void bytes })
    const signRead = vi.fn(async (key: string) => ({ url: `https://r2.test/${encodeURIComponent(key)}`, expiresAt: 123 }))
    const storage = { read, put, signRead, signUpload: async () => 'upload' } as unknown as SuiteStorage
    const created = await accessSuiteAssets(user, projectId, { assetIds: [assetId], variant: 'thumbnail' }, storage)
    expect(created.items[0].served).toBe('thumbnail')
    expect(signRead).toHaveBeenCalledWith(thumbKey)
    expect(put.mock.calls[0][1].byteLength * 4).toBeLessThan(png.byteLength)
    expect(mocks.thumbnail).toBe(thumbKey)

    resetSuiteThumbnailState()
    mocks.column = false
    mocks.thumbnail = null
    signRead.mockClear(); put.mockClear(); read.mockClear()
    const pendingMigration = await accessSuiteAssets(user, projectId, { assetIds: [assetId], variant: 'thumbnail' }, storage)
    expect(pendingMigration.items[0]).toMatchObject({ served: 'original' })
    expect(read).not.toHaveBeenCalled()
    expect(signRead).toHaveBeenCalledWith(objectKey)

    resetSuiteThumbnailState()
    mocks.column = true
    read.mockRejectedValue(new Error('对象桶暂不可用'))
    await expect(accessSuiteAssets(user, projectId, { assetIds: [assetId], variant: 'thumbnail' }, storage)).resolves.toMatchObject({ items: [{ served: 'original' }] })
    await expect(accessSuiteAssets(user, projectId, { assetIds: [assetId], variant: 'poster' }, storage)).rejects.toThrow()
  })
})

function fakeStorage(bytes: Uint8Array) {
  const read = vi.fn(async () => ({ bytes }))
  const signRead = vi.fn(async (key: string) => ({ url: `https://r2.test/${encodeURIComponent(key)}`, expiresAt: 123 }))
  const storage = { read, put: vi.fn(async () => undefined), signRead, signUpload: async () => 'upload' } as unknown as SuiteStorage
  return { storage, read, signRead }
}
