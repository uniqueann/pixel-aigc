// @vitest-environment jsdom

import { StrictMode, useEffect } from 'react'
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from '@/editor/store'
import { ensureFreeCanvasContent } from './initialize'

function InitializeHarness() {
  useEffect(() => ensureFreeCanvasContent(), [])
  return null
}

describe('自由画布初始化', () => {
  beforeEach(() => {
    useEditorStore.setState({
      project: null,
      activeSceneId: null,
      selectedNodeIds: [],
      viewport: { zoom: 1, panX: 0, panY: 0 },
      undoStack: [],
      redoStack: [],
    })
  })

  it('在 React StrictMode 重放 Effect 时只注册一个初始节点', async () => {
    await act(async () => {
      render(<StrictMode><InitializeHarness /></StrictMode>)
    })

    const state = useEditorStore.getState()
    const scene = state.project?.document.scenes[0]
    expect(scene?.nodes).toHaveLength(1)
    expect(Object.keys(state.project?.assets ?? {})).toEqual(['asset:demo-image'])
    expect(state.selectedNodeIds).toEqual([scene?.nodes[0].id])
    expect(state.undoStack).toHaveLength(0)
  })
})
