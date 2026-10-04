import { useEffect, useRef, useState } from 'react'
import { EditOutlined, EllipsisOutlined } from '@ant-design/icons'
import { App, Dropdown, Tooltip } from 'antd'
import { cloudEnabled } from '@/cloud/client'
import { useCloudStore } from '@/cloud/sync'
import { useEditorStore } from '@/editor/store'
import { exportProject, flushProject, hasUnfinishedGeneration, newProject, replaceSnapshot } from '@/editor/persistence/projectPersistence'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { parseSnapshot } from '@/editor/persistence/snapshot'
import { useCanvasActionGate } from './canvasActionGate'
import {
  commitProjectName,
  isProjectSaveShortcut,
  projectSaveShortcutLabel,
  projectSaveStatusCopy,
} from './projectActions'

export function CanvasProjectCrumb() {
  const project = useEditorStore((state) => state.project)
  const status = usePersistenceStore((state) => state.status)
  const error = usePersistenceStore((state) => state.error)
  const [session, setSession] = useState<{ id: string; draft: string; original: string } | null>(null)
  const cancelingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const stored = project?.name ?? ''
  const shown = stored.trim() ? stored : '未命名画布'
  const editing = !!project && session?.id === project.id
  const draft = editing ? session.draft : stored
  const copy = projectSaveStatusCopy(status)

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const begin = () => {
    if (!project) return
    cancelingRef.current = false
    setSession({ id: project.id, draft: stored, original: stored })
  }

  const commit = () => {
    if (cancelingRef.current) {
      cancelingRef.current = false
      return
    }
    const original = session?.original ?? stored
    setSession(null)
    commitProjectName(draft, original)
  }

  const statusNode = (
    <span
      role="status"
      className={`project-save-status ${status}`}
      title={error || copy.full}
      aria-label={error ? `${copy.full}：${error}` : copy.full}
    >
      <span className="project-save-status-icon" aria-hidden="true">{copy.icon}</span>
      <span className="project-save-status-full">
        {status === 'saved' ? <><span className="project-save-mark">✓</span> 已保存</> : copy.full}
      </span>
    </span>
  )

  return (
    <nav className="canvas-header-crumb" aria-label="面包屑">
      <span className="canvas-crumb-prefix">自由画布</span>
      <span className="canvas-crumb-sep" aria-hidden="true">/</span>
      {editing ? (
        <input
          ref={inputRef}
          className="canvas-project-name-input"
          aria-label="项目名称"
          value={draft}
          maxLength={100}
          onChange={(event) => setSession((current) => current ? { ...current, draft: event.target.value } : current)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancelingRef.current = true
              event.currentTarget.blur()
              setSession(null)
            }
          }}
        />
      ) : (
        <button type="button" className="canvas-project-name" onClick={begin} disabled={!project} aria-label={`编辑项目名称 ${shown}`}>
          <span className="canvas-project-name-text">{shown}</span>
          <EditOutlined className="canvas-project-name-icon" aria-hidden />
        </button>
      )}
      {project ? (error ? <Tooltip title={error}>{statusNode}</Tooltip> : statusNode) : null}
    </nav>
  )
}

function menuLabel(text: string, extra?: string) {
  return (
    <span className="project-menu-row">
      <span>{text}</span>
      {extra ? <span className="project-menu-kbd">{extra}</span> : null}
    </span>
  )
}

export function CanvasProjectMenu() {
  const inputRef = useRef<HTMLInputElement>(null)
  const { modal, message } = App.useApp()
  const project = useEditorStore((state) => state.project)
  const phase = usePersistenceStore((state) => state.phase)
  const blocked = useCanvasActionGate((state) => state.blocked)
  const cloudBusy = useCloudStore((state) => state.busy || state.interacting)
  const unavailable = blocked || cloudBusy || hasUnfinishedGeneration()
  const ready = phase === 'ready' && !!project
  const shortcut = projectSaveShortcutLabel()

  const run = async (action: () => unknown) => {
    try { await action() } catch (err) { message.error(err instanceof Error ? err.message : '项目操作失败') }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isProjectSaveShortcut(event)) return
      event.preventDefault()
      const active = document.activeElement
      if (active instanceof HTMLElement && active !== document.body) active.blur()
      if (usePersistenceStore.getState().phase !== 'ready' || !useEditorStore.getState().project) return
      void flushProject().catch((err: unknown) => {
        message.error(err instanceof Error ? err.message : '项目操作失败')
      })
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [message])

  return (
    <>
      <Dropdown
        trigger={['click']}
        placement="bottomRight"
        autoFocus
        overlayClassName="project-actions-dropdown"
        overlayStyle={{ zIndex: 40 }}
        menu={{
          selectable: false,
          items: [
            { key: 'save', disabled: !ready, label: menuLabel('立即保存', shortcut) },
            { key: 'export', disabled: !ready, label: '导出 JSON' },
            { key: 'import', disabled: !ready || unavailable, label: '导入 JSON' },
            { type: 'divider' },
            { key: 'new', disabled: !ready || unavailable, label: '新建项目' },
          ],
          onClick: ({ key }) => {
            if (key === 'save') void run(flushProject)
            if (key === 'export') void run(exportProject)
            if (key === 'import') inputRef.current?.click()
            if (key === 'new') modal.confirm({
              title: '新建空白项目？',
              content: '当前项目会保留本地存档；未同步的内容建议先导出 JSON。',
              okText: '新建',
              cancelText: '取消',
              onOk: newProject,
            })
          },
        }}
      >
        <button type="button" className="project-actions-trigger" aria-label="项目操作">
          <EllipsisOutlined />
        </button>
      </Dropdown>
      <input ref={inputRef} type="file" accept="application/json,.json" aria-label="选择项目 JSON" hidden onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        void run(async () => {
          const snapshot = parseSnapshot(await file.text())
          if (cloudEnabled) {
            snapshot.project.id = crypto.randomUUID()
            snapshot.cloud = undefined
            for (const record of Object.values(snapshot.recoveries)) record.projectId = snapshot.project.id
          }
          modal.confirm({
            title: `导入「${snapshot.project.name}」？`,
            content: '将整体替换当前项目。如需保留，请先取消并导出当前项目。',
            okText: '导入',
            cancelText: '取消',
            onOk: () => replaceSnapshot(snapshot),
          })
        })
      }} />
    </>
  )
}
