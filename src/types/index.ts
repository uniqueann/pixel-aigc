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

export interface PlatformSizePreset {
  platform: string
  label: string
  width: number
  height: number
}
