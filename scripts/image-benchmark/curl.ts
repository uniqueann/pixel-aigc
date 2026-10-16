import { spawn } from 'node:child_process'

/** 凭证仅通过标准输入传给 curl；保留原 Host、SNI 和证书校验，不跟随重定向。 */
export function curlImageBenchmark(url: string, body: string, headers: Record<string, string>, edgeAddress?: string): Promise<unknown> {
  const entries: Array<[string, string]> = [['url', url], ['request', 'POST'], ['data', body],
    ...Object.entries(headers).map(([key, value]): [string, string] => ['header', `${key}: ${value}`])]
  if (edgeAddress) entries.push(['resolve', `${new URL(url).hostname}:443:${edgeAddress}`])
  const config = entries.map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n')
    + '\nmax-time = 60\nsilent\nshow-error\nfail-with-body\n'
  return new Promise((resolve, reject) => {
    const child = spawn('curl', ['--config', '-'], { timeout: 65_000, stdio: ['pipe', 'pipe', 'pipe'] })
    const buffers: Buffer[] = []
    let bytes = 0
    child.stdout.on('data', (data: Buffer) => {
      bytes += data.length
      if (bytes > 128 * 1024) child.kill()
      else buffers.push(data)
    })
    child.stderr.resume()
    child.on('error', () => reject(new Error('CURL_TRANSPORT_FAILED')))
    child.on('close', code => {
      if (code !== 0 || bytes > 128 * 1024) { reject(new Error('CURL_TRANSPORT_FAILED')); return }
      try { resolve(JSON.parse(Buffer.concat(buffers).toString('utf8'))) }
      catch { reject(new Error('CURL_RESPONSE_INVALID')) }
    })
    child.stdin.on('error', () => reject(new Error('CURL_INPUT_FAILED')))
    child.stdin.end(config)
  })
}
