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

/** 清空后的保存失败时恢复原提示词；新的草稿或项目已经出现时保持新内容。 */
export async function saveAbandonedCanvasDraft(flush:()=>Promise<void>,epoch:number) {
  if(usePersistenceStore.getState().epoch!==epoch)throw new Error('项目编辑状态已变化')
  const original=usePersistenceStore.getState().drafts
  abandonCanvasGenerationDraft()
  const cleared=usePersistenceStore.getState().drafts
  try {await flush()} catch(error) {
    const state=usePersistenceStore.getState()
    if(state.epoch===epoch&&state.drafts===cleared)state.setDrafts(original)
    throw error
  }
}
