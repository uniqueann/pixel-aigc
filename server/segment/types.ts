import type { NormBox, NormPoint, SegmentSession } from '../../shared/smart-select.js'
import { SMART_SELECT_MISS_CODE } from '../../shared/smart-select.js'
import type { DetectionObserver } from '../detection-timing.js'

export interface GoodsAlpha {
  alpha: Uint8Array
  width: number
  height: number
  originWidth: number
  originHeight: number
}

export interface SegmentProvider {
  id: string
  segmentGoods(image: Buffer, log?: DetectionObserver): Promise<GoodsAlpha>
}

export interface SmartSelectRequest {
  image?: Buffer
  point: NormPoint
  box?: NormBox
  session?: SegmentSession | null
}

export interface SmartSelectHit {
  maskBase64: string
  width: number
  height: number
  bbox: NormBox
  session: SegmentSession | null
}

export interface SmartSelectMiss {
  miss: true
  code: typeof SMART_SELECT_MISS_CODE
  message: string
  session?: SegmentSession
}

export type SmartSelectResponse = SmartSelectHit | SmartSelectMiss

export type GoodsCacheSource = 'session-cache' | 'session-restored' | 'image-cache' | 'provider'
