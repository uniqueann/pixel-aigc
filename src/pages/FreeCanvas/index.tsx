import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { App, Button, Input, Segmented, Tooltip } from 'antd'
import { RemoveNodeCommand, UpdateNodeCommand } from '@/editor/commands'
import { useEditorStore } from '@/editor/store'
import FreeCanvasStage from '@/features/free-canvas/FreeCanvasStage'
import { ensureFreeCanvasContent } from '@/features/free-canvas/initialize'
import type { NodeTransform } from '@/features/free-canvas/types'
import { CANVAS_MODES } from './modes'

function isEditingText(target: EventTarget | null) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

export default function FreeCanvas() {
  const { mode } = useParams<{ mode: string }>()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [prompt, setPrompt] = useState('')
  const project = useEditorStore((state) => state.project)
  const activeSceneId = useEditorStore((state) => state.activeSceneId)
  const selectedNodeId = useEditorStore((state) => state.selectedNodeIds[0])
  const viewport = useEditorStore((state) => state.viewport)
  const canUndo = useEditorStore((state) => state.undoStack.length > 0)
  const canRedo = useEditorStore((state) => state.redoStack.length > 0)
  const selectNodes = useEditorStore((state) => state.selectNodes)
  const executeCommand = useEditorStore((state) => state.executeCommand)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const setViewport = useEditorStore((state) => state.setViewport)
  const activeSlug = CANVAS_MODES.find((m) => m.slug === mode)?.slug ?? CANVAS_MODES[0].slug
  const scene = project?.document.scenes.find((item) => item.id === activeSceneId)

  useEffect(() => {
    ensureFreeCanvasContent()
  }, [])

  const handleSelectNode = useCallback((nodeId?: string) => {
    selectNodes(nodeId ? [nodeId] : [])
  }, [selectNodes])

  const handleTransformNode = useCallback((nodeId: string, transform: NodeTransform) => {
    const currentSceneId = useEditorStore.getState().activeSceneId
    if (!currentSceneId) return
    executeCommand(new UpdateNodeCommand(currentSceneId, nodeId, transform))
  }, [executeCommand])

  const handleDelete = useCallback(() => {
    const state = useEditorStore.getState()
    const nodeId = state.selectedNodeIds[0]
    if (!state.activeSceneId || !nodeId) return
    state.executeCommand(new RemoveNodeCommand(state.activeSceneId, nodeId))
  }, [])

  const handleAssetLoadError = useCallback((content: string) => {
    message.error({ content, duration: 4 })
  }, [message])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (isEditingText(event.target)) return
      const commandKey = event.metaKey || event.ctrlKey
      if (commandKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        handleDelete()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [handleDelete, redo, undo])

  if (!project || !scene) {
    return <div className="free-canvas-loading">正在准备自由画布…</div>
  }

  return (
    <div className="free-canvas-page">
      <div className="free-canvas-page-header">
        <Segmented
          options={CANVAS_MODES.map((item) => ({ label: item.label, value: item.slug }))}
          value={activeSlug}
          onChange={(value) => navigate(`/canvas/${value}`)}
        />
        <span>{scene.width} × {scene.height}</span>
      </div>
      <div className="free-canvas-workspace">
        <FreeCanvasStage
          key={scene.id}
          scene={scene}
          assets={project.assets}
          selectedNodeId={selectedNodeId}
          viewport={viewport}
          canUndo={canUndo}
          canRedo={canRedo}
          onSelectNode={handleSelectNode}
          onTransformNode={handleTransformNode}
          onViewportChange={setViewport}
          onUndo={undo}
          onRedo={redo}
          onDelete={handleDelete}
          onAssetLoadError={handleAssetLoadError}
        />
        <aside className="free-canvas-generation-panel">
          <div>
            <h2>{activeSlug === 'text-to-video' ? '文生视频' : '文生图'}</h2>
            <p>输入创意描述，生成结果将在后续迭代中直接加入当前画布。</p>
          </div>
          <Input.TextArea
            rows={7}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="描述你想生成的画面"
          />
          <div className="free-canvas-generation-placeholder">
            <span>参考图</span><strong>下一迭代接入</strong>
            <span>生成参数</span><strong>下一迭代接入</strong>
          </div>
          <Tooltip title="生成能力将在下一迭代接入">
            <span className="free-canvas-disabled-action">
              <Button type="primary" disabled block>生成 · 下一迭代接入</Button>
            </span>
          </Tooltip>
          <p className="free-canvas-panel-hint">当前版本已支持图片节点的移动、缩放、旋转和删除。</p>
        </aside>
      </div>
    </div>
  )
}
