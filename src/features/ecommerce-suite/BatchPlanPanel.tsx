import { useEffect, useRef, useState } from 'react'
import { Alert, App, Button, Checkbox, Modal, Select, Spin } from 'antd'
import { useTranslation } from 'react-i18next'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import type { SuiteQuote } from '@shared/ecommerce-suite'
import { SUITE_CATEGORY_TEMPLATES } from '@shared/ecommerce-suite-templates'
import { listImageModels, type PublicImageModel } from '@/services/api/imageModels'
import ModelChoice from '@/components/ModelChoice'
import type { SuiteClient } from './api'
import { getSlotUnreadyReason, type SuiteRetrySelection } from './batchPlan'
import { formatSuiteError, suiteSceneToneLabel, suiteSlotLabel } from './i18n'

export type { SuiteRetrySelection }

export default function BatchPlanPanel({ data, client, retry, blocked, flush, onSubmit, onClose, onError }: {
  data: SuiteProjectDetail; client: SuiteClient; retry?: SuiteRetrySelection; blocked: boolean;
  flush: () => Promise<void>; onSubmit: (quote: SuiteQuote) => Promise<void>; onClose: () => void; onError: (error: unknown) => void
}) {
  const { t } = useTranslation('ecommerce')
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
          if (!model) throw new Error(t('plan.errors.selectModel'))
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
        message.success(t('plan.quoteSuccessToast', { count: response.items.length, credits: response.totalCredits }))
        setTimeout(() => {
          quoteSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }, 60)
      }
    } catch (error) {
      if (alive.current) {
        const errorText = formatSuiteError(error, 'ecommerce:plan.errors.quoteFailed')
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
      title={retry ? t('plan.retryTitle') : t('plan.title')}
      onCancel={busy ? undefined : onClose}
      width={720}
      footer={quote ? (
        <>
          {!agreed && !expired && !blocked && <span className="suite-muted" style={{ marginRight: 12 }}>{t('plan.confirmCheckboxFirst')}</span>}
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
            {expired ? t('plan.expiredButton') : t('plan.submitButton', { credits: quote.totalCredits })}
          </Button>
        </>
      ) : (
        <Button
          type="primary"
          loading={busy || modelsLoading}
          disabled={blocked || !selected.length || modelsLoading || !model}
          onClick={() => { void prepare() }}
        >
          {busy ? t('plan.calculatingButton') : modelsLoading ? t('plan.loadingModelsButton') : t('plan.calculateButton')}
        </Button>
      )}
    >
      {planError && (
        <Alert
          type="error"
          showIcon
          closable
          message={t('plan.quoteFailedTitle')}
          description={planError}
          onClose={() => setPlanError(null)}
          style={{ marginBottom: 12 }}
        />
      )}
      <Alert
        type="info"
        message={t('plan.infoTitle')}
        description={t('plan.infoDesc')}
      />
      <p className="suite-muted">{t('plan.currentStyleNote', { tone: suiteSceneToneLabel(data.project.config.style.sceneTone) })}</p>
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
                {suiteSlotLabel(slot)}
              </Checkbox>
              {reason && <small>{reason}</small>}
            </label>
          )
        })}
      </div>
      <p className="suite-muted">{t('plan.sizeSlotHint')}</p>
      <label className="suite-plan-field">
        {t('plan.modelLabel')}
        <ModelChoice
          ariaLabel={t('plan.modelAria')}
          models={models}
          value={model?.id}
          loading={modelsLoading}
          disabled={busy || modelsLoading}
          hintScope="image_input"
          onChange={id => { invalidate(); setModelId(id) }}
        />
      </label>
      <label className="suite-plan-field">
        {t('plan.resolutionLabel')}
        <Select
          aria-label={t('plan.resolutionAria')}
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
          <span>{t('plan.calculatingHint')}</span>
        </div>
      )}

      {quote && (
        <div ref={quoteSectionRef} className="suite-quote-section" style={{ marginTop: 16 }}>
          {expired ? (
            <Alert
              type="warning"
              showIcon
              message={t('plan.quoteExpiredTitle')}
              description={t('plan.quoteExpiredDesc')}
              style={{ marginBottom: 14 }}
            />
          ) : (
            <Alert
              type="success"
              showIcon
              message={t('plan.quoteDoneTitle')}
              description={t('plan.quoteDoneDesc', { count: quote.items.length, credits: quote.totalCredits })}
              style={{ marginBottom: 14 }}
            />
          )}
          <div className="suite-plan-items">
            {quote.items.map(item => {
              const slot = data.project.config.slots.find(slot => slot.id === item.slotId)
              return (
                <div className="suite-quote" key={item.operationId}>
                  <strong>{slot ? suiteSlotLabel(slot) : undefined}</strong>
                  {item.mode === 'reuse' ? (
                    <p>{t('plan.itemReuseDesc')}</p>
                  ) : (
                    <>
                      <p>{t('plan.itemEditMeta', { model: models.find(model => model.id === item.modelProfileId)?.label ?? item.modelProfileId, resolution: item.resolution.toUpperCase(), count: item.count })}</p>
                      <p>{t('plan.itemEditPricing', { width: item.size.width, height: item.size.height, unitCredits: item.unitCredits, credits: item.credits })}</p>
                      {item.warnings?.length ? <Alert type="warning" message={t('plan.itemNormalizedWarning')} /> : null}
                      <details><summary>{t('plan.viewPromptDetail')}</summary><pre>{item.promptSnapshot}</pre></details>
                    </>
                  )}
                </div>
              )
            })}
          </div>
          <p className="suite-muted" style={{ margin: '12px 0 8px' }}>
            {t('plan.quoteSummaryLine', { count: quote.items.length, credits: quote.totalCredits })}
          </p>
          <Checkbox checked={agreed} disabled={busy || expired} onChange={event => setAgreed(event.target.checked)}>
            {t('plan.confirmCheckboxLabel')}
          </Checkbox>
          {expired && (
            <div style={{ marginTop: 8 }}>
              <Button onClick={() => { invalidate(); void prepare() }}>{t('plan.recalculateButton')}</Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
