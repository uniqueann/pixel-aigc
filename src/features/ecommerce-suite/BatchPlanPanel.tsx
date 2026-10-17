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
  const [selected, setSelected] = useState<string[]>(retry?.slotIds ?? data.project.config.slots.filter(slot => slot.enabled && slot.kind !== 'size' && (slot.kind !== 'detail' || slot.referenceAssetIds.length)).map(slot => slot.id))
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
      if (alive.current && sequence.current === request) { setQuote(response); setAgreed(false); setExpired(false) }
    } catch (error) { if (alive.current) onError(error) }
    finally { if (alive.current) setBusy(false) }
  }
  return <Modal open className="suite-batch-plan" centered styles={{ body: { maxHeight: 'calc(100dvh - 220px)', overflowY: 'auto' } }} title={retry ? '重新确认未执行或失败槽位' : '整套计划与统一风格重生成'} onCancel={busy ? undefined : onClose} width={720}
    footer={quote ? <Button type="primary" loading={busy} disabled={blocked || !agreed || expired} onClick={() => {
      if (!quote) return
      setBusy(true)
      void onSubmit(quote).then(() => { if (alive.current) onClose() }).catch(onError).finally(() => { if (alive.current) setBusy(false) })
    }}>{expired ? '报价已过期，请重新获取' : `确认计划 · ${quote.totalCredits} 积分上限`}</Button>
      : <Button type="primary" loading={busy} disabled={blocked || !selected.length} onClick={() => { void prepare() }}>保存资料并预览逐项报价</Button>}>
    <Alert type="info" message="每槽位默认一张候选，按原任务的成功候选计费" description="已接收的计划等待服务端派发，结果先保存候选供显式选用。停止只影响未创建原任务的项；失败仅在手动重新确认后发起新尝试。" />
    <p>统一风格：{data.project.config.style.sceneTone}；配色 {data.project.config.style.palette.join('、')}。需修改时先在商品资料保存新风格，重生成保留旧版本。</p>
    <div className="suite-plan-slots">{data.project.config.slots.map(slot => {
      const sourceRequired = slot.kind === 'detail' || slot.kind === 'size'
      const reason = !slot.enabled ? '已跳过' : sourceRequired && !slot.referenceAssetIds.length ? slot.kind === 'size' ? '需上传已核对标注的尺寸成品' : '需真实细节照片' : ''
      return <label key={slot.id}><Checkbox checked={selected.includes(slot.id)} disabled={busy || Boolean(reason) || Boolean(retry && !retry.slotIds.includes(slot.id))}
        onChange={event => { invalidate(); setSelected(ids => event.target.checked ? [...ids, slot.id] : ids.filter(id => id !== slot.id)) }}>{slot.name}</Checkbox>{reason && <small>{reason}</small>}</label>
    })}</div>
    <p className="suite-muted">尺寸图仅复用已上传、已核对的标注成品，不会自动绘制标注。缺少已确认事实的槽位会在报价时提示补充，不猜测商品参数。</p>
    <label className="suite-plan-field">本批次图片模型<ModelChoice ariaLabel="批次图片模型" models={models} value={model?.id} disabled={busy} hintScope="image_input" onChange={id => { invalidate(); setModelId(id) }} /></label>
    <label className="suite-plan-field">生成分辨率<Select aria-label="批次分辨率" value={actualResolution} disabled={busy || !model} options={model?.ui.resolutions.map(value => ({ value, label: value.toUpperCase() }))}
      onChange={value => { invalidate(); setResolution(value) }} /></label>
    {quote && <>
      <div className="suite-plan-items">{quote.items.map(item => <div className="suite-quote" key={item.operationId}>
        <strong>{data.project.config.slots.find(slot => slot.id === item.slotId)?.name}</strong>
        {item.mode === 'reuse' ? <p>复用已保存图片，无生成费用</p> : <><p>{models.find(model => model.id === item.modelProfileId)?.label ?? item.modelProfileId} · {item.resolution.toUpperCase()} · {item.count} 张候选</p>
          <p>预期 {item.size.width} × {item.size.height}；单价 {item.unitCredits} 积分；合计 {item.credits} 积分</p>
          {item.warnings?.length ? <Alert type="warning" message="模型已规范化输出规格，请核对本项分辨率、像素和价格" /> : null}
          <details><summary>完整生成要求与确认事实</summary><pre>{item.promptSnapshot}</pre></details></>}
      </div>)}</div>
      <p>{quote.items.length} 个目标槽位，预算上限 {quote.totalCredits} 积分；报价十分钟有效，接受后首次派发窗口为三十分钟。未派发项不预扣，模型或价格变化需重新确认。</p>
      <Checkbox checked={agreed} disabled={busy || expired} onChange={event => setAgreed(event.target.checked)}>已核对槽位、输入资料、模型实际规格与费用上限</Checkbox>
      {expired && <Button onClick={() => { invalidate(); void prepare() }}>重新获取报价</Button>}
    </>}
  </Modal>
}
