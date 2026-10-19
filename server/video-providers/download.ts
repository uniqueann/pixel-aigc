import { lookup } from 'node:dns'
import { BlockList, isIP } from 'node:net'
import { Agent } from 'undici'
import type { ProviderContext } from '../image-providers/types.js'
import { VideoProviderError } from './types.js'

export const VIDEO_MAX_BYTES = 100 * 1024 * 1024
const blocked = new BlockList()
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) blocked.addSubnet(address, prefix, 'ipv6')
export function publicVideoAddress(address: string) {
  const family = isIP(address)
  return family !== 0 && !/^::ffff:/i.test(address) && !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6')
}

/** 在实际建连时检查 DNS 结果，禁止私网与重定向，避免检查后重新解析造成绕过。 */
const dispatcher = new Agent({ connect: { lookup(hostname, options, callback) {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error || !addresses.length || addresses.some(item => !publicVideoAddress(item.address))) {
      callback(error ?? new Error('视频结果地址不允许访问'), '', 4)
    } else if (options.all) callback(null, addresses)
    else callback(null, addresses[0].address, addresses[0].family)
  })
} } })

export async function downloadVideoResult(url: string, ctx: ProviderContext, maxBytes = VIDEO_MAX_BYTES) {
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new VideoProviderError('VIDEO_RESULT_INVALID', '视频结果地址无效') }
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')
    || host === 'localhost' || (isIP(host) && !publicVideoAddress(host))) {
    throw new VideoProviderError('VIDEO_RESULT_INVALID', '视频结果地址无效')
  }
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(100_000)]) : AbortSignal.timeout(100_000)
  const init: RequestInit & { dispatcher: Agent } = { signal, redirect: 'error', dispatcher }
  const response = await ctx.fetch(url, init)
  if (!response.ok || !response.body) throw new VideoProviderError('VIDEO_RESULT_DOWNLOAD', '视频结果读取失败', true)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    if (Number(response.headers.get('content-length')) > maxBytes) throw new VideoProviderError('VIDEO_RESULT_TOO_LARGE', '视频结果超过文件大小限制')
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > maxBytes) throw new VideoProviderError('VIDEO_RESULT_TOO_LARGE', '视频结果超过文件大小限制')
      chunks.push(part.value)
    }
  } finally { await reader.cancel().catch(() => undefined) }
  return Buffer.concat(chunks, size)
}
