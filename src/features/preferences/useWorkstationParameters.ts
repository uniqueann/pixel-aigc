import { useCallback, useState } from 'react'
import { COUNT_TOOLS, type CountTool, type ImageMemory } from '@shared/preferences'
import { initialWorkstationParameters, workstationCountSource, type WorkstationParameters } from './toolParameters'
import { usePreferencesStore } from './store'

export function useWorkstationParameters(tool: string) {
  const memoryEpoch = usePreferencesStore(state => state.memoryEpoch)
  const countSource = usePreferencesStore(state => workstationCountSource(state.preferences, tool))
  const [draft, setDraft] = useState(() => ({
    tool,
    memoryEpoch,
    countSource,
    parameters: initialWorkstationParameters(usePreferencesStore.getState().preferences, tool),
  }))
  let parameters = draft.parameters
  if (draft.tool !== tool || draft.memoryEpoch !== memoryEpoch) {
    parameters = initialWorkstationParameters(usePreferencesStore.getState().preferences, tool)
    setDraft({ tool, memoryEpoch, countSource, parameters })
  } else if (draft.countSource !== countSource) {
    parameters = { ...draft.parameters, count: initialWorkstationParameters(usePreferencesStore.getState().preferences, tool).count }
    setDraft({ tool, memoryEpoch, countSource, parameters })
  }
  const update = useCallback((patch: Partial<WorkstationParameters>, remember = true) => {
    setDraft(previous => ({
      tool,
      memoryEpoch: previous.memoryEpoch,
      countSource: previous.countSource,
      parameters: { ...previous.parameters, ...patch },
    }))
    if (!remember) return
    const state = usePreferencesStore.getState()
    if (COUNT_TOOLS.includes(tool as CountTool)) {
      const memory: NonNullable<ImageMemory['retouch']> & NonNullable<ImageMemory['relight']> = {}
      if (patch.count !== undefined) memory.count = patch.count
      if (patch.resolution !== undefined) memory.resolution = patch.resolution
      if (tool === 'retouch' && patch.retouchDirections) memory.retouchDirections = patch.retouchDirections
      if (tool === 'relight' && patch.relight) memory.relight = patch.relight
      state.remember(tool as CountTool, memory)
    } else if (tool === 'outpaint') {
      const memory: NonNullable<ImageMemory['outpaint']> = {}
      if (patch.outpaintMode !== undefined) memory.outpaintMode = patch.outpaintMode
      if (patch.outpaintOutputMode !== undefined) memory.outpaintOutputMode = patch.outpaintOutputMode
      if (patch.presetPlatform !== undefined) memory.presetPlatform = patch.presetPlatform
      state.remember('outpaint', memory)
    }
  }, [tool])
  return { parameters, update }
}
