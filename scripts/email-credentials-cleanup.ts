import postgres from 'postgres'

const scope = process.argv[2]
const execute = process.argv[3] === '--execute'
if (!['local', 'preview', 'production'].includes(scope)) throw new Error('用法：tsx --env-file-if-exists=.env.local scripts/email-credentials-cleanup.ts local|preview|production [--execute]')
if (!process.env.AIGC_ADMIN_DATABASE_URL) throw new Error('请配置本地管理员连接 AIGC_ADMIN_DATABASE_URL')
const sql = postgres(process.env.AIGC_ADMIN_DATABASE_URL, { prepare: false, max: 1, ssl: process.env.AIGC_DB_LOCAL === 'true' ? false : 'require' })
try {
  await sql.begin(async tx => {
    const [active] = await tx`select count(*)::integer as n from aigc.email_tasks where scope=${scope} and status='processing' and billing_state='legacy_free'`
    if (active.n) throw new Error('仍有旧版任务处理中，请完成切换并等待收口后再清理')
    const [count] = await tx`select count(*)::integer as n from aigc.model_credentials where scope=${scope}`
    if (execute) await tx`delete from aigc.model_credentials where scope=${scope}`
    console.log(JSON.stringify({ scope, records: count.n, executed: execute }))
  })
} finally { await sql.end() }
