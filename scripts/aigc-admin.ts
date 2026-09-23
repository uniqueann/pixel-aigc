import { randomBytes } from 'node:crypto'
import { readFile, writeFile, chmod } from 'node:fs/promises'
import postgres from 'postgres'

const url = process.env.AIGC_ADMIN_DATABASE_URL
if (!url) throw new Error('请配置迁移管理员连接 AIGC_ADMIN_DATABASE_URL；不得用于线上 API')
const sql = postgres(url, { prepare: false, max: 1, ssl: process.env.AIGC_DB_LOCAL === 'true' ? false : 'require' })
const [command, value, status] = process.argv.slice(2)
try {
  if (command === 'bootstrap') {
    const existing = await sql`select rolname from pg_roles where rolname='aigc_server'`
    if (existing.length) throw new Error('aigc_server 已存在；为避免意外轮换密码，请使用现有凭据')
    const password = randomBytes(32).toString('hex')
    const target = new URL(url)
    const originalUser = decodeURIComponent(target.username)
    target.username = originalUser.includes('.') ? `aigc_server.${originalUser.split('.').slice(1).join('.')}` : 'aigc_server'
    target.password = password
    const filename = '.env.local'
    const previous = await readFile(filename, 'utf8').catch(() => '')
    const content = previous.replace(/^AIGC_DATABASE_URL=.*$/m, '') + `\nAIGC_DATABASE_URL=${target.toString()}\n`
    // 先安全保存凭据，再创建账号；数据库失败时可用同一份本地配置排查。
    await writeFile(filename, content, { mode: 0o600 })
    await chmod(filename, 0o600)
    await sql.begin(async tx => {
      // 密码仅由随机十六进制组成，不能包含 SQL 语法。
      await tx.unsafe(`create role aigc_server login password '${password}' nosuperuser nocreatedb nocreaterole noinherit nobypassrls`)
      await tx`grant aigc_api to aigc_server`
    })
    console.log('受限运行账号已创建，连接串已写入 .env.local；未打印密码。请将 AIGC_DATABASE_URL 配置到 Vercel。')
  } else if (command === 'invite') {
    throw new Error('AIGC 已开放注册，邀请命令已停用')
  } else if (command === 'member') {
    if (!value || !['active','disabled'].includes(status)) throw new Error('用法：npm run aigc:member -- 用户UUID active或disabled')
    const operator = process.env.AIGC_ADMIN_OPERATOR || process.env.USER || 'local-admin'
    const reason = process.argv.slice(5).join(' ').trim() || '管理员手动操作'
    await sql.begin(async tx => {
      const [member] = await tx`select status from aigc.members where user_id=${value} for update`
      if (!member) throw new Error('成员不存在')
      if (member.status === status) return
      await tx`update aigc.members set status=${status},updated_at=now() where user_id=${value}`
      await tx`insert into aigc.member_status_events(user_id,previous_status,next_status,operator,reason)
        values(${value},${member.status},${status},${operator},${reason})`
    })
    console.log('应用成员状态已更新；共享 Auth 账号未改变。')
  } else throw new Error('不支持的管理命令')
} finally { await sql.end() }
