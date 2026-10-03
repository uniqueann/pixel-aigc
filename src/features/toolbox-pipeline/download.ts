import { outputNames as ratioNames } from '@/pages/Toolbox/aspect-ratio/geometry'
import { outputNames as watermarkNames } from '@/pages/Toolbox/watermark/geometry'
import { createResultZip } from '@/pages/Toolbox/shared/zip'
import { itemStatus, type PipelineItem, type PipelineSettings } from './types'

export function pipelineNames(items: PipelineItem[], settings: PipelineSettings) {
  const names = ratioNames(items.map(item => ({ name: item.file.name,
    mimeType: item.output?.mimeType ?? 'image/png', presetId: settings.aspectRatio.selectedPresetId })))
  const finalNames = settings.watermarkEnabled ? watermarkNames(names.map((name, index) => ({ name, mimeType: items[index].output?.mimeType ?? 'image/png' }))) : names
  return new Map(items.map((item, index) => [item.id, finalNames[index]]))
}

export async function createPipelineZip(items: PipelineItem[], settings: PipelineSettings) {
  const completed = items.filter(item => itemStatus(item) === 'succeeded' && item.output)
  const names = pipelineNames(completed, settings)
  return createResultZip(completed.map(item => ({ name: names.get(item.id)!, blob: item.output!.blob })))
}
