import { useEffect, useRef, useState } from 'react'
import { EditOutlined, EllipsisOutlined } from '@ant-design/icons'
import { App, Dropdown, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('nav')
  const project = useEditorStore((state) => state.project)
  const status = usePersistenceStore((state) => state.status)
  const error = usePersistenceStore((state) => state.error)
  const [session, setSession] = useState<{ id: string; draft: string; original: string } | null>(null)
  const cancelingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const stored = project?.name ?? ''
  const shown = stored.trim() ? stored : t('projectHeader.untitledCanvas')
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
        {status === 'saved' ? <><span className="project-save-mark">✓</span> {t('projectHeader.status.savedWord')}</> : copy.full}
      </span>
    </span>
  )

  return (
    <nav className="canvas-header-crumb" aria-label={t('projectHeader.breadcrumbAria')}>
      <span className="canvas-crumb-prefix">{t('projectHeader.canvasCrumb')}</span>
      <span className="canvas-crumb-sep" aria-hidden="true">/</span>
      {editing ? (
        <input
          ref={inputRef}
          className="canvas-project-name-input"
          aria-label={t('projectHeader.projectNameAria')}
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
        <button type="button" className="canvas-project-name" onClick={begin} disabled={!project} aria-label={t('projectHeader.editProjectNameAria', { name: shown })}>
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
  const { t } = useTranslation(['nav', 'common'])
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
    try { await action() } catch (err) { message.error(err instanceof Error ? err.message : t('nav:projectHeader.operationFailed')) }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isProjectSaveShortcut(event)) return
      event.preventDefault()
      const active = document.activeElement
      if (active instanceof HTMLElement && active !== document.body) active.blur()
      if (usePersistenceStore.getState().phase !== 'ready' || !useEditorStore.getState().project) return
      void flushProject().catch((err: unknown) => {
        message.error(err instanceof Error ? err.message : t('nav:projectHeader.operationFailed'))
      })
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [message, t])

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
            { key: 'save', disabled: !ready, label: menuLabel(t('nav:projectHeader.saveNow'), shortcut) },
            { key: 'export', disabled: !ready, label: t('nav:projectHeader.exportJson') },
            { key: 'import', disabled: !ready || unavailable, label: t('nav:projectHeader.importJson') },
            { type: 'divider' },
            { key: 'new', disabled: !ready || unavailable, label: t('nav:projectHeader.newProject') },
          ],
          onClick: ({ key }) => {
            if (key === 'save') void run(flushProject)
            if (key === 'export') void run(exportProject)
            if (key === 'import') inputRef.current?.click()
            if (key === 'new') modal.confirm({
              title: t('nav:projectHeader.newConfirmTitle'),
              content: t('nav:projectHeader.newConfirmContent'),
              okText: t('nav:projectHeader.newConfirmOk'),
              cancelText: t('common:actions.cancel'),
              onOk: newProject,
            })
          },
        }}
      >
        <button type="button" className="project-actions-trigger" aria-label={t('nav:projectHeader.actionsAria')}>
          <EllipsisOutlined />
        </button>
      </Dropdown>
      <input ref={inputRef} type="file" accept="application/json,.json" aria-label={t('nav:projectHeader.selectJsonAria')} hidden onChange={(event) => {
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
            title: t('nav:projectHeader.importConfirmTitle', { name: snapshot.project.name }),
            content: t('nav:projectHeader.importConfirmContent'),
            okText: t('nav:projectHeader.importConfirmOk'),
            cancelText: t('common:actions.cancel'),
            onOk: () => replaceSnapshot(snapshot),
          })
        })
      }} />
    </>
  )
}
