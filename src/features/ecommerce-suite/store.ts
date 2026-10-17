import { createStore } from 'zustand/vanilla'
import type { SuiteProjectConfig } from '@shared/ecommerce-suite'

interface SuiteEditorState {
  config: SuiteProjectConfig | null
  dirty: boolean
  editRevision: number
  selectedSlotId: string | null
  setConfig(config: SuiteProjectConfig, dirty?: boolean): void
  markSaved(editRevision: number): void
  selectSlot(id: string): void
}
/** 每次打开项目创建独立实例；账号与环境变化时由外层 key 销毁。 */
export function createSuiteEditorStore() {
  return createStore<SuiteEditorState>(set => ({ config: null, dirty: false, editRevision: 0, selectedSlotId: null,
    setConfig: (config, dirty = true) => set(state => ({ config, dirty, editRevision: state.editRevision + 1 })),
    markSaved: editRevision => set(state => state.editRevision === editRevision ? { dirty: false } : {}),
    selectSlot: selectedSlotId => set({ selectedSlotId }),
  }))
}
