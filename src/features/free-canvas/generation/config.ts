export interface ImageSizePreset {
  key: string
  label: string
  width: number
  height: number
  tooltip?: string
}

export function getAspectRatioTooltip(key: string): string {
  switch (key) {
    case '1:1':
      return '1:1 正方形 · 头像/电商主图'
    case '4:3':
      return '4:3 横屏 · 经典画幅/文稿展示'
    case '3:4':
      return '3:4 竖屏 · 小红书/社交平台/电商'
    case '16:9':
      return '16:9 宽屏 · 桌面壁纸/横屏视频'
    case '9:16':
      return '9:16 竖屏 · 抖音/快手/手机全屏'
    case '3:2':
      return '3:2 横屏 · 单反相机经典画幅'
    case '2:3':
      return '2:3 竖屏 · 单反相机竖构图'
    default:
      return key
  }
}

export const IMAGE_SIZE_PRESETS: ImageSizePreset[] = [
  { key: '1:1', label: '1:1', width: 1024, height: 1024, tooltip: '1:1 正方形 · 头像/电商主图' },
  { key: '4:3', label: '4:3', width: 1024, height: 768, tooltip: '4:3 横屏 · 经典画幅/文稿展示' },
  { key: '3:4', label: '3:4', width: 768, height: 1024, tooltip: '3:4 竖屏 · 小红书/社交平台/电商' },
  { key: '16:9', label: '16:9', width: 1280, height: 720, tooltip: '16:9 宽屏 · 桌面壁纸/横屏视频' },
  { key: '9:16', label: '9:16', width: 720, height: 1280, tooltip: '9:16 竖屏 · 抖音/快手/手机全屏' },
]
