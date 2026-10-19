import { MINIMAX_H3_VIDEO_MODEL, videoModelModes, type VideoMode, type VideoModelProfile } from '@shared/video-models'

/** 有历史选择时只寻找原模型；不因模型下线而静默替换供应商。 */
export function selectedCanvasVideoModel(models: VideoModelProfile[], mode: VideoMode, selectedId?: string) {
  const matching = models.filter(model => videoModelModes(model).includes(mode))
  if (selectedId) return matching.find(model => model.id === selectedId)
  return matching.find(model => model.id === MINIMAX_H3_VIDEO_MODEL.id && model.available !== false)
    ?? matching.find(model => model.available !== false)
}
