import postgres from 'postgres'
import { env } from './config.js'
let connection: ReturnType<typeof postgres> | undefined
export const database = () => connection ??= postgres(env('AIGC_DATABASE_URL'), {
  prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10,
  ssl: process.env.AIGC_DB_LOCAL === 'true' ? false : 'require',
})
export type Transaction = postgres.TransactionSql
export function withIdentity<T>(userId: string, email: string, action: (sql: Transaction) => Promise<T>): Promise<T> {
  return database().begin(async sql => {
    await sql`set local role aigc_api`
    await sql`select set_config('aigc.user_id', ${userId}, true), set_config('aigc.email', ${email}, true)`
    return action(sql)
  }) as Promise<T>
}
