import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Modal, Select } from 'antd'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import type { SuiteQuote } from '@shared/ecommerce-suite'
import { SUITE_CATEGORY_TEMPLATES } from '@shared/ecommerce-suite-templates'
import { listImageModels, type PublicImageModel } from '@/services/api/imageModels'
import ModelChoice from '@/components/ModelChoice'
import type { SuiteClient } from './api'

export interface SuiteRetrySelection { batchId: string; slotIds: string[] }

export default function BatchPlanPanel({ data, client, retry, blocked, flush, onSubmit, onClose, onError }: {
  data: SuiteProjectDetail; client: SuiteClient; retry?: SuiteRetrySelection; blocked: boolean;
  flush: () => Promise<void>; onSubmit: (quote: SuiteQuote) => Promise<void>; onClose: () => void; onError: (error: unknown) => void
}) {
  const [models, setModels] = useState<PublicImageModel[]>([])
  const [modelId, setModelId] = useState('')
  const [resolution, setResolution] = useState<'1k' | '2k' | '4k'>('1k')
  const [selected, setSelected] = useState<string[]>(retry?.slotIds ?? data.project.config.slots.filter(slot => slot.enabled && (slot.kind !== 'size' || data.project.config.facts.some(fact => fact.confirmed && ['dimension','capacity'].includes(fact.kind))) && (slot.kind !== 'detail' || slot.referenceAssetIds.length)).map(slot => slot.id))
  const [quote, setQuote] = useState<SuiteQuote>()
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [expired, setExpired] = useState(false)
  const sequence = useRef(0)
  const alive = useRef(true)
  const model = models.find(model => model.id === modelId) ?? models[0]
  const actualResolution = model?.ui.resolutions.includes(resolution) ? resolution : model?.ui.resolutions[0] ?? '1k'
  useEffect(() => {
    const abort = new AbortController(); alive.current = true
    void listImageModels('image_edit', abort.signal).then(models => { client.assertCurrent(); setModels(models) }).catch(error => { if (!abort.signal.aborted) onError(error) })
    return () => { alive.current = false; abort.abort() }
  }, [client, onError])
  useEffect(() => {
    if (!quote) return
    const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(quote.expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [quote])
  const invalidate = () => { sequence.current++; setQuote(undefined); setAgreed(false) }
  const prepare = async () => {
    const request = ++sequence.current
    setBusy(true)
    try {
      await flush()
      const saved = await client.get(data.project.id)
      const config = saved.project.config
      const response = await client.quote(data.project.id, { expectedRevision: saved.project.revision,
        ...(retry ? { retryOfBatchId: retry.batchId } : {}),
        slots: selected.map(id => {
          const slot = config.slots.find(slot => slot.id === id)!
          const strategy = SUITE_CATEGORY_TEMPLATES[config.subcategory].slots.find(template => template.key === slot.key)!.strategy
          if (strategy !== 'image_edit') return { slotId: id, mode: 'reuse' as const }
          if (!model) throw new Error('请先选择可用图片模型')
          return { slotId: id, mode: 'image_edit' as const, modelProfileId: model.id, resolution: actualResolution, count: 1,
            note: saved.drafts.find(draft => draft.slotId === id)?.value?.promptNote ?? '' }
        }) })
      if (alive.current && sequence.current === request) { setQuote(response); setAgreed(true); setExpired(false) }
    } catch (error) { if (alive.current) onError(error) }
    finally { if (alive.current) setBusy(false) }
  }
  return <Modal open className="suite-batch-plan" centered styles={{ body: { maxHeight: 'calc(100dvh - 220px)', overflowY: 'auto' } }} title={retry ? '重新生成未完成槽位' : '全套批量生成'} onCancel={busy ? undefined : onClose} width={720}
    footer={quote ? <Button type="primary" loading={busy} disabled={blocked || !agreed || expired} onClick={() => {
      if (!quote) return
      setBusy(true)
      void onSubmit(quote).then(() => { if (alive.current) onClose() }).catch(onError).finally(() => { if (alive.current) setBusy(false) })
    }}>{expired ? '已超时，请重新计算' : `开始批量生成 · ${quote.totalCredits} 积分上限`}</Button>
      : <Button type="primary" loading={busy} disabled={blocked || !selected.length} onClick={() => { void prepare() }}>计算预估费用</Button>}>
    <Alert type="info" message="批量生成说明" description="系统将为所选槽位批量生成场景展示图，按实际成功张数扣除积分，失败不扣费。生成后可逐槽位核对并设为当前使用。" />
    <p className="suite-muted">当前统一风格：{data.project.config.style.sceneTone || '默认风格'}。可在商品信息中随时调整风格与描述标签。</p>
    <div className="suite-plan-slots">{data.project.config.slots.map(slot => {
      const sourceRequired = slot.kind === 'detail'
      const reason = !slot.enabled ? '已跳过' : sourceRequired && !slot.referenceAssetIds.length ? '需细节参考图' : slot.kind === 'size' && !data.project.config.facts.some(fact => fact.confirmed && ['dimension','capacity'].includes(fact.kind)) ? '需添加尺寸规格' : ''
      return <label key={slot.id}><Checkbox checked={selected.includes(slot.id)} disabled={busy || Boolean(reason) || Boolean(retry && !retry.slotIds.includes(slot.id))}
        onChange={event => { invalidate(); setSelected(ids => event.target.checked ? [...ids, slot.id] : ids.filter(id => id !== slot.id)) }}>{slot.name}</Checkbox>{reason && <small>{reason}</small>}</label>
    })}</div>
    <p className="suite-muted">尺寸图支持添加文字与标注线，不单独调用生图模型；缺少尺寸规格时可先在商品信息中补充。</p>
    <label className="suite-plan-field">图片模型<ModelChoice ariaLabel="批次图片模型" models={models} value={model?.id} disabled={busy} hintScope="image_input" onChange={id => { invalidate(); setModelId(id) }} /></label>
    <label className="suite-plan-field">生成分辨率<Select aria-label="批次分辨率" value={actualResolution} disabled={busy || !model} options={model?.ui.resolutions.map(value => ({ value, label: value.toUpperCase() }))}
      onChange={value => { invalidate(); setResolution(value) }} /></label>
    {quote && <>
      <div className="suite-plan-items">{quote.items.map(item => <div className="suite-quote" key={item.operationId}>
        <strong>{data.project.config.slots.find(slot => slot.id === item.slotId)?.name}</strong>
        {item.mode === 'reuse' ? <p>复用已有底图，无生成费用</p> : <><p>{models.find(model => model.id === item.modelProfileId)?.label ?? item.modelProfileId} · {item.resolution.toUpperCase()} · {item.count} 张候选</p>
          <p>预期 {item.size.width} × {item.size.height}；单价 {item.unitCredits} 积分；合计 {item.credits} 积分</p>
          {item.warnings?.length ? <Alert type="warning" message="模型已自动规范化输出规格，请核对分辨率与费用" /> : null}
          <details><summary>查看生成提示词详情</summary><pre>{item.promptSnapshot}</pre></details></>}
      </div>)}</div>
      <p className="suite-muted">所选 {quote.items.length} 个槽位，最高预估消耗 {quote.totalCredits} 积分；按实际成功生成张数结算。</p>
      <Checkbox checked={agreed} disabled={busy || expired} onChange={event => setAgreed(event.target.checked)}>已核对生成槽位与费用上限</Checkbox>
      {expired && <Button onClick={() => { invalidate(); void prepare() }}>重新计算费用</Button>}
    </>}
  </Modal>
}
