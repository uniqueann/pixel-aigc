import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { CloudError } from '@/cloud/client'
import type { SuiteActor, SuiteProjectConfig, SuiteQuote } from '@shared/ecommerce-suite'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import type { SuiteClient } from './api'
import { clearPendingSuite, readPendingSuite, readSuiteBackup, saveSuiteBackup, saveSuiteBlob, type PendingSuiteSubmission } from './backup'
import { createSuiteEditorStore } from './store'
import { submitSuiteOnce } from './recovery'
import { backupAssetBlob, loadFullSuite } from './recoveryPackage'
import { emitTaskCenter } from '@/features/task-center/receipts'
import { refreshBillingBalance } from '@/services/api/billing'

export const suiteWorkspacePoll = { initialMs: 3_000, fastMs: 5_000, slowMs: 120_000, failureMs: 10_000 }
const activeBatch = (batch: { state: string }) => batch.state === 'queued' || batch.state === 'running'
const blockedBatch = (batch: { state: string }) => batch.state === 'blocked'

export function useSuiteWorkspace(id: string, actor: SuiteActor, client: SuiteClient, signal: AbortSignal, focusedBatchId?: string) {
  const [store] = useState(createSuiteEditorStore)
  const editor = useStore(store)
  const [detail, setDetail] = useState<SuiteProjectDetail>()
  const latest = useRef<SuiteProjectDetail>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState(false)
  const [saveState, setSaveState] = useState('正在读取')
  const [conflict, setConflict] = useState(false)
  const [backupState, setBackupState] = useState('尚未完成图片备份')
  const [pending, setPending] = useState<PendingSuiteSubmission>()
  const saving = useRef<Promise<void>>()
  const loading = useRef(0)
  const accept = useCallback((data: SuiteProjectDetail, replace = false) => {
    client.assertCurrent()
    if (data.project.actor.userId !== actor.userId || data.project.actor.runtimeScope !== actor.runtimeScope) throw new Error('项目归属与当前账号环境不一致')
    latest.current = data
    setDetail(data)
    if (!store.getState().config || replace) store.getState().setConfig(data.project.config, false)
    if (!store.getState().selectedSlotId) store.getState().selectSlot(data.project.config.slots[0].id)
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
    accept(data, replace)
    setOffline(false)
    void saveSuiteBackup(actor, data).then(() => readSuiteBackup(actor, id)).then(backup => {
      if (!signal.aborted) setBackupState(backup?.complete ? '本地完整备份已就绪' : '元数据已备份，部分图片尚未落盘')
    }).catch(() => { if (!signal.aborted) setBackupState('本地存储不可用，可下载恢复包') })
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
        setBackupState(backup.complete ? '本地完整备份已就绪' : '元数据已备份，部分图片尚未落盘')
      }
      try {
        const data = await load()
        if (backup?.conflictConfig || store.getState().dirty) {
          if (!store.getState().dirty && backup?.conflictConfig) store.getState().setConfig(backup.conflictConfig)
          setConflict(true); setSaveState('发现本机未同步副本，请选择读取云端或另存副本')
        } else if (data) { store.getState().setConfig(data.project.config, false); setSaveState('已保存到云端') }
      } catch (error) {
        if (!signal.aborted) { setOffline(Boolean(backup)); setError(error instanceof Error ? error.message : '读取失败'); setSaveState(backup ? '正在使用本地备份' : '读取失败') }
      }
    })().catch(error => { if (!signal.aborted) setError(error.message) })
  }, [accept, actor, client, id, load, signal, store])
  useEffect(() => store.subscribe(state => {
    if (!state.dirty || !state.config || !latest.current) return
    void saveSuiteBackup(actor, latest.current, false, state.config).catch(() => { if (!signal.aborted) setBackupState('本地存储不可用，请先保存云端或下载恢复包') })
  }), [actor, signal, store])
  const flush = useCallback(async (): Promise<void> => {
    if (saving.current) await saving.current
    const state = store.getState(), data = latest.current
    if (!state.dirty || !state.config || !data) return
    const config = state.config, editRevision = state.editRevision
    if (conflict) throw new Error('云端存在修订冲突，请先处理本机副本')
    const action = (async () => {
      await saveSuiteBackup(actor, data, false, config)
      client.assertCurrent()
      if (offline) { setSaveState('已保存本机，联网后需要同步'); return }
      setSaveState('正在保存…')
      try {
        const project = await client.update(id, data.project.revision, config)
        const next = { ...latest.current!, project }
        latest.current = next; setDetail(next)
        store.getState().markSaved(editRevision)
        // 成功保存后清除待同步标记，仍保留新编辑产生的本机副本。
        const current = store.getState()
        await saveSuiteBackup(actor, next, false, current.dirty ? current.config! : null)
        if (!signal.aborted) setSaveState(current.dirty ? '还有编辑待保存' : '已保存到云端')
      } catch (error) {
        if (!signal.aborted) {
          setSaveState(error instanceof CloudError && error.status === 409 ? '云端有更新，本机副本已保留' : '云端保存失败，本机副本已保留')
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
    const timer = setTimeout(() => { void flush().catch(error => { if (!signal.aborted) setError(error.message) }) }, 800)
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
    if (!batch) throw new Error('尚未查到已接收的原批次；继续保留原编号，暂不允许重新提交')
    await clearPendingSuite(actor, id)
    setPending(undefined)
    await load()
  }, [actor, client, id, load, pending])
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
        catch (error) { if (!disposed && !signalRef.current.aborted) { failures++; setError(error instanceof Error ? error.message : '原结果读取失败，可手动重试读取') } }
      }
      if (!disposed && !signalRef.current.aborted && failures < 3) schedule(failures ? suiteWorkspacePoll.failureMs : mode === 'slow' ? suiteWorkspacePoll.slowMs : suiteWorkspacePoll.fastMs)
    }
    schedule(pollMode === 'slow' ? suiteWorkspacePoll.slowMs : suiteWorkspacePoll.initialMs)
    return () => { disposed = true; clearTimeout(timer) }
  }, [actor.userId, pollMode])
  const run = useCallback(async <T,>(action: () => Promise<T>) => {
    setBusy(true); setError('')
    try { client.assertCurrent(); return await action() }
    catch (error) { if (!signal.aborted) setError(error instanceof Error ? error.message : '操作失败'); throw error }
    finally { if (!signal.aborted) setBusy(false) }
  }, [client, signal])
  const submit = async (quote: SuiteQuote) => {
    await flush()
    if (store.getState().dirty) throw new Error('请先保存所有编辑再提交')
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
    setBackupState('本地完整备份已就绪')
    return all
  }
  const reloadCloud = async () => {
    await load(true); setConflict(false); setError(''); setSaveState('已读取云端')
    const data = latest.current!
    await saveSuiteBackup(actor, data, false, null)
  }
  const edit = (config: SuiteProjectConfig) => store.getState().setConfig(config)
  return { detail, editor, store, error, busy, offline, conflict, pending, saveState, backupState, client, run, load, flush, edit,
    submit, recoverPending, settleOriginals, completeBackup, reloadCloud }
}
