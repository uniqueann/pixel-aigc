import { describe, expect, it } from 'vitest'
import { createPipelineStore } from './store'
import type { PipelineItem } from './types'

function item(id: string): PipelineItem {
  return {
    id,
    file: new File([id], `${id}.png`, { type: 'image/png' }),
    sourceMime: 'image/png',
    width: 800,
    height: 800,
    ratioStatus: 'succeeded',
    watermarkStatus: 'succeeded',
    output: { blob: new Blob([id]), mimeType: 'image/png', width: 1600, height: 1600 },
  }
}

describe('流水线结果恢复', () => {
  it('恢复设置变更前的整批结果与设置', () => {
    const store = createPipelineStore('test')
    store.getState().add(item('a'))
    const snapshot = {
      items: store.getState().items,
      settings: store.getState().settings,
      selectedId: 'a',
    }
    store.getState().updateRatio({ selectedPresetId: 'temu-1x1' })
    expect(store.getState().items[0].output).toBeUndefined()

    store.getState().restore(snapshot)
    expect(store.getState().items[0].output).toBeDefined()
    expect(store.getState().settings.aspectRatio.selectedPresetId).toBe(snapshot.settings.aspectRatio.selectedPresetId)
    expect(store.getState().selectedId).toBe('a')
  })

  it('误删撤销按原位置放回并保留结果', () => {
    const store = createPipelineStore('test')
    store.getState().add(item('a'))
    store.getState().add(item('b'))
    store.getState().add(item('c'))
    const removed = store.getState().items[1]
    store.getState().remove('b')
    expect(store.getState().items.map(entry => entry.id)).toEqual(['a', 'c'])

    store.getState().restoreItem(removed, 1)
    expect(store.getState().items.map(entry => entry.id)).toEqual(['a', 'b', 'c'])
    expect(store.getState().items[1].output).toBeDefined()
  })
})
