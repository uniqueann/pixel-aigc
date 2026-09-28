import { ProviderError } from '../types.js'
import { DRAGONCODE_MAX_DATA_URI_BYTES } from './config.js'

const DATA_URI_RE = /^data:([^;,]+)?((?:;[^,]*)*);base64,([\s\S]*)$/i

export function decodedBase64Bytes(base64: string) {
  const trimmed = base64.replace(/\s+/g, '')
  if (!trimmed) return 0
  const padding = trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(trimmed.length * 3 / 4) - padding)
}

export function parseDataUri(url: string) {
  const match = DATA_URI_RE.exec(url)
  if (!match) return null
  const mimeType = (match[1] || 'application/octet-stream').trim().toLowerCase()
  return { mimeType, byteLength: decodedBase64Bytes(match[3] ?? '') }
}

export function assertReferenceImageUrl(url: string, maxBytes = DRAGONCODE_MAX_DATA_URI_BYTES) {
  if (!url.startsWith('data:')) return
  const parsed = parseDataUri(url)
  if (!parsed) {
    throw new ProviderError('INVALID_PARAMS', '参考图数据无效', false, 400)
  }
  if (!parsed.mimeType.startsWith('image/')) {
    throw new ProviderError('INVALID_PARAMS', '参考图必须是图片格式', false, 400)
  }
  if (parsed.byteLength > maxBytes) {
    throw new ProviderError('INVALID_PARAMS', '参考图超过 20MB 限制', false, 400)
  }
}

export function describeReferenceUrl(url: string): Record<string, unknown> {
  if (url.startsWith('data:')) {
    const parsed = parseDataUri(url)
    return {
      kind: 'data-uri',
      mimeType: parsed?.mimeType ?? null,
      bytes: parsed?.byteLength ?? null,
    }
  }
  try {
    const parsed = new URL(url)
    const signedQueryParamNames = [...parsed.searchParams.keys()].filter(name => (
      /^X-Amz-/i.test(name) || /^(signature|sig|token)$/i.test(name)
    ))
    return {
      kind: 'url',
      host: parsed.host,
      pathname: parsed.pathname,
      hasQuery: parsed.search.length > 1,
      signedQueryParamNames,
      amzExpires: parsed.searchParams.get('X-Amz-Expires'),
      note: 'confirm DragonCode forwards signed query params intact on first live run',
    }
  } catch {
    return { kind: 'invalid' }
  }
}
