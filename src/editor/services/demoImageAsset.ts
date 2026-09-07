import { createImageAsset } from './assetService'

const DEMO_IMAGE_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="960" viewBox="0 0 1280 960">
    <defs>
      <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
        <stop stop-color="#e7ecea"/>
        <stop offset="1" stop-color="#b8c9c3"/>
      </linearGradient>
      <linearGradient id="product" x1="0" x2="1">
        <stop stop-color="#153e35"/>
        <stop offset="1" stop-color="#21cfa0"/>
      </linearGradient>
    </defs>
    <rect width="1280" height="960" fill="url(#bg)"/>
    <ellipse cx="640" cy="760" rx="330" ry="55" fill="#587069" opacity=".28"/>
    <rect x="430" y="210" width="420" height="520" rx="70" fill="url(#product)"/>
    <rect x="485" y="275" width="310" height="310" rx="34" fill="#f6faf8" opacity=".92"/>
    <circle cx="640" cy="430" r="92" fill="#d9eee7"/>
    <path d="M588 430h104M640 378v104" stroke="#17745f" stroke-width="24" stroke-linecap="round"/>
    <text x="640" y="665" text-anchor="middle" font-family="sans-serif" font-size="44" fill="#ffffff">DEMO PRODUCT</text>
  </svg>
`

export const DEMO_IMAGE_ASSET = createImageAsset({
  id: 'asset:demo-image',
  name: '示例商品图',
  url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(DEMO_IMAGE_SVG)}`,
  width: 1280,
  height: 960,
})
