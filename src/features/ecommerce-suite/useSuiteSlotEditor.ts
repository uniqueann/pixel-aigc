import { useCallback, useEffect, useRef, useState } from 'react'
import { CloudError } from '@/cloud/client'
import { suiteCompositionSchema, type SuiteComposition, type SuiteSlotDraft, type SuiteSlotVersion } from '@shared/ecommerce-suite'
import { SUITE_RENDERER_VERSION } from '@shared/ecommerce-suite-annotations'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import type { SuiteClient } from './api'
import { archiveSuiteDraft, readLocalSuiteDraft, saveLocalSuiteDraft } from './backup'

interface RecordValue { value: SuiteSlotDraft; dirty: boolean; edit: number; error?: string }
export function suiteDraftComposition(value: SuiteSlotDraft, base?: SuiteSlotVersion): SuiteComposition | undefined {
  if (!base) return undefined
  return { ...base.composition, rendererVersion: SUITE_RENDERER_VERSION, layersSnapshot: value.layers,
    factsSnapshot: value.factsSnapshot ?? base.composition.factsSnapshot, copyLanguage: value.copyLanguage ?? base.composition.copyLanguage,
    unitSystem: value.unitSystem ?? base.composition.unitSystem }
}
function initialDraft(data: SuiteProjectDetail, slotId: string): SuiteSlotDraft {
  const cloud = data.drafts.find(item => item.slotId === slotId)
  const headId = data.project.slotHeads.find(head => head.slotId === slotId)?.activeVersionId ?? null
  const version = data.versions.find(item => item.id === headId)
  if (cloud?.value && !cloud.value.baseVersionId && !cloud.value.layers.length && version)
    return { ...cloud.value, expectedDraftRevision: cloud.revision, baseVersionId: version.id,
      layers: version.composition.layersSnapshot, factsSnapshot: version.composition.factsSnapshot,
      copyLanguage: version.composition.copyLanguage, unitSystem: version.composition.unitSystem }
  return cloud?.value ? { ...cloud.value, expectedDraftRevision: cloud.revision } : { expectedDraftRevision: cloud?.revision ?? 0, baseVersionId: headId,
    layers: version?.composition.layersSnapshot ?? [], factsSnapshot: version?.composition.factsSnapshot ?? data.project.config.facts.filter(fact => fact.confirmed),
    copyLanguage: version?.composition.copyLanguage ?? data.project.config.copyLanguage, unitSystem: version?.composition.unitSystem ?? data.project.config.unitSystem,
    modelProfileId: null, resolution: '1k', count: 1, promptNote: '' }
}
/** 生成参数和图层共享同一草稿写入队列，避免两个页签覆盖彼此。 */
export function useSuiteSlotEditor(data: SuiteProjectDetail | undefined, client: SuiteClient, signal: AbortSignal, offline: boolean) {
  const latest = useRef(data)
  useEffect(() => { latest.current = data }, [data])
  const [records] = useState(() => new Map<string, RecordValue>())
  const [snapshot, setSnapshot] = useState(() => new Map<string, RecordValue>())
  const writes = useRef(new Map<string, Promise<void>>())
  const restored = useRef(new Set<string>())
  const [revision, refresh] = useState(0)
  const notify = useCallback(() => { if (!signal.aborted) { setSnapshot(new Map(records)); refresh(value => value + 1) } }, [records, signal])
  useEffect(() => {
    if (!data) return
    let disposed = false
    for (const slot of data.project.config.slots) {
      const old = records.get(slot.id)
      const cloud = data.drafts.find(item => item.slotId === slot.id)
      if (!old || !old.dirty && !writes.current.has(slot.id) && (cloud?.revision ?? 0) > old.value.expectedDraftRevision)
        records.set(slot.id, { value: initialDraft(data, slot.id), dirty: false, edit: 0 })
      if (!restored.current.has(slot.id)) {
        void readLocalSuiteDraft(data.project.actor, data.project.id, slot.id).then(local => {
          if (disposed || signal.aborted) return
          restored.current.add(slot.id)
          if (!local?.dirty || records.get(slot.id)?.dirty) return
          records.set(slot.id, { value: local.value, dirty: true, edit: 1 }); notify()
        }).catch(() => { if (!disposed) notify() })
      }
    }
    queueMicrotask(() => { if (!disposed) notify() })
    return () => { disposed = true }
  }, [data, notify, records, signal])
  const edit = useCallback((slotId: string, patch: Partial<SuiteSlotDraft>) => {
    const current = records.get(slotId), detail = latest.current
    if (!current || !detail) return
    const next = { value: { ...current.value, ...patch }, dirty: true, edit: current.edit + 1, error: undefined }
    records.set(slotId, next); notify()
    void saveLocalSuiteDraft(detail.project.actor, detail.project.id, slotId, next).catch(() => {
      // 只标记仍属于这次编辑的记录；若云端已保存成功，不能用过期的本机失败覆盖结果。
      const record = records.get(slotId)
      if (record?.edit === next.edit && record.dirty) { record.error = '本机存储失败，请保持页面并保存云端或下载图层草稿'; notify() }
    })
  }, [notify, records])
  const flushSlot = useCallback(async (slotId: string) => {
    // 等待后必须复查：其他调用可能已接手同一槽位的保存，各自用同一修订号重复提交会制造假冲突。
    while (writes.current.has(slotId)) await writes.current.get(slotId)
    const record = records.get(slotId), detail = latest.current
    if (!record?.dirty || !detail) return
    if (record.error?.includes('冲突')) throw new Error(record.error)
    const action = (async () => {
      // 本机草稿只是降级能力：IndexedDB 写入失败时继续保存云端，避免因配额问题丢失编辑。
      try { await saveLocalSuiteDraft(detail.project.actor, detail.project.id, slotId, record) } catch { /* 继续云端保存 */ }
      if (offline) return
      const saved = await client.draft(detail.project.id, slotId, record.value)
      const current = records.get(slotId)!
      const next = { ...current, value: { ...current.value, expectedDraftRevision: saved.revision }, dirty: current.edit !== record.edit, error: undefined }
      records.set(slotId, next)
      try { await saveLocalSuiteDraft(detail.project.actor, detail.project.id, slotId, next) } catch { /* 本机备份失败不影响云端结果 */ }
    })().catch(error => {
      const current = records.get(slotId)
      if (current) current.error = error instanceof CloudError && error.status === 409 ? '草稿修订冲突，本机副本已保留，请读取云端或另存图层草稿' : '草稿未同步，请手动重试保存'
      throw error
    })
    writes.current.set(slotId, action)
    try { await action } finally { if (writes.current.get(slotId) === action) writes.current.delete(slotId); notify() }
  }, [client, notify, offline, records])
  const flushAll = useCallback(async () => {
    for (const id of records.keys()) await flushSlot(id)
  }, [flushSlot, records])
  useEffect(() => {
    if (offline || ![...records.values()].some(record => record.dirty && (!record.error || record.error.includes('本机存储失败')))) return
    const timer = setTimeout(() => { void flushAll().catch(() => undefined) }, 800)
    return () => clearTimeout(timer)
  }, [revision, flushAll, offline, records])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if ([...records.values()].some(record => record.dirty)) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [records])
  const reset = async (slotId: string, version: SuiteSlotVersion) => {
    // 读取云端与写入排在同一队列：既等待在途保存，也防止自动保存插进这次读取中间。
    const previous = writes.current.get(slotId)
    const action = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(async () => {
      const detail = latest.current!, old = records.get(slotId)
      if (!detail) return
      if (old) await archiveSuiteDraft(detail.project.actor, detail.project.id, slotId, old)
      const cloud = (await client.get(detail.project.id)).drafts.find(item => item.slotId === slotId)
      records.set(slotId, { value: { ...initialDraft(detail, slotId), ...old?.value, expectedDraftRevision: cloud?.revision ?? 0,
        baseVersionId: version.id, layers: version.composition.layersSnapshot, factsSnapshot: version.composition.factsSnapshot,
        copyLanguage: version.composition.copyLanguage, unitSystem: version.composition.unitSystem }, dirty: true, edit: (old?.edit ?? 0) + 1 })
    })
    writes.current.set(slotId, action)
    try { await action } finally { if (writes.current.get(slotId) === action) writes.current.delete(slotId); notify() }
    await flushSlot(slotId)
  }
  const readCloud = async (slotId: string) => {
    // 读取云端与写入排在同一队列：否则读到的修订可能落后于刚保存的结果，下一次编辑会被误判为冲突。
    const previous = writes.current.get(slotId)
    const action = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(async () => {
      const detail = latest.current!, old = records.get(slotId)
      if (!detail) return
      if (old) await archiveSuiteDraft(detail.project.actor, detail.project.id, slotId, old)
      const cloud = await client.get(detail.project.id)
      const value = initialDraft(cloud, slotId)
      records.set(slotId, { value, dirty: false, edit: 0 })
      await saveLocalSuiteDraft(detail.project.actor, detail.project.id, slotId, { value, dirty: false })
    })
    writes.current.set(slotId, action)
    try { await action } finally { if (writes.current.get(slotId) === action) writes.current.delete(slotId); notify() }
  }
  const saveVersion = async (slotId: string) => {
    await flushSlot(slotId)
    const detail = latest.current!, record = records.get(slotId)!
    if (offline) throw new Error('请联网保存图层版本，本机草稿仍保留')
    const base = detail.versions.find(item => item.id === record.value.baseVersionId)
    const composition = suiteCompositionSchema.parse(suiteDraftComposition(record.value, base))
    const result = await client.saveVersion(detail.project.id, slotId, { requestId: crypto.randomUUID(), baseVersionId: base!.id,
      expectedHeadRevision: detail.project.slotHeads.find(head => head.slotId === slotId)!.headRevision, expectedDraftRevision: record.value.expectedDraftRevision, composition })
    if (result.version.id !== base!.id) await reset(slotId, result.version)
    return result.version
  }
  return { records: snapshot, revision, edit, flushSlot, flushAll, reset, readCloud, saveVersion }
}
