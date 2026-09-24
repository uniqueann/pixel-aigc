import type { PlatformSizePreset } from '@/types'

/**
 * 电商平台图片尺寸预设，做成数据字典而非硬编码在组件里，
 * 后续新增平台只需要在这里加一行。
 */
export const PLATFORM_SIZE_PRESETS: PlatformSizePreset[] = [
  { id: 'amazon-main', platform: 'amazon', label: 'Amazon 主图', width: 1600, height: 1600 },
  { id: 'temu-main', platform: 'temu', label: 'Temu 主图', width: 1200, height: 1200 },
  { id: 'shopee-main', platform: 'shopee', label: 'Shopee 主图', width: 1000, height: 1000 },
  { id: 'tiktok-main', platform: 'tiktok', label: '抖音商品图', width: 1080, height: 1440 },
]
