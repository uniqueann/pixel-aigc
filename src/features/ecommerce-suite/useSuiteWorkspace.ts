import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { CloudError } from '@/cloud/client'
import { getTask } from '@/services/api/task'
import type { SuiteActor, SuiteProjectConfig, SuiteQuote } from '@shared/ecommerce-suite'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import type { SuiteClient } from './api'
import { clearPendingSuite, readPendingSuite, readSuiteBackup, saveSuiteBackup, saveSuiteBlob, type PendingSuiteSubmission } from './backup'
import { createSuiteEditorStore } from './store'
import { submitSuiteOnce } from './recovery'
import { backupAssetBlob, loadFullSuite } from './recoveryPackage'

export function useSuiteWorkspace(id: string, actor: SuiteActor, client: SuiteClient, signal: AbortSignal) {
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
    if (sequence !== loading.current) return
    accept(data, replace)
    setOffline(false)
    void saveSuiteBackup(actor, data).then(() => readSuiteBackup(actor, id)).then(backup => {
      if (!signal.aborted) setBackupState(backup?.complete ? '本地完整备份已就绪' : '元数据已备份，部分图片尚未落盘')
    }).catch(() => { if (!signal.aborted) setBackupState('本地存储不可用，可下载恢复包') })
    return data
  }, [accept, actor, client, id, signal])
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
    for (const operation of data.operations.filter(operation => !operation.terminalState)) {
      if (operation.task) await getTask(operation.task.sourceId, { signal })
      client.assertCurrent()
      await client.results(id, operation.batchId)
    }
    return load()
  }, [client, id, load, signal])
  useEffect(() => {
    if (!detail?.batches.some(batch => batch.state === 'running')) return
    let disposed = false, timer: ReturnType<typeof setTimeout>
    let failures = 0
    const poll = async () => {
      if (disposed || signal.aborted) return
      if (!document.hidden) {
        try { await settleOriginals(); failures = 0 }
        catch (error) { if (!disposed && !signal.aborted) { failures++; setError(error instanceof Error ? error.message : '原结果读取失败，可手动重试读取') } }
      }
      if (!disposed && !signal.aborted && failures < 3) timer = setTimeout(() => { void poll() }, failures ? 10000 : 5000)
    }
    timer = setTimeout(() => { void poll() }, 3000)
    return () => { disposed = true; clearTimeout(timer) }
  }, [detail?.batches, settleOriginals, signal])
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
      const batch = await submitSuiteOnce(client, actor, id, quote)
      await client.results(id, batch.id)
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
