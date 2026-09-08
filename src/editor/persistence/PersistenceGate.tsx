import { useEffect, type ReactNode } from 'react'
import { Alert, App, Button, Space } from 'antd'
import { downloadJson, initializePersistence, restartAfterLoadError } from './projectPersistence'
import { usePersistenceStore } from './persistenceStore'

export default function PersistenceGate({ children }: { children: ReactNode }) {
  const phase = usePersistenceStore((state) => state.phase)
  const error = usePersistenceStore((state) => state.error)
  const raw = usePersistenceStore((state) => state.raw)
  const writable = usePersistenceStore((state) => state.writable)
  const epoch = usePersistenceStore((state) => state.epoch)
  const { modal, message } = App.useApp()
  useEffect(() => { void initializePersistence() }, [])
  if (phase === 'idle' || phase === 'loading') return <div className="free-canvas-loading">正在恢复本地项目…</div>
  if (phase === 'error' || !writable) {
    return <div className="project-recovery-screen">
      <Alert type={phase === 'error' ? 'error' : 'info'} showIcon message={phase === 'error' ? '无法恢复本地项目' : '项目已在其他页面打开'} description={error ?? '此页面暂为只读。关闭正在编辑的页面后，点击重新取得编辑权。'} />
      <Space wrap>
        <Button onClick={() => { void initializePersistence() }}>重新读取并取得编辑权</Button>
        {raw !== undefined && <Button onClick={() => downloadJson(raw, '项目原始存档.json')}>下载原始存档</Button>}
        {phase === 'error' && writable && <Button danger onClick={() => modal.confirm({
          title: '重新开始将替换本地存档', content: '建议先下载原始存档，以便以后恢复。', okText: '重新开始', cancelText: '取消',
          onOk: async () => { try { await restartAfterLoadError() } catch (err) { message.error(String(err)); throw err } },
        })}>重新开始</Button>}
      </Space>
    </div>
  }
  return <div key={epoch} className="project-app-root">{children}</div>
}
