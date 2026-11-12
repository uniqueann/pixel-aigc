import { describe, expect, it, vi } from 'vitest'
import { checkUploadCors } from './check-upload-cors'

const origin = 'https://app.test'
const signed = 'https://storage.test/private-bucket/temporary/check?X-Amz-Signature=secret&X-Amz-Credential=private'

describe('只读上传跨域诊断', () => {
  it('移除签名，仅以无正文 OPTIONS 检查真实 Origin 的 PUT 预检', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { headers: {
      'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, PUT', 'Access-Control-Allow-Headers': 'Content-Type, Range',
    } }))
    const result = await checkUploadCors(origin, signed, request)
    const [url, init] = request.mock.calls[0]
    expect(String(url)).toBe('https://storage.test/private-bucket/temporary/check')
    expect(init).toMatchObject({ method: 'OPTIONS', redirect: 'error', headers: {
      Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type',
    } })
    expect(init?.body).toBeUndefined()
    expect(result.preflightAllowed).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/secret|private|storage\.test|Signature|Credential/)
  })

  it.each([
    { 'Access-Control-Allow-Origin': 'https://other.test', 'Access-Control-Allow-Methods': 'PUT', 'Access-Control-Allow-Headers': 'content-type' },
    { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'content-type' },
    { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'PUT', 'Access-Control-Allow-Headers': 'range' },
  ])('允许来源、方法、请求头缺一不可', async headers => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { headers }))
    expect((await checkUploadCors(origin, signed, request)).preflightAllowed).toBe(false)
  })

  it('网络异常只输出安全结论，不输出包含签名的底层错误', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError(`Failed to fetch ${signed}`))
    const result = await checkUploadCors(origin, signed, request)
    expect(result.preflightAllowed).toBe(false)
    expect(JSON.stringify(result)).not.toMatch(/secret|private|storage\.test|Signature|Credential/)
  })

  it('拒绝带路径的 Origin，不发出请求', async () => {
    const request = vi.fn<typeof fetch>()
    await expect(checkUploadCors(`${origin}/page`, signed, request)).rejects.toThrow('Origin')
    expect(request).not.toHaveBeenCalled()
  })
})
