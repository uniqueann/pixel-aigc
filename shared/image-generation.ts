export type ImageOperation = 'text_to_image' | 'image_edit' | 'inpaint' | 'outpaint' | 'variation'

export type ImageResolution = '1k' | '2k' | '4k'

export type ImageSource =
  | { kind: 'r2'; objectKey: string }
  | { kind: 'url'; url: string }
  | { kind: 'data'; dataUrl: string }

export interface NormalizedImageInput {
  /** 服务端可读的对象引用；不接受 blob:，data: 仅限小图兜底 */
  source: ImageSource
  width?: number
  height?: number
  mimeType?: string
}

export interface NormalizedImageRequest {
  operation: ImageOperation
  prompt: string
  images: NormalizedImageInput[]
  mask?: NormalizedImageInput
  target: {
    size?: { width: number; height: number }
    aspectRatio?: string
    resolution?: ImageResolution
  }
  count: number
  extra?: Record<string, unknown>
}

export interface NormalizedImageResult {
  images: Array<{
    bytes: Uint8Array
    mimeType: string
    width: number
    height: number
    providerUrl?: string
  }>
}

export interface ImageResultView {
  url: string
  width: number
  height: number
  mimeType: string
}
