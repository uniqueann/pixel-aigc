import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Select } from 'antd'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { i18n } from '@/i18n'
import { useUserStore } from '@/store/useUserStore'
import type { SuiteActor } from '@shared/ecommerce-suite'
import type { SuiteBridgeDetail } from '@shared/ecommerce-suite-runtime'
import type { GenerationTask } from '@/types'
import { suiteClient } from './api'
import { formatSuiteError } from './i18n'
import { backupAssetBlob } from './recoveryPackage'

export interface WorkstationSuiteBinding { id: string; inputObjectKey: string }
export default function WorkstationBridge({ id, tool, task, disabled, onInput, onBinding }: {
  id: string; tool: string; task?: GenerationTask<unknown>; disabled: boolean;
  onInput: (detail: SuiteBridgeDetail, blob: Blob, actor: SuiteActor) => void;
  onBinding: (binding: WorkstationSuiteBinding | undefined) => void
}) {
  const { t } = useTranslation('ecommerce')
  const account = useUserStore(state => state.account)
  const owner = account?.userId, scope = account?.runtimeScope
  const navigate = useNavigate(), { message } = App.useApp()
  const [detail, setDetail] = useState<SuiteBridgeDetail>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string>()
  const [lifetime, setLifetime] = useState<AbortController>()
  useEffect(() => {
    const abort = new AbortController()
    queueMicrotask(() => { if (!abort.signal.aborted) setLifetime(abort) })
    return () => abort.abort()
  }, [])
  const runtime = useMemo(() => {
    if (!owner || !scope || !lifetime) return undefined
    const actor = { userId: owner, runtimeScope: scope }
    const abort = lifetime
    return { actor, abort, client: suiteClient(actor, abort.signal) }
  }, [owner, scope, lifetime])
  useEffect(() => {
    if (!runtime) return
    let disposed = false
    onBinding(undefined)
    void (async () => {
      const data = await runtime.client.bridge(id)
      if (data.bridge.tool !== tool) throw new Error(i18n.t('ecommerce:bridge.errors.toolMismatch'))
      const blob = await backupAssetBlob(runtime.actor, data.asset, runtime.abort.signal)
      runtime.client.assertCurrent()
      if (disposed) return
      onInput(data, blob, runtime.actor)
      onBinding({ id: data.bridge.id, inputObjectKey: data.asset.objectKey })
      setDetail(data); setError('')
    })().catch(error => { if (!disposed && !runtime.abort.signal.aborted) setError(formatSuiteError(error, 'ecommerce:bridge.errors.restoreFailed')) })
    return () => { disposed = true; onBinding(undefined) }
  }, [id, runtime, tool, onInput, onBinding])
  useEffect(() => {
    if (!runtime || task?.status !== 'succeeded') return
    let disposed = false
    void runtime.client.bridge(id).then(data => { if (!disposed) setDetail(data) }).catch(error => { if (!disposed && !runtime.abort.signal.aborted) setError(formatSuiteError(error, 'ecommerce:bridge.errors.refreshFailed')) })
    return () => { disposed = true }
  }, [id, runtime, task?.id, task?.status])
  const results = detail?.availableResults ?? []
  const key = (value: typeof results[number]) => `${value.sourceKind}:${value.sourceId}:${value.ordinal}`
  const result = results.find(result => key(result) === selected) ?? results[0]
  const perform = async (action: () => Promise<void>) => {
    if (!runtime) return
    setBusy(true)
    try { await action(); setError('') }
    catch (error) { if (!runtime.abort.signal.aborted) setError(formatSuiteError(error, 'ecommerce:errors.actionFailed')) }
    finally { if (!runtime.abort.signal.aborted) setBusy(false) }
  }
  return <Alert className="suite-workstation-bridge" type={error ? 'warning' : 'info'} showIcon message={error || (detail ? t('bridge.bannerTitleWithVersion', { version: detail.version.versionNumber }) : t('bridge.bannerTitleRestoring'))}
    description={<div>
      <p>{t('bridge.bannerDesc', { modeNote: detail?.bridge.inputMode === 'composite' ? t('bridge.modeNoteComposite') : t('bridge.modeNoteBase') })}</p>
      <div className="suite-actions">
        <Button disabled={disabled || busy || !runtime} onClick={() => { void perform(async () => { const data = await runtime!.client.bridge(id); setDetail(data) }) }}>{t('bridge.refreshResults')}</Button>
        <Button disabled={disabled || busy || !detail} onClick={() => { void perform(async () => {
          const data = await runtime!.client.bridge(id), blob = await backupAssetBlob(runtime!.actor, data.asset, runtime!.abort.signal)
          runtime!.client.assertCurrent(); onInput(data, blob, runtime!.actor); onBinding({ id, inputObjectKey: data.asset.objectKey }); setDetail(data)
        }) }}>{t('bridge.reloadInput')}</Button>
        {detail && <Button onClick={() => navigate(`/ecommerce/${detail.bridge.projectId}?slot=${detail.bridge.slotId}`)}>{t('bridge.backToSuite')}</Button>}
      </div>
      {results.length > 0 && <div className="suite-actions">
        <Select aria-label={t('bridge.selectResultAria')} value={result && key(result)} options={results.map(item => ({ value: key(item), label: t('bridge.resultOption', { id: item.sourceId.slice(0,8), index: item.ordinal + 1, returnedSuffix: detail?.returns.some(old => key(old) === key(item)) ? t('bridge.returnedSuffix') : '' }) }))} onChange={setSelected} />
        <Button type="primary" disabled={disabled || busy || !result} loading={busy} onClick={() => { void perform(async () => {
          const returned = await runtime!.client.returnBridge(id, crypto.randomUUID(), result!)
          runtime!.client.assertCurrent(); setDetail(await runtime!.client.bridge(id))
          const suffix = returned.sizeChanged
            ? t('bridge.returnSuffixSizeChanged')
            : returned.sourceChanged
              ? t('bridge.returnSuffixSourceChanged')
              : t('bridge.returnSuffixDefault')
          message.success(t('bridge.returnSuccess', { version: returned.version.versionNumber, suffix }))
        }) }}>{t('bridge.returnButton')}</Button>
      </div>}
    </div>} />
}
