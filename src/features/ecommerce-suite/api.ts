import { cloudRequest, CloudError } from '@/cloud/client'
import { useUserStore } from '@/store/useUserStore'
import { normalizeImageBlob } from '@shared/image-format'
import type { SuiteActor, SuiteAssetRef, SuiteBatch, SuiteProject, SuiteProjectConfig, SuiteQuote, SuiteQuoteRequest, SuiteSlotDraft, SuiteSlotVersion } from '@shared/ecommerce-suite'
import type { SuiteProjectDetail, SuiteProjectList } from '@shared/ecommerce-suite-runtime'

export function suiteClient(actor: SuiteActor, signal?: AbortSignal) {
  const assertCurrent = () => {
    signal?.throwIfAborted()
    const account = useUserStore.getState().account
    if (account?.userId !== actor.userId || account.runtimeScope !== actor.runtimeScope) throw new CloudError(401, '账号或运行环境已切换', 'ACCOUNT_CHANGED')
  }
  const request = async <T>(path: string, method = 'GET', body?: unknown, timeoutMs?: number): Promise<T> => {
    assertCurrent()
    const result = await cloudRequest<T>(`/ecommerce/suites${path}`, method, body, { expectedUserId: actor.userId, signal, timeoutMs })
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
    findCreate: (requestId: string) => request<SuiteProject | null>(`/by-request/${requestId}`),
    get: (id: string) => request<SuiteProjectDetail>(`/${id}`),
    update: (id: string, expectedRevision: number, config: SuiteProjectConfig) => request<SuiteProject>(`/${id}`, 'PATCH', { expectedRevision, config }),
    access: (id: string, assetIds: string[]) => request<{ items: { assetId: string; url: string; expiresAt: number }[] }>(`/${id}/assets/access`, 'POST', { assetIds }),
    draft: (id: string, slotId: string, value: SuiteSlotDraft) => request<{ slotId: string; revision: number; value: SuiteSlotDraft }>(`/${id}/slots/${slotId}/draft`, 'PATCH', value),
    versions: (id: string, slotId: string, before = '2147483647') => request<{ items: SuiteSlotVersion[]; nextCursor: string | null }>(`/${id}/slots/${slotId}/versions?before=${before}`),
    select: (id: string, slotId: string, versionId: string, expectedHeadRevision: number) => request<SuiteProject>(`/${id}/slots/${slotId}/current`, 'PATCH', { versionId, expectedHeadRevision }),
    quote: (id: string, value: SuiteQuoteRequest) => request<SuiteQuote>(`/${id}/quotes`, 'POST', value),
    submit: (id: string, requestId: string, quote: SuiteQuote) => request<SuiteBatch>(`/${id}/batches`, 'POST', {
      requestId, quoteId: quote.id, expectedRevision: quote.expectedRevision, planFingerprint: quote.planFingerprint, maxCredits: quote.totalCredits,
    }, 120000),
    findBatch: (id: string, requestId: string) => request<SuiteBatch | null>(`/${id}/batches/by-request/${requestId}`),
    results: (id: string, batchId: string) => request(`/${id}/batches/${batchId}/results`, 'POST', {}),
    recycle: (id: string) => request(`/${id}`, 'DELETE'),
    restore: (id: string) => request(`/${id}/restore`, 'POST', {}),
  }
}
export type SuiteClient = ReturnType<typeof suiteClient>
