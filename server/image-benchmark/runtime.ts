import { lookup } from 'node:dns/promises'
import { connect as connectTls } from 'node:tls'
import { database } from '../db.js'
import { putObject, getObject, deleteObject } from '../storage.js'
import { DEFAULT_QWEN_IMAGE_BASE_URL } from '../image-providers/qwen-image/config.js'
import type { BenchmarkRuntime } from './probe.js'

/** 每次新建连接，仅测 DNS、TCP 和 TLS，不提交 HTTP 生成或识别请求。 */
async function connectProvider(provider: 'qwen' | 'tencent', signal: AbortSignal) {
  let host: string
  if (provider === 'qwen') {
    host = new URL(process.env.QWEN_IMAGE_BASE_URL || process.env.DASHSCOPE_BASE_URL || DEFAULT_QWEN_IMAGE_BASE_URL).hostname
  } else {
    const bucket = process.env.TENCENT_COS_BUCKET, region = process.env.TENCENT_COS_REGION
    if (!bucket || !region) return null
    host = `${bucket}.cos.${region}.myqcloud.com`
  }
  const start = performance.now()
  const resolved = await new Promise<{ address: string }>((resolve, reject) => {
    const aborted = () => reject(signal.reason)
    if (signal.aborted) { aborted(); return }
    signal.addEventListener('abort', aborted, { once: true })
    lookup(host, { family: 4 }).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
  })
  signal.throwIfAborted()
  const dnsMs = performance.now() - start
  return new Promise<Record<string, number>>((resolve, reject) => {
    const at = performance.now()
    let tcpAt = at
    const socket = connectTls({ host: resolved.address, port: 443, servername: host, rejectUnauthorized: true })
    const aborted = () => socket.destroy(new Error('连接探测已超时'))
    signal.addEventListener('abort', aborted, { once: true })
    socket.once('close', () => signal.removeEventListener('abort', aborted))
    if (signal.aborted) aborted()
    socket.once('connect', () => { tcpAt = performance.now() })
    socket.once('secureConnect', () => {
      const tlsAt = performance.now()
      socket.destroy()
      resolve({ dns: dnsMs, tcp: tcpAt - at, tls: tlsAt - tcpAt })
    })
    socket.once('error', reject)
  })
}

export function imageBenchmarkRuntime(): BenchmarkRuntime {
  return {
    now: () => performance.now(),
    database: async signal => {
      signal.throwIfAborted()
      const started = performance.now()
      let readyAt = started
      let queryMs = 0
      await database().begin(async sql => {
        // 复用业务连接池；这里包含排队、必要的连接建立和 BEGIN，不能误称纯建连。
        readyAt = performance.now()
        await sql`set transaction read only`
        await sql`set local role aigc_api`
        await sql`select set_config('statement_timeout','5000',true),set_config('lock_timeout','2000',true)`
        await sql`select set_config('aigc.user_id',${process.env.IMAGE_BENCHMARK_USER_ID!},true),set_config('aigc.scope','preview',true)`
        const at = performance.now()
        const [member] = await sql`select status from aigc.members where user_id=${process.env.IMAGE_BENCHMARK_USER_ID!}::uuid`
        if (!member || member.status !== 'active') throw new Error('预览基准账号不可用')
        await sql`select id,status from aigc.image_jobs where user_id=${process.env.IMAGE_BENCHMARK_USER_ID!}::uuid
          and scope='preview' and expires_at>now() order by created_at desc limit 5`
        queryMs = performance.now() - at
      })
      signal.throwIfAborted()
      return { acquireAndBegin: readyAt - started, query: queryMs }
    },
    put: (key, bytes, signal) => putObject(key, bytes, 'application/octet-stream', signal),
    get: async (key, signal) => (await getObject(key, signal)).bytes,
    remove: (key, signal) => deleteObject(key, signal),
    connect: connectProvider,
  }
}
