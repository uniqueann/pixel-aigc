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
  /** 文本生成类任务的单条结果 */
  resultText?: string
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

/** 智能编辑任务参数 */
export interface ImageEditTaskParams extends ImageTaskParams {
  sourceImageUrl: string
  prompt: string
  count: number
  resolution: '2k' | '4k'
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

/** 自由画布文生视频任务参数 */
export interface TextToVideoTaskParams {
  prompt: string
  size: { width: number; height: number }
  durationSeconds: number
  count: 1
}

/** 自由画布图片裂变任务参数 */
export interface VariationTaskParams {
  sourceImageUrl: string
  prompt?: string
  size: { width: number; height: number }
  count: number
}

/** 自由画布图生视频任务参数，复用文生视频能力路由 */
export interface ImageToVideoTaskParams {
  sourceImageUrl: string
  prompt: string
  size: { width: number; height: number }
  durationSeconds: 5 | 10
  count: 1
}

export type EmailAssistOperation = 'summarize' | 'reply' | 'polish' | 'grammar'
export type EmailAssistLanguage = 'zh' | 'en' | 'ja'
export type EmailPolishStyle = 'clear' | 'shorten' | 'lengthen' | 'simplify'

/** 邮件助手异步任务参数 */
export interface EmailAssistTaskParams {
  sourceText: string
  operation: EmailAssistOperation
  language: EmailAssistLanguage
  instruction?: string
  polishStyles?: EmailPolishStyle[]
}

export interface PlatformSizePreset {
  platform: string
  label: string
  width: number
  height: number
}
