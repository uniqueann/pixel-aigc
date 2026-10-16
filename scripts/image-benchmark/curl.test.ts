import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
import { curlImageBenchmark } from './curl.js'
afterEach(() => vi.clearAllMocks())
function child() {
  const value = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
  mocks.spawn.mockReturnValue(value)
  return value
}
describe('curl 控制端传输', () => {
  it('凭证通过标准输入传递，域名和证书校验保留，响应按 JSON 解析', async () => {
    const process = child()
    let input = ''
    process.stdin.on('data', value => { input += value })
    const result = curlImageBenchmark('https://test.vercel.app/api/internal/image-benchmark', '{}', { Authorization: 'Bearer private-token' }, '1.2.3.4')
    expect(mocks.spawn.mock.calls[0][1]).toEqual(['--config', '-'])
    expect(input).toContain('Authorization: Bearer private-token')
    expect(input).toContain('test.vercel.app:443:1.2.3.4')
    expect(input).not.toMatch(/insecure|location/)
    process.stdout.write('{"ok":true}')
    process.emit('close', 0)
    await expect(result).resolves.toEqual({ ok: true })
  })
  it('失败不输出包含私有地址或令牌的底层错误', async () => {
    const process = child()
    const result = curlImageBenchmark('https://test.vercel.app/api/internal/image-benchmark', '{}', {})
    process.stderr.write('https://private.test?token=secret')
    process.emit('close', 35)
    await expect(result).rejects.toThrow('CURL_TRANSPORT_FAILED')
  })
})
