import { beforeEach, describe, expect, it } from 'vitest'
import { Capability } from '@/types'
import { useEditorStore } from '@/editor/store'
import { selectAssetOrigin, selectGenerationChildren, selectGenerationParents } from './index'
import type { GenerationJob } from '@/editor/types'

const job = (id: string, inputs: string[], outputs: string[]): GenerationJob => ({
  id,
  capability: Capability.Inpaint,
  status: 'succeeded',
  input: {},
  inputAssetIds: inputs,
  outputAssetIds: outputs,
  createdAt: '2026-09-06T00:00:00.000Z',
  updatedAt: '2026-09-06T00:00:00.000Z',
})

describe('Generation Lineage', () => {
  beforeEach(() => useEditorStore.getState().createProject('血缘测试'))

  it('从 Asset 关系推导连续生成和分叉', () => {
    const state = useEditorStore.getState()
    state.registerGeneration(job('root', ['original'], ['asset-a']))
    state.registerGeneration(job('branch-b', ['asset-a'], ['asset-b']))
    state.registerGeneration(job('branch-c', ['asset-a', 'reference'], ['asset-c']))

    expect(selectGenerationChildren('root')(useEditorStore.getState()).map((item) => item.id)).toEqual(['branch-b', 'branch-c'])
    expect(selectGenerationParents('branch-c')(useEditorStore.getState()).map((item) => item.id)).toEqual(['root'])
    expect(selectAssetOrigin('asset-c')(useEditorStore.getState())?.id).toBe('branch-c')
  })
})
