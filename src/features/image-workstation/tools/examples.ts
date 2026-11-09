export interface ToolExampleFrame {
  src: string
  alt: string
  caption: string
}

export interface ToolExample {
  before: ToolExampleFrame[]
  after: ToolExampleFrame
}

/** 未上传时给融合看的示意商品图，不是用户作品。智能编辑与裂变改用画布内的 SVG 教学示意。 */
export const TOOL_EXAMPLES: Partial<Record<string, ToolExample>> = {
  fusion: {
    before: [
      { src: '/examples/fusion-product.webp', alt: '待放入场景的滴管瓶商品图', caption: '商品' },
      { src: '/examples/fusion-scene.webp', alt: '提供新背景的木桌场景图', caption: '场景' },
    ],
    after: { src: '/examples/fusion-after.webp', alt: '滴管瓶放入木桌场景后的合成结果', caption: '合成' },
  },
}

export function toolExample(slug?: string) {
  return slug ? TOOL_EXAMPLES[slug] : undefined
}
