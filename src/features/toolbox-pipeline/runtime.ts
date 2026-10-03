import { useUserStore } from '@/store/useUserStore'
import { usePreferencesStore } from '@/features/preferences/store'
import { initialAspectRatioSettings, initialWatermarkSettings } from '@/features/preferences/toolParameters'
import { AspectRatioRenderer } from '@/pages/Toolbox/aspect-ratio/renderer'
import { WatermarkRenderer } from '@/pages/Toolbox/watermark/renderer'
import { SubjectDetectionCache } from '@/pages/Toolbox/aspect-ratio/subjectCache'
import { executePipeline, validatePipeline } from './executor'
import { usePipelineStore } from './store'
import { invalidateRatio, itemStatus } from './types'

export function initializePipeline() {
  const preferences = usePreferencesStore.getState().preferences
  const ratio = initialAspectRatioSettings(preferences)
  usePipelineStore.getState().initialize({ aspectRatio: { ...ratio, strategy: ratio.strategy === 'crop' ? 'crop' : 'letterbox' },
    watermarkEnabled: true, watermark: initialWatermarkSettings(preferences) })
}

const cache = new SubjectDetectionCache(useUserStore.getState().userId ?? 'local')
let active: { controller: AbortController; ratio: AspectRatioRenderer; watermark: WatermarkRenderer } | null = null

export function pausePipeline() {
  const state = usePipelineStore.getState()
  if (state.runState !== 'running') return
  active?.controller.abort()
  active?.ratio.dispose()
  active?.watermark.dispose()
  usePipelineStore.setState({ runState: 'paused', stopping: !!active, revision: state.revision + 1,
    items: state.items.map(item => ({ ...item, phase: undefined,
      ratioStatus: item.ratioStatus === 'processing' ? 'pending' : item.ratioStatus,
      watermarkStatus: item.watermarkStatus === 'processing' ? 'pending' : item.watermarkStatus })) })
}

export function forgetPipelineImage(file: File) { cache.remove(file) }
export function clearPipelineCache() { cache.clear() }

export async function startPipeline(ids?: string[]) {
  if (active) return
  const state = usePipelineStore.getState()
  validatePipeline(state.settings)
  // 成功但降级的单张重试需要重新检测，普通失败项保留最近的成功步骤。
  const items = state.items.map(item => ids?.includes(item.id) && itemStatus(item) === 'succeeded' && item.cropFocus?.source === 'grid'
    ? (cache.remove(item.file), invalidateRatio(item)) : item)
  const targets = items.filter(item => (!ids || ids.includes(item.id)) && itemStatus(item) !== 'succeeded')
  if (!targets.length) return
  const owner = state.ownerId
  const revision = state.revision + 1
  const run = { controller: new AbortController(), ratio: new AspectRatioRenderer(), watermark: new WatermarkRenderer() }
  active = run
  usePipelineStore.setState({ items, runState: 'running', stopping: false, revision })
  const current = () => usePipelineStore.getState().ownerId === owner && usePipelineStore.getState().revision === revision && !run.controller.signal.aborted
  try {
    await executePipeline({ items: targets, settings: state.settings,
      detect: item => cache.read(item, { signal: run.controller.signal }),
      renderRatio: request => run.ratio.render(request), renderWatermark: request => run.watermark.render(request),
      isStopped: () => !current(),
      update: (id, patch) => { if (current()) usePipelineStore.setState(next => ({ items: next.items.map(item => item.id === id ? { ...item, ...patch } : item) })) },
    })
  } finally {
    run.ratio.dispose(); run.watermark.dispose()
    if (active === run) active = null
    if (current()) usePipelineStore.setState({ runState: 'idle', stopping: false })
    else usePipelineStore.setState({ stopping: false })
  }
}

// 订阅随模块存活，离开流水线页面后切换用户也必须清除图片和检测缓存。
usePipelineStore.getState().reset(useUserStore.getState().userId ?? 'local')
useUserStore.subscribe((state, previous) => {
  if (state.userId === previous.userId) return
  pausePipeline()
  cache.setOwner(state.userId ?? 'local')
  usePipelineStore.getState().reset(state.userId ?? 'local')
  if (active) usePipelineStore.setState({ stopping: true })
})
