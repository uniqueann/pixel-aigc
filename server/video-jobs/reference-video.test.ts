import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VIDEO_REFERENCE_RETENTION_MS } from '../../shared/video-replication.js'
import { handleVideoReferenceRoute, resolveVideoReference } from './reference-video.js'

const storage = vi.hoisted(() => ({
  getObjectLimited: vi.fn(), headObject: vi.fn(), putObject: vi.fn(), signRead: vi.fn(), signUpload: vi.fn(),
}))
vi.mock('../storage.js', () => storage)
vi.mock('../db.js', () => ({
  runtimeScope: () => 'local',
  withIdentity: (_user: string, _email: string, action: (sql: unknown) => void) => action(undefined),
}))
vi.mock('../members.js', () => ({ requireActive: vi.fn() }))
vi.mock('../objects.js', () => ({ readOwnedVideoMetadata: vi.fn() }))
vi.mock('../video-providers/registry.js', () => ({ videoGenerationAvailable: () => true }))

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'local@example.test', providers: [], avatarUrl: null, suggestedName: '测试账号' }
const other = { ...user, id: '00000000-0000-4000-8000-000000000002', email: 'other@example.test' }
const sample = readFileSync('public/mock/text-to-video-5s.mp4')
const uuid = '00000000-0000-4000-8000-000000000010'
const validKey = (createdAt: number) => `temporary/video-replication/local/${user.id}/ready/${createdAt}-${uuid}-${'a'.repeat(64)}.mp4`

beforeEach(() => {
  vi.resetAllMocks()
  storage.signUpload.mockResolvedValue('https://r2.test/put')
  storage.signRead.mockResolvedValue({ url: 'https://r2.test/get' })
})

describe('视频复刻参考素材', () => {
  it('按用户和运行环境签发直传地址，只发布测量过的 MP4 字节', async () => {
    storage.getObjectLimited.mockResolvedValue({ bytes: sample })
    const upload = await handleVideoReferenceRoute(user, 'POST', ['video-references', 'uploads'], { size: sample.length })
    expect(upload).toMatchObject({ uploadUrl: 'https://r2.test/put' })
    if (!('uploadId' in upload)) throw new Error('未签发上传标识')
    const base = `temporary/video-replication/local/${user.id}/`
    expect(storage.signUpload).toHaveBeenCalledWith(`${base}pending/${upload.uploadId}`, 'video/mp4', sample.length)
    const reference = await handleVideoReferenceRoute(user, 'POST', ['video-references', 'complete'], { uploadId: upload.uploadId, size: sample.length })
    expect(reference).toMatchObject({ width: 640, height: 360, durationSeconds: 5, url: 'https://r2.test/get' })
    expect(storage.putObject).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${base}ready/${upload.uploadId}-[0-9a-f]{64}\\.mp4$`)),
      sample, 'video/mp4', expect.any(AbortSignal), { width: '640', height: '360', duration: '5' })
  })

  it('拒绝过期、跨账号、跨环境和伪造视频，未校验素材不获读取地址', async () => {
    await expect(resolveVideoReference(other, validKey(Date.now()))).rejects.toMatchObject({ status: 404 })
    await expect(resolveVideoReference(user, validKey(Date.now()).replace('/local/', '/preview/'))).rejects.toMatchObject({ status: 404 })
    await expect(resolveVideoReference(user, validKey(Date.now() - VIDEO_REFERENCE_RETENTION_MS))).rejects.toMatchObject({ status: 404 })
    expect(storage.headObject).not.toHaveBeenCalled()
    expect(storage.signRead).not.toHaveBeenCalled()
    const bytes = Buffer.from('伪造的视频')
    storage.getObjectLimited.mockResolvedValue({ bytes })
    await expect(handleVideoReferenceRoute(user, 'POST', ['video-references', 'complete'],
      { uploadId: `${Date.now()}-${uuid}`, size: bytes.length })).rejects.toMatchObject({ code: 'VIDEO_REFERENCE_INVALID' })
    expect(storage.putObject).not.toHaveBeenCalled()
  })

  it('重新预览复用已验证元数据，读取链接不超过参考素材的保留期', async () => {
    const key = validKey(Date.now() - VIDEO_REFERENCE_RETENTION_MS + 45_000)
    storage.headObject.mockResolvedValue({ bytes: sample.length, contentType: 'video/mp4', metadata: { width: '640', height: '360', duration: '5' } })
    await expect(resolveVideoReference(user, key, 7200)).resolves.toMatchObject({ key, width: 640, height: 360, durationSeconds: 5 })
    const ttl = storage.signRead.mock.calls[0][1]
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(45)
    expect(storage.getObjectLimited).not.toHaveBeenCalled()
  })
})
