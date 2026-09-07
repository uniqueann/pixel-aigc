/**
 * 与后端 Provider 抽象层对齐的能力枚举。
 * 前端只需要知道"我要什么能力"，不关心具体调用哪个 AI 模型。
 */
export enum Capability {
  ImageEdit = 'image_edit', // 智能编辑
  Relight = 'relight', // 重新打光
  Inpaint = 'inpaint', // 消除 / 重绘 共用
  Outpaint = 'outpaint', // 扩图
  Variation = 'variation', // 裂变
  Fusion = 'fusion', // 融合
  Retouch = 'retouch', // 精修
  BgRemove = 'bg_remove', // 智能抠图
  TextToImage = 'text_to_image',
  TextToVideo = 'text_to_video',
  EmailAssist = 'email_assist',
  SmartSelect = 'smart_select', // 智能选区，同步接口，不进入生成任务队列
}

export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export interface GenerationTask<TParams = Record<string, unknown>> {
  id: string
  capability: Capability
  status: TaskStatus
  params: TParams
  resultUrls?: string[]
  errorMessage?: string
  creditsCost: number
  createdAt: string
  updatedAt: string
}

/** 图片编辑类任务的通用参数，具体工具在此基础上扩展 */
export interface ImageTaskParams {
  sourceImageUrl?: string
  maskUrl?: string
  refImageUrls?: string[]
  size?: { width: number; height: number }
  count?: number
  strength?: number
  enhance?: 'high' | 'medium' | 'low' | 'off'
  resolution?: '2k' | '4k'
  extra?: Record<string, unknown>
}

/** 消除/重绘任务参数 */
export interface InpaintTaskParams extends ImageTaskParams {
  mode: 'remove' | 'repaint'
  /** 重绘模式必填，消除模式不需要 */
  prompt?: string
}

/** 扩图任务参数 */
export interface OutpaintTaskParams extends ImageTaskParams {
  targetSize: { width: number; height: number }
  /** 原图在目标画布中的偏移量，用于后端还原蒙版位置 */
  originOffset: { x: number; y: number }
}

/** 自由画布文生图任务参数 */
export interface TextToImageTaskParams {
  prompt: string
  size: { width: number; height: number }
  count: number
}

export interface PlatformSizePreset {
  platform: string
  label: string
  width: number
  height: number
}
