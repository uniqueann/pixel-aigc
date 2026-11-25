import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'
import { CloudError } from '@/cloud/client'
import { i18n } from '@/i18n'
import type { SuiteActor, SuiteProjectConfig, SuiteQuote } from '@shared/ecommerce-suite'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import type { SuiteClient } from './api'
import { clearPendingSuite, readPendingSuite, readSuiteBackup, saveSuiteBackup, saveSuiteBlob, type PendingSuiteSubmission } from './backup'
import { formatSuiteError } from './i18n'
import { createSuiteEditorStore } from './store'
import { submitSuiteOnce } from './recovery'
import { backupAssetBlob, loadFullSuite } from './recoveryPackage'
import { emitTaskCenter } from '@/features/task-center/receipts'
import { refreshBillingBalance } from '@/services/api/billing'

export const suiteWorkspacePoll = { initialMs: 3_000, fastMs: 5_000, slowMs: 120_000, failureMs: 10_000 }
const activeBatch = (batch: { state: string }) => batch.state === 'queued' || batch.state === 'running'
const blockedBatch = (batch: { state: string }) => batch.state === 'blocked'

type SaveStateKey =
  | 'loading'
  | 'localConflictFound'
  | 'savedToCloud'
  | 'usingLocalBackup'
  | 'readFailed'
  | 'savedLocalPendingSync'
  | 'localStorageUnavailable'
  | 'saving'
  | 'dirtyRemaining'
  | 'cloudUpdatedLocalKept'
  | 'cloudSaveFailedLocalKept'
  | 'abandonedPending'
  | 'reconnectedSynced'
  | 'loadedCloud'

type BackupStateKey =
  | 'initial'
  | 'complete'
  | 'metadataOnly'
  | 'storageUnavailableDownload'
  | 'storageUnavailableSaveCloud'
  | 'storageUnavailableKeepPage'

