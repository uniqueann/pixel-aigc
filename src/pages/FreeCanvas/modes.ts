export interface CanvasMode {
  slug: string
  label: string
  description: string
}

export const CANVAS_MODES: CanvasMode[] = [
  { slug: 'text-to-image', label: '文生图', description: '用文字描述生成一张新的图片。' },
  { slug: 'text-to-video', label: '文生视频', description: '用文字描述生成一段视频。' },
]
