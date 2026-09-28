import { describe, expect, it } from 'vitest'
import { ProviderError } from '../types.js'
import { DRAGONCODE_MAX_DATA_URI_BYTES } from './config.js'
import { assertReferenceImageUrl, decodedBase64Bytes, describeReferenceUrl, parseDataUri } from './images.js'

describe('DragonCode 参考图校验', () => {
  it('接受 image/* data URI，拒绝非图片 MIME', () => {
    expect(parseDataUri('data:image/png;base64,AAAA')?.mimeType).toBe('image/png')
    expect(() => assertReferenceImageUrl('data:image/png;base64,iVBORw0KGgo=')).not.toThrow()
    expect(() => assertReferenceImageUrl('data:text/plain;base64,aGVsbG8=')).toThrow(ProviderError)
    expect(() => assertReferenceImageUrl('data:application/json;base64,e30=')).toThrow(/必须是图片格式/)
  })

  it('按 20,971,520 解码字节限制，可在提交前拦截超限图', () => {
    expect(DRAGONCODE_MAX_DATA_URI_BYTES).toBe(20_971_520)
    expect(decodedBase64Bytes('AAAA')).toBe(3)
    expect(decodedBase64Bytes('AAAAAA==')).toBe(4)
    expect(() => assertReferenceImageUrl('data:image/png;base64,AAAAAA==', 3)).toThrow(/20MB/)
    expect(() => assertReferenceImageUrl('https://files.example/a.png')).not.toThrow()
  })

  it('描述预签名 GET 时只记录参数名，不记录签名值', () => {
    const described = describeReferenceUrl('https://media.example/obj?X-Amz-Expires=3600&X-Amz-Signature=super-secret&token=abcd')
    expect(described).toMatchObject({
      kind: 'url',
      host: 'media.example',
      hasQuery: true,
      amzExpires: '3600',
    })
    expect(JSON.stringify(described)).not.toContain('super-secret')
    expect(described.signedQueryParamNames).toEqual(expect.arrayContaining(['X-Amz-Expires', 'X-Amz-Signature', 'token']))
  })
})
