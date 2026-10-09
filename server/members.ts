import type { Transaction } from './db.js'
import { HttpError } from './errors.js'

export async function requireActive(sql: Transaction, userId: string) {
  const [member] = await sql`select status from aigc.members where user_id=${userId}`
  if (!member) throw new HttpError(403, '当前账号尚未初始化', 'MEMBER_UNAVAILABLE')
  if (member.status !== 'active') throw new HttpError(403, '当前账号已被停用', 'MEMBER_DISABLED')
}
