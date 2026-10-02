import type { NormBox, NormPoint, SegmentSession } from '../../shared/smart-select.js'
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

export interface SmartSelectResponse {
  maskBase64: string
  width: number
  height: number
  bbox: NormBox
  session: SegmentSession | null
}
