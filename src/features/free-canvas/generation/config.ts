export interface ImageSizePreset {
  key: string
  label: string
  width: number
  height: number
}

export const IMAGE_SIZE_PRESETS: ImageSizePreset[] = [
  { key: '1:1', label: '1:1', width: 1024, height: 1024 },
  { key: '4:3', label: '4:3', width: 1024, height: 768 },
  { key: '3:4', label: '3:4', width: 768, height: 1024 },
  { key: '16:9', label: '16:9', width: 1280, height: 720 },
  { key: '9:16', label: '9:16', width: 720, height: 1280 },
]
