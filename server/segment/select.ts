import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { HttpError } from '../errors.js'
import { measureDetection, measureDetectionSync, type DetectionObserver } from '../detection-timing.js'
import {
  alphaBBox,
  buildSelectionAlpha,
  binarizeAlpha,
  type SegmentSession,
} from '../../shared/smart-select.js'
import { segmentProvider } from './providers.js'
import type { GoodsAlpha, SegmentProvider, SmartSelectRequest, SmartSelectResponse } from './types.js'

const MAX_SESSION_CHARS = 6_000_000
const MAX_GOODS_CACHE = 8

interface CachedGoods {
  goods: GoodsAlpha
  session: SegmentSession | null
  provider: string
}

const goodsCache = new Map<string, CachedGoods>()

export function clearSmartSelectGoodsCache() {
  goodsCache.clear()
}

function digestKey(kind: 'image' | 'session', value: Buffer | string) {
  return `${kind}:${createHash('sha256').update(value).digest('hex')}`
}

function readCached(key: string) {
  const entry = goodsCache.get(key)
  if (!entry) return null
  goodsCache.delete(key)
  goodsCache.set(key, entry)
  return entry
}

function writeCached(key: string, entry: CachedGoods) {
  if (goodsCache.has(key)) goodsCache.delete(key)
  goodsCache.set(key, entry)
  while (goodsCache.size > MAX_GOODS_CACHE) {
    const oldest = goodsCache.keys().next().value
    if (oldest === undefined) break
    goodsCache.delete(oldest)
  }
}

function rememberGoods(entry: CachedGoods, image?: Buffer) {
  if (image?.length) writeCached(digestKey('image', image), entry)
  if (entry.session) writeCached(digestKey('session', entry.session.payload), entry)
}

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

async function loadGoods(
  input: SmartSelectRequest,
  provider: SegmentProvider | null,
  log?: DetectionObserver,
): Promise<CachedGoods> {
  if (input.session) {
    log?.({ sessionBytes: Buffer.byteLength(input.session.payload) })
    const cached = measureDetectionSync(log, 'cacheLookup', () => readCached(digestKey('session', input.session!.payload)))
    if (cached) { log?.({ cacheSource: 'session-cache' }); return cached }
    const decoded = await measureDetection(log, 'sessionDecode', () => decodeSession(input.session!))
    if (decoded) {
      const entry = { goods: decoded, session: input.session, provider: input.session.provider }
      rememberGoods(entry)
      log?.({ cacheSource: 'session-restored' })
      return entry
    }
    if (!input.image?.length) {
      throw new HttpError(400, '选区缓存已失效，请再点一次', 'SMART_SELECT_SESSION_INVALID')
    }
  }
  if (!input.image?.length) throw new HttpError(400, '缺少图片', 'SMART_SELECT_IMAGE_REQUIRED')
  if (input.image.length > 20 * 1024 * 1024) throw new HttpError(413, '单张图片不能超过 20 MB')
  const cached = measureDetectionSync(log, 'cacheLookup', () => readCached(digestKey('image', input.image!)))
  if (cached) { log?.({ cacheSource: 'image-cache' }); return cached }
  if (!provider) throw new HttpError(503, '智能选区尚未配置', 'SMART_SELECT_UNCONFIGURED')
  log?.({ cacheSource: 'provider' })
  const goods = await provider.segmentGoods(input.image, log)
  const session = await measureDetection(log, 'sessionEncode', () => encodeSession(provider.id, goods))
  if (session) log?.({ outputSessionBytes: Buffer.byteLength(session.payload) })
  const entry = { goods, session, provider: provider.id }
  rememberGoods(entry, input.image)
  return entry
}

export async function selectSmartMask(
  input: SmartSelectRequest,
  provider: SegmentProvider | null = segmentProvider(),
  log?: DetectionObserver,
): Promise<SmartSelectResponse> {
  const loaded = await loadGoods(input, provider, log)
  const { goods } = loaded
  const selected = measureDetectionSync(log, 'selectionBuild', () => buildSelectionAlpha(goods.alpha, goods.width, goods.height, input.point, input.box))
  const session = loaded.session ?? await measureDetection(log, 'sessionEncode', () => encodeSession(loaded.provider, goods))
  if (session) log?.({ outputSessionBytes: Buffer.byteLength(session.payload) })
  if (session && !loaded.session) rememberGoods({ ...loaded, session }, input.image)
  if ('error' in selected) throw selectionFailure(selected.error, session)
  const bbox = measureDetectionSync(log, 'selectionBBox', () => alphaBBox(selected.alpha, goods.width, goods.height))
  if (!bbox) throw selectionFailure('miss', session)
  const mask = await measureDetection(log, 'maskEncode', () => encodeAlphaPng(selected.alpha, goods.width, goods.height, 'white'))
  log?.({ maskBytes: mask.length, encodedMaskBytes: Buffer.byteLength(mask.toString('base64')) })
  return {
    maskBase64: mask.toString('base64'),
    width: goods.width,
    height: goods.height,
    bbox,
    session,
  }
}
