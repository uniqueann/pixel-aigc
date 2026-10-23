import { useEffect, useRef, useState } from 'react'
import { Alert, App, Button, Checkbox, Modal, Select, Spin } from 'antd'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import type { SuiteQuote } from '@shared/ecommerce-suite'
import { SUITE_CATEGORY_TEMPLATES } from '@shared/ecommerce-suite-templates'
import { listImageModels, type PublicImageModel } from '@/services/api/imageModels'
import ModelChoice from '@/components/ModelChoice'
import type { SuiteClient } from './api'
import { getSlotUnreadyReason, type SuiteRetrySelection } from './batchPlan'

export type { SuiteRetrySelection }

export default function BatchPlanPanel({ data, client, retry, blocked, flush, onSubmit, onClose, onError }: {
  data: SuiteProjectDetail; client: SuiteClient; retry?: SuiteRetrySelection; blocked: boolean;
  flush: () => Promise<void>; onSubmit: (quote: SuiteQuote) => Promise<void>; onClose: () => void; onError: (error: unknown) => void
}) {
  const { message } = App.useApp()
  const [models, setModels] = useState<PublicImageModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)
  const [modelId, setModelId] = useState('')
  const [resolution, setResolution] = useState<'1k' | '2k' | '4k'>('1k')
  const [selected, setSelected] = useState<string[]>(
    retry?.slotIds ??
    data.project.config.slots
      .filter(slot => !getSlotUnreadyReason(slot, data.project.config.subcategory, data.project.config.facts))
      .map(slot => slot.id)
  )
  const [quote, setQuote] = useState<SuiteQuote>()
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [expired, setExpired] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const sequence = useRef(0)
  const alive = useRef(true)
  const quoteSectionRef = useRef<HTMLDivElement>(null)
  const model = models.find(model => model.id === modelId) ?? models[0]
  const actualResolution = model?.ui.resolutions.includes(resolution) ? resolution : model?.ui.resolutions[0] ?? '1k'

  useEffect(() => {
    const abort = new AbortController()
    alive.current = true
    void listImageModels('image_edit', abort.signal)
      .then(models => {
        client.assertCurrent()
        setModels(models)
      })
      .catch(error => {
        if (!abort.signal.aborted) onError(error)
      })
      .finally(() => {
        if (!abort.signal.aborted) setModelsLoading(false)
      })
    return () => {
      alive.current = false
      abort.abort()
    }
  }, [client, onError])

  useEffect(() => {
    if (!quote) return
    const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(quote.expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [quote])

  const invalidate = () => {
    sequence.current++
    setQuote(undefined)
    setAgreed(false)
    setPlanError(null)
  }

  const prepare = async () => {
    const request = ++sequence.current
    setBusy(true)
    setPlanError(null)
    try {
      await flush()
      const saved = await client.get(data.project.id)
      const config = saved.project.config
      const response = await client.quote(data.project.id, {
        expectedRevision: saved.project.revision,
        ...(retry ? { retryOfBatchId: retry.batchId } : {}),
        slots: selected.map(id => {
          const slot = config.slots.find(slot => slot.id === id)!
          const strategy = SUITE_CATEGORY_TEMPLATES[config.subcategory].slots.find(template => template.key === slot.key)!.strategy
          if (strategy !== 'image_edit') return { slotId: id, mode: 'reuse' as const }
          if (!model) throw new Error('请先选择可用图片模型')
          return {
            slotId: id,
            mode: 'image_edit' as const,
            modelProfileId: model.id,
            resolution: actualResolution,
            count: 1,
            note: saved.drafts.find(draft => draft.slotId === id)?.value?.promptNote ?? '',
          }
        }),
      })
      if (alive.current && sequence.current === request) {
        setQuote(response)
        setAgreed(false)
        setExpired(false)
        setPlanError(null)
        message.success(`已完成费用预估，共 ${response.items.length} 个槽位，最高 ${response.totalCredits} 积分`)
        setTimeout(() => {
          quoteSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }, 60)
      }
    } catch (error) {
      if (alive.current) {
        const errorText = error instanceof Error ? error.message : '费用预估失败，请稍后重试'
        setPlanError(errorText)
        onError(error)
      }
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <Modal
      open
      className="suite-batch-plan"
      centered
      styles={{ body: { maxHeight: 'calc(100dvh - 220px)', overflowY: 'auto' } }}
      title={retry ? '重新生成未完成槽位' : '全套批量生成'}
      onCancel={busy ? undefined : onClose}
      width={720}
      footer={quote ? (
        <>
          {!agreed && !expired && !blocked && <span className="suite-muted" style={{ marginRight: 12 }}>请先勾选确认</span>}
          <Button
            type="primary"
            loading={busy}
            disabled={blocked || !agreed || expired}
            onClick={() => {
              if (!quote) return
              setBusy(true)
              void onSubmit(quote).then(() => { if (alive.current) onClose() }).catch(onError).finally(() => { if (alive.current) setBusy(false) })
            }}
          >
            {expired ? '已超时，请重新计算' : `开始批量生成 · ${quote.totalCredits} 积分上限`}
          </Button>
        </>
      ) : (
        <Button
          type="primary"
          loading={busy || modelsLoading}
          disabled={blocked || !selected.length || modelsLoading || !model}
          onClick={() => { void prepare() }}
        >
          {busy ? '正在计算预估费用...' : modelsLoading ? '正在加载模型配置...' : '计算预估费用'}
        </Button>
      )}
    >
      {planError && (
        <Alert
          type="error"
          showIcon
          closable
          message="费用预估未完成"
          description={planError}
          onClose={() => setPlanError(null)}
          style={{ marginBottom: 12 }}
        />
      )}
      <Alert
        type="info"
        message="批量生成说明"
        description="系统将为所选槽位批量生成场景展示图，按实际成功张数扣除积分，失败不扣费。生成后可逐槽位核对并设为当前使用。"
      />
      <p className="suite-muted">当前统一风格：{data.project.config.style.sceneTone || '默认风格'}。可在商品信息中随时调整风格与描述标签。</p>
      <div className="suite-plan-slots">
        {data.project.config.slots.map(slot => {
          const reason = getSlotUnreadyReason(slot, data.project.config.subcategory, data.project.config.facts)
          return (
            <label key={slot.id}>
              <Checkbox
                checked={selected.includes(slot.id)}
                disabled={busy || Boolean(reason) || Boolean(retry && !retry.slotIds.includes(slot.id))}
                onChange={event => {
                  invalidate()
                  setSelected(ids => event.target.checked ? [...ids, slot.id] : ids.filter(id => id !== slot.id))
                }}
              >
                {slot.name}
              </Checkbox>
              {reason && <small>{reason}</small>}
            </label>
          )
        })}
      </div>
      <p className="suite-muted">尺寸图支持添加文字与标注线，不单独调用生图模型；缺少尺寸规格或卖点时可先在“商品信息与规格”中补充并确认。</p>
      <label className="suite-plan-field">
        图片模型
        <ModelChoice
          ariaLabel="批次图片模型"
          models={models}
          value={model?.id}
          loading={modelsLoading}
          disabled={busy || modelsLoading}
          hintScope="image_input"
          onChange={id => { invalidate(); setModelId(id) }}
        />
      </label>
      <label className="suite-plan-field">
        生成分辨率
        <Select
          aria-label="批次分辨率"
          value={actualResolution}
          disabled={busy || modelsLoading || !model}
          options={model?.ui.resolutions.map(value => ({ value, label: value.toUpperCase() }))}
          onChange={value => { invalidate(); setResolution(value) }}
        />
      </label>

      {busy && !quote && (
        <div
          className="suite-plan-loading"
          style={{
            textAlign: 'center',
            padding: '16px 0',
            color: 'var(--color-text-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <Spin size="small" />
          <span>正在核对所选槽位并计算预估费用…</span>
        </div>
      )}

      {quote && (
        <div ref={quoteSectionRef} className="suite-quote-section" style={{ marginTop: 16 }}>
          {expired ? (
            <Alert
              type="warning"
              showIcon
              message="预估已超时"
              description="费用预估已超时失效，请重新计算后再开始批量生成。"
              style={{ marginBottom: 14 }}
            />
          ) : (
            <Alert
              type="success"
              showIcon
              message="费用预估已完成"
              description={`已核算 ${quote.items.length} 个槽位的生成参数，最高预估消耗 ${quote.totalCredits} 积分（按实际成功生成张数扣除积分，失败不扣费）。请核对下方明细并勾选确认。`}
              style={{ marginBottom: 14 }}
            />
          )}
          <div className="suite-plan-items">
            {quote.items.map(item => (
              <div className="suite-quote" key={item.operationId}>
                <strong>{data.project.config.slots.find(slot => slot.id === item.slotId)?.name}</strong>
                {item.mode === 'reuse' ? (
                  <p>复用已有底图，无生成费用</p>
                ) : (
                  <>
                    <p>{models.find(model => model.id === item.modelProfileId)?.label ?? item.modelProfileId} · {item.resolution.toUpperCase()} · {item.count} 张候选</p>
                    <p>预期 {item.size.width} × {item.size.height}；单价 {item.unitCredits} 积分；合计 {item.credits} 积分</p>
                    {item.warnings?.length ? <Alert type="warning" message="模型已自动规范化输出规格，请核对分辨率与费用" /> : null}
                    <details><summary>查看生成提示词详情</summary><pre>{item.promptSnapshot}</pre></details>
                  </>
                )}
              </div>
            ))}
          </div>
          <p className="suite-muted" style={{ margin: '12px 0 8px' }}>
            所选 {quote.items.length} 个槽位，最高预估消耗 {quote.totalCredits} 积分；按实际成功生成张数结算。
          </p>
          <Checkbox checked={agreed} disabled={busy || expired} onChange={event => setAgreed(event.target.checked)}>
            已核对生成槽位与费用上限
          </Checkbox>
          {expired && (
            <div style={{ marginTop: 8 }}>
              <Button onClick={() => { invalidate(); void prepare() }}>重新计算费用</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
