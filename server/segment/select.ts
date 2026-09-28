import sharp from 'sharp'
import { HttpError } from '../errors.js'
import {
  alphaBBox,
  buildSelectionAlpha,
  binarizeAlpha,
  type SegmentSession,
} from '../../shared/smart-select.js'
import { segmentProvider } from './providers.js'
import type { GoodsAlpha, SegmentProvider, SmartSelectRequest, SmartSelectResponse } from './types.js'

const MAX_SESSION_CHARS = 6_000_000

interface GoodsSessionPayload {
  v: 1
  kind: 'goods-alpha'
  originWidth: number
  originHeight: number
  fittedWidth: number
  fittedHeight: number
  pngBase64: string
}

function selectionFailure(error: 'miss' | 'full-frame', session: SegmentSession | null) {
  if (error === 'full-frame') {
    return new SmartSelectFailure(422, '没有分离出商品轮廓，请改用画笔', 'SMART_SELECT_NO_SUBJECT', session)
  }
  return new SmartSelectFailure(422, '没有点中商品，请点在商品上。水印和文字请用画笔', 'SMART_SELECT_MISS', session)
}

export class SmartSelectFailure extends HttpError {
  constructor(status: number, message: string, code: string, readonly session: SegmentSession | null) {
    super(status, message, code)
  }
}

async function encodeAlphaPng(alpha: Uint8Array, width: number, height: number, color: 'white' | 'black') {
  const channels = color === 'white' ? 4 : 1
  const raw = Buffer.allocUnsafe(width * height * channels)
  if (channels === 1) {
    raw.set(alpha)
  } else {
    for (let index = 0; index < alpha.length; index += 1) {
      const offset = index * 4
      raw[offset] = 255
      raw[offset + 1] = 255
      raw[offset + 2] = 255
      raw[offset + 3] = alpha[index]
    }
  }
  return sharp(raw, { raw: { width, height, channels } }).png().toBuffer()
}

async function decodeSession(session: SegmentSession): Promise<GoodsAlpha | null> {
  let payload: GoodsSessionPayload
  try {
    payload = JSON.parse(session.payload) as GoodsSessionPayload
  } catch {
    return null
  }
  if (payload?.v !== 1 || payload.kind !== 'goods-alpha') return null
  const { originWidth, originHeight, fittedWidth, fittedHeight, pngBase64 } = payload
  if (![originWidth, originHeight, fittedWidth, fittedHeight].every(value => Number.isInteger(value) && value >= 1 && value <= 20000)) {
    return null
  }
  if (fittedWidth * fittedHeight > 7680 * 4320) return null
  const png = Buffer.from(pngBase64, 'base64')
  if (!png.length) return null
  try {
    const { data, info } = await sharp(png, { failOn: 'none' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (info.width !== fittedWidth || info.height !== fittedHeight) return null
    return {
      alpha: binarizeAlpha(data, info.width, info.height, 4),
      width: fittedWidth,
      height: fittedHeight,
      originWidth,
      originHeight,
    }
  } catch {
    return null
  }
}

async function encodeSession(providerId: string, goods: GoodsAlpha): Promise<SegmentSession | null> {
  const png = await encodeAlphaPng(goods.alpha, goods.width, goods.height, 'white')
  const payload = JSON.stringify({
    v: 1,
    kind: 'goods-alpha',
    originWidth: goods.originWidth,
    originHeight: goods.originHeight,
    fittedWidth: goods.width,
    fittedHeight: goods.height,
    pngBase64: png.toString('base64'),
  } satisfies GoodsSessionPayload)
  if (payload.length > MAX_SESSION_CHARS) return null
  return { provider: providerId, payload }
}

export async function selectSmartMask(
  input: SmartSelectRequest,
  provider: SegmentProvider | null = segmentProvider(),
): Promise<SmartSelectResponse> {
  let goods = input.session ? await decodeSession(input.session) : null
  let sessionProvider = input.session?.provider ?? provider?.id ?? 'tencent-goods'
  if (!goods) {
    if (input.session && !input.image?.length) {
      throw new HttpError(400, '选区缓存已失效，请再点一次', 'SMART_SELECT_SESSION_INVALID')
    }
    if (!input.image?.length) throw new HttpError(400, '缺少图片', 'SMART_SELECT_IMAGE_REQUIRED')
    if (input.image.length > 20 * 1024 * 1024) throw new HttpError(413, '单张图片不能超过 20 MB')
    if (!provider) throw new HttpError(503, '智能选区尚未配置', 'SMART_SELECT_UNCONFIGURED')
    goods = await provider.segmentGoods(input.image)
    sessionProvider = provider.id
  }
  const selected = buildSelectionAlpha(goods.alpha, goods.width, goods.height, input.point, input.box)
  const session = await encodeSession(sessionProvider, goods)
  if ('error' in selected) throw selectionFailure(selected.error, session)
  const bbox = alphaBBox(selected.alpha, goods.width, goods.height)
  if (!bbox) throw selectionFailure('miss', session)
  const mask = await encodeAlphaPng(selected.alpha, goods.width, goods.height, 'white')
  return {
    maskBase64: mask.toString('base64'),
    width: goods.width,
    height: goods.height,
    bbox,
    session,
  }
}
