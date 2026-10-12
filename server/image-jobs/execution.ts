import type { BillingPort } from './billing.js'
import { createSqlBilling } from './billing.js'
import { withIdentity } from '../db.js'
import { createSqlStore } from './repository.js'
import type { ImageJobStore } from './types.js'

/** 每次调用只包围数据库操作；供应商、下载、裁剪和 R2 必须在调用之外运行。 */
export interface ImageExecutionPort {
  transaction<T>(action: (store: ImageJobStore, billing: BillingPort) => Promise<T>): Promise<T>
}

export function sqlImageExecution(userId: string, email: string): ImageExecutionPort {
  return {
    transaction: action => withIdentity(userId,email,async sql => {
      await sql`select set_config('statement_timeout','8000',true),set_config('lock_timeout','5000',true)`
      return action(createSqlStore(sql,userId),createSqlBilling(sql))
    }),
  }
}

export class ImageLeaseLost extends Error {
  constructor() { super('图片任务租约已失效'); this.name = 'ImageLeaseLost' }
}
