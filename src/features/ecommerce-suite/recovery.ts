import { CloudError } from '@/cloud/client'
import type { SuiteActor, SuiteBatch, SuiteQuote } from '@shared/ecommerce-suite'
import type { SuiteClient } from './api'
import { clearPendingSuite, readPendingSuite, savePendingSuite } from './backup'

const inFlight = new Map<string, Promise<SuiteBatch>>()

/** 提交事实不明时只做 GET；禁止失败后更换编号或自动重放收费 POST。 */
export function submitSuiteOnce(client: SuiteClient, actor: SuiteActor, projectId: string, quote: SuiteQuote): Promise<SuiteBatch> {
  const key = JSON.stringify([actor.userId, actor.runtimeScope, projectId])
  const current = inFlight.get(key)
  if (current) return current
  const action = submit(client, actor, projectId, quote)
  inFlight.set(key, action)
  void action.finally(() => { if (inFlight.get(key) === action) inFlight.delete(key) }).catch(() => undefined)
  return action
}
async function submit(client: SuiteClient, actor: SuiteActor, projectId: string, quote: SuiteQuote): Promise<SuiteBatch> {
  client.assertCurrent()
  const pending = await readPendingSuite(actor, projectId)
  if (pending) {
    const original = await client.findBatch(projectId, pending.requestId)
    if (!original) throw new Error('已有待确认的原请求，请先查询原批次，不要重新生成')
    await clearPendingSuite(actor, projectId)
    return original
  }
  const requestId = crypto.randomUUID()
  await savePendingSuite(actor, { projectId, requestId, quote, createdAt: Date.now() })
  client.assertCurrent()
  try {
    const batch = await client.submit(projectId, requestId, quote)
    await clearPendingSuite(actor, projectId)
    return batch
  } catch (error) {
    client.assertCurrent()
    if (error instanceof CloudError && [400, 401, 402, 403, 404, 409, 422, 429].includes(error.status)) {
      await clearPendingSuite(actor, projectId)
      throw error
    }
    const original = await client.findBatch(projectId, requestId)
    if (!original) throw new Error('提交结果待确认，原请求已保存在本机。请查询原批次，不要重新生成', { cause: error })
    await clearPendingSuite(actor, projectId)
    return original
  }
}
