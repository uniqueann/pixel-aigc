export {
  inspectImage,
  inspectLogo,
  MAX_BATCH_BYTES,
  MAX_DESKTOP_PIXELS,
  MAX_FILES,
  MAX_IMAGE_BYTES,
  MAX_LOGO_BYTES,
  MAX_MOBILE_PIXELS,
  MAX_ZIP_BYTES,
  queueLimitMessage,
} from '../shared/inspect'

import type { WatermarkSettings } from './types'

export function hasWatermark(settings: WatermarkSettings) {
  return settings.kind === 'text' ? Boolean(settings.text.trim()) : Boolean(settings.logo)
}
