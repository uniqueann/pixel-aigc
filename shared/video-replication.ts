export const VIDEO_REPLICATION_MODEL_ID = 'seedance-fast-video-replication'
export const VIDEO_REPLICATION_MODEL = 'bytedance/seedance-2.0-fast'
export const VIDEO_REFERENCE_MAX_BYTES = 50_000_000
export const VIDEO_REFERENCE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const VIDEO_REPLICATION_RATIOS = ['9:16', '16:9', '1:1'] as const
export type VideoReplicationRatio = typeof VIDEO_REPLICATION_RATIOS[number]

export const VIDEO_REPLICATION_SIZES: Record<VideoReplicationRatio, { width: number; height: number }> = {
  '9:16': { width: 720, height: 1280 },
  '16:9': { width: 1280, height: 720 },
  '1:1': { width: 720, height: 720 },
}

export interface VideoReplicationPricing {
  version: string
  /** 行对应参考片时长，列对应成片时长。两轴都是 ≤5、≤10、≤15 秒。 */
  credits: [[number, number, number], [number, number, number], [number, number, number]]
}

export interface VideoReference {
  key: string
  width: number
  height: number
  durationSeconds: number
  retentionExpiresAt: string
}

export interface VideoReplicationTaskParams {
  mode: 'video_replication'
  ratio: VideoReplicationRatio
  resolution: '720p'
  generateAudio: false
  prompt: string
  size: { width: number; height: number }
  count: 1
  durationSeconds: number
  referenceVideoKey: string
  sourceImageKey?: string
}

export function videoReplicationCredits(pricing: VideoReplicationPricing | undefined, referenceSeconds: number, outputSeconds: number) {
  if (!pricing || !Number.isFinite(referenceSeconds) || referenceSeconds < 2 || referenceSeconds > 15
    || !Number.isInteger(outputSeconds) || outputSeconds < 4 || outputSeconds > 15) return undefined
  const tier = (seconds: number) => seconds <= 5 ? 0 : seconds <= 10 ? 1 : 2
  const value = pricing.credits[tier(referenceSeconds)][tier(outputSeconds)]
  return Number.isSafeInteger(value) && value > 0 ? value : undefined
}

export function videoReplicationDefaults(reference: VideoReference) {
  const ratio = reference.width / reference.height
  const candidates = VIDEO_REPLICATION_RATIOS.map(value => {
    const { width, height } = VIDEO_REPLICATION_SIZES[value]
    return { value, distance: Math.abs(Math.log(ratio / (width / height))) }
  })
  return {
    durationSeconds: Math.max(4, Math.min(15, Math.round(reference.durationSeconds))),
    ratio: candidates.reduce((nearest, candidate) => candidate.distance < nearest.distance ? candidate : nearest).value,
  }
}
