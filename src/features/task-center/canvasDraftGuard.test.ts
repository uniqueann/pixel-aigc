import { beforeEach, describe, expect, it } from 'vitest'
import { defaultDrafts } from '@/editor/persistence/types'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { abandonCanvasGenerationDraft,canvasDraftDirty,saveAbandonedCanvasDraft } from './canvasDraftGuard'

beforeEach(() => {
  usePersistenceStore.setState({ drafts: defaultDrafts() })
})

describe('画布未提交草稿', () => {
  it('有提示词时视为未保存，确认放弃后才清空', () => {
    const drafts = defaultDrafts()
    drafts['text-to-image'].prompt = '  一只猫'
    usePersistenceStore.getState().setDrafts(drafts)
    expect(canvasDraftDirty(usePersistenceStore.getState().drafts)).toBe(true)
    abandonCanvasGenerationDraft()
    expect(usePersistenceStore.getState().drafts['text-to-image'].prompt).toBe('')
    expect(canvasDraftDirty(usePersistenceStore.getState().drafts)).toBe(false)
  })

  it('空白提示词不拦截', () => {
    expect(canvasDraftDirty(defaultDrafts())).toBe(false)
  })
  it('确认清空后的保存失败会恢复提示词',async()=>{
    const drafts=defaultDrafts();drafts['text-to-image'].prompt='必须保留'
    usePersistenceStore.getState().setDrafts(drafts)
    await expect(saveAbandonedCanvasDraft(async()=>{throw new Error('保存失败')},usePersistenceStore.getState().epoch)).rejects.toThrow('保存失败')
    expect(usePersistenceStore.getState().drafts['text-to-image'].prompt).toBe('必须保留')
  })
  it('保存失败期间已有新草稿，不用旧提示词覆盖它',async()=>{
    const epoch=usePersistenceStore.getState().epoch
    await expect(saveAbandonedCanvasDraft(async()=>{
      const drafts=defaultDrafts();drafts['text-to-image'].prompt='新的提示词'
      usePersistenceStore.getState().setDrafts(drafts)
      throw new Error('保存失败')
    },epoch)).rejects.toThrow('保存失败')
    expect(usePersistenceStore.getState().drafts['text-to-image'].prompt).toBe('新的提示词')
  })

  it('放弃只清空提示词，保留派生原图', () => {
    const drafts = defaultDrafts()
    drafts.derived = { mode: 'variation', sourceAssetId: 'asset:1', sourceNode: { id: 'n', type: 'image' } as never, prompt: '改一改', count: 1, durationSeconds: 5 }
    usePersistenceStore.getState().setDrafts(drafts)
    abandonCanvasGenerationDraft()
    expect(usePersistenceStore.getState().drafts.derived).toMatchObject({ prompt: '', sourceAssetId: 'asset:1' })
    expect(usePersistenceStore.getState().drafts['text-to-video'].presetKey).toBe('1:1')
  })
})
