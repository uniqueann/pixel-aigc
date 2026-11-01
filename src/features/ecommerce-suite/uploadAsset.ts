import { CloudError } from '@/cloud/client'
import type { SuiteClient } from './api'

/**
 * 上传资产。预留编号可能被一次中断的上传（pending 行）占着，服务器不允许同一编号换成另一张图；
 * 未完成的尝试不应让资产永久无法设置，因此冲突时改用新编号重传，由调用方更新配置指向新资产。
 */
export async function uploadSuiteAsset(client: SuiteClient, projectId: string, assetId: string, blob: Blob, name: string, reserved: boolean) {
  try {
    return await client.upload(projectId, assetId, blob, name)
  } catch (error) {
    if (!reserved || !(error instanceof CloudError) || error.code !== 'SUITE_REQUEST_CONFLICT') throw error
    return client.upload(projectId, crypto.randomUUID(), blob, name)
  }
}
