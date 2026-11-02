import { describe, expect, it, vi } from 'vitest'
import { CloudError } from '@/cloud/client'
import type { SuiteAssetRef } from '@shared/ecommerce-suite'
import type { SuiteClient } from './api'
import { uploadSuiteAsset } from './uploadAsset'

const projectId = '00000000-0000-4000-8000-000000000001'
const reservedId = '00000000-0000-4000-8000-000000000002'
const blob = new Blob(['图片'], { type: 'image/png' })
const asset = { assetId: reservedId } as SuiteAssetRef
const uploader = () => vi.fn<(projectId: string, assetId: string, source: Blob, name?: string) => Promise<SuiteAssetRef>>()
const fake = (upload: ReturnType<typeof uploader>) => ({ upload } as unknown as SuiteClient)

describe('套图资产上传编号', () => {
  it('预留编号可用时直接复用，便于中断后接着传同一张图', async () => {
    const upload = uploader().mockResolvedValue(asset)
    await expect(uploadSuiteAsset(fake(upload), projectId, reservedId, blob, '商品主体图', true)).resolves.toBe(asset)
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0][1]).toBe(reservedId)
  })

  it('预留编号被中断的旧上传占着时换新编号重传，避免底图永久无法设置', async () => {
    const next = { assetId: '00000000-0000-4000-8000-000000000003' } as SuiteAssetRef
    const upload = uploader()
      .mockRejectedValueOnce(new CloudError(409, '上传编号已用于其他图片', 'SUITE_REQUEST_CONFLICT'))
      .mockResolvedValueOnce(next)
    await expect(uploadSuiteAsset(fake(upload), projectId, reservedId, blob, '商品主体图', true)).resolves.toBe(next)
    expect(upload).toHaveBeenCalledTimes(2)
    expect(upload.mock.calls[1][1]).not.toBe(reservedId)
  })

  it('编号不是预留的或不是冲突错误时原样抛出', async () => {
    const conflict = uploader().mockRejectedValue(new CloudError(409, '上传编号已用于其他图片', 'SUITE_REQUEST_CONFLICT'))
    await expect(uploadSuiteAsset(fake(conflict), projectId, reservedId, blob, '商品主体图', false)).rejects.toMatchObject({ code: 'SUITE_REQUEST_CONFLICT' })
    expect(conflict).toHaveBeenCalledTimes(1)

    const broken = uploader().mockRejectedValue(new CloudError(500, '存储不可用'))
    await expect(uploadSuiteAsset(fake(broken), projectId, reservedId, blob, '商品主体图', true)).rejects.toMatchObject({ status: 500 })
    expect(broken).toHaveBeenCalledTimes(1)
  })
})
