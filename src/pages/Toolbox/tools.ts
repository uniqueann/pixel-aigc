export interface ToolboxTool {
  slug: string
  label: string
  description: string
}

export const TOOLBOX_TOOLS: ToolboxTool[] = [
  { slug: 'bg-remove', label: '智能抠图', description: '去掉背景，得到透明底的商品图。' },
  { slug: 'watermark', label: '加水印', description: '给图片加上文字或图片水印。' },
  { slug: 'aspect-ratio', label: '转比例', description: '把图片适配到目标比例。' },
  { slug: 'pipeline', label: '流水线', description: '按步骤批量处理多张商品图。' },
]
