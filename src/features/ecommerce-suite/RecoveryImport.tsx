import { useState } from 'react'
import { Alert, Button, Modal } from 'antd'
import { useTranslation } from 'react-i18next'
import type { SuiteActor } from '@shared/ecommerce-suite'
import type { SuiteClient } from './api'
import { formatSuiteError } from './i18n'
import { importSuiteRecovery, readSuiteRecovery } from './importRecovery'

export default function RecoveryImport({ actor, client, onImported }: { actor: SuiteActor; client: SuiteClient; onImported: (id: string) => void }) {
  const { t } = useTranslation('ecommerce')
  const [input, setInput] = useState<Awaited<ReturnType<typeof readSuiteRecovery>>>()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const read = async (file: File) => {
    setBusy(true); setError('')
    try { const data = await readSuiteRecovery(file); client.assertCurrent(); setInput(data) }
    catch (error) { setError(formatSuiteError(error, 'ecommerce:recoveryImport.errors.readFailed')) }
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
    } catch (error) { setError(formatSuiteError(error, 'ecommerce:recoveryImport.errors.importIncomplete')) }
    finally { setBusy(false) }
  }
  return <>
    <label className="suite-file-button">{busy ? t('recoveryImport.busyButton') : t('recoveryImport.importButton')}<input aria-label={t('recoveryImport.inputAria')} type="file" accept=".zip,application/zip" disabled={busy}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void read(file) }} /></label>
    {error && !input && <Alert type="warning" message={error} />}
    <Modal title={t('recoveryImport.modalTitle')} open={Boolean(input)} onCancel={busy ? undefined : () => setInput(undefined)} maskClosable={!busy}
      footer={<Button type="primary" loading={busy} onClick={() => { void restore() }}>{t('recoveryImport.restoreButton')}</Button>}>
      {input && <p>{t('recoveryImport.summaryLine', { title: input.manifest.config.title, assets: input.manifest.assets.length, versions: input.manifest.versions.length })}</p>}
      <p>{t('recoveryImport.desc1')}</p>
      <p>{t('recoveryImport.desc2')}</p>
      {error && <Alert type="warning" message={error} />}
    </Modal>
  </>
}
