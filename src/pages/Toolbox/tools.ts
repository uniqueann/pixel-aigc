export interface ToolboxTool {
  slug: string
  label: string
}

export const TOOLBOX_TOOLS: ToolboxTool[] = [
  { slug: 'bg-remove', label: '智能抠图' },
  { slug: 'watermark', label: '加水印' },
  { slug: 'aspect-ratio', label: '转比例' },
]
