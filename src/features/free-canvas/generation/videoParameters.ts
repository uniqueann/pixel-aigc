import { MINIMAX_H3_VIDEO_MODEL, SEEDANCE_VIDEO_MODEL, videoModelAvailableForMode, videoModelModes, type VideoMode, type VideoModelProfile } from '@shared/video-models'

export function videoModelIdForDraft(draft?: { modelProfileId?: string; videoResolution?: string; resolution?: string }) {
  return draft?.modelProfileId ?? (draft?.videoResolution === '720p' || draft?.resolution === '720p' ? SEEDANCE_VIDEO_MODEL.id : undefined)
}

export function videoRetryParametersSupported(model: VideoModelProfile | undefined, mode: VideoMode, params: object) {
  return videoModelAvailableForMode(model, mode) && (model?.audioMode !== 'native' || ('generateAudio' in params && params.generateAudio === true))
}

/** 有历史选择时只寻找原模型；不因模型下线而静默替换供应商。 */
export function selectedCanvasVideoModel(models: VideoModelProfile[], mode: VideoMode, selectedId?: string) {
  const matching = models.filter(model => videoModelModes(model).includes(mode))
  if (selectedId) return matching.find(model => model.id === selectedId)
  return matching.find(model => model.id === MINIMAX_H3_VIDEO_MODEL.id && videoModelAvailableForMode(model, mode))
    ?? matching.find(model => videoModelAvailableForMode(model, mode))
}
