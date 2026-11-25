import { i18n } from '@/i18n'
import { useEditorStore } from '@/editor/store'

export type ProjectSaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

export function isCanvasRoute(pathname: string) {
  return pathname === '/canvas' || pathname.startsWith('/canvas/')
}

export function projectSaveShortcutLabel(platform = typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent) {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? '⌘S' : 'Ctrl+S'
}

export function isProjectSaveShortcut(event: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat: boolean
  isComposing?: boolean
}) {
  if (event.repeat || event.altKey || event.shiftKey || event.isComposing) return false
  if (!(event.metaKey || event.ctrlKey)) return false
  return event.key.toLowerCase() === 's'
}

/** 宽屏完整文案；窄屏只保留 icon。失败详情仍走现有 error 字段。 */
export function projectSaveStatusCopy(status: ProjectSaveStatus) {
  return {
    saved: { full: i18n.t('nav:projectHeader.status.saved'), icon: '✓' },
    dirty: { full: i18n.t('nav:projectHeader.status.dirty'), icon: '●' },
    saving: { full: i18n.t('nav:projectHeader.status.saving'), icon: '…' },
    error: { full: i18n.t('nav:projectHeader.status.error'), icon: '!' },
  }[status]
}

/** 与原项目名输入框相同：写回 project.name 与 updatedAt。空值不写入，由调用方回退原名。 */
export function commitProjectName(draft: string, original: string) {
  const name = draft.slice(0, 100)
  if (!name.trim() || name === original) return false
  useEditorStore.setState((state) => ({
    project: state.project ? { ...state.project, name, updatedAt: new Date().toISOString() } : null,
  }))
  return true
}
