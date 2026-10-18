import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Select } from 'antd'
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
  const [busy, setBusy] = useState(false)
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

  const change = (patch: Partial<SuiteSlotDraft>) => { sequence.current++; onEdit(patch) }

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
        await onSubmit(response)
      }
    } catch (error) {
      if (alive.current) onError(error)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return <div className="suite-generation">
    <h3>{slot.name}</h3>
    {draftConflict && <Alert type="warning" message={draft?.error} description="当前槽位有未保存修改，请先保存或重置后再生成。" />}
    <p className="suite-muted">{reuse ? slot.kind === 'size' ? '尺寸图支持添加文字与标注线；若有已标注的现成图片也可直接上传。' : strategy === 'detail_reference' ? '细节特写建议上传真实细节照片作为底图。' : '主图将保留纯白底与居中标准。'
      : '基于商品原图与卖点生成场景，每次针对当前槽位生成。'}</p>
    {!reuse && <>
      <label>图片模型<ModelChoice ariaLabel="套图图片模型" models={models} value={model?.id} loading={loading} disabled={blocked || busy} placeholder={loading ? '正在加载模型' : '暂无可用模型'} hintScope="image_input" onChange={id => change({ modelProfileId: id })} /></label>
      <div className="suite-settings-row"><label>分辨率<Select aria-label="套图分辨率" value={actualResolution} disabled={blocked || busy || !model} options={model?.ui.resolutions.map(value => ({ value, label: value.toUpperCase() }))} onChange={value => change({ resolution: value })} /></label>
        <label>生成数量<Select aria-label="候选数量" value={actualCount} disabled={blocked || busy || !model} options={Array.from({ length: Math.min(4, model?.ui.maxCount ?? 1) }, (_, index) => ({ value: index + 1, label: `${index + 1} 张` }))} onChange={value => change({ count: value })} /></label></div>
      <label>补充要求（选填）<Input.TextArea aria-label="本槽位补充要求" placeholder="例如：增加自然光、加一盆绿植，保持商品外观一致" value={note} maxLength={Math.max(100, (model?.ui.promptMaxLength ?? 4000) - 800)} rows={4} disabled={busy || blocked} showCount onChange={event => change({ promptNote: event.target.value })} /></label>
      <p className="suite-muted">图片比例与商品主体图保持一致。</p>
    </>}
    {!slot.enabled && <Alert type="info" message="该槽位已跳过，可在商品资料中重新启用" />}
    <Button block type="primary" loading={busy || (loading && !reuse)} disabled={blocked || unavailable || draftConflict || (!reuse && loading)} onClick={() => { void handleGenerate() }}>
      {busy ? '正在提交生成任务...' : reuse ? '确认底图设置' : '生成当前图片'}
    </Button>
    <p className="suite-muted">{reuse ? '使用原图或已上传的底图，不产生生成费用。' : '按实际成功张数扣除积分，失败或超时全额自动退还；生成后可在备选版本中查看。'}</p>
  </div>
}
