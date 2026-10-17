import { cloudRequest, CloudError } from '@/cloud/client'
import { useUserStore } from '@/store/useUserStore'
import { normalizeImageBlob } from '@shared/image-format'
import type { SuiteActor, SuiteAssetRef, SuiteBatch, SuiteProject, SuiteProjectConfig, SuiteQuote, SuiteQuoteRequest, SuiteSlotDraft, SuiteSlotVersion } from '@shared/ecommerce-suite'
import type { SuiteBatchDetail, SuiteProjectDetail, SuiteProjectList } from '@shared/ecommerce-suite-runtime'
import type { SuiteBridgeDetail } from '@shared/ecommerce-suite-runtime'
import type { SuiteRestoreSnapshotRequest } from '@shared/ecommerce-suite-recovery'
import type { SuitePrecheck, SuiteExportConfig } from '@shared/ecommerce-suite-precheck'
import type { z } from 'zod'
import type { suiteCreateBridgeRequestSchema, suiteSaveVersionRequestSchema, SuiteBridge, SuiteTaskResult } from '@shared/ecommerce-suite'

export function suiteClient(actor: SuiteActor, signal?: AbortSignal) {
  const assertCurrent = () => {
    signal?.throwIfAborted()
    const account = useUserStore.getState().account
    if (account?.userId !== actor.userId || account.runtimeScope !== actor.runtimeScope) throw new CloudError(401, '账号或运行环境已切换', 'ACCOUNT_CHANGED')
  }
  const request = async <T>(path: string, method = 'GET', body?: unknown, timeoutMs?: number): Promise<T> => {
    assertCurrent()
    const result = await cloudRequest<T>(path.startsWith('/bridges/') ? `/ecommerce${path}` : `/ecommerce/suites${path}`, method, body, { expectedUserId: actor.userId, signal, timeoutMs })
    assertCurrent()
    return result
  }
  const upload = async (projectId: string, assetId: string, source: Blob, name = '商品图片') => {
    assertCurrent()
    const blob = await normalizeImageBlob(source)
    const pending = await request<{ asset?: SuiteAssetRef; assetId: string; uploadId: string; uploadUrl: string }>(`/${projectId}/assets`, 'POST', {
      requestId: assetId, name: name.slice(0, 200), mimeType: blob.type, bytes: blob.size,
    })
    if (pending.asset) return pending.asset
    assertCurrent()
    const response = await fetch(pending.uploadUrl, { method: 'PUT', headers: { 'Content-Type': blob.type }, body: blob,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) })
    if (!response.ok) throw new Error('图片上传中断，可使用原上传编号继续')
    assertCurrent()
    return (await request<{ asset: SuiteAssetRef }>(`/${projectId}/assets/complete`, 'POST', { assetId: pending.assetId, uploadId: pending.uploadId })).asset
  }
  return {
    assertCurrent, upload,
    list: (cursor = '1', deleted = false) => request<SuiteProjectList>(`?cursor=${cursor}${deleted ? '&deleted=1' : ''}`),
    create: (requestId: string, config: SuiteProjectConfig) => request<SuiteProject>('', 'POST', { requestId, config }),
    restoreSnapshot: (id: string, value: SuiteRestoreSnapshotRequest) => request<SuiteProject>(`/${id}/restore-snapshot`, 'POST', value, 120000),
    findCreate: (requestId: string) => request<SuiteProject | null>(`/by-request/${requestId}`),
    get: (id: string) => request<SuiteProjectDetail>(`/${id}`),
    precheck: (id: string, versionIds: string[], output: SuiteExportConfig) => request<SuitePrecheck>(`/${id}/prechecks`, 'POST', { versionIds, output }),
    update: (id: string, expectedRevision: number, config: SuiteProjectConfig) => request<SuiteProject>(`/${id}`, 'PATCH', { expectedRevision, config }),
    access: (id: string, assetIds: string[]) => request<{ items: { assetId: string; url: string; expiresAt: number }[] }>(`/${id}/assets/access`, 'POST', { assetIds }),
    draft: (id: string, slotId: string, value: SuiteSlotDraft) => request<{ slotId: string; revision: number; value: SuiteSlotDraft }>(`/${id}/slots/${slotId}/draft`, 'PATCH', value),
    versions: (id: string, slotId: string, before = '2147483647') => request<{ items: SuiteSlotVersion[]; nextCursor: string | null }>(`/${id}/slots/${slotId}/versions?before=${before}`),
    select: (id: string, slotId: string, versionId: string, expectedHeadRevision: number) => request<SuiteProject>(`/${id}/slots/${slotId}/current`, 'PATCH', { versionId, expectedHeadRevision }),
    saveVersion: (id: string, slotId: string, value: z.infer<typeof suiteSaveVersionRequestSchema>) => request<{ version: SuiteSlotVersion; project: SuiteProject }>(`/${id}/slots/${slotId}/versions`, 'POST', value),
    createBridge: (id: string, value: z.infer<typeof suiteCreateBridgeRequestSchema>) => request<SuiteBridge>(`/${id}/bridges`, 'POST', value),
    bridge: (id: string) => request<SuiteBridgeDetail>(`/bridges/${id}`),
    returnBridge: (id: string, requestId: string, result: SuiteTaskResult) => request<{ version: SuiteSlotVersion; candidateOnly: boolean; sourceChanged: boolean; sizeChanged?: boolean }>(`/bridges/${id}/results`, 'POST', { requestId, result }),
    quote: (id: string, value: SuiteQuoteRequest) => request<SuiteQuote>(`/${id}/quotes`, 'POST', value),
    submit: (id: string, requestId: string, quote: SuiteQuote) => request<SuiteBatch>(`/${id}/batches`, 'POST', {
      requestId, quoteId: quote.id, expectedRevision: quote.expectedRevision, planFingerprint: quote.planFingerprint, maxCredits: quote.totalCredits,
    }, 120000),
    stop: (id: string, batchId: string) => request<SuiteBatch>(`/${id}/batches/${batchId}/stop`, 'POST', {}),
    batch: (id: string, batchId: string) => request<SuiteBatchDetail>(`/${id}/batches/${batchId}`),
    findBatch: (id: string, requestId: string) => request<SuiteBatch | null>(`/${id}/batches/by-request/${requestId}`),
    results: (id: string, batchId: string) => request(`/${id}/batches/${batchId}/results`, 'POST', {}),
    recycle: (id: string) => request(`/${id}`, 'DELETE'),
    restore: (id: string) => request(`/${id}/restore`, 'POST', {}),
  }
}
export type SuiteClient = ReturnType<typeof suiteClient>
