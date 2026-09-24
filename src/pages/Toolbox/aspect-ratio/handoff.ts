import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'

export interface OutpaintHandoff {
  file: File
  presetId: string
}

let pending: OutpaintHandoff | null = null

export function setOutpaintHandoff(value: OutpaintHandoff) {
  pending = value
}

export function takeOutpaintHandoff() {
  const value = pending
  pending = null
  return value
}

export function presetForHandoff(presetId: string) {
  return PLATFORM_SIZE_PRESETS.find(preset => preset.id === presetId) ?? null
}
