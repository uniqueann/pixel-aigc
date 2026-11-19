import { createHash } from 'node:crypto'
import { z } from 'zod'

const credits = z.number().int().positive().max(100_000)
const row = z.tuple([credits, credits, credits])
const schema = z.object({ version: z.string().trim().min(1).max(100), credits: z.tuple([row, row, row]) }).strict()

/** 报价以完成对账后的部署配置为准。缺少价格时保持入口关闭。 */
export function videoReplicationPricing(env = process.env) {
  try {
    const result = schema.safeParse(JSON.parse(env.VIDEO_REPLICATION_PRICING ?? 'null'))
    if (!result.success) return undefined
    const digest = createHash('sha256').update(JSON.stringify(result.data.credits)).digest('hex').slice(0, 12)
    return { ...result.data, version: `${result.data.version}:${digest}` }
  } catch {
    return undefined
  }
}
