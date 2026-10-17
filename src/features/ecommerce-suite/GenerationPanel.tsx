import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Input, Modal, Select } from 'antd'
import type { SuiteProject, SuiteQuote, SuiteSlotConfig, SuiteSlotDraft } from '@shared/ecommerce-suite'
import { SUITE_CATEGORY_TEMPLATES } from '@shared/ecommerce-suite-templates'
import { listImageModels, type PublicImageModel } from '@/services/api/imageModels'
import ModelChoice from '@/components/ModelChoice'
import type { SuiteClient } from './api'

export default function GenerationPanel({ project, slot, draft, client, blocked, flush, onSubmit, onEdit, flushDraft, onError }: {
  project: SuiteProject; slot: SuiteSlotConfig; draft?: { value: SuiteSlotDraft; error?: string };
  client: SuiteClient; blocked: boolean; flush: () => Promise<void>; onSubmit: (quote: SuiteQuote) => Promise<void>;
  onEdit: (patch: Partial<SuiteSlotDraft>) => void; flushDraft: () => Promise<void>; onError: (error: unknown) => void
}) {
  const [models, setModels] = useState<PublicImageModel[]>([])
  const [loading, setLoading] = useState(true)
  const modelId = draft?.value.modelProfileId ?? ''
  const resolution = draft?.value.resolution ?? '1k'
  const count = draft?.value.count ?? 1
  const note = draft?.value.promptNote ?? ''
  const [quote, setQuote] = useState<SuiteQuote>()
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [expired, setExpired] = useState(false)
  const draftConflict = Boolean(draft?.error)
  const sequence = useRef(0)
  const alive = useRef(true)
  const model = models.find(item => item.id === modelId) ?? models[0]
  const actualResolution = model?.ui.resolutions.includes(resolution) ? resolution : model?.ui.resolutions[0] ?? '1k'
  const actualCount = Math.min(count, model?.ui.maxCount ?? 1)
  const strategy = SUITE_CATEGORY_TEMPLATES[project.config.subcategory].slots.find(item => item.key === slot.key)!.strategy
  const reuse = strategy !== 'image_edit'
  const unavailable = (!reuse && !model) || !slot.enabled
  useEffect(() => {
    const abort = new AbortController(); alive.current = true
    void listImageModels('image_edit', abort.signal).then(items => { client.assertCurrent(); setModels(items) })
      .catch(error => { if (!abort.signal.aborted) onError(error) }).finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => { alive.current = false; abort.abort() }
  }, [client, onError])
  useEffect(() => {
    if (!quote) return
    const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(quote.expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [quote])
  const change = (patch: Partial<SuiteSlotDraft>) => { sequence.current++; setQuote(undefined); onEdit(patch) }
  const prepare = async () => {
    setBusy(true)
    const revision = ++sequence.current
    try {
      await flush()
      await flushDraft()
      const saved = (await client.get(project.id)).project
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
    {draftConflict && <Alert type="warning" message={draft?.error} description="请在文字与标注页签处理草稿冲突，生成参数与图层共用保存修订。" />}
    <p className="suite-muted">{reuse ? slot.kind === 'size' ? '请先确认规格并上传已核对标注的尺寸成品，本次仅复用图片；也可先复用原图再在文字与标注中添加已确认规格。' : strategy === 'detail_reference' ? '上传真实细节照片后保存为底图，不生成未知结构。' : '将已确认商品照片保存为主图底图，不调用图片模型。发布前仍需核对白底、留边与底图内容。'
      : '以原商品图为参考，生成后请核对外观与细节。每次只处理当前槽位。'}</p>
    {!reuse && <>
      <label>图片模型<ModelChoice ariaLabel="套图图片模型" models={models} value={model?.id} loading={loading} disabled={blocked || busy} placeholder={loading ? '正在加载模型' : '暂无可用模型'} hintScope="image_input" onChange={id => change({ modelProfileId: id })} /></label>
      <div className="suite-settings-row"><label>分辨率<Select aria-label="套图分辨率" value={actualResolution} disabled={blocked || busy || !model} options={model?.ui.resolutions.map(value => ({ value, label: value.toUpperCase() }))} onChange={value => change({ resolution: value })} /></label>
        <label>候选数量<Select aria-label="候选数量" value={actualCount} disabled={blocked || busy || !model} options={Array.from({ length: Math.min(4, model?.ui.maxCount ?? 1) }, (_, index) => ({ value: index + 1, label: `${index + 1} 张` }))} onChange={value => change({ count: value })} /></label></div>
      <label>本槽位补充要求<Input.TextArea aria-label="本槽位补充要求" value={note} maxLength={Math.max(100, (model?.ui.promptMaxLength ?? 4000) - 800)} rows={5} disabled={busy || blocked} showCount onChange={event => change({ promptNote: event.target.value })} /></label>
      <p className="suite-muted">比例跟随商品主体图。报价会显示模型规范化后的分辨率、预期尺寸与警告；最终像素以实际结果为准。</p>
    </>}
    {!slot.enabled && <Alert type="info" message="该槽位已跳过，可在商品资料中重新启用" />}
    <Button block type="primary" loading={busy || loading && !reuse} disabled={blocked || unavailable || draftConflict || (!reuse && loading)} onClick={() => { void prepare() }}>{reuse ? '预览原图复用计划' : '保存并获取当前槽位报价'}</Button>
    <p className="suite-muted">确认后等待服务端派发，结果先保存候选供显式选用；费用按原账本处理，失败仅手动重试。</p>
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
