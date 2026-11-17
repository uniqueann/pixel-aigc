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

  it('新项目是空白画布：不预置示例图，也不自动选中', async () => {
    await act(async () => {
      render(<StrictMode><InitializeHarness /></StrictMode>)
    })

    const state = useEditorStore.getState()
    const scene = state.project?.document.scenes[0]
    expect(state.project?.name).toBe('未命名画布')
    expect(scene?.nodes).toHaveLength(0)
    expect(Object.keys(state.project?.assets ?? {})).toEqual([])
    expect(state.selectedNodeIds).toEqual([])
    expect(state.undoStack).toHaveLength(0)
  })

  it('已经有项目时不动它（StrictMode 重放也不会重建）', async () => {
    const first = useEditorStore.getState().createProject('已有项目')
    await act(async () => {
      render(<StrictMode><InitializeHarness /></StrictMode>)
    })
    expect(useEditorStore.getState().project?.id).toBe(first.id)
    expect(useEditorStore.getState().project?.name).toBe('已有项目')
  })
})
