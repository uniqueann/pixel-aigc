import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import { taskInputKey } from './imageInput'
const mocks = vi.hoisted(() => ({ read: vi.fn(), upload: vi.fn() }))
vi.mock('@/features/image-workstation/download', () => ({ blobFromImageSource: mocks.read }))
vi.mock('./upload', () => ({ uploadTaskInput: mocks.upload }))
beforeEach(() => vi.resetAllMocks())

describe('共享生成原图准备', () => {
  const asset = createImageAsset({ id: 'input', name: '原图', url: 'data:image/png;base64,aW1hZ2U=', width: 100, height: 100, mimeType: 'image/jpeg' })
  it('本地原图按实际 Blob 格式上传，原 Asset 保留可恢复内容', async () => {
    const blob = new Blob(['原图'], { type: 'image/png' })
    const options = { ownerId: 'owner', signal: new AbortController().signal }
    mocks.read.mockResolvedValue(blob)
    mocks.upload.mockResolvedValue('uploaded-key')
    await expect(taskInputKey(asset, '读取失败', options)).resolves.toBe('uploaded-key')
    expect(mocks.upload).toHaveBeenCalledWith(blob, 'image/png', options.signal)
    expect(asset.objectKey).toBeUndefined()
    expect(asset.url).toMatch(/^data:/)
  })

  it('私有对象与云端素材直接复用对象键，不重复读取或上传', async () => {
    await expect(taskInputKey({ ...asset, objectKey: 'existing-key' }, '读取失败')).resolves.toBe('existing-key')
    await expect(taskInputKey({ ...asset, storage: { provider: 'r2', projectId: 'project', objectKey: 'cloud-key' } }, '读取失败')).resolves.toBe('cloud-key')
    expect(mocks.read).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('已取消的操作不使用对象键也不上传，读取失败保留原错误原因', async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(taskInputKey({ ...asset, objectKey: 'existing-key' }, '读取失败', { ownerId: 'owner', signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' })
    const cause = new Error('图片不存在')
    mocks.read.mockRejectedValueOnce(cause)
    await expect(taskInputKey(asset, '无法读取原图')).rejects.toMatchObject({ message: '无法读取原图', cause })
    expect(mocks.upload).not.toHaveBeenCalled()
  })
})
