export interface CanvasMode {
  slug: string
  label: string
}

export const CANVAS_MODES: CanvasMode[] = [
  { slug: 'text-to-image', label: '文生图' },
  { slug: 'text-to-video', label: '文生视频' },
]

export const VIDEO_REPLICATION_MODE = { slug: 'video-replication', label: '视频复刻' } as const
