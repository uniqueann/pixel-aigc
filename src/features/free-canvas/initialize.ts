import { useEditorStore } from '@/editor/store'

/**
 * 自由画布的项目入口：没有项目就建一个空项目。
 * 新项目**不再预置示例图片**——空白画布由空状态引导（见 CanvasEmptyState），
 * 避免新人第一件事是删掉一张假图。
 */
export function ensureFreeCanvasContent() {
  if (useEditorStore.getState().project) return
  useEditorStore.getState().createProject('未命名画布', { width: 1280, height: 720 })
}
