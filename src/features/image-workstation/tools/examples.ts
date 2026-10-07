export interface ToolExampleFrame {
  src: string
  alt: string
  caption: string
}

export interface ToolExample {
  before: ToolExampleFrame[]
  after: ToolExampleFrame
}

/** 未上传时给裂变、融合看的示意商品图，不是用户作品。 */
export const TOOL_EXAMPLES: Partial<Record<string, ToolExample>> = {
  variation: {
    before: [{ src: '/examples/variation-before.webp', alt: '裂变前的白底马克杯', caption: '原图' }],
    after: { src: '/examples/variation-after.webp', alt: '裂变后的马克杯变体', caption: '变体' },
  },
  fusion: {
    before: [
      { src: '/examples/fusion-product.webp', alt: '待融合的滴管瓶商品图', caption: '商品' },
      { src: '/examples/fusion-scene.webp', alt: '待融合的木桌场景', caption: '场景' },
    ],
    after: { src: '/examples/fusion-after.webp', alt: '滴管瓶放入木桌场景后的效果', caption: '合成' },
  },
}

export function toolExample(slug?: string) {
  return slug ? TOOL_EXAMPLES[slug] : undefined
}
