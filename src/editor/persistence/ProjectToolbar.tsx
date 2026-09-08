import { useRef } from 'react'
import { App, Button, Input, Space, Tooltip } from 'antd'
import { useEditorStore } from '@/editor/store'
import { usePersistenceStore } from './persistenceStore'
import { exportProject, flushProject, hasUnfinishedGeneration, newProject, replaceSnapshot } from './projectPersistence'
import { parseSnapshot } from './snapshot'

export default function ProjectToolbar({ busy }: { busy: boolean }) {
  const project = useEditorStore((state) => state.project)
  const status = usePersistenceStore((state) => state.status)
  const error = usePersistenceStore((state) => state.error)
  const inputRef = useRef<HTMLInputElement>(null)
  const { modal, message } = App.useApp()
  const unavailable = busy || hasUnfinishedGeneration()
  const run = async (action: () => unknown) => {
    try { await action() } catch (err) { message.error(err instanceof Error ? err.message : '项目操作失败') }
  }
  return <div className="project-toolbar">
    <Input aria-label="项目名称" value={project?.name ?? ''} maxLength={100} onChange={(event) => {
      const name = event.target.value
      useEditorStore.setState((state) => ({ project: state.project ? { ...state.project, name, updatedAt: new Date().toISOString() } : null }))
    }} onBlur={() => {
      if (!useEditorStore.getState().project?.name.trim()) useEditorStore.setState((state) => ({ project: state.project ? { ...state.project, name: '未命名画布' } : null }))
    }} />
    <Tooltip title={error}><span role="status" className={`project-save-status ${status}`}>{({ saved: '已保存', dirty: '未保存', saving: '保存中…', error: '保存失败' })[status]}</span></Tooltip>
    <Space size="small" wrap>
      <Button size="small" onClick={() => { void run(flushProject) }}>立即保存</Button>
      <Button size="small" onClick={() => { void run(exportProject) }}>导出 JSON</Button>
      <Button size="small" disabled={unavailable} onClick={() => inputRef.current?.click()}>导入 JSON</Button>
      <Button size="small" disabled={unavailable} onClick={() => modal.confirm({
        title: '新建空白项目？', content: '当前项目将被替换。如需保留，请先导出 JSON。', okText: '新建', cancelText: '取消', onOk: newProject,
      })}>新建项目</Button>
    </Space>
    <input ref={inputRef} type="file" accept="application/json,.json" aria-label="选择项目 JSON" hidden onChange={(event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      void run(async () => {
        const snapshot = parseSnapshot(await file.text())
        modal.confirm({ title: `导入「${snapshot.project.name}」？`, content: '将整体替换当前项目。如需保留，请先取消并导出当前项目。', okText: '导入', cancelText: '取消', onOk: () => replaceSnapshot(snapshot) })
      })
    }} />
  </div>
}
