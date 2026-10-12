import type { CanvasDrafts } from '@/editor/persistence/types'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'

export function canvasDraftDirty(drafts: CanvasDrafts) {
  return [drafts['text-to-image'].prompt, drafts['text-to-video'].prompt, drafts.derived?.prompt].some(value => Boolean(value?.trim()))
}

/** 用户确认离开后才清空未提交提示词，取消导航不会改草稿。 */
export function abandonCanvasGenerationDraft() {
  const state = usePersistenceStore.getState()
  const drafts = state.drafts
  state.setDrafts({
    ...drafts,
    'text-to-image': { ...drafts['text-to-image'], prompt: '' },
    'text-to-video': { ...drafts['text-to-video'], prompt: '' },
    ...(drafts.derived ? { derived: { ...drafts.derived, prompt: '' } } : {}),
  })
}