export function useSuiteWorkspace(id: string, actor: SuiteActor, client: SuiteClient, signal: AbortSignal, focusedBatchId?: string) {
  const { t } = useTranslation('ecommerce')
  const [store] = useState(createSuiteEditorStore)
  const editor = useStore(store)
  const [detail, setDetail] = useState<SuiteProjectDetail>()
  const latest = useRef<SuiteProjectDetail>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState(false)
  const [saveStateKey, setSaveStateKey] = useState<SaveStateKey>('loading')
  const [conflict, setConflict] = useState(false)
  const [backupStateKey, setBackupStateKey] = useState<BackupStateKey>('initial')
  const [pending, setPending] = useState<PendingSuiteSubmission>()
  const saving = useRef<Promise<void>>()
  const loading = useRef(0)
  const accept = useCallback((data: SuiteProjectDetail, replace = false) => {
    client.assertCurrent()
    if (data.project.actor.userId !== actor.userId || data.project.actor.runtimeScope !== actor.runtimeScope) throw new Error(i18n.t('ecommerce:workspace.errors.actorMismatch'))
    // 修订号单调递增：保存刚返回的新修订不能被仍在途的旧读取回退，否则下一次保存会用旧修订制造假冲突。
    if (latest.current?.project.id === data.project.id && data.project.revision < latest.current.project.revision) return false
    latest.current = data
    setDetail(data)
    if (!store.getState().config || replace) store.getState().setConfig(data.project.config, false)
    if (!store.getState().selectedSlotId) store.getState().selectSlot(data.project.config.slots[0].id)
    return true
  }, [actor, client, store])
  const load = useCallback(async (replace = false) => {
    const sequence = ++loading.current
    const data = await client.get(id)
    if (focusedBatchId && !data.batches.some(batch => batch.id === focusedBatchId)) {
      const focused = await client.batch(id, focusedBatchId)
      data.batches.push(focused.batch); data.operations.push(...focused.operations)
      const known = new Set(data.tasks.map(task => task.taskKey))
      data.tasks.push(...focused.tasks.filter(task => !known.has(task.taskKey)))
    }
    if (sequence !== loading.current) return
    setOffline(false)
    // 被丢弃的过期快照不能作为调用方后续操作的依据，也不能回写本机备份；返回当前最新详情。
    if (!accept(data, replace)) return latest.current
    void saveSuiteBackup(actor, data).then(() => readSuiteBackup(actor, id)).then(backup => {
      if (!signal.aborted) setBackupStateKey(backup?.complete ? 'complete' : 'metadataOnly')
    }).catch(() => { if (!signal.aborted) setBackupStateKey('storageUnavailableDownload') })
    return data
  }, [accept, actor, client, focusedBatchId, id, signal])
  useEffect(() => {
    void (async () => {
      const backup = await readSuiteBackup(actor, id).catch(() => undefined)
      const receipt = await readPendingSuite(actor, id).catch(() => undefined)
      client.assertCurrent()
      setPending(receipt)
      if (backup) {
        accept(backup.detail)
        setBackupStateKey(backup.complete ? 'complete' : 'metadataOnly')
      }
      try {
        const data = await load()
        if (backup?.conflictConfig || store.getState().dirty) {
          if (!store.getState().dirty && backup?.conflictConfig) store.getState().setConfig(backup.conflictConfig)
          setConflict(true); setSaveStateKey('localConflictFound')
        } else if (data) { store.getState().setConfig(data.project.config, false); setSaveStateKey('savedToCloud') }
      } catch (error) {
        if (!signal.aborted) { setOffline(Boolean(backup)); setError(formatSuiteError(error, 'ecommerce:workspace.errors.readFailed')); setSaveStateKey(backup ? 'usingLocalBackup' : 'readFailed') }
      }
    })().catch(error => { if (!signal.aborted) setError(formatSuiteError(error, 'ecommerce:workspace.errors.readFailed')) })
  }, [accept, actor, client, id, load, signal, store])
  useEffect(() => store.subscribe(state => {
    if (!state.dirty || !state.config || !latest.current) return
    void saveSuiteBackup(actor, latest.current, false, state.config).catch(() => { if (!signal.aborted) setBackupStateKey('storageUnavailableSaveCloud') })
  }), [actor, signal, store])
  const flush = useCallback(async (online = !offline): Promise<void> => {
    if (saving.current) await saving.current
    const state = store.getState(), data = latest.current
    if (!state.dirty || !state.config || !data) return
    const config = state.config, editRevision = state.editRevision
    if (conflict) throw new Error(i18n.t('ecommerce:workspace.errors.conflictMustResolve'))
    const action = (async () => {
      // 本机备份只是降级能力：IndexedDB 配额不足或不可用时，不能阻断云端保存。
      let localSaved = true
      try { await saveSuiteBackup(actor, data, false, config) }
      catch { localSaved = false; if (!signal.aborted) setBackupStateKey('storageUnavailableKeepPage') }
      client.assertCurrent()
      if (!online) {
        setSaveStateKey(localSaved ? 'savedLocalPendingSync' : 'localStorageUnavailable')
        return
      }
      setSaveStateKey('saving')
      try {
        const project = await client.update(id, data.project.revision, config)
        const next = { ...latest.current!, project }
        latest.current = next; setDetail(next)
        store.getState().markSaved(editRevision)
        // 成功保存后清除待同步标记，仍保留新编辑产生的本机副本；本机写失败不能反过来报云端失败。
        const current = store.getState()
        try { await saveSuiteBackup(actor, next, false, current.dirty ? current.config! : null) }
        catch { if (!signal.aborted) setBackupStateKey('storageUnavailableKeepPage') }
        if (!signal.aborted) setSaveStateKey(current.dirty ? 'dirtyRemaining' : 'savedToCloud')
      } catch (error) {
        if (!signal.aborted) {
          setSaveStateKey(error instanceof CloudError && error.status === 409 ? 'cloudUpdatedLocalKept' : 'cloudSaveFailedLocalKept')
          if (error instanceof CloudError && error.status === 409) setConflict(true)
        }
        throw error
      }
    })()
    saving.current = action
    try { await action } finally { if (saving.current === action) saving.current = undefined }
  }, [actor, client, conflict, id, offline, signal, store])
  useEffect(() => {
    if (!editor.dirty || conflict) return
    const timer = setTimeout(() => { void flush().catch(error => { if (!signal.aborted) setError(formatSuiteError(error, 'ecommerce:workspace.errors.saveFailed')) }) }, 800)
    return () => clearTimeout(timer)
  }, [editor.editRevision, editor.dirty, conflict, flush, signal])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (store.getState().dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', guard)
    return () => { window.removeEventListener('beforeunload', guard) }
  }, [store])
  const recoverPending = useCallback(async () => {
    const receipt = pending ?? await readPendingSuite(actor, id)
    if (!receipt) return
    const batch = await client.findBatch(id, receipt.requestId)
    if (!batch) throw new Error(i18n.t('ecommerce:workspace.errors.pendingBatchNotFound'))
    await clearPendingSuite(actor, id)
    setPending(undefined)
    await load()
  }, [actor, client, id, load, pending])
  /** 用户确认原请求未受理后放弃本机编号；放弃前再做一次权威查询，批次已存在时转为找回。 */
  const abandonPending = useCallback(async (): Promise<'none' | 'recovered' | 'abandoned'> => {
    const receipt = pending ?? await readPendingSuite(actor, id)
    if (!receipt) { setPending(undefined); return 'none' }
    const batch = await client.findBatch(id, receipt.requestId)
    await clearPendingSuite(actor, id)
    setPending(undefined)
    if (batch) { await load(); return 'recovered' }
    if (!signal.aborted) setSaveStateKey('abandonedPending')
    return 'abandoned'
  }, [actor, client, id, load, pending, signal])
  const settleOriginals = useCallback(async () => {
    const data = latest.current
    if (!data) return
    for (const batch of data.batches) {
      client.assertCurrent()
      await client.results(id, batch.id)
    }
    void refreshBillingBalance(actor.userId).catch(() => undefined)
    return load()
  }, [actor.userId, client, id, load])
  const loadRef = useRef(load)
  const signalRef = useRef(signal)
  useEffect(() => { loadRef.current = load; signalRef.current = signal }, [load, signal])
  const pollMode = detail?.batches.some(activeBatch) ? 'fast' : detail?.batches.some(blockedBatch) ? 'slow' : 'off'
  useEffect(() => {
    // 排队/运行中保持短间隔。待用户处理的 blocked 大幅退避，避免签名与缩略图被轮询反复打掉。
    if (pollMode === 'off') return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    const schedule = (delay: number) => { timer = setTimeout(() => { void poll() }, delay) }
    const poll = async () => {
      if (disposed || signalRef.current.aborted) return
      let mode: 'fast' | 'slow' | 'off' = pollMode
      if (!document.hidden) {
        try {
          const next = await loadRef.current()
          failures = 0
          // 更新的读取覆盖了这次响应时保持原间隔，不能把仍在运行的批次降成慢轮询。
          if (next) {
            const running = next.batches.some(activeBatch)
            const blocked = next.batches.some(blockedBatch)
            if (!running && !blocked) {
              void refreshBillingBalance(actor.userId).catch(() => undefined)
              return
            }
            mode = running ? 'fast' : 'slow'
          }
        }
        catch (error) { if (!disposed && !signalRef.current.aborted) { failures++; setError(formatSuiteError(error, 'ecommerce:workspace.errors.pollReadFailed')) } }
      }
      if (!disposed && !signalRef.current.aborted && failures < 3) schedule(failures ? suiteWorkspacePoll.failureMs : mode === 'slow' ? suiteWorkspacePoll.slowMs : suiteWorkspacePoll.fastMs)
    }
    schedule(pollMode === 'slow' ? suiteWorkspacePoll.slowMs : suiteWorkspacePoll.initialMs)
    return () => { disposed = true; clearTimeout(timer) }
  }, [actor.userId, pollMode])
  const run = useCallback(async <T,>(action: () => Promise<T>) => {
    setBusy(true); setError('')
    try { client.assertCurrent(); return await action() }
    catch (error) { if (!signal.aborted) setError(formatSuiteError(error, 'ecommerce:errors.actionFailed')); throw error }
    finally { if (!signal.aborted) setBusy(false) }
  }, [client, signal])
  const submit = async (quote: SuiteQuote) => {
    await flush()
    if (store.getState().dirty) throw new Error(i18n.t('ecommerce:workspace.errors.saveBeforeSubmit'))
    try {
      await submitSuiteOnce(client, actor, id, quote)
      client.assertCurrent()
      emitTaskCenter({ type: 'refresh' })
      void refreshBillingBalance(actor.userId).catch(() => undefined)
      await load()
      setPending(undefined)
    } finally { if (!signal.aborted) setPending(await readPendingSuite(actor, id)) }
  }
  const completeBackup = async () => {
    await flush()
    const all = await loadFullSuite(client, id)
    for (const asset of all.assets) {
      client.assertCurrent()
      await saveSuiteBlob(actor, id, asset.assetId, await backupAssetBlob(actor, asset, signal))
    }
    await saveSuiteBackup(actor, all, true)
    setBackupStateKey('complete')
    return all
  }
  const reloadCloud = async (discardLocal = false) => {
    const dirty = store.getState().dirty
    // 离线重连时保留本机未同步编辑并随后上传；冲突页的“读取云端”才明确丢弃本机副本。
    const keepLocal = dirty && !discardLocal && !conflict
    await load(!keepLocal)
    setConflict(false); setError('')
    if (keepLocal) {
      await flush(true)
      setSaveStateKey('reconnectedSynced')
    } else {
      setSaveStateKey('loadedCloud')
    }
    const data = latest.current!
    try { await saveSuiteBackup(actor, data, false, null) }
    catch { if (!signal.aborted) setBackupStateKey('storageUnavailableKeepPage') }
  }
  const edit = (config: SuiteProjectConfig) => store.getState().setConfig(config)
  const saveState = t(`workspace.saveStates.${saveStateKey}`)
  const backupState = t(`workspace.backupStates.${backupStateKey}`)
  return { detail, editor, store, error, busy, offline, conflict, pending, saveState, backupState, client, run, load, flush, edit,
    submit, recoverPending, abandonPending, settleOriginals, completeBackup, reloadCloud }
}
