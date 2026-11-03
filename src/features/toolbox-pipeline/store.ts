import { create } from 'zustand'
import { DEFAULT_ASPECT_RATIO_SETTINGS } from '@/pages/Toolbox/aspect-ratio/types'
import { DEFAULT_WATERMARK_SETTINGS } from '@/pages/Toolbox/watermark/types'
import { invalidateRatio, invalidateWatermark, type PipelineItem, type PipelineSettings } from './types'

export function defaultPipelineSettings(): PipelineSettings {
  return { aspectRatio: { ...DEFAULT_ASPECT_RATIO_SETTINGS, strategy: 'letterbox' },
    watermarkEnabled: true, watermark: { ...DEFAULT_WATERMARK_SETTINGS } }
}

interface PipelineState {
  ownerId: string
  initialized: boolean
  items: PipelineItem[]
  selectedId: string | null
  settings: PipelineSettings
  runState: 'idle' | 'running' | 'paused'
  stopping: boolean
  revision: number
  initialize: (settings: PipelineSettings) => void
  add: (item: PipelineItem) => void
  select: (id: string) => void
  remove: (id: string) => void
  clear: () => void
  reset: (ownerId: string) => void
  restore: (snapshot: { items: PipelineItem[]; settings: PipelineSettings; selectedId: string | null }) => void
  restoreItem: (item: PipelineItem, index: number) => void
  updateRatio: (patch: Partial<PipelineSettings['aspectRatio']>) => void
  updateWatermark: (patch: Partial<PipelineSettings['watermark']>) => void
  enableWatermark: (enabled: boolean) => void
}

function changed<T extends object>(current: T, patch: Partial<T>) {
  return (Object.keys(patch) as (keyof T)[]).some(key => !Object.is(current[key], patch[key]))
}

export function createPipelineStore(ownerId = 'local') {
  return create<PipelineState>((set, get) => ({
    ownerId, initialized: false, items: [], selectedId: null, settings: defaultPipelineSettings(), runState: 'idle', stopping: false, revision: 0,
    initialize: settings => { if (!get().initialized) set({ settings, initialized: true }) },
    add: item => { if (get().runState !== 'running' && !get().stopping) set(state => ({ items: [...state.items, item], selectedId: state.selectedId ?? item.id })) },
    select: selectedId => set({ selectedId }),
    remove: id => {
      if (get().runState === 'running' || get().stopping) return
      set(state => { const items = state.items.filter(item => item.id !== id)
        return { items, selectedId: state.selectedId === id ? items[0]?.id ?? null : state.selectedId } })
    },
    clear: () => { if (get().runState !== 'running' && !get().stopping) set(state => ({ items: [], selectedId: null, runState: 'idle', revision: state.revision + 1 })) },
    reset: ownerId => set(state => ({ ownerId, initialized: false, items: [], selectedId: null,
      settings: defaultPipelineSettings(), runState: 'idle', stopping: false, revision: state.revision + 1 })),
    // 设置变更后恢复整批结果；只在空闲时允许，避免覆盖正在写入的运行结果。
    restore: snapshot => {
      if (get().runState === 'running' || get().stopping) return
      set(state => ({ items: snapshot.items, settings: snapshot.settings, selectedId: snapshot.selectedId,
        runState: 'idle', stopping: false, revision: state.revision + 1 }))
    },
    // 误删撤销：按原位置放回，保留原有结果与状态。
    restoreItem: (item, index) => {
      if (get().runState === 'running' || get().stopping) return
      set(state => {
        const items = [...state.items]
        items.splice(Math.max(0, Math.min(index, items.length)), 0, item)
        return { items, selectedId: state.selectedId ?? item.id, revision: state.revision + 1 }
      })
    },
    updateRatio: patch => {
      if (get().runState === 'running' || get().stopping || !changed(get().settings.aspectRatio, patch)) return
      set(state => ({ settings: { ...state.settings, aspectRatio: { ...state.settings.aspectRatio, ...patch } },
        items: state.items.map(invalidateRatio), revision: state.revision + 1 }))
    },
    updateWatermark: patch => {
      if (get().runState === 'running' || get().stopping || !changed(get().settings.watermark, patch)) return
      set(state => ({ settings: { ...state.settings, watermark: { ...state.settings.watermark, ...patch } },
        items: state.items.map(invalidateWatermark), revision: state.revision + 1 }))
    },
    enableWatermark: watermarkEnabled => {
      if (get().runState === 'running' || get().stopping || get().settings.watermarkEnabled === watermarkEnabled) return
      set(state => ({ settings: { ...state.settings, watermarkEnabled }, items: state.items.map(invalidateWatermark), revision: state.revision + 1 }))
    },
  }))
}

export const usePipelineStore = createPipelineStore()
