import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Select } from 'antd'
import { useTranslation } from 'react-i18next'
import type { SuiteProject, SuiteQuote, SuiteSlotConfig, SuiteSlotDraft } from '@shared/ecommerce-suite'
import { SUITE_CATEGORY_TEMPLATES } from '@shared/ecommerce-suite-templates'
import { listImageModels, type PublicImageModel } from '@/services/api/imageModels'
import ModelChoice from '@/components/ModelChoice'
import type { SuiteClient } from './api'
import { suiteSlotLabel } from './i18n'

export default function GenerationPanel({ project, slot, draft, client, blocked, flush, onSubmit, onEdit, flushDraft, onError }: {
  project: SuiteProject; slot: SuiteSlotConfig; draft?: { value: SuiteSlotDraft; error?: string };
  client: SuiteClient; blocked: boolean; flush: () => Promise<void>; onSubmit: (quote: SuiteQuote) => Promise<void>;
  onEdit: (patch: Partial<SuiteSlotDraft>) => void; flushDraft: () => Promise<void>; onError: (error: unknown) => void
}) {
  const { t } = useTranslation('ecommerce')
  const [models, setModels] = useState<PublicImageModel[]>([])
  const [loading, setLoading] = useState(true)
  const modelId = draft?.value.modelProfileId ?? ''
  const resolution = draft?.value.resolution ?? '1k'
  const count = draft?.value.count ?? 1
  const note = draft?.value.promptNote ?? ''
  const [busy, setBusy] = useState(false)
  const [quote, setQuote] = useState<SuiteQuote>()
  const [expired, setExpired] = useState(false)
  const draftConflict = Boolean(draft?.error)
  const sequence = useRef(0)
  const alive = useRef(true)
  const model = models.find(item => item.id === modelId) ?? models[0]
  const actualResolution = model?.ui.resolutions.includes(resolution) ? resolution : model?.ui.resolutions[0] ?? '1k'
  const actualCount = Math.min(count, model?.ui.maxCount ?? 1)
  const strategy = SUITE_CATEGORY_TEMPLATES[project.config.subcategory].slots.find(item => item.key === slot.key)!.strategy
  const reuse = strategy !== 'image_edit'
  const quotedCount = quote?.items.reduce((sum, item) => sum + item.count, 0) ?? 0
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

  const discardQuote = () => { setQuote(undefined); setExpired(false) }
  const change = (patch: Partial<SuiteSlotDraft>) => { sequence.current++; discardQuote(); onEdit(patch) }

  const submitQuote = async (confirmed: SuiteQuote) => {
    setBusy(true)
    try {
      await onSubmit(confirmed)
      if (alive.current) discardQuote()
    } catch (error) {
      if (alive.current) { discardQuote(); onError(error) }
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const handleGenerate = async () => {
    setBusy(true)
    const revision = ++sequence.current
    try {
      await flush()
      await flushDraft()
      const saved = (await client.get(project.id)).project
      const response = await client.quote(project.id, {
        expectedRevision: saved.revision,
        slots: [reuse ? { slotId: slot.id, mode: 'reuse' } : {
          slotId: slot.id, mode: 'image_edit',
          modelProfileId: model!.id, resolution: actualResolution, count: actualCount, note,
        }],
      })
      if (alive.current && sequence.current === revision) {
        if (reuse) {
          await onSubmit(response)
        } else {
          setQuote(response)
          setExpired(false)
        }
      }
    } catch (error) {
      if (alive.current) onError(error)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return <div className="suite-generation">
    <h3>{suiteSlotLabel(slot)}</h3>
    {draftConflict && <Alert type="warning" message={draft?.error} description={t('generation.draftConflictDesc')} />}
    <p className="suite-muted">{reuse ? slot.kind === 'size' ? t('generation.descReuseSize') : strategy === 'detail_reference' ? t('generation.descReuseDetail') : t('generation.descReuseMain')
      : t('generation.descImageEdit')}</p>
    {!reuse && <>
      <label>{t('generation.modelLabel')}<ModelChoice ariaLabel={t('generation.modelAria')} models={models} value={model?.id} loading={loading} disabled={blocked || busy} placeholder={loading ? t('generation.loadingModels') : t('generation.noModels')} hintScope="image_input" onChange={id => change({ modelProfileId: id })} /></label>
      <div className="suite-settings-row"><label>{t('generation.resolutionLabel')}<Select aria-label={t('generation.resolutionAria')} value={actualResolution} disabled={blocked || busy || !model} options={model?.ui.resolutions.map(value => ({ value, label: value.toUpperCase() }))} onChange={value => change({ resolution: value })} /></label>
        <label>{t('generation.countLabel')}<Select aria-label={t('generation.countAria')} value={actualCount} disabled={blocked || busy || !model} options={Array.from({ length: Math.min(4, model?.ui.maxCount ?? 1) }, (_, index) => ({ value: index + 1, label: t('generation.countOption', { count: index + 1 }) }))} onChange={value => change({ count: value })} /></label></div>
      <label>{t('generation.noteLabel')}<Input.TextArea aria-label={t('generation.noteAria')} placeholder={t('generation.notePlaceholder')} value={note} maxLength={Math.max(100, (model?.ui.promptMaxLength ?? 4000) - 800)} rows={4} disabled={busy || blocked} showCount onChange={event => change({ promptNote: event.target.value })} /></label>
      <p className="suite-muted">{t('generation.aspectRatioHint')}</p>
    </>}
    {!slot.enabled && <Alert type="info" message={t('generation.slotSkippedNotice')} />}
    {quote && !reuse && (expired
      ? <Alert type="warning" showIcon message={t('generation.quoteExpiredTitle')} description={t('generation.quoteExpiredDesc')} />
      : <Alert type="info" showIcon message={t('generation.quoteReadyTitle', { count: quotedCount, credits: quote.totalCredits })}
        description={t('generation.quoteReadyDesc')} />)}
    {quote && !reuse
      ? <div className="suite-generation-confirm" style={{ display: 'flex', gap: 8 }}>
        <Button disabled={busy} onClick={discardQuote}>{t('generation.backToEdit')}</Button>
        {expired
          ? <Button type="primary" style={{ flex: 1 }} loading={busy} disabled={blocked || draftConflict} onClick={() => { void handleGenerate() }}>{t('generation.recalculate')}</Button>
          : <Button type="primary" style={{ flex: 1 }} loading={busy} disabled={blocked || draftConflict} onClick={() => { void submitQuote(quote) }}>
            {busy ? t('generation.submitting') : t('generation.confirmGenerate', { count: quotedCount, credits: quote.totalCredits })}
          </Button>}
      </div>
      : <Button block type="primary" loading={busy || (loading && !reuse)} disabled={blocked || unavailable || draftConflict || (!reuse && loading)} onClick={() => { void handleGenerate() }}>
        {busy ? (reuse ? t('generation.submitting') : t('generation.calculating')) : reuse ? t('generation.confirmReuseFree') : t('generation.estimateButton', { count: actualCount, resolution: actualResolution.toUpperCase() })}
      </Button>}
    <p className="suite-muted">{reuse ? t('generation.footerReuse') : t('generation.footerImageEdit')}</p>
  </div>
}
