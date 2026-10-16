import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Input, Modal, Select } from 'antd'
import type { SuiteProject, SuiteQuote, SuiteSlotConfig, SuiteSlotDraft } from '@shared/ecommerce-suite'
import { SUITE_CATEGORY_TEMPLATES } from '@shared/ecommerce-suite-templates'
import { listImageModels, type PublicImageModel } from '@/services/api/imageModels'
import ModelChoice from '@/components/ModelChoice'
import { CloudError } from '@/cloud/client'
import { downloadBlob } from '@/pages/Toolbox/shared/zip'
import type { SuiteClient } from './api'
import { readLocalSuiteDraft, saveLocalSuiteDraft } from './backup'

export default function GenerationPanel({ project, slot, draft, client, blocked, flush, onSubmit, onSaved, onError }: {
  project: SuiteProject; slot: SuiteSlotConfig; draft?: { revision: number; value: SuiteSlotDraft | null };
  client: SuiteClient; blocked: boolean; flush: () => Promise<void>; onSubmit: (quote: SuiteQuote) => Promise<void>;
  onSaved: () => Promise<unknown>; onError: (error: unknown) => void
}) {
  const [models, setModels] = useState<PublicImageModel[]>([])
  const [loading, setLoading] = useState(true)
  const [modelId, setModel] = useState(draft?.value?.modelProfileId ?? '')
  const [resolution, setResolution] = useState<'1k' | '2k' | '4k'>(draft?.value?.resolution ?? '1k')
  const [count, setCount] = useState(draft?.value?.count ?? 1)
  const [note, setNote] = useState(draft?.value?.promptNote ?? '')
  const [quote, setQuote] = useState<SuiteQuote>()
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [expired, setExpired] = useState(false)
  const [draftConflict, setDraftConflict] = useState(false)
  const sequence = useRef(0)
  const alive = useRef(true)
  const draftRevision = useRef(draft?.revision ?? 0)
  const draftWrite = useRef<Promise<void>>()
  const dirtyDraft = useRef(false)
  const latestValues = useRef({ modelId, resolution, count, note })
  const [draftEdit, setDraftEdit] = useState(0)
  const model = models.find(item => item.id === modelId) ?? models[0]
  const actualResolution = model?.ui.resolutions.includes(resolution) ? resolution : model?.ui.resolutions[0] ?? '1k'
  const actualCount = Math.min(count, model?.ui.maxCount ?? 1)
  const strategy = SUITE_CATEGORY_TEMPLATES[project.config.subcategory].slots.find(item => item.key === slot.key)!.strategy
  const reuse = strategy !== 'image_edit'
  const unavailable = slot.kind === 'size' || (!reuse && !model) || !slot.enabled
  useEffect(() => {
    const abort = new AbortController(); alive.current = true
    void listImageModels('image_edit', abort.signal).then(items => { client.assertCurrent(); setModels(items) })
      .catch(error => { if (!abort.signal.aborted) onError(error) }).finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => { alive.current = false; abort.abort() }
  }, [client, onError])
  useEffect(() => {
    let cancelled = false
    void readLocalSuiteDraft(project.actor, project.id, slot.id).then(local => {
      if (cancelled || !local?.dirty || dirtyDraft.current) return
      const values = { modelId: local.value.modelProfileId ?? '', resolution: local.value.resolution, count: local.value.count, note: local.value.promptNote }
      latestValues.current = values
      draftRevision.current = local.value.expectedDraftRevision
      dirtyDraft.current = true
      setModel(values.modelId); setResolution(values.resolution); setCount(values.count); setNote(values.note); setDraftEdit(value => value + 1)
    }).catch(onError)
    return () => { cancelled = true }
  }, [project.actor, project.id, slot.id, onError])
  const saveDraft = async () => {
    if (draftWrite.current) await draftWrite.current
    if (!dirtyDraft.current) return
    const values = latestValues.current
    const payload: SuiteSlotDraft = { expectedDraftRevision: draftRevision.current,
      baseVersionId: project.slotHeads.find(head => head.slotId === slot.id)?.activeVersionId ?? null,
      promptNote: values.note, count: values.count, resolution: values.resolution, modelProfileId: values.modelId || null, layers: draft?.value?.layers ?? [] }
    const action = (async () => {
      await saveLocalSuiteDraft(project.actor, project.id, slot.id, { value: payload, dirty: true })
      const saved = await client.draft(project.id, slot.id, payload)
      draftRevision.current = saved.revision
      if (latestValues.current === values) dirtyDraft.current = false
      await saveLocalSuiteDraft(project.actor, project.id, slot.id, { value: { ...payload, expectedDraftRevision: saved.revision }, dirty: dirtyDraft.current })
    })().catch(error => {
      if (alive.current && error instanceof CloudError && error.status === 409) setDraftConflict(true)
      throw error
    })
    draftWrite.current = action
    try { await action } finally { if (draftWrite.current === action) draftWrite.current = undefined }
  }
  const saveLatest = useRef(saveDraft)
  useEffect(() => { saveLatest.current = saveDraft })
  useEffect(() => {
    if (!draftEdit || blocked) return
    const timer = setTimeout(() => { void saveLatest.current().catch(onError) }, 800)
    return () => clearTimeout(timer)
  }, [draftEdit, blocked, onError])
  useEffect(() => {
    if (!quote) return
    const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(quote.expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [quote])
  const change = (patch: Partial<typeof latestValues.current>) => {
    sequence.current++; setQuote(undefined)
    const values = { ...latestValues.current, ...patch }
    latestValues.current = values; dirtyDraft.current = true
    setModel(values.modelId); setResolution(values.resolution); setCount(values.count); setNote(values.note); setDraftEdit(value => value + 1)
    void saveLocalSuiteDraft(project.actor, project.id, slot.id, { value: { expectedDraftRevision: draftRevision.current,
      baseVersionId: project.slotHeads.find(head => head.slotId === slot.id)?.activeVersionId ?? null,
      promptNote: values.note, count: values.count, resolution: values.resolution, modelProfileId: values.modelId || null, layers: draft?.value?.layers ?? [] }, dirty: true }).catch(onError)
  }
  const prepare = async () => {
    setBusy(true)
    const revision = ++sequence.current
    try {
      await flush()
      await saveDraft()
      const saved = (await client.get(project.id)).project
      const updated = await client.draft(project.id, slot.id, { expectedDraftRevision: draftRevision.current,
        baseVersionId: saved.slotHeads.find(head => head.slotId === slot.id)?.activeVersionId ?? null,
        promptNote: note, count: reuse ? 1 : actualCount, resolution: actualResolution,
        modelProfileId: reuse ? null : model!.id, layers: draft?.value?.layers ?? [] })
      draftRevision.current = updated.revision
      await saveLocalSuiteDraft(project.actor, project.id, slot.id, { value: { ...updated.value, expectedDraftRevision: updated.revision }, dirty: false })
      await onSaved()
      const response = await client.quote(project.id, { expectedRevision: saved.revision,
        slots: [reuse ? { slotId: slot.id, mode: 'reuse' } : { slotId: slot.id, mode: 'image_edit',
          modelProfileId: model!.id, resolution: actualResolution, count: actualCount, note }] })
      if (alive.current && sequence.current === revision) { setAgreed(false); setExpired(false); setQuote(response) }
    } catch (error) { if (alive.current) onError(error) }
    finally { if (alive.current) setBusy(false) }
  }
  const submit = async () => {
    if (!quote || !agreed) return
    setBusy(true)
    try { await onSubmit(quote); if (alive.current) setQuote(undefined) }
    catch (error) { if (alive.current) onError(error) }
    finally { if (alive.current) setBusy(false) }
  }
  return <div className="suite-generation">
    <h3>{slot.name}</h3>
    {draftConflict && <Alert type="warning" message="云端生成要求已更新，本机要求已保留" action={<div className="suite-actions">
      <Button size="small" onClick={() => downloadBlob(new Blob([latestValues.current.note], { type: 'text/plain;charset=utf-8' }), '套图本机编辑要求.txt')}>保存本机要求</Button>
      <Button size="small" onClick={() => { void client.get(project.id).then(async data => {
        const cloud = data.drafts.find(item => item.slotId === slot.id)
        const values = { modelId: cloud?.value?.modelProfileId ?? '', resolution: cloud?.value?.resolution ?? '1k' as const, count: cloud?.value?.count ?? 1, note: cloud?.value?.promptNote ?? '' }
        latestValues.current = values; draftRevision.current = cloud?.revision ?? 0; dirtyDraft.current = false
        setModel(values.modelId); setResolution(values.resolution); setCount(values.count); setNote(values.note); setDraftConflict(false)
        if (cloud?.value) await saveLocalSuiteDraft(project.actor, project.id, slot.id, { value: { ...cloud.value, expectedDraftRevision: cloud.revision }, dirty: false })
      }).catch(onError) }}>读取云端要求</Button>
    </div>} />}
    <p className="suite-muted">{reuse ? slot.kind === 'size' ? '尺寸与标注将在图层阶段接入，目前可以先填写确认规格。' : strategy === 'detail_reference' ? '上传真实细节照片后保存为底图，不生成未知结构。' : '将已确认商品照片保存为主图底图，不调用图片模型。发布前仍需核对白底、留边与底图内容。'
      : '以原商品图为参考，生成后请核对外观与细节。每次只处理当前槽位。'}</p>
    {!reuse && <>
      <label>图片模型<ModelChoice ariaLabel="套图图片模型" models={models} value={model?.id} loading={loading} disabled={blocked || busy} placeholder={loading ? '正在加载模型' : '暂无可用模型'} hintScope="image_input" onChange={id => change({ modelId: id })} /></label>
      <div className="suite-settings-row"><label>分辨率<Select aria-label="套图分辨率" value={actualResolution} disabled={blocked || busy || !model} options={model?.ui.resolutions.map(value => ({ value, label: value.toUpperCase() }))} onChange={value => change({ resolution: value })} /></label>
        <label>候选数量<Select aria-label="候选数量" value={actualCount} disabled={blocked || busy || !model} options={Array.from({ length: Math.min(4, model?.ui.maxCount ?? 1) }, (_, index) => ({ value: index + 1, label: `${index + 1} 张` }))} onChange={value => change({ count: value })} /></label></div>
      <label>本槽位补充要求<Input.TextArea aria-label="本槽位补充要求" value={note} maxLength={Math.max(100, (model?.ui.promptMaxLength ?? 4000) - 800)} rows={5} disabled={busy || blocked} showCount onChange={event => change({ note: event.target.value })} /></label>
      <p className="suite-muted">比例跟随商品主体图。报价会显示模型规范化后的分辨率、预期尺寸与警告；最终像素以实际结果为准。</p>
    </>}
    {!slot.enabled && <Alert type="info" message="该槽位已跳过，可在商品资料中重新启用" />}
    <Button block type="primary" loading={busy || loading && !reuse} disabled={blocked || unavailable || draftConflict || (!reuse && loading)} onClick={() => { void prepare() }}>{reuse ? '预览原图复用计划' : '保存并获取当前槽位报价'}</Button>
    <p className="suite-muted">已提交原任务会按原任务规则继续；本阶段不提供整套后台派发。</p>
    <Modal open={Boolean(quote)} title={reuse ? '确认复用原图' : '确认单槽位生成'} onCancel={busy ? undefined : () => setQuote(undefined)} maskClosable={false}
      footer={<Button type="primary" loading={busy} disabled={!agreed || !quote || expired} onClick={() => { void submit() }}>{expired ? '报价已过期，请重新获取' : `确认${quote?.totalCredits ? `并提交 · ${quote.totalCredits} 积分上限` : '保存底图'}`}</Button>}>
      {quote?.items.map(item => <div key={item.operationId} className="suite-quote">
        <strong>{slot.name}</strong>
        {item.mode === 'image_edit' ? <><p>{models.find(model => model.id === item.modelProfileId)?.label ?? item.modelProfileId} · {item.resolution.toUpperCase()} · {item.count} 张候选</p>
          <p>预期尺寸 {item.size.width} × {item.size.height}；单价 {item.unitCredits} 积分／张；合计 {item.credits} 积分</p>
          {item.warnings?.map(warning => <Alert key={warning} type="warning" message={warning === 'RESOLUTION_DOWNGRADED_4K_UNSUPPORTED_RATIO'
            ? '当前比例不支持 4K，本次将按 2K 生成，请确认实际规格与费用' : '模型已调整输出规格，请核对本次分辨率、预期尺寸与费用'} />)}
          <details><summary>查看将提交的完整要求</summary><pre>{item.promptSnapshot}</pre></details>
        </> : <p>复用已持久保存的原图，不创建收费图片任务，生成费用为 0。</p>}
      </div>)}
      <p>报价有效期十分钟。候选按实际成功张数计费，最终只选一张也不退还其他成功候选的费用。原任务自行预扣和结算，失败后需手动重新确认。</p>
      <Checkbox checked={agreed} disabled={busy} onChange={event => setAgreed(event.target.checked)}>我已核对商品资料、处理方式和本次费用</Checkbox>
    </Modal>
  </div>
}
