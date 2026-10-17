import { useState } from 'react'
import { Alert, Button, Modal } from 'antd'
import type { SuiteActor } from '@shared/ecommerce-suite'
import type { SuiteClient } from './api'
import { importSuiteRecovery, readSuiteRecovery } from './importRecovery'

export default function RecoveryImport({ actor, client, onImported }: { actor: SuiteActor; client: SuiteClient; onImported: (id: string) => void }) {
  const [input, setInput] = useState<Awaited<ReturnType<typeof readSuiteRecovery>>>()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const read = async (file: File) => {
    setBusy(true); setError('')
    try { const data = await readSuiteRecovery(file); client.assertCurrent(); setInput(data) }
    catch (error) { setError(error instanceof Error ? error.message : '恢复包无法读取') }
    finally { setBusy(false) }
  }
  const restore = async () => {
    if (!input) return
    setBusy(true); setError('')
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input.manifest)))
      const checksum = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2,'0')).join('')
      const project = await importSuiteRecovery(client, actor, input, checksum)
      client.assertCurrent(); setInput(undefined); onImported(project.id)
    } catch (error) { setError(error instanceof Error ? error.message : '导入未完成，可以使用同一恢复包继续') }
    finally { setBusy(false) }
  }
  return <>
    <label className="suite-file-button">{busy ? '正在校验或恢复…' : '导入含图片恢复包'}<input aria-label="导入套图恢复包" type="file" accept=".zip,application/zip" disabled={busy}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void read(file) }} /></label>
    {error && !input && <Alert type="warning" message={error} />}
    <Modal title="恢复套图副本" open={Boolean(input)} onCancel={busy ? undefined : () => setInput(undefined)} maskClosable={!busy}
      footer={<Button type="primary" loading={busy} onClick={() => { void restore() }}>重新上传图片并恢复为当前账号项目</Button>}>
      <p>{input?.manifest.config.title} · {input?.manifest.assets.length} 张图片 · {input?.manifest.versions.length} 个完整版本</p>
      <p>恢复底图、图层、历史和草稿。原云端访问权限与生成任务不迁移，后续生成需要重新确认费用；本次导入不产生生成费用。</p>
      <p>同一恢复包重复导入会找回本次恢复项目。上传中断时可保留恢复包继续，不必重新生成图片。</p>
      {error && <Alert type="warning" message={error} />}
    </Modal>
  </>
}
