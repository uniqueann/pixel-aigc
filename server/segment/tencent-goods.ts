import sharp from 'sharp'
import { HttpError } from '../errors.js'
import { goodsMattingInline } from '../tencent-ci.js'
import {
  ALPHA_THRESHOLD,
  GOODS_MATTING_MAX_BYTES,
  GOODS_MATTING_MIN_EDGE,
  binarizeAlpha,
  fitMattingWorkingSize,
  scaleAlphaNearest,
} from '../../shared/smart-select.js'
import type { GoodsAlpha, SegmentProvider } from './types.js'

async function renderJpeg(image: Buffer, width: number, height: number, quality: number) {
  return sharp(image, { failOn: 'none' }).rotate().resize(width, height, { fit: 'fill' }).jpeg({ quality }).toBuffer()
}

/** 先按分辨率上限缩小，再把 JPEG 压到 10MB 以内。抠图只接受 PNG/JPEG。 */
export async function prepareGoodsMattingInput(image: Buffer, maxBytes = GOODS_MATTING_MAX_BYTES) {
  const meta = await sharp(image, { failOn: 'none' }).rotate().metadata()
  const originWidth = meta.width ?? 0
  const originHeight = meta.height ?? 0
  if (originWidth < 1 || originHeight < 1) throw new HttpError(400, '无法读取图片', 'SMART_SELECT_IMAGE_INVALID')
  let fitted: { width: number; height: number }
  try {
    fitted = fitMattingWorkingSize(originWidth, originHeight)
  } catch {
    throw new HttpError(400, '图片太小，商品抠图至少需要 32×32', 'SMART_SELECT_IMAGE_TOO_SMALL')
  }
  let width = fitted.width
  let height = fitted.height
  let quality = 90
  let jpeg = await renderJpeg(image, width, height, quality)
  let steps = 0
  while (jpeg.length > maxBytes && steps < 12) {
    steps += 1
    if (quality > 55) quality -= 15
    else {
      const nextWidth = Math.max(GOODS_MATTING_MIN_EDGE, Math.round(width * 0.75))
      const nextHeight = Math.max(GOODS_MATTING_MIN_EDGE, Math.round(height * 0.75))
      if (nextWidth === width && nextHeight === height && quality <= 55) break
      width = nextWidth
      height = nextHeight
      quality = 75
    }
    jpeg = await renderJpeg(image, width, height, quality)
  }
  if (jpeg.length > maxBytes) {
    throw new HttpError(400, '图片过大，缩小后仍超过商品抠图 10MB 限制', 'SMART_SELECT_IMAGE_TOO_LARGE')
  }
  return { jpeg, width, height, originWidth, originHeight }
}

async function alphaFromMatting(png: Buffer, width: number, height: number) {
  const { data, info } = await sharp(png, { failOn: 'none' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const binary = binarizeAlpha(data, info.width, info.height, 4)
  if (info.width === width && info.height === height) return binary
  const scaled = scaleAlphaNearest(binary, info.width, info.height, width, height)
  for (let index = 0; index < scaled.length; index += 1) scaled[index] = scaled[index] >= ALPHA_THRESHOLD ? 255 : 0
  return scaled
}

export const tencentGoodsProvider: SegmentProvider = {
  id: 'tencent-goods',
  async segmentGoods(image): Promise<GoodsAlpha> {
    const prepared = await prepareGoodsMattingInput(image)
    const png = await goodsMattingInline(prepared.jpeg)
    return {
      alpha: await alphaFromMatting(png, prepared.width, prepared.height),
      width: prepared.width,
      height: prepared.height,
      originWidth: prepared.originWidth,
      originHeight: prepared.originHeight,
    }
  },
}
