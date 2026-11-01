import { CloudError } from '@/cloud/client'
import type { SuiteProject, SuiteProjectConfig } from '@shared/ecommerce-suite'
import type { SuiteClient } from './api'

export interface SuiteCreateResult { project: SuiteProject; requestId: string; recovered: boolean }

/** 明确表示请求未被接受的错误，无需再按编号找回。 */
const rejected = (error: unknown) => error instanceof CloudError && [400, 401, 402, 403, 404, 422, 429].includes(error.status)

/**
 * 创建结果不明时先按原编号找回，避免响应丢失后重复创建项目；
 * 只有确认旧编号已删除或已用于其他配置时，才换新编号重试一次。
 */
export async function createSuiteProject(
  client: SuiteClient,
  requestId: string,
  config: SuiteProjectConfig,
  persist: (requestId: string) => Promise<void>,
): Promise<SuiteCreateResult> {
  try {
    return { project: await client.create(requestId, config), requestId, recovered: false }
  } catch (error) {
    if (rejected(error)) throw error
    // 找回失败时保留原编号并上抛原错误：结果仍然未知，不能冒险创建第二个项目。
    let existing: SuiteProject | null
    try { existing = await client.findCreate(requestId) }
    catch { throw error }
    if (existing) return { project: existing, requestId, recovered: true }
    // 旧行已删除或该编号已用于其他配置：换新编号重试，并先持久化以保证中断后仍能找回。
    if (!(error instanceof CloudError) || (error.code !== 'SUITE_REQUEST_CONFLICT' && error.code !== 'SUITE_PROJECT_DELETED')) throw error
    const next = crypto.randomUUID()
    await persist(next)
    return { project: await client.create(next, config), requestId: next, recovered: false }
  }
}
