import { expect, it } from 'vitest'
import { signUpload } from './storage'
it('浏览器直传签名绑定类型和大小，不携带空请求体的 CRC32 校验值', async () => {
  process.env.R2_ACCOUNT_ID='test'; process.env.R2_BUCKET='test'; process.env.R2_ACCESS_KEY_ID='test'; process.env.R2_SECRET_ACCESS_KEY='test'
  const url = new URL(await signUpload('temporary/test','image/png',100))
  expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host')
  expect(url.searchParams.get('X-Amz-Expires')).toBe('600')
  expect(url.searchParams.has('x-amz-checksum-crc32')).toBe(false)
})
